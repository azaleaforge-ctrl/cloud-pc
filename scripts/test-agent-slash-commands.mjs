import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chat = await readFile(join(root, 'src/renderer/components/editor/AgentChat.tsx'), 'utf8');
const css = await readFile(join(root, 'src/renderer/components/editor/agent-progress.css'), 'utf8');

for (const command of ['/sessions', '/connect', '/model']) {
  assert.ok(chat.includes("command: '" + command + "'"),
    'slash command catalog must include ' + command);
}
assert.ok(chat.includes("startsWith(slashCommandQuery || '/')"), 'typing / must filter the slash command menu');
assert.ok(chat.includes("event.key === 'ArrowDown'") && chat.includes("event.key === 'ArrowUp'"),
  'the command menu must support keyboard selection');
assert.ok(chat.includes("event.key === 'Escape' && slashMenuOpen"), 'Escape must close the command menu');
assert.ok(chat.includes("const exactCommand = AGENT_SLASH_COMMANDS.find"), 'full command names must be recognized before sending messages');
assert.ok(chat.includes("if (trimmedInput.startsWith('/'))"), 'slash inputs must be handled by the command router before normal chat send');
assert.ok(chat.includes('Perintah ') && chat.includes('typedCommand') && chat.includes('tidak dikenal.'),
  'unknown slash commands must report an error instead of being sent to the AI');
assert.ok(chat.includes("if (command === '/model') {") && chat.includes('openModelPicker();'),
  '/model must open a dedicated model picker modal, not the connection settings panel');
assert.ok(chat.includes("setSettingsFocusTarget('connect')"), '/connect must focus the provider connection settings');
assert.ok(chat.includes('className="ai-model-dialog" role="dialog" aria-modal="true"'),
  '/model must open an accessible, dedicated modal dialog');
assert.ok(chat.includes('modelCostFilter') && chat.includes('modelSearchQuery'),
  'the model picker must have functional cost filters and search');
assert.ok(chat.includes("model.costTier === 'free'") && chat.includes("model.costTier === 'premium'"),
  'cost filters must use cost tier exposed by provider metadata');

assert.ok(chat.includes('className="ai-session-overlay"') && chat.includes('className="ai-session-history ai-sessions-modal"'),
  '/sessions must open a centered modal');
assert.ok(chat.includes('role="dialog" aria-modal="true"'), 'the session picker must be an accessible modal dialog');
assert.ok(chat.includes('className="ai-session-code"'), 'each session must show its session code as well as its name');
assert.ok(chat.includes('className="ai-session-list ai-sessions-modal-list"'), 'the session modal must have a dedicated scroll list');
assert.ok(!chat.includes('Riwayat ({workspaceSessions.length})'), 'the replaced session toolbar button must be removed');
assert.ok(!chat.includes('className="ai-clear-btn" onClick={() => setSettingsOpen((open) => !open)} title="Pengaturan AI">'),
  'the redundant settings toolbar button must be replaced by /connect and /model');

const menuPosition = chat.indexOf('className="ai-slash-menu"');
const inputPosition = chat.indexOf('<div className="ai-input-row">', menuPosition);
assert.ok(menuPosition >= 0 && inputPosition > menuPosition, 'the command menu must render above the composer input row');
assert.ok(css.includes('.ai-slash-menu {') && css.includes('max-height: 320px;') && css.includes('overflow-y: auto;'),
  'slash suggestions must stay compact and scroll when necessary');
assert.ok(css.includes('.ai-session-overlay {') && css.includes('justify-content: center;') && css.includes('align-items: center;'),
  'the session picker must be centered on screen');
assert.ok(css.includes('.ai-panel.fullsize .ai-settings {') && css.includes('max-height: min(48vh, 420px);'),
  '/connect settings must remain independently scrollable');
assert.ok(css.includes('.ai-model-overlay {') && css.includes('.ai-model-options {') && css.includes('overscroll-behavior: contain;'),
  'the model picker must be a centered overlay with an internally scrollable model list');
assert.ok(css.includes('.ai-sessions-modal-list {') && css.includes('max-height: min(255px, 42vh);') && css.includes('overflow-y: auto;'),
  'the session list must scroll internally after roughly three rows');
assert.ok(chat.includes('disabled={loading || !sessionReady || !activeAgent}'),
  'the composer must remain available to enter /connect before a provider is connected');

console.log('Agent slash-command and session-modal tests: all assertions passed.');
