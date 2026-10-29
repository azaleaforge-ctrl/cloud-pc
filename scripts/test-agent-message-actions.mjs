import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'rk-agent-message-actions-'));
try {
  const bundle = join(temp, 'agentMessageActions.cjs');
  await build({
    entryPoints: [join(root, 'src/shared/agentMessageActions.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent',
  });
  const { createAgentReforkPlan, findCheckpointForMessage } = createRequire(import.meta.url)(bundle);
  const messages = [
    { id: 'u1', role: 'user', content: 'Make a button', ts: 100 },
    { id: 'a1', role: 'assistant', content: 'I will inspect files.', ts: 110, runId: 'run-1' },
    { id: 'u2', role: 'user', content: 'Change the color', ts: 200, attachments: [{ id: 'att-1', name: 'mock.png', mimeType: 'image/png', size: 10 }] },
    { id: 'a2', role: 'assistant', content: 'Done', ts: 220, runId: 'run-2' },
    { id: 'u3', role: 'user', content: 'Add a test', ts: 300 },
  ];
  let passed = 0;
  function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }

  test('refork branch contains only messages before the selected prompt and does not duplicate it', () => {
    const plan = createAgentReforkPlan(messages, 'u2');
    assert.equal(plan.prompt, 'Change the color');
    assert.deepEqual(plan.messages.map(message => message.id), ['u1', 'a1']);
    assert.equal(plan.messages.some(message => message.id === 'u2'), false);
    assert.equal(plan.messages.some(message => message.id === 'a2' || message.id === 'u3'), false);
  });
  test('refork reports ephemeral attachments so the UI can ask for re-selection', () => {
    assert.equal(createAgentReforkPlan(messages, 'u2').requiresAttachmentReselect, true);
    assert.equal(createAgentReforkPlan(messages, 'u1').requiresAttachmentReselect, false);
  });
  test('refork refuses unknown IDs and assistant messages', () => {
    assert.equal(createAgentReforkPlan(messages, 'missing'), null);
    assert.equal(createAgentReforkPlan(messages, 'a1'), null);
  });
  test('uses runId as the authoritative checkpoint link for new sessions', () => {
    const checkpoints = [
      { id: 'cp-1', runId: 'run-1', createdAt: 150, projectPath: '/project', status: 'applied', paths: ['a.ts'] },
      { id: 'cp-2', runId: 'run-2', createdAt: 250, projectPath: '/project', status: 'applied', paths: ['b.ts'] },
    ];
    assert.equal(findCheckpointForMessage(messages[0], messages, checkpoints).id, 'cp-1');
    assert.equal(findCheckpointForMessage(messages[1], messages, checkpoints).id, 'cp-1');
    assert.equal(findCheckpointForMessage(messages[3], messages, checkpoints).id, 'cp-2');
    assert.equal(findCheckpointForMessage({ ...messages[0], runId: 'missing-run' }, messages, checkpoints), undefined);
  });
  test('maps v1.0.6 legacy messages to only checkpoints inside that prompt interval', () => {
    const legacy = messages.map(message => ({ ...message, runId: undefined }));
    const checkpoints = [
      { id: 'cp-before', runId: 'old-run-1', createdAt: 150, projectPath: '/project', status: 'applied', paths: ['a.ts'] },
      { id: 'cp-selected', runId: 'old-run-2', createdAt: 250, projectPath: '/project', status: 'rewound', paths: ['b.ts'] },
      { id: 'cp-after', runId: 'old-run-3', createdAt: 350, projectPath: '/project', status: 'applied', paths: ['c.ts'] },
    ];
    assert.equal(findCheckpointForMessage(legacy[0], legacy, checkpoints).id, 'cp-before');
    assert.equal(findCheckpointForMessage(legacy[2], legacy, checkpoints).id, 'cp-selected');
    assert.equal(findCheckpointForMessage(legacy[4], legacy, checkpoints).id, 'cp-after');
  });
  console.log('\nAgent message action tests: ' + passed + ' passed.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
