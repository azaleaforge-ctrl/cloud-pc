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
  const { shouldBlockToolUntilTodoPlan } = require(bundlePath);

  for (const name of ['list_project_files', 'read_project_file', 'search_project_files', 'todo_read', 'read_session_memory', 'search_web', 'read_web_page', 'check_package_version', 'get_current_time']) {
    test('allows read-only discovery before Todo: ' + name, () => {
      assert.equal(shouldBlockToolUntilTodoPlan(true, false, name), false);
    });
  }

  test('allows todo_write to create the initial plan', () => {
    assert.equal(shouldBlockToolUntilTodoPlan(true, false, 'todo_write'), false);
  });

  for (const name of ['write_project_file', 'run_terminal', 'write_session_memory', 'mcp_mutating_tool']) {
    test('blocks mutating or unknown tools until Todo exists: ' + name, () => {
      assert.equal(shouldBlockToolUntilTodoPlan(true, false, name), true);
    });
  }

  test('does not require Todo for simple/non-substantive requests', () => {
    assert.equal(shouldBlockToolUntilTodoPlan(false, false, 'write_project_file'), false);
  });

  test('does not block any tool while a Todo task is active', () => {
    assert.equal(shouldBlockToolUntilTodoPlan(true, true, 'run_terminal'), false);
  });

  test('blocks mutations when Todo entries exist but none is in progress', () => {
    assert.equal(shouldBlockToolUntilTodoPlan(true, false, 'write_project_file'), true);
  });

  console.log('\nAgent Todo policy tests: ' + passed + ' passed, ' + failed + ' failed.');
  if (failed) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
