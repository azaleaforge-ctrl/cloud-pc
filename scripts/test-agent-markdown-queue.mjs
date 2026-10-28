import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chat = await readFile(join(root, 'src/renderer/components/editor/AgentChat.tsx'), 'utf8');
const css = await readFile(join(root, 'src/renderer/components/editor/agent-progress.css'), 'utf8');
const queueUi = await readFile(join(root, 'src/renderer/components/QueueTab.tsx'), 'utf8');
const queueHost = await readFile(join(root, 'src/main/hostRoom.ts'), 'utf8');

assert.match(chat, /<\\\/think>/, 'think closing marker must be recognized');
assert.match(chat, /ai-think-end/, 'think closing marker must have a visible indicator');
assert.match(chat, /\\d\+\|\\[a-zA-Z\\]\|\\[ivxlcdmIVXLCDM\\]/, 'ordered list markers must support numeric, alphabetic and roman forms');
assert.match(chat, /ai-markdown-task-mark/, 'task-list items must render a checkbox marker');
assert.match(chat, /event\.key === 'ArrowDown'.*event\.key === 'ArrowUp'/s, 'agent question choices must support arrow-key navigation');
assert.match(chat, /event\.key === 'Enter'/, 'agent question selection must require Enter/click confirmation');
assert.match(chat, /setTodos\\(\\[\\]\\);\\s*setChanges\\(\\[\\]\\);/, 'new tasks must clear previous Todo and workspace changes');
assert.match(css, /\\.ai-rich-content ol[^\\n]*list-style: decimal outside !important/, 'ordered-list markers must be visible despite global resets');
assert.match(css, /\\.ai-rich-content p \\{ margin: 0 0 12px/, 'paragraphs must have readable vertical spacing');
assert.match(queueUi, /Daftar anggota idle/, 'queue UI must have an Idle section');
assert.match(queueHost, /if \\(holder === null\\) \\{\\s*void internalTakeTurn\\(memberId\\)/, 'first active member must acquire an empty room');
assert.match(queueHost, /Date\\.now\\(\\) - holderLastActivity >= IDLE_TIMEOUT_MS/, 'fresh activity must recover an expired idle turn');
console.log('Agent Markdown and queue regression tests: 11 assertions passed.');
