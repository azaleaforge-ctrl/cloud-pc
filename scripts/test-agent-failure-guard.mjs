// Regression tests for non-blocking agent tool error handling.
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

  assert.equal(guard.isToolFailureResult('Tool gagal: file tidak ditemukan.'), true);
  assert.equal(guard.isToolFailureResult('Status: failed\nExit code: 1\nmissing script'), true);
  assert.equal(guard.isToolFailureResult('Status: completed\nExit code: 0'), false);
  console.log('PASS tool failure classification preserves real command results');

  const todoHint = guard.getToolRecoveryHint('todo_write', 'Tool gagal: Todo payload tidak valid.');
  assert.match(todoHint, /Todo List hanya panel progres opsional/i);
  assert.match(todoHint, /lanjutkan pekerjaan file\/terminal utama/i);
  assert.doesNotMatch(todoHint, /hentikan run|jangan lanjut/i);
  console.log('PASS Todo failures are advisory and do not gate workspace actions');

  const terminalHint = guard.getToolRecoveryHint(
    'run_terminal',
    'Status: failed\nExit code: 1\nThe filename, directory name, or volume label syntax is incorrect.',
  );
  assert.match(terminalHint, /Shell terminal aktif/);
  assert.match(terminalHint, /Timeout satu command tidak menghentikan agent/);
  console.log('PASS terminal errors provide a recovery path without ending the agent run');

  const genericHint = guard.getToolRecoveryHint('read_project_file', 'Tool gagal: read error.');
  assert.match(genericHint, /bukan alasan untuk menghentikan seluruh run/i);
  console.log('PASS generic tool errors remain recoverable');

  assert.equal(typeof guard.repeatedFailureSignature, 'undefined');
  assert.equal(typeof guard.repeatedNoProgressActionSignature, 'undefined');
  assert.equal(typeof guard.getRepeatedActionRecoveryHint, 'undefined');
  console.log('PASS repeated-failure and no-progress stop helpers have been removed');
} finally {
  await rm(temp, { recursive: true, force: true });
}
