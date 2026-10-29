import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'rk-agent-verification-'));
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

try {
  const agent = await readFile(join(root, 'src/main/editor/agent.ts'), 'utf8');
  const bundlePath = join(temp, 'agentVerification.cjs');
  await build({
    entryPoints: [join(root, 'src/main/editor/agentVerification.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  const { hasSuccessfulTerminalVerification } = createRequire(import.meta.url)(bundlePath);
  const check = (overrides = {}) => ({
    command: 'npm run build',
    startedAt: 100,
    finishedAt: 200,
    exitCode: 0,
    codeChangeVersion: 2,
    ...overrides,
  });

  test('accepts a successful check for the current code generation', () => {
    assert.equal(hasSuccessfulTerminalVerification([check()], 2), true);
  });

  test('rejects a successful check from before the latest source edit', () => {
    assert.equal(hasSuccessfulTerminalVerification([check({ codeChangeVersion: 1 })], 2), false);
  });

  test('rejects a check that started before a source edit even if it finished afterward', () => {
    const inFlightBeforeEdit = check({ startedAt: 150, finishedAt: 300, codeChangeVersion: 1 });
    assert.equal(hasSuccessfulTerminalVerification([inFlightBeforeEdit], 2), false);
  });

  test('rejects failed or unknown-exit checks', () => {
    assert.equal(hasSuccessfulTerminalVerification([check({ exitCode: 1 })], 2), false);
    assert.equal(hasSuccessfulTerminalVerification([check({ exitCode: null })], 2), false);
  });

  test('requires verification to finish after the task starts', () => {
    assert.equal(hasSuccessfulTerminalVerification([check({ finishedAt: 199 })], 2, 200), false);
    assert.equal(hasSuccessfulTerminalVerification([check({ finishedAt: 200 })], 2, 200), true);
  });

  test('accepts a new successful check after the latest edit', () => {
    const checks = [check({ codeChangeVersion: 1 }), check({ startedAt: 250, finishedAt: 400, codeChangeVersion: 2 })];
    assert.equal(hasSuccessfulTerminalVerification(checks, 2), true);
  });

  test('runtime increments code generation for edits and snapshots it when checks start', () => {
    assert.ok(agent.includes('session.codeChangeVersion += 1;'));
    assert.ok(agent.includes('const codeChangeVersionAtStart = session.codeChangeVersion;'));
    assert.ok(agent.includes('codeChangeVersion: codeChangeVersionAtStart,'));
    assert.ok(agent.includes('hasSuccessfulTerminalVerification(session.successfulTerminalChecks, session.codeChangeVersion, taskStartedAt)'));
    assert.ok(agent.includes('hasSuccessfulTerminalVerification(session.successfulTerminalChecks, session.codeChangeVersion);'));
  });

  console.log('\nAgent verification guard tests: ' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
