// Unit test untuk validator Todo Orchestrator. Jalankan: npm run test:agent-todo
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'rk-agent-todo-'));
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
  const bundlePath = join(temp, 'agentTodo.cjs');
  await build({
    entryPoints: [join(ROOT, 'src', 'main', 'editor', 'agentTodo.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  const { applyAgentTodoUpdate } = require(bundlePath);

  const plan = [
    { id: 'inspect', title: 'Periksa struktur project', status: 'in_progress', priority: 'high', blockedBy: [], verification: 'Inventory project dibaca' },
    { id: 'implement', title: 'Implementasi perubahan', status: 'pending', priority: 'normal', blockedBy: ['inspect'], verification: 'Perubahan kode dibuat dan ditinjau' },
    { id: 'verify', title: 'Verifikasi hasil', status: 'pending', priority: 'normal', blockedBy: ['implement'], verification: 'Pemeriksaan yang diperlukan lulus' },
  ];
  const initial = applyAgentTodoUpdate([], plan, 1000);

  test('accepts a sequential plan with one active task', () => {
    assert.equal(initial.length, 3);
    assert.equal(initial.filter((todo) => todo.status === 'in_progress').length, 1);
    assert.equal(initial[0].createdAt, 1000);
  });

  test('rejects duplicate task IDs', () => {
    assert.throws(() => applyAgentTodoUpdate([], [
      { id: 'same', title: 'A', status: 'pending' },
      { id: 'same', title: 'B', status: 'pending' },
    ]), /duplikat/i);
  });

  test('rejects references to missing dependencies', () => {
    assert.throws(() => applyAgentTodoUpdate([], [
      { id: 'a', title: 'A', status: 'pending', blockedBy: ['missing'] },
    ]), /ID yang tidak ada/i);
  });

  test('rejects dependency cycles', () => {
    assert.throws(() => applyAgentTodoUpdate([], [
      { id: 'a', title: 'A', status: 'pending', blockedBy: ['b'] },
      { id: 'b', title: 'B', status: 'pending', blockedBy: ['a'] },
    ]), /siklus/i);
  });

  test('rejects multiple in-progress tasks', () => {
    assert.throws(() => applyAgentTodoUpdate([], [
      { id: 'a', title: 'A', status: 'in_progress' },
      { id: 'b', title: 'B', status: 'in_progress' },
    ]), /Hanya satu task/i);
  });

  test('does not allow dependent work before prerequisite completion', () => {
    assert.throws(() => applyAgentTodoUpdate(initial, [
      { ...initial[0], status: 'blocked', blockedReason: 'Menunggu prasyarat' },
      { ...initial[1], status: 'in_progress' },
      initial[2],
    ], 2000), /prasyarat/i);
  });

  test('does not allow a new task to be marked complete immediately', () => {
    assert.throws(() => applyAgentTodoUpdate([], [
      { id: 'fresh', title: 'Task baru', status: 'completed', completionEvidence: 'Saya rasa selesai' },
    ], 2000), /Task baru tidak boleh langsung completed/i);
  });

  test('requires verification evidence before completing active work', () => {
    assert.throws(() => applyAgentTodoUpdate(initial, [
      { ...initial[0], status: 'completed', completionEvidence: '' },
      initial[1],
      initial[2],
    ], 2000), /bukti verifikasi/i);
  });

  const completedFirst = applyAgentTodoUpdate(initial, [
    { ...initial[0], status: 'completed', completionEvidence: 'Inventory project dibaca dan struktur utama diverifikasi.' },
    initial[1],
    initial[2],
  ], 2000);

  test('allows completion from in-progress when evidence is supplied', () => {
    assert.equal(completedFirst[0].status, 'completed');
    assert.match(completedFirst[0].completionEvidence, /Inventory project/i);
    assert.equal(completedFirst[1].status, 'pending');
  });

  const secondActive = applyAgentTodoUpdate(completedFirst, [
    completedFirst[0],
    { ...completedFirst[1], status: 'in_progress' },
    completedFirst[2],
  ], 3000);

  test('allows the next dependent task only after its prerequisite is completed', () => {
    assert.equal(secondActive[1].status, 'in_progress');
  });

  test('does not allow existing task IDs to disappear', () => {
    assert.throws(() => applyAgentTodoUpdate(initial, [initial[0]], 2000), /tidak boleh menghapus task/i);
  });

  test('requires a reason for blocked tasks', () => {
    assert.throws(() => applyAgentTodoUpdate([], [
      { id: 'blocked', title: 'Task terblokir', status: 'blocked' },
    ]), /blockedReason/i);
  });

  test('preserves completed task identity and completion evidence', () => {
    assert.throws(() => applyAgentTodoUpdate(completedFirst, [
      { ...completedFirst[0], title: 'Judul lain' },
      completedFirst[1],
      completedFirst[2],
    ], 3000), /Judul dan dependensi/i);
  });

  console.log('\nTodo Orchestrator tests: ' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
