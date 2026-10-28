import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const dir=await mkdtemp(join(tmpdir(),'rk-agent-attachments-'));
const require=createRequire(import.meta.url);
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+(error instanceof Error?error.message:String(error)));}}
async function make(name,data){const path=join(dir,name);await writeFile(path,data);return path;}
try{
 const bundle=join(dir,'agentAttachments.cjs');
 await build({entryPoints:[join(root,'src/main/editor/agentAttachments.ts')],bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent'});
 const {prepareAgentAttachments,resolveAgentAttachments}=require(bundle);
 const txt=await make('notes.txt','Ruang Kerja attachment test\nSecond line.');
 const txtRefs=await prepareAgentAttachments([txt]);
 test('text extraction returns opaque refs, not filesystem paths',()=>{assert.equal(txtRefs[0].name,'notes.txt');assert.equal('path' in txtRefs[0],false);assert.match(resolveAgentAttachments(txtRefs)[0].text,/Second line/);});
 const pdf=await make('sample.pdf','%PDF-1.4\nBT (Invoice total 250) Tj ET\n%%EOF');
 const pdfRefs=await prepareAgentAttachments([pdf]);
 test('basic selectable PDF text extraction',()=>assert.match(resolveAgentAttachments(pdfRefs)[0].text,/Invoice total 250/));
 const AdmZip=require('adm-zip'),zip=new AdmZip();
 zip.addFile('word/document.xml',Buffer.from('<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>DOCX content</w:t></w:r></w:p></w:body></w:document>'));
 const docx=await make('spec.docx',zip.toBuffer()),docxRefs=await prepareAgentAttachments([docx]);
 test('DOCX OpenXML extraction',()=>assert.match(resolveAgentAttachments(docxRefs)[0].text,/DOCX content/));
 const workbookZip=new AdmZip();
 workbookZip.addFile('xl/sharedStrings.xml',Buffer.from('<sst xmlns="urn:sheet"><si><t>Revenue</t></si><si><t>April</t></si></sst>'));
 workbookZip.addFile('xl/worksheets/sheet1.xml',Buffer.from('<worksheet xmlns="urn:sheet"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1200</v></c><c r="C1" t="s"><v>1</v></c></row></sheetData></worksheet>'));
 const workbook=await make('table.xlsx',workbookZip.toBuffer()),workbookRefs=await prepareAgentAttachments([workbook]);
 test('XLSX extraction includes shared strings and cell addresses',()=>{const text=resolveAgentAttachments(workbookRefs)[0].text;assert.match(text,/A1=Revenue/);assert.match(text,/B1=1200/);assert.match(text,/C1=April/);});
 const slideZip=new AdmZip();
 slideZip.addFile('ppt/slides/slide1.xml',Buffer.from('<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:t>Quarterly Report</a:t></p:sld>'));
 const slide=await make('slides.pptx',slideZip.toBuffer()),slideRefs=await prepareAgentAttachments([slide]);
 test('PPTX extraction reads slide text',()=>assert.match(resolveAgentAttachments(slideRefs)[0].text,/Quarterly Report/));
 const image=await make('photo.png',Buffer.from([137,80,78,71,13,10,26,10]));
 const imageRefs=await prepareAgentAttachments([image]);
 test('image data stays in main-process payload, not renderer ref',()=>{assert.equal('dataUrl' in imageRefs[0],false);assert.match(resolveAgentAttachments(imageRefs)[0].dataUrl,/^data:image\/png;base64,/);});
 const bad=await make('legacy.doc',Buffer.from('binary'));let rejected=false;
 try{await prepareAgentAttachments([bad]);}catch(error){rejected=/belum didukung/i.test(error.message);}
 test('unsupported document type is rejected',()=>assert.equal(rejected,true));
 console.log('\nAgent attachment tests: '+passed+' passed, '+failed+' failed');
 if(failed)process.exitCode=1;
}finally{await rm(dir,{recursive:true,force:true});}
