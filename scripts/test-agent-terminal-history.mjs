import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'rk-terminal-history-'));
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

const processRecord = (commandId, overrides = {}) => ({
  commandId,
  command: 'npm run build',
  cwd: ROOT,
  shell: 'PowerShell 7',
  status: 'running',
  startedAt: 1_800_000_000_000,
  timeoutMs: 30_000,
  ...overrides,
});

try {
  const bundlePath = join(temp, 'agentTerminalHistory.cjs');
  await build({
    entryPoints: [join(ROOT, 'src', 'shared', 'agentTerminalHistory.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'silent',
  });

  const {
    MAX_AGENT_TERMINAL_HISTORY,
    MAX_AGENT_TERMINAL_OUTPUT_CHARS,
    appendAgentTerminalOutput,
    formatAgentTerminalDiagnostics,
    formatAgentTerminalOutput,
    upsertAgentTerminalProcess,
  } = require(bundlePath);

  let history = upsertAgentTerminalProcess([], processRecord('cmd-1'));
  history = appendAgentTerminalOutput(history, {
    commandId: 'cmd-1', stream: 'stdout', data: 'build started\n', ts: 1_800_000_000_100,
  });
  history = appendAgentTerminalOutput(history, {
    commandId: 'cmd-1', stream: 'stderr', data: 'warning: test warning\n', ts: 1_800_000_000_200,
  });

  test('stores stdout and stderr chunks on their matching command', () => {
    assert.equal(history.length, 1);
    assert.equal(history[0].outputs.length, 2);
    assert.equal(history[0].outputChars, 'build started\nwarning: test warning\n'.length);
    assert.match(formatAgentTerminalOutput(history[0].outputs), /STDOUT/);
    assert.match(formatAgentTerminalOutput(history[0].outputs), /STDERR/);
  });

  history = upsertAgentTerminalProcess(history, processRecord('cmd-1', {
    status: 'failed', finishedAt: 1_800_000_001_000, exitCode: 1, message: 'Build failed',
  }));
  test('updates final process status without deleting captured output', () => {
    assert.equal(history[0].process.status, 'failed');
    assert.equal(history[0].process.exitCode, 1);
    assert.equal(history[0].outputs.length, 2);
  });

  const report = formatAgentTerminalDiagnostics(history[0]);
  test('formats complete diagnostics including shell, cwd, timestamps, exit code and both streams', () => {
    assert.match(report, /PowerShell 7/);
    assert.match(report, /Working directory:/);
    assert.match(report, /Started at:/);
    assert.match(report, /Finished at:/);
    assert.match(report, /Exit code: 1/);
    assert.match(report, /build started/);
    assert.match(report, /test warning/);
  });

  let bounded = [];
  for (let i = 0; i < MAX_AGENT_TERMINAL_HISTORY + 5; i += 1) {
    bounded = upsertAgentTerminalProcess(bounded, processRecord('cmd-' + i), MAX_AGENT_TERMINAL_HISTORY);
  }
  test('keeps terminal history bounded and retains the newest command records', () => {
    assert.equal(bounded.length, MAX_AGENT_TERMINAL_HISTORY);
    assert.equal(bounded.at(-1).process.commandId, 'cmd-' + (MAX_AGENT_TERMINAL_HISTORY + 4));
  });

  let capped = upsertAgentTerminalProcess([], processRecord('cmd-output'));
  for (let i = 0; i < 12; i += 1) {
    capped = appendAgentTerminalOutput(capped, {
      commandId: 'cmd-output', stream: 'stdout', data: 'x'.repeat(3000), ts: 1_800_000_000_000 + i,
    });
  }
  test('caps output memory per command without affecting command metadata', () => {
    assert.ok(capped[0].outputChars <= MAX_AGENT_TERMINAL_OUTPUT_CHARS);
    assert.equal(capped[0].process.commandId, 'cmd-output');
  });

  const unchanged = appendAgentTerminalOutput([], {
    commandId: 'missing', stream: 'stdout', data: 'ignored', ts: Date.now(),
  });
  test('ignores late output for a command that is no longer in the history window', () => {
    assert.deepEqual(unchanged, []);
  });

  console.log('\nTerminal history tests: ' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
