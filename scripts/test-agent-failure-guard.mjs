// Regression tests for agent-tool failure classification and recovery prompts.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'rk-agent-failure-'));
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
  const bundlePath = join(temp, 'agentFailureGuard.cjs');
  await build({
    entryPoints: [join(ROOT, 'src', 'main', 'editor', 'agentFailureGuard.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  const guard = require(bundlePath);

  test('recognizes Todo validation failures as tool errors', () => {
    assert.equal(guard.isToolFailureResult('Tool gagal: Task hanya bisa menjadi completed setelah berstatus in_progress: Update package.json.'), true);
  });

  test('groups the same Todo state-transition failure despite a different task title', () => {
    const first = guard.repeatedFailureSignature('todo_write', 'Tool gagal: Task hanya bisa menjadi completed setelah berstatus in_progress: Update package.json.');
    const second = guard.repeatedFailureSignature('todo_write', 'Tool gagal: Task hanya bisa menjadi completed setelah berstatus in_progress: Pastikan indexedDB masih kompatibel.');
    assert.equal(first, second);
  });

  test('groups the same Windows shell command-not-found failure across different commands', () => {
    const first = guard.repeatedFailureSignature('run_terminal', "Status: failed\nExit code: 1\n'pwd' is not recognized as an internal or external command");
    const second = guard.repeatedFailureSignature('run_terminal', "Status: failed\nExit code: 1\n'npm' is not recognized as an internal or external command");
    assert.equal(first, second);
  });

  test('keeps distinct failure categories separate', () => {
    const shell = guard.repeatedFailureSignature('run_terminal', 'Status: failed\nExit code: 1\nThe filename, directory name, or volume label syntax is incorrect.');
    const missing = guard.repeatedFailureSignature('run_terminal', "'npm' is not recognized as an internal or external command");
    assert.notEqual(shell, missing);
  });

  test('recovery prompt requires reading Todo state and not repeating the same payload', () => {
    const hint = guard.getToolRecoveryHint('todo_write', 'Tool gagal: Task hanya bisa menjadi completed setelah berstatus in_progress.');
    assert.match(hint, /todo_read/);
    assert.match(hint, /jangan kirim ulang/i);
    assert.match(hint, /pending/i);
    assert.match(hint, /pembaruan berikutnya/i);
  });

  test('terminal recovery prompt describes the selected shell and forbids exit-code wrappers', () => {
    const hint = guard.getToolRecoveryHint('run_terminal', 'Status: failed\nExit code: 1\nThe filename, directory name, or volume label syntax is incorrect.');
    assert.match(hint, /Shell terminal aktif/);
    assert.match(hint, /exit code/i);
    assert.match(hint, /jangan mengubah source code/i);
  });

  test('creates a stable signature for semantically identical tool arguments', () => {
    assert.equal(
      guard.repeatedNoProgressActionSignature('write_project_file', '{"path":"src/a.ts","content":"x"}'),
      guard.repeatedNoProgressActionSignature('write_project_file', '{"content":"x","path":"src/a.ts"}'),
    );
  });

  test('keeps different tool arguments in separate no-progress groups', () => {
    assert.notEqual(
      guard.repeatedNoProgressActionSignature('run_terminal', '{"command":"npm run build"}'),
      guard.repeatedNoProgressActionSignature('run_terminal', '{"command":"npm test"}'),
    );
  });

  test('does not treat interactive user questions as repeatable no-progress actions', () => {
    assert.equal(guard.repeatedNoProgressActionSignature('ask_user', '{"question":"Choose"}'), null);
  });

  test('does not assign a repeated-failure signature to a successful result', () => {
    assert.equal(guard.repeatedFailureSignature('todo_write', 'Todo List diperbarui: 2/2 task completed.'), null);
  });

  console.log('\nAgent Failure Guard tests: ' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
