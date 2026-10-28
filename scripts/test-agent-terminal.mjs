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

function terminalCommand(mode, shell) {
  if (shell.family === 'powershell') {
    if (mode === 'streams') return "[Console]::Out.WriteLine('terminal-runtime-ok'); [Console]::Error.WriteLine('stderr-ok')";
    if (mode === 'fail') return 'exit 7';
    if (mode === 'hang') return 'Start-Sleep -Seconds 30';
    if (mode === 'large') return "1..1000 | ForEach-Object { 'x' }";
  }
  if (shell.family === 'cmd') {
    if (mode === 'streams') return 'echo terminal-runtime-ok & echo stderr-ok 1>&2';
    if (mode === 'fail') return 'exit /b 7';
    if (mode === 'hang') return 'ping -n 30 127.0.0.1 > NUL';
    if (mode === 'large') return 'for /l %i in (1,1,1000) do @echo x';
  }
  if (shell.family === 'posix') {
    if (mode === 'streams') return "printf 'terminal-runtime-ok\\n'; printf 'stderr-ok\\n' >&2";
    if (mode === 'fail') return 'exit 7';
    if (mode === 'hang') return 'sleep 30';
    if (mode === 'large') return 'yes x | head -n 1000';
  }
  throw new Error('Unknown terminal test mode: ' + mode + ' (' + shell.family + ')');
}

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
  const shellBundlePath = join(temp, 'terminalShell.cjs');
  await build({
    entryPoints: [join(ROOT, 'src', 'main', 'editor', 'terminalShell.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: shellBundlePath,
    logLevel: 'silent',
  });
  const { startTerminalCommand } = require(bundlePath);
  const { resolveTerminalShell, buildTerminalCommandInvocation, getAgentTerminalGuidance } = require(shellBundlePath);
  const shell = resolveTerminalShell();

  test('resolves one explicit shell profile and describes its command language', () => {
    assert.ok(shell.file);
    assert.ok(shell.name);
    assert.ok(['powershell', 'cmd', 'posix'].includes(shell.family));
    assert.match(getAgentTerminalGuidance(shell), /Shell terminal aktif/);
    if (process.platform === 'win32') {
      assert.ok(['powershell', 'cmd'].includes(shell.family));
    } else {
      assert.equal(shell.family, 'posix');
    }
  });

  test('builds a shell-consistent command invocation without echoing shell-specific exit-code snippets', () => {
    const invocation = buildTerminalCommandInvocation(terminalCommand('streams', shell), shell);
    assert.equal(invocation.file, shell.file);
    assert.equal(invocation.shellName, shell.name);
    if (shell.family === 'powershell') {
      assert.ok(invocation.args.includes('-Command'));
      assert.match(invocation.args.at(-1), /FromBase64String/);
      assert.doesNotMatch(invocation.args.at(-1), /EXIT_CODE:\s*\$\?/i);
    } else {
      assert.equal(invocation.args.at(-1), terminalCommand('streams', shell));
    }
  });

  const outputEvents = [];
  const success = await startTerminalCommand(options(
    terminalCommand('streams', shell),
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

  const failedRun = await startTerminalCommand(options(terminalCommand('fail', shell))).promise;
  test('preserves non-zero exit code as a failure', () => {
    assert.equal(failedRun.status, 'failed');
    assert.equal(failedRun.exitCode, 7);
  });

  const timeoutRun = await startTerminalCommand(options(
    terminalCommand('hang', shell),
    { timeoutMs: 350 },
  )).promise;
  test('terminates a command after its configured timeout', () => {
    assert.equal(timeoutRun.status, 'timed_out');
    assert.match(timeoutRun.message, /melewati batas/i);
    assert.ok(timeoutRun.durationMs < 10000);
  });

  const cancelHandle = startTerminalCommand(options(
    terminalCommand('hang', shell),
    { timeoutMs: 5000 },
  ));
  setTimeout(() => cancelHandle.cancel(), 120);
  const cancelledRun = await cancelHandle.promise;
  test('supports cancellation and reports cancelled outcome', () => {
    assert.equal(cancelledRun.status, 'cancelled');
    assert.match(cancelledRun.message, /dibatalkan/i);
  });

  const limitedRun = await startTerminalCommand(options(
    terminalCommand('large', shell),
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
