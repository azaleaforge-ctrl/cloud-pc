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
 const image=await make('photo.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64'));
 const imageRefs=await prepareAgentAttachments([image]);
 test('image data stays in main-process payload, not renderer ref',()=>{assert.equal('dataUrl' in imageRefs[0],false);assert.match(resolveAgentAttachments(imageRefs)[0].dataUrl,/^data:image\/png;base64,/);});
 const scannedPdf=await make('scan.pdf',Buffer.from('%PDF-1.4\\n%%EOF','utf8'));
 const scannedRefs=await prepareAgentAttachments([scannedPdf]);
 test('scanned PDF retains its original file for provider-side OCR fallback',()=>{const item=resolveAgentAttachments(scannedRefs)[0];assert.match(item.text,/OCR/i);assert.match(item.dataUrl,/^data:application\/pdf;base64,/);});
 const mp3=await make('recording.mp3',Buffer.from([0x49,0x44,0x33,0x04,0x00,0x00,0x00,0x00,0x00,0x00]));
 const mp3Refs=await prepareAgentAttachments([mp3]);
 test('audio attachments retain MIME-tagged main-process payloads',()=>{const item=resolveAgentAttachments(mp3Refs)[0];assert.equal(item.mimeType,'audio/mpeg');assert.match(item.dataUrl,/^data:audio\/mpeg;base64,/);});
 const mp4=await make('clip.mp4',(() => { const b=Buffer.alloc(24); b.writeUInt32BE(24,0); b.write('ftyp',4); b.write('isom',8); b.write('isom',16); return b; })());
 const mp4Refs=await prepareAgentAttachments([mp4]);
 test('video attachments retain MIME-tagged main-process payloads',()=>{const item=resolveAgentAttachments(mp4Refs)[0];assert.equal(item.mimeType,'video/mp4');assert.match(item.dataUrl,/^data:video\/mp4;base64,/);});
 const malformedImage=await make('fake.png',Buffer.from([137,80,78,71,13,10,26,10]));
 let malformedImageRejected=false;
 try{await prepareAgentAttachments([malformedImage]);}catch(error){malformedImageRejected=/signature|header/i.test(error.message);}
 test('rejects image files that contain only a PNG signature without a valid header',()=>assert.equal(malformedImageRejected,true));
 const malformedAudio=await make('fake.mp3',Buffer.from('not audio'));
 let malformedAudioRejected=false;
 try{await prepareAgentAttachments([malformedAudio]);}catch(error){malformedAudioRejected=/signature/i.test(error.message);}
 test('rejects audio files with invalid signatures',()=>assert.equal(malformedAudioRejected,true));
 const bad=await make('legacy.doc',Buffer.from('binary'));let rejected=false;
 try{await prepareAgentAttachments([bad]);}catch(error){rejected=/belum didukung/i.test(error.message);}
 test('unsupported document type is rejected',()=>assert.equal(rejected,true));
 console.log('\nAgent attachment tests: '+passed+' passed, '+failed+' failed');
 if(failed)process.exitCode=1;
}finally{await rm(dir,{recursive:true,force:true});}
