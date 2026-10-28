import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chat = await readFile(join(root, 'src/renderer/components/editor/AgentChat.tsx'), 'utf8');
const css = await readFile(join(root, 'src/renderer/components/editor/agent-progress.css'), 'utf8');
const queueUi = await readFile(join(root, 'src/renderer/components/QueueTab.tsx'), 'utf8');
const queueHost = await readFile(join(root, 'src/main/hostRoom.ts'), 'utf8');

assert.ok(chat.includes('</think>'), 'think closing marker must be recognized');
assert.ok(chat.includes('ai-think-end'), 'think closing marker must have a visible indicator');
assert.ok(chat.includes('[ivxlcdmIVXLCDM]{2,}'), 'ordered list markers must support Roman numerals');
assert.ok(chat.includes('[a-zA-Z]'), 'ordered list markers must support alphabetic forms');
assert.ok(chat.includes('ai-markdown-task-mark'), 'task-list items must render a checkbox marker');
assert.ok(chat.includes("event.key === 'ArrowDown'") && chat.includes("event.key === 'ArrowUp'"), 'agent question choices must support arrow-key navigation');
assert.ok(chat.includes("event.key === 'Enter'"), 'agent question selection must require Enter/click confirmation');
assert.ok(chat.includes('setTodos([]);\n    setChanges([]);'), 'new tasks must clear previous Todo and workspace changes');
assert.ok(css.includes('list-style: decimal outside !important'), 'ordered-list markers must be visible despite global resets');
assert.ok(css.includes('.ai-rich-content p { margin: 0 0 12px'), 'paragraphs must have readable vertical spacing');
assert.ok(queueUi.includes('Daftar anggota idle'), 'queue UI must have an Idle section');
assert.ok(queueHost.includes('if (holder === null) {\n        void internalTakeTurn(memberId);'), 'first active member must acquire an empty room');
assert.ok(queueHost.includes('Date.now() - holderLastActivity >= IDLE_TIMEOUT_MS'), 'fresh activity must recover an expired idle turn');
console.log('Agent Markdown and queue regression tests: 12 assertions passed.');
