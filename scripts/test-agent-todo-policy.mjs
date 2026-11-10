import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'rk-agent-todo-policy-'));
const require = createRequire(import.meta.url);
let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error instanceof Error ? error.message : String(error))); }
}

try {
  const bundlePath = join(temp, 'agentTodoPolicy.cjs');
  await build({
    entryPoints: [join(root, 'src/main/editor/agentTodoPolicy.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  const { requiresTodoPlanForRequest, shouldBlockToolUntilTodoPlan } = require(bundlePath);

  test('all workspace and terminal tools remain available without Todo', () => {
    for (const name of [
      'list_project_files', 'read_project_file', 'search_project_files',
      'todo_read', 'todo_write', 'read_session_memory', 'write_session_memory',
      'write_project_file', 'run_terminal', 'search_web', 'read_web_page',
      'check_package_version', 'get_current_time', 'mcp_mutating_tool',
    ]) {
      assert.equal(shouldBlockToolUntilTodoPlan(true, false, name), false, name + ' must never be blocked');
      assert.equal(shouldBlockToolUntilTodoPlan(true, true, name), false, name + ' must never be gated by Todo');
    }
  });

  test('change-intent classification is informational only', () => {
    assert.equal(requiresTodoPlanForRequest('Perbaiki Agentic Coding AI dan tambahkan regression tests'), true);
    assert.equal(requiresTodoPlanForRequest('Refactor dan ubah konfigurasi project'), true);
    assert.equal(requiresTodoPlanForRequest('Baca file package.json'), false);
    assert.equal(shouldBlockToolUntilTodoPlan(requiresTodoPlanForRequest('Perbaiki aplikasi'), false, 'write_project_file'), false);
  });

  console.log('\nAgent Todo policy tests: ' + passed + ' passed, ' + failed + ' failed.');
  if (failed) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
