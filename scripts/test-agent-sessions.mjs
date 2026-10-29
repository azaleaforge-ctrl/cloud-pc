import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const temp=await mkdtemp(join(tmpdir(),'rk-agent-sessions-'));
const userData=join(temp,'user-data');
const workspace=join(temp,'workspace');
const require=createRequire(import.meta.url);
let passed=0,failed=0;
async function test(name,fn){
  try{await fn();passed++;console.log('PASS '+name);}
  catch(error){failed++;console.error('FAIL '+name+': '+(error instanceof Error?error.stack:String(error)));}
}
try{
  await mkdir(workspace,{recursive:true});
  const bundle=join(temp,'agentSessionStore.cjs');
  await build({
    entryPoints:[join(root,'src/main/editor/agentSessionStore.ts')],
    bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent',
  });
  const api=require(bundle);

  await test('saves and reloads full session data without localStorage',async()=>{
    const messages=[
      {id:'u1',role:'user',content:'Buat komponen dashboard',ts:100,runId:'llm_run_123'},
      {id:'a1',role:'assistant',content:'Saya akan memeriksa project dahulu.',ts:101},
    ];
    const saved=await api.saveAgentSession(userData,{id:'chat-one',messages,projectPath:workspace,activeAgentId:'poolside',todos:[]});
    assert.equal(saved.id,'chat-one');
    const loaded=await api.loadAgentSession(userData,'chat-one');
    assert.ok(loaded);
    assert.equal(loaded.messages.length,2);
    assert.equal(loaded.messages[0].content,'Buat komponen dashboard');
    assert.equal(loaded.messages[0].runId,'llm_run_123');
    assert.equal(loaded.messages[1].runId,undefined);
    assert.equal(loaded.projectPath,workspace);
    assert.equal(loaded.activeAgentId,'poolside');
    assert.equal(loaded.schemaVersion,1);
  });

  await test('lists sessions by last update and derives a stable title/preview',async()=>{
    await api.saveAgentSession(userData,{id:'chat-two',messages:[{id:'u2',role:'user',content:'Perbaiki terminal',ts:200}]});
    const list=await api.listAgentSessions(userData);
    const second=list.find(item=>item.id==='chat-two');
    const first=list.find(item=>item.id==='chat-one');
    assert.ok(second);
    assert.equal(second.title,'Perbaiki terminal');
    assert.equal(second.messageCount,1);
    assert.ok(first);
  });

  await test('generates compact context summaries while retaining the visible transcript',async()=>{
    const messages=Array.from({length:105},(_,index)=>({
      id:'m'+index,role:index%2===0?'user':'assistant',
      content:(index%2===0?'User request ':'Assistant result ')+index+' '.repeat(20),ts:index+1,
    }));
    const saved=await api.saveAgentSession(userData,{id:'chat-compaction',messages});
    const loaded=await api.loadAgentSession(userData,'chat-compaction');
    assert.equal(loaded.messages.length,105);
    assert.ok(loaded.summary.length>0);
    assert.ok(loaded.summaryThroughTs>0);
    assert.equal(saved.hasSummary,true);
    assert.ok(loaded.summary.length<=12_000);
  });

  await test('stores a file checkpoint and restores then re-applies it with redo',async()=>{
    const file=join(workspace,'example.ts');
    await writeFile(file,'before','utf8');
    await api.saveAgentSession(userData,{id:'chat-rewind',messages:[],projectPath:workspace});
    const change={
      id:'change-1',path:'example.ts',operation:'modify',oldContent:'before',newContent:'after',
      addedLines:1,removedLines:1,changedAt:Date.now(),
    };
    await writeFile(file,'after','utf8'); // Simulate write_project_file before checkpoint persistence.
    const checkpoint=await api.recordAgentFileCheckpoint(userData,'chat-rewind','run-1',workspace,change);
    assert.equal(checkpoint.files.length,1);
    const rewind=await api.rewindAgentCheckpoint(userData,'chat-rewind',workspace,checkpoint.id);
    assert.equal(rewind.ok,true);
    assert.equal(await readFile(file,'utf8'),'before');
    const redo=await api.redoAgentCheckpoint(userData,'chat-rewind',workspace,checkpoint.id);
    assert.equal(redo.ok,true);
    assert.equal(await readFile(file,'utf8'),'after');
    const checkpoints=await api.listAgentCheckpoints(userData,'chat-rewind');
    assert.equal(checkpoints[0].status,'applied');
    assert.deepEqual(checkpoints[0].paths,['example.ts']);
  });

  await test('rewind of an agent-created file deletes it and redo restores it',async()=>{
    const file=join(workspace,'created-by-agent.txt');
    await rm(file,{force:true});
    await api.saveAgentSession(userData,{id:'chat-created',messages:[],projectPath:workspace});
    await writeFile(file,'created contents','utf8'); // Checkpoints are recorded after the tool writes the file.
    const checkpoint=await api.recordAgentFileCheckpoint(userData,'chat-created','run-create',workspace,{
      id:'change-create',path:'created-by-agent.txt',operation:'create',oldContent:'',newContent:'created contents',
      addedLines:1,removedLines:0,changedAt:Date.now(),
    });
    const rewind=await api.rewindAgentCheckpoint(userData,'chat-created',workspace,checkpoint.id);
    assert.equal(rewind.ok,true);
    await assert.rejects(()=>stat(file));
    const redo=await api.redoAgentCheckpoint(userData,'chat-created',workspace,checkpoint.id);
    assert.equal(redo.ok,true);
    assert.equal(await readFile(file,'utf8'),'created contents');
  });

  await test('refuses rewind if the target was manually modified after checkpoint',async()=>{
    const file=join(workspace,'manual-conflict.txt');
    await writeFile(file,'agent edit','utf8');
    await api.saveAgentSession(userData,{id:'chat-conflict',messages:[],projectPath:workspace});
    const checkpoint=await api.recordAgentFileCheckpoint(userData,'chat-conflict','run-conflict',workspace,{
      id:'change-conflict',path:'manual-conflict.txt',operation:'modify',oldContent:'before',newContent:'agent edit',
      addedLines:1,removedLines:1,changedAt:Date.now(),
    });
    await writeFile(file,'manual user edit','utf8');
    const result=await api.rewindAgentCheckpoint(userData,'chat-conflict',workspace,checkpoint.id);
    assert.equal(result.ok,false);
    assert.match(result.message,/berubah/i);
    assert.equal(await readFile(file,'utf8'),'manual user edit');
  });

  await test('preserves prior run checkpoint when a later file would exceed its size budget',async()=>{
    await api.saveAgentSession(userData,{id:'chat-checkpoint-budget',messages:[],projectPath:workspace});
    const contents=[];
    for(let index=0;index<4;index++) {
      const name='budget-'+index+'.txt';
      const oldContent='o'.repeat(950_000);
      const newContent='n'.repeat(950_000);
      await writeFile(join(workspace,name),newContent,'utf8');
      contents.push({id:'budget-'+index,path:name,operation:'modify',oldContent,newContent,addedLines:1,removedLines:1,changedAt:Date.now()});
      await api.recordAgentFileCheckpoint(userData,'chat-checkpoint-budget','budget-run',workspace,contents[index]);
    }
    const tooLarge={id:'budget-overflow',path:'budget-overflow.txt',operation:'create',oldContent:'',newContent:'n'.repeat(900_000),addedLines:1,removedLines:0,changedAt:Date.now()};
    await writeFile(join(workspace,tooLarge.path),tooLarge.newContent,'utf8');
    await assert.rejects(
      () => api.recordAgentFileCheckpoint(userData,'chat-checkpoint-budget','budget-run',workspace,tooLarge),
      /Checkpoint melebihi batas ukuran/,
    );
    const checkpoints=await api.listAgentCheckpoints(userData,'chat-checkpoint-budget');
    assert.equal(checkpoints.length,1);
    assert.equal(checkpoints[0].runId,'budget-run');
    assert.deepEqual(checkpoints[0].paths,['budget-0.txt','budget-1.txt','budget-2.txt','budget-3.txt']);
  });

  await test('validates every file in a multi-file rewind before changing any file',async()=>{
    const first=join(workspace,'multi-first.txt');
    const second=join(workspace,'multi-second.txt');
    await writeFile(first,'before first','utf8');
    await writeFile(second,'before second','utf8');
    await api.saveAgentSession(userData,{id:'chat-multi-conflict',messages:[],projectPath:workspace});
    await writeFile(first,'agent first','utf8');
    await api.recordAgentFileCheckpoint(userData,'chat-multi-conflict','run-multi',workspace,{
      id:'change-first',path:'multi-first.txt',operation:'modify',oldContent:'before first',newContent:'agent first',
      addedLines:1,removedLines:1,changedAt:Date.now(),
    });
    await writeFile(second,'agent second','utf8');
    const checkpoint=await api.recordAgentFileCheckpoint(userData,'chat-multi-conflict','run-multi',workspace,{
      id:'change-second',path:'multi-second.txt',operation:'modify',oldContent:'before second',newContent:'agent second',
      addedLines:1,removedLines:1,changedAt:Date.now(),
    });
    await writeFile(second,'manual second','utf8');
    const result=await api.rewindAgentCheckpoint(userData,'chat-multi-conflict',workspace,checkpoint.id);
    assert.equal(result.ok,false);
    assert.equal(await readFile(first,'utf8'),'agent first');
    assert.equal(await readFile(second,'utf8'),'manual second');
  });

  await test('refuses checkpoint paths outside the workspace and workspace mismatch',async()=>{
    await api.saveAgentSession(userData,{id:'chat-boundary',messages:[],projectPath:workspace});
    await assert.rejects(()=>api.recordAgentFileCheckpoint(userData,'chat-boundary','run-bad',workspace,{
      id:'bad',path:'../outside.txt',operation:'create',oldContent:'',newContent:'bad',addedLines:1,removedLines:0,changedAt:Date.now(),
    }));
    const file=join(workspace,'inside.txt');
    await writeFile(file,'new','utf8');
    const checkpoint=await api.recordAgentFileCheckpoint(userData,'chat-boundary','run-safe',workspace,{
      id:'inside',path:'inside.txt',operation:'modify',oldContent:'old',newContent:'new',addedLines:1,removedLines:1,changedAt:Date.now(),
    });
    const elsewhere=join(temp,'elsewhere');
    await mkdir(elsewhere,{recursive:true});
    const result=await api.rewindAgentCheckpoint(userData,'chat-boundary',elsewhere,checkpoint.id);
    assert.equal(result.ok,false);
    assert.match(result.message,/Workspace berbeda/i);
  });

  await test('deletes only the selected session and its own memory file',async()=>{
    const memory=join(userData,'ai-memory','sessions');
    await mkdir(memory,{recursive:true});
    await writeFile(join(memory,'chat-one.md'),'delete me','utf8');
    await writeFile(join(memory,'chat-keep.md'),'keep me','utf8');
    const deleted=await api.deleteAgentSession(userData,'chat-one');
    assert.equal(deleted,true);
    assert.equal(await api.loadAgentSession(userData,'chat-one'),null);
    await assert.rejects(()=>stat(join(memory,'chat-one.md')));
    assert.equal(await readFile(join(memory,'chat-keep.md'),'utf8'),'keep me');
  });

  console.log('\\nAgent session/checkpoint tests: '+passed+' passed, '+failed+' failed');
  if(failed)process.exitCode=1;
}finally{
  await rm(temp,{recursive:true,force:true});
}
