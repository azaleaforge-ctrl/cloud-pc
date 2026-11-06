import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'rk-openai-messages-'));
const require = createRequire(import.meta.url);

try {
  const bundle = join(dir, 'openAiMessages.cjs');
  await build({
    entryPoints: [join(root, 'src/main/editor/openAiMessages.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    logLevel: 'silent',
  });
  const { normalizeOpenAiToolCallMessages } = require(bundle);

  const input = [
    { role: 'system', content: 'system instructions' },
    { role: 'user', content: 'Inspect the project.' },
    {
      role: 'assistant',
      content: 'I will inspect the project first.',
      tool_calls: [{
        id: 'call-1',
        type: 'function',
        function: { name: 'list_project_files', arguments: '{}' },
      }],
    },
    { role: 'tool', tool_call_id: 'call-1', content: 'README.md' },
  ];
  const normalized = normalizeOpenAiToolCallMessages(input);
  assert.deepEqual(normalized.slice(0, 2), input.slice(0, 2));
  assert.deepEqual(normalized[2], { role: 'assistant', content: 'I will inspect the project first.' });
  assert.equal(normalized[3].role, 'assistant');
  assert.equal(normalized[3].content, null);
  assert.deepEqual(normalized[3].tool_calls, input[2].tool_calls);
  assert.deepEqual(normalized[4], input[3]);

  const emptyContent = normalizeOpenAiToolCallMessages([{
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 'call-2', type: 'function', function: { name: 'todo_write', arguments: '{}' } }],
  }]);
  assert.equal(emptyContent.length, 1);
  assert.equal(emptyContent[0].content, null);

  const ordinaryAssistant = [{ role: 'assistant', content: 'A normal response.' }];
  assert.deepEqual(normalizeOpenAiToolCallMessages(ordinaryAssistant), ordinaryAssistant);

  console.log('Agent OpenAI-compatible message tests: all assertions passed.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
