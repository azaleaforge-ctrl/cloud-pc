// Tests for the foreground terminal process runtime. Run: npm run test:agent-terminal
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'rk-agent-terminal-'));
const require = createRequire(import.meta.url);
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('PASS ' + name);
  } catch (error) {
    failed += 1;
    console.error('FAIL ' + name + ' — ' + (error instanceof Error ? error.message : String(error)));
  }
}

function options(command, extra = {}) {
  return {
    commandId: 'test-' + Math.random().toString(36).slice(2),
    command,
    cwd: ROOT,
    env: process.env,
    timeoutMs: 5000,
    maxOutputChars: 1800,
    ...extra,
  };
}

const nodeCommand = (code) => 'node -e "' + code.replace(/"/g, '\\"') + '"';

try {
  const bundlePath = join(temp, 'terminalRuntime.cjs');
  await build({
    entryPoints: [join(ROOT, 'src', 'main', 'editor', 'terminalRuntime.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  const { startTerminalCommand } = require(bundlePath);

  const outputEvents = [];
  const success = await startTerminalCommand(options(
    nodeCommand("console.log('terminal-runtime-ok'); console.error('stderr-ok')"),
    { onOutput: (event) => outputEvents.push(event) },
  )).promise;
  test('captures stdout and stderr and reports successful exit', () => {
    assert.equal(success.status, 'completed');
    assert.equal(success.exitCode, 0);
    assert.match(success.output, /terminal-runtime-ok/);
    assert.match(success.output, /stderr-ok/);
    assert.ok(outputEvents.some((event) => event.stream === 'stdout'));
    assert.ok(outputEvents.some((event) => event.stream === 'stderr'));
  });

  const failedRun = await startTerminalCommand(options(nodeCommand('process.exit(7)'))).promise;
  test('preserves non-zero exit code as a failure', () => {
    assert.equal(failedRun.status, 'failed');
    assert.equal(failedRun.exitCode, 7);
  });

  const timeoutRun = await startTerminalCommand(options(
    nodeCommand('setTimeout(() => {}, 30000)'),
    { timeoutMs: 350 },
  )).promise;
  test('terminates a command after its configured timeout', () => {
    assert.equal(timeoutRun.status, 'timed_out');
    assert.match(timeoutRun.message, /melewati batas/i);
    assert.ok(timeoutRun.durationMs < 10000);
  });

  const cancelHandle = startTerminalCommand(options(
    nodeCommand('setTimeout(() => {}, 30000)'),
    { timeoutMs: 5000 },
  ));
  setTimeout(() => cancelHandle.cancel(), 120);
  const cancelledRun = await cancelHandle.promise;
  test('supports cancellation and reports cancelled outcome', () => {
    assert.equal(cancelledRun.status, 'cancelled');
    assert.match(cancelledRun.message, /dibatalkan/i);
  });

  const limitedRun = await startTerminalCommand(options(
    nodeCommand("process.stdout.write('x'.repeat(5000))"),
    { maxOutputChars: 500 },
  )).promise;
  test('bounds captured output while the output callback can stream chunks', () => {
    assert.ok(limitedRun.output.length <= 500);
  });

  console.log('\nTerminal runtime tests: ' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
