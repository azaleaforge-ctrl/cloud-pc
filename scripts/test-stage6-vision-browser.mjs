import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'rk-stage6-'));
const require = createRequire(import.meta.url);
let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log('PASS ' + name);
}

try {
  const bundle = join(dir, 'webNavigation.cjs');
  await build({
    entryPoints: [join(root, 'src/shared/webNavigation.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'silent',
  });
  const { normalizeWebNavigationUrl } = require(bundle);
  test('allows HTTP/HTTPS project and LAN preview URLs', () => {
    assert.equal(normalizeWebNavigationUrl('  http://127.0.0.1:5173/  '), 'http://127.0.0.1:5173/');
    assert.equal(normalizeWebNavigationUrl('https://example.com/docs'), 'https://example.com/docs');
  });
  test('rejects script, file, data, malformed, credentialed and oversized URLs', () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///C:/Windows/win.ini',
      'data:text/html,hello',
      'ftp://example.com/file',
      'https://user:pass@example.com/',
      'not a url',
      'https://' + 'a'.repeat(2050) + '.com',
    ]) assert.equal(normalizeWebNavigationUrl(url), null, url);
  });

  const webTab = await readFile(join(root, 'src/renderer/components/WebTab.tsx'), 'utf8');
  const main = await readFile(join(root, 'src/main/index.ts'), 'utf8');
  const chat = await readFile(join(root, 'src/renderer/components/editor/AgentChat.tsx'), 'utf8');
  const release = await readFile(join(root, '.github/workflows/release.yml'), 'utf8');
  const readme = await readFile(join(root, 'README.md'), 'utf8');

  test('browser uses native back/forward and validates main-frame navigation', () => {
    assert.match(webTab, /\.goBack\(\)/);
    assert.match(webTab, /\.goForward\(\)/);
    assert.match(webTab, /addEventListener\('will-navigate', onWillNavigate\)/);
    assert.doesNotMatch(webTab, /javascript:history\.(?:back|forward)\(\)/);
    assert.doesNotMatch(webTab, /allowpopups=\{true\}/);
  });
  test('main process pins webview security preferences and rejects unsafe external URLs', () => {
    assert.match(main, /will-attach-webview/);
    assert.match(main, /delete webPreferences\.preload/);
    assert.match(main, /webPreferences\.nodeIntegration = false/);
    assert.match(main, /webPreferences\.contextIsolation = true/);
    assert.match(main, /webPreferences\.sandbox = true/);
    assert.match(main, /webPreferences\.webSecurity = true/);
    assert.match(main, /target\.protocol === 'http:'/);
    assert.match(main, /target\.protocol === 'https:'/);
  });
  test('model picker can filter models whose catalog explicitly lists image input', () => {
    assert.match(chat, /modelVisionOnly/);
    assert.match(chat, /inputModalities[^\n]*some\(modality => \/\^\(image\|images\|vision\)\//);
    assert.match(chat, /Filter vision hanya memakai metadata input dari katalog provider/);
    assert.match(chat, /Uji kemampuan/);
  });
  test('release workflow syncs version metadata and runs regression suite before building', () => {
    const lock = release.indexOf('name: Sync package-lock version');
    const runtime = release.indexOf('name: Test Agent Runtime');
    const buildStep = release.indexOf('name: Build');
    assert.ok(lock >= 0 && runtime > lock && buildStep > runtime);
    assert.match(release, /npm run test:agent-runtime/);
    assert.match(release, /latest\.yml/);
    assert.match(release, /blockmap/);
  });
  test('README explains optional AI/web network data flows and vision limitations', () => {
    assert.match(readme, /provider AI yang dikonfigurasi/);
    assert.match(readme, /input gambar/);
    assert.match(readme, /tidak menjalankan JavaScript situs/);
  });

  console.log('\nStage 6 vision/browser/release tests: ' + passed + ' passed.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
