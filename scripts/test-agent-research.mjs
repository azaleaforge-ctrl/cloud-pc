import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const dir=await mkdtemp(join(tmpdir(),'rk-agent-research-'));
const require=createRequire(import.meta.url);
let passed=0,failed=0;
function test(name,fn){
  try{fn();passed++;console.log('PASS '+name);}
  catch(error){failed++;console.error('FAIL '+name+': '+(error instanceof Error?error.message:String(error)));}
}
try{
  const bundle=join(dir,'agentResearch.cjs');
  await build({entryPoints:[join(root,'src/main/editor/agentResearch.ts')],bundle:true,platform:'node',format:'cjs',outfile:bundle,logLevel:'silent'});
  const research=require(bundle);

  test('allows a normal public IPv4 and denies private/reserved IPv4',()=>{
    assert.equal(research.isPublicAddress('8.8.8.8'),true);
    for(const ip of ['127.0.0.1','10.0.0.8','172.16.0.2','192.168.1.2','169.254.4.4','100.64.0.1','224.0.0.1','203.0.113.8']) {
      assert.equal(research.isPublicAddress(ip),false,ip);
    }
  });
  test('allows global IPv6 and blocks loopback, link-local and documentation ranges',()=>{
    assert.equal(research.isPublicAddress('2606:4700:4700::1111'),true);
    for(const ip of ['::1','::','fe80::1','fc00::1','2001:db8::1']) assert.equal(research.isPublicAddress(ip),false,ip);
  });
  test('accepts HTTPS domains and rejects HTTP, credentials, private IP and nonstandard ports',()=>{
    assert.equal(research.normalizeHttpsUrl('https://example.com/docs').hostname,'example.com');
    for(const url of [
      'http://example.com','https://user:pass@example.com','https://127.0.0.1/private',
      'https://localhost','https://printer.local','https://example.com:8443'
    ]) assert.throws(()=>research.normalizeHttpsUrl(url),undefined,url);
  });
  test('parses search result titles, URLs and snippets without executing page scripts',()=>{
    const html='<div class="result"><a class="result__a" href="https://docs.example.dev/guide?a=1&amp;b=2">Official &amp; Safe Docs</a><a class="result__snippet">Current release &amp; setup</a></div>';
    const rows=research.extractSearchResults(html,4);
    assert.equal(rows.length,1);
    assert.equal(rows[0].title,'Official & Safe Docs');
    assert.equal(rows[0].url,'https://docs.example.dev/guide?a=1&b=2');
  });
  test('parses Bing fallback results and strips Bing click redirect URLs',()=>{
    const direct='<li class="b_algo"><h2><a href="https://nextjs.org/docs">Next.js Docs</a></h2><p>Official framework documentation.</p></li>';
    const encoded='a1'+Buffer.from('https://nodejs.org/en/about/previous-releases').toString('base64');
    const wrapped='<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u='+encoded+'">Node.js releases</a></h2><p>Release schedule.</p></li>';
    const rows=research.extractBingSearchResults('<html><body>'+direct+wrapped+'</body></html>',5);
    assert.equal(rows.length,2);
    assert.equal(rows[0].title,'Next.js Docs');
    assert.equal(rows[0].url,'https://nextjs.org/docs');
    assert.match(rows[0].snippet,/Official framework/);
    assert.equal(rows[1].url,'https://nodejs.org/en/about/previous-releases');
  });
  test('ignores malformed, non-HTTPS, and Bing-internal search links',()=>{
    const html='<li class="b_algo"><h2><a href="javascript:alert(1)">Bad</a></h2></li>'+
      '<li class="b_algo"><h2><a href="https://www.bing.com/search?q=internal">Internal</a></h2></li>';
    assert.deepEqual(research.extractBingSearchResults(html),[]);
  });
  test('extracts readable page text, keeps title and strips script/nav content',()=>{
    const result=research.extractReadableContent('<html><head><title>Guide &amp; API</title></head><body><nav>Menu item</nav><main><h1>Installation</h1><p>Run npm install.</p><script>steal secrets()</script></main></body></html>','text/html');
    assert.equal(result.title,'Guide & API');
    assert.match(result.text,/Installation/);
    assert.match(result.text,/Run npm install/);
    assert.doesNotMatch(result.text,/Menu item|steal secrets/);
  });
  test('decodes common HTML entities safely',()=>{
    assert.equal(research.decodeHtmlEntities('&lt;tag&gt; &amp; &#39;x&#39; &#x41;'),"<tag> & 'x' A");
  });
  test('builds source URLs for supported package registries',()=>{
    assert.equal(research.buildRegistryUrl('npm','react'),'https://registry.npmjs.org/react');
    assert.equal(research.buildRegistryUrl('npm','@scope/tool'),'https://registry.npmjs.org/%40scope%2ftool');
    assert.equal(research.buildRegistryUrl('pypi','My_Package'),'https://pypi.org/pypi/my-package/json');
    assert.equal(research.buildRegistryUrl('crates','serde'),'https://crates.io/api/v1/crates/serde');
    assert.equal(research.buildRegistryUrl('packagist','vendor/package'),'https://repo.packagist.org/p2/vendor/package.json');
    assert.equal(research.buildRegistryUrl('rubygems','rails'),'https://rubygems.org/api/v1/gems/rails.json');
  });
  test('rejects malformed package names instead of constructing arbitrary URLs',()=>{
    assert.throws(()=>research.buildRegistryUrl('npm','../../etc/passwd'));
    assert.throws(()=>research.buildRegistryUrl('packagist','vendor'));
    assert.throws(()=>research.buildRegistryUrl('pypi','package?url=evil'));
  });
  test('formats deterministic current time for an explicit IANA timezone',()=>{
    const now=new Date('2026-10-28T00:00:00.000Z');
    const result=JSON.parse(research.getCurrentTime('Asia/Jakarta',now));
    assert.equal(result.utc,'2026-10-28T00:00:00.000Z');
    assert.equal(result.timeZone,'Asia/Jakarta');
    assert.match(result.localSortable,/2026-10-28/);
    assert.match(result.utcOffset,/GMT\+7/);
  });
  test('rejects unknown timezone names',()=>assert.throws(()=>research.getCurrentTime('Mars/Olympus_Mons',new Date('2026-01-01T00:00:00Z'))));

  console.log('\nAgent research tests: '+passed+' passed, '+failed+' failed');
  if(failed)process.exitCode=1;
}finally{await rm(dir,{recursive:true,force:true});}
