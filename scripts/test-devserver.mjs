// Uji subsistem dev server tanpa framework tes: bundle TS dengan esbuild lalu jalankan.
// Jalankan dari root project: node scripts/test-devserver.mjs
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const requireCjs = createRequire(import.meta.url);

let failures = 0;
let passes = 0;

function record(name, ok, detail = '') {
  if (ok) {
    passes += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
  return path;
}

async function fixture(root, name, files) {
  const dir = join(root, name);
  await ensureDir(dir);
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    await ensureDir(dirname(target));
    await writeFile(target, content, 'utf8');
  }
  return dir;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function canBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

function waitUntil(predicate, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

const root = await mkdtemp(join(tmpdir(), 'rk-devserver-'));
let handle = null;
let busyServer = null;

try {
  // ---------- bundle ----------
  const outdir = join(root, 'bundle');
  await build({
    entryPoints: [
      join(ROOT, 'src', 'main', 'frameworkDetect.ts'),
      join(ROOT, 'src', 'main', 'devServer.ts'),
    ],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outdir,
    external: ['electron'],
    logLevel: 'silent',
  });

  const { detectFramework, retargetPort } = requireCjs(join(outdir, 'frameworkDetect.js'));
  const { startDevServer } = requireCjs(join(outdir, 'devServer.js'));

  // ---------- deteksi framework ----------
  const nextDir = await fixture(root, 'next-app', {
    'package.json': JSON.stringify({
      name: 'next-app',
      dependencies: { next: '14.2.0', react: '18.2.0' },
      scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
    }, null, 2),
  });
  const nextInfo = detectFramework(nextDir);
  const nextCommand = nextInfo?.command ?? '';
  record('detect: next id', nextInfo?.id === 'next', JSON.stringify(nextInfo));
  record(
    'detect: next command tanpa "---"',
    Boolean(nextInfo) && !nextCommand.includes('---')
      && (/node_modules[\\/]\.bin[\\/]next(\.cmd)?/.test(nextCommand) || /^npm run dev -- /.test(nextCommand)),
    nextCommand,
  );
  record('detect: next args tetap []', Array.isArray(nextInfo?.args) && nextInfo.args.length === 0);
  record('detect: next notes terisi', Boolean(nextInfo?.notes && nextInfo.notes.length > 0));

  const binDir = await fixture(root, 'next-app-terpasang', {
    'package.json': JSON.stringify({
      name: 'next-app-terpasang',
      dependencies: { next: '14.2.0' },
      scripts: { dev: 'next dev' },
    }, null, 2),
    'node_modules/.bin/next.cmd': '@echo off\r\n',
  });
  const binInfo = detectFramework(binDir);
  record(
    'detect: biner lokal dipakai lebih dulu',
    /node_modules[\\/]\.bin[\\/]next(\.cmd)?/.test(binInfo?.command ?? '')
      && /--hostname 0\.0\.0\.0/.test(binInfo?.command ?? ''),
    binInfo?.command,
  );

  const spacedDir = await fixture(root, 'project dengan spasi', {
    'package.json': JSON.stringify({
      name: 'spaced',
      dependencies: { next: '14.2.0' },
      scripts: { dev: 'next dev' },
    }, null, 2),
    'node_modules/.bin/next.cmd': '@echo off\r\n',
  });
  const spacedInfo = detectFramework(spacedDir);
  record(
    'detect: path berspasi dikutip',
    /^"[^"]*node_modules[\\/]\.bin[\\/]next\.cmd"/.test(spacedInfo?.command ?? ''),
    spacedInfo?.command,
  );

  const customScriptDir = await fixture(root, 'next-custom-script', {
    'package.json': JSON.stringify({
      name: 'next-custom-script',
      dependencies: { next: '14.2.0' },
      scripts: { dev: 'next dev --turbopack' },
    }, null, 2),
    'node_modules/.bin/next.cmd': '@echo off\r\n',
  });
  const customInfo = detectFramework(customScriptDir);
  record(
    'detect: script dengan flag khusus tetap dihormati',
    (customInfo?.command ?? '').startsWith('npm run dev -- ') && !(customInfo?.command ?? '').includes('---'),
    customInfo?.command,
  );

  const laravelDir = await fixture(root, 'laravel-app', {
    'composer.json': JSON.stringify({ require: { 'laravel/framework': '^11.0', php: '^8.2' } }, null, 2),
    artisan: '#!/usr/bin/env php\n',
    'public/index.php': '<?php echo "ok";',
  });
  const laravelInfo = detectFramework(laravelDir);
  record('detect: laravel id', laravelInfo?.id === 'laravel', JSON.stringify(laravelInfo));
  record('detect: laravel port 8000', laravelInfo?.detectedPort === 8000);

  const viteDir = await fixture(root, 'vite-app', {
    'package.json': JSON.stringify({
      name: 'vite-app',
      devDependencies: { vite: '5.0.0' },
      scripts: { dev: 'vite' },
    }, null, 2),
  });
  const viteInfo = detectFramework(viteDir);
  record('detect: vite id', viteInfo?.id === 'vite', JSON.stringify(viteInfo));
  record('detect: vite command tanpa "---"', !(viteInfo?.command ?? '').includes('---'), viteInfo?.command);

  const staticDir = await fixture(root, 'static-site', {
    'index.html': '<!doctype html><html><body>halo</body></html>',
  });
  const staticInfo = detectFramework(staticDir);
  record('detect: static id', staticInfo?.id === 'static', JSON.stringify(staticInfo));

  const mixedDir = await fixture(root, 'js-go', {
    'package.json': JSON.stringify({
      name: 'js-go',
      dependencies: { next: '14.2.0' },
      scripts: { dev: 'next dev' },
    }, null, 2),
    'go.mod': 'module example.com/jsgo\n\ngo 1.22\n',
  });
  const mixedInfo = detectFramework(mixedDir);
  record('detect: project JS + go.mod tetap next', mixedInfo?.id === 'next', JSON.stringify(mixedInfo));

  record(
    'port: retargetPort mengganti --port',
    retargetPort('next dev --port 3000', 3000, 3100) === 'next dev --port 3100',
    retargetPort('next dev --port 3000', 3000, 3100),
  );

  // ---------- startDevServer: sukses ----------
  const e2eDir = await fixture(root, 'e2e', {});
  const e2ePort = await freePort();
  const e2eStates = [];
  let e2eExits = 0;
  handle = await startDevServer({
    framework: {
      id: 'test-node',
      name: 'Uji Node',
      command: `node -e "require('http').createServer((q,s)=>s.end('ok')).listen(${e2ePort},()=>console.log('http://localhost:${e2ePort}'))"`,
      args: [],
      cwd: e2eDir,
      packageManager: 'system',
      detectedPort: e2ePort,
    },
    cwd: e2eDir,
    onLog: () => {},
    onState: (state) => e2eStates.push(state),
    onExit: () => { e2eExits += 1; },
  });

  const becameRunning = await waitUntil(() => e2eStates.some((s) => s.status === 'running'), 25_000);
  const runningState = e2eStates.find((s) => s.status === 'running');
  record('start: transisi starting', e2eStates[0]?.status === 'starting', JSON.stringify(e2eStates.map((s) => s.status)));
  record('start: status running', becameRunning, JSON.stringify(e2eStates.map((s) => s.status)));
  record('start: url terisi', Boolean(runningState?.url && runningState.url.startsWith('http://localhost:')), runningState?.url ?? 'null');

  const stopStartedAt = Date.now();
  await handle.stop();
  const stopDuration = Date.now() - stopStartedAt;
  handle = null;
  record('stop: status stopped', e2eStates[e2eStates.length - 1]?.status === 'stopped', JSON.stringify(e2eStates[e2eStates.length - 1]?.status));
  record('stop: selesai < 8 detik', stopDuration < 8_000, `${stopDuration}ms`);
  await waitUntil(() => canBind(e2ePort), 8_000).then((ok) => {
    record('stop: proses mati (port dilepas)', ok);
  });
  record('stop: onExit dipanggil sekali', e2eExits === 1, String(e2eExits));

  // ---------- startDevServer: gagal cepat ----------
  const failDir = await fixture(root, 'fail-fast', {});
  const failStates = [];
  const failPort = await freePort();
  const failHandle = await startDevServer({
    framework: {
      id: 'test-fail',
      name: 'Uji Gagal',
      command: 'node -e "process.exit(3)"',
      args: [],
      cwd: failDir,
      packageManager: 'system',
      detectedPort: failPort,
    },
    cwd: failDir,
    onLog: () => {},
    onState: (state) => failStates.push(state),
  });
  const failedFast = await waitUntil(() => failStates.some((s) => s.status === 'error'), 5_000);
  record('fail: error < 5 detik', failedFast, JSON.stringify(failStates.map((s) => s.status)));
  record('fail: pesan error terisi', Boolean(failStates.find((s) => s.status === 'error')?.error));
  await failHandle.stop();

  // ---------- watchdog: status starting tidak menggantung ----------
  const watchdogDir = await fixture(root, 'watchdog', {});
  const watchdogStates = [];
  const watchdogPort = await freePort();
  const watchdogHandle = await startDevServer({
    framework: {
      id: 'test-watchdog',
      name: 'Uji Watchdog',
      command: 'node -e "setTimeout(()=>{},60000)"',
      args: [],
      cwd: watchdogDir,
      packageManager: 'system',
      detectedPort: watchdogPort,
    },
    cwd: watchdogDir,
    startTimeoutMs: 1_500,
    onLog: () => {},
    onState: (state) => watchdogStates.push(state),
  });
  const watchdogFired = await waitUntil(() => watchdogStates.some((s) => s.status === 'error'), 8_000);
  const watchdogError = watchdogStates.find((s) => s.status === 'error')?.error ?? '';
  record('watchdog: error setelah batas waktu', watchdogFired, JSON.stringify(watchdogStates.map((s) => s.status)));
  record('watchdog: pesan menyebut detik', /detik/.test(watchdogError), watchdogError);
  await watchdogHandle.stop();

  // ---------- preflight: dependensi belum terpasang ----------
  const preflightStates = [];
  const preflightDir = nextDir; // package.json next ada, node_modules tidak ada
  const preflightInfo = detectFramework(preflightDir) ?? {
    id: 'next', name: 'Next.js', command: 'npm run dev', args: [], cwd: preflightDir,
    packageManager: 'npm', detectedPort: 3000,
  };
  const preflightHandle = await startDevServer({
    framework: preflightInfo,
    cwd: preflightDir,
    onLog: () => {},
    onState: (state) => preflightStates.push(state),
  });
  const preflightFailed = await waitUntil(() => preflightStates.some((s) => s.status === 'error'), 5_000);
  const preflightError = preflightStates.find((s) => s.status === 'error')?.error ?? '';
  record('preflight: error tanpa spawn', preflightFailed, JSON.stringify(preflightStates.map((s) => s.status)));
  record('preflight: pesan menyebut npm install', /node_modules/.test(preflightError) && /npm install/.test(preflightError), preflightError);
  await preflightHandle.stop();

  // ---------- startDevServer: port bentrok ----------
  const conflictPort = await freePort();
  busyServer = http.createServer((q, s) => s.end('busy'));
  await new Promise((resolve, reject) => {
    busyServer.once('error', reject);
    busyServer.listen(conflictPort, '0.0.0.0', () => resolve());
  });
  const conflictDir = await fixture(root, 'conflict', {});
  const conflictStates = [];
  const conflictHandle = await startDevServer({
    framework: {
      id: 'test-conflict',
      name: 'Uji Port Bentrok',
      command: `node -e "require('http').createServer((q,s)=>s.end('ok')).listen(${conflictPort},()=>console.log('http://localhost:${conflictPort}'))"`,
      args: [],
      cwd: conflictDir,
      packageManager: 'system',
      detectedPort: conflictPort,
    },
    cwd: conflictDir,
    onLog: () => {},
    onState: (state) => conflictStates.push(state),
  });
  const conflictRunning = await waitUntil(() => conflictStates.some((s) => s.status === 'running'), 25_000);
  const conflictState = conflictStates.find((s) => s.status === 'running');
  const effectivePort = conflictState?.targetPort ?? conflictState?.port ?? null;
  record('port bentrok: tetap running', conflictRunning, JSON.stringify(conflictStates.map((s) => s.status)));
  record('port bentrok: port dipindah', effectivePort !== null && effectivePort !== conflictPort, `efektif ${effectivePort}, bentrok ${conflictPort}`);
  await conflictHandle.stop();
} catch (err) {
  failures += 1;
  console.log('FAIL  harness — ' + (err?.stack ?? err));
} finally {
  if (handle) {
    try { await handle.stop(); } catch { /* abaikan */ }
  }
  if (busyServer) {
    await new Promise((resolve) => busyServer.close(() => resolve()));
  }
  await rm(root, { recursive: true, force: true });
}

console.log(`\n${passes} PASS · ${failures} FAIL`);
process.exit(failures > 0 ? 1 : 0);
