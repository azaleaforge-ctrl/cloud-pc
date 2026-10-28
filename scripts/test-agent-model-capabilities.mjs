import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const dir=await mkdtemp(join(tmpdir(),'rk-model-capabilities-'));
const require=createRequire(import.meta.url);
let passed=0,failed=0;
function test(name,fn){
  try{fn();passed++;console.log('PASS '+name);}
  catch(error){failed++;console.error('FAIL '+name+': '+(error instanceof Error?error.message:String(error)));}
}
const originalFetch=globalThis.fetch;
function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
}
try{
  const bundle=join(dir,'modelCapabilities.cjs');
  await build({
    entryPoints:[join(root,'src/main/editor/modelCapabilities.ts')],
    bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent',
  });
  const api=require(bundle);

  await test('normalizes common provider model IDs and rejects unsafe/ambiguous IDs',()=>{
    assert.equal(api.normalizeModelId('  provider/model-v2:thinking(high)  '),'provider/model-v2:thinking(high)');
    for(const id of ['', ' model with spaces ', '../etc/passwd', 'x'.repeat(201), 'model?admin=true', 'model\\nname']) {
      assert.throws(()=>api.normalizeModelId(id));
    }
  });

  await test('parses OpenAI-compatible catalog, removes invalid/duplicate IDs, sorts and bounds it',()=>{
    const input={data:[
      {id:'zeta-model',owned_by:'team-z'},
      {id:'alpha-model',name:'Alpha',owned_by:'team-a'},
      {id:'alpha-model',owned_by:'duplicate'},
      {id:'../invalid'},
      null,
      {id:'gamma-model'},
    ]};
    const models=api.parseModelsForTest?api.parseModelsForTest(input):api.parseModels(input);
    assert.deepEqual(models.map(item=>item.id),['alpha-model','gamma-model','zeta-model']);
    assert.equal(models[0].name,'Alpha');
  });

  await test('lists models from the primary endpoint and normalizes metadata',async()=>{
    globalThis.fetch=async url=>{
      assert.equal(String(url),'https://primary.example/v1/models');
      return json({data:[{id:'model-z'},{id:'model-a',owned_by:'provider'}]});
    };
    const result=await api.listAvailableModels({
      apiKey:'test-key',endpoint:'https://primary.example/v1',models:['old-model'],
      fallbackEndpoint:'https://fallback.example/v1',
    });
    assert.equal(result.ok,true);
    assert.equal(result.endpoint,'https://primary.example/v1');
    assert.deepEqual(result.models.map(item=>item.id),['model-a','model-z']);
    assert.ok(result.retrievedAt);
  });

  await test('falls back to the secondary endpoint when primary model listing fails',async()=>{
    globalThis.fetch=async url=>{
      if(String(url)==='https://primary.example/v1/models') return json({error:{message:'unavailable'}},503);
      assert.equal(String(url),'https://fallback.example/v1/models');
      return json({data:[{id:'fallback-model'}]});
    };
    const result=await api.listAvailableModels({
      apiKey:'test-key',endpoint:'https://primary.example/v1',models:['default'],
      fallbackEndpoint:'https://fallback.example/v1',
    });
    assert.equal(result.ok,true);
    assert.equal(result.endpoint,'https://fallback.example/v1');
    assert.equal(result.models[0].id,'fallback-model');
  });

  await test('reports chat, actual function tool-calling and image-input checks',async()=>{
    const requests=[];
    globalThis.fetch=async (url,init)=>{
      const body=JSON.parse(init.body);
      requests.push({url:String(url),body});
      if(body.tools?.length) {
        return json({choices:[{message:{tool_calls:[{type:'function',function:{name:'capability_probe',arguments:'{"ready":true}'}}]}}]});
      }
      const hasImage=body.messages?.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url'));
      return json({choices:[{message:{content:hasImage?'a tiny image':'OK'}}]});
    };
    const report=await api.diagnoseModelCapabilities({
      apiKey:'test-key',endpoint:'https://primary.example/v1',models:['model-a'],
      fallbackEndpoint:'https://fallback.example/v1',
    },'model-a');
    assert.equal(report.ok,true);
    assert.deepEqual(report.checks.map(check=>check.status),['supported','supported','supported']);
    assert.equal(report.checks.length,3);
    assert.ok(requests.every(item=>item.url==='https://primary.example/v1/chat/completions'));
    assert.equal(requests.length,3);
  });

  await test('labels function-calling and image input as unsupported when provider rejects them',async()=>{
    globalThis.fetch=async (url,init)=>{
      const body=JSON.parse(init.body);
      if(body.tools?.length) return json({error:{message:'tool calling not supported'}},400);
      const hasImage=body.messages?.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url'));
      if(hasImage) return json({error:{message:'image input not supported'}},400);
      return json({choices:[{message:{content:'OK'}}]});
    };
    const report=await api.diagnoseModelCapabilities({
      apiKey:'test-key',endpoint:'https://primary.example/v1',models:['text-only'],
    },'text-only');
    assert.equal(report.ok,true);
    assert.equal(report.checks[0].status,'supported');
    assert.equal(report.checks[1].status,'unsupported');
    assert.equal(report.checks[2].status,'unsupported');
  });

  await test('returns unknown for tool-calling when request succeeds but no tool call is returned',async()=>{
    globalThis.fetch=async (_url,init)=>{
      const body=JSON.parse(init.body);
      if(body.tools?.length) return json({choices:[{message:{content:'I cannot call tools'}}]});
      return json({choices:[{message:{content:'OK'}}]});
    };
    const report=await api.diagnoseModelCapabilities({apiKey:'key',endpoint:'https://primary.example/v1',models:['no-tools']},'no-tools');
    assert.equal(report.checks[1].status,'unknown');
    assert.equal(report.checks[2].status,'supported');
  });

  await test('fails cleanly when the API key is missing or the model ID is invalid',async()=>{
    const noKey=await api.listAvailableModels({apiKey:'',endpoint:'https://primary.example/v1',models:['model']});
    assert.equal(noKey.ok,false);
    assert.match(noKey.message,/API key/);
    await assert.rejects(()=>api.diagnoseModelCapabilities({apiKey:'x',endpoint:'https://primary.example/v1',models:[]},'../bad'));
  });

  console.log('\nModel capability tests: '+passed+' passed, '+failed+' failed');
  if(failed)process.exitCode=1;
}finally{
  globalThis.fetch=originalFetch;
  await rm(dir,{recursive:true,force:true});
}
