import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chat = await readFile(join(root, 'src/renderer/components/editor/AgentChat.tsx'), 'utf8');
const css = await readFile(join(root, 'src/renderer/components/editor/editor.css'), 'utf8');

function lastRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(escaped + '\\s*\\{([^}]*)\\}', 'g');
  const matches = [...css.matchAll(expression)];
  assert.ok(matches.length, 'expected CSS rule for ' + selector);
  return matches[matches.length - 1][1];
}

const sidePanel = lastRule('.ai-agent-sidepanel');
assert.match(sidePanel, /overflow-y:\\s*auto/, 'the outer right panel must scroll when total card height exceeds the viewport');
assert.match(sidePanel, /overscroll-behavior-y:\\s*contain/, 'outer scrolling must not chain unexpectedly to the chat');

for (const [className, expectedHeight] of [
  ['.ai-side-workspace-card', '150px'],
  ['.ai-side-skills-card', '210px'],
  ['.ai-side-tools-card', '210px'],
  ['.ai-side-todo-card', '265px'],
  ['.ai-side-changes-card', '265px'],
]) {
  const rule = lastRule('.ai-agent-sidepanel > .ai-side-card' + className);
  assert.match(rule, /flex:\\s*0\\s+0\\s+auto/, className + ' must not expand and crowd out other cards');
  assert.match(rule, new RegExp('max-height:\\\\s*' + expectedHeight.replace('px', 'px')), className + ' must have a height ceiling');
}

const innerScroller = lastRule('.ai-agent-sidepanel .ai-side-scroll');
assert.match(innerScroller, /min-height:\\s*0/, 'inner scroll areas need min-height: 0 within a flex card');
assert.match(innerScroller, /overflow-y:\\s*auto/, 'each card list must scroll independently');
assert.match(innerScroller, /overscroll-behavior-y:\\s*contain/, 'inner scrolling must not chain to the parent');
assert.match(chat, /className="ai-side-scroll ai-side-skills-scroll"/, 'skills card must have its own scroll region');
assert.match(chat, /className="ai-side-scroll ai-side-tools-scroll"/, 'tool activity card must have its own scroll region');
assert.match(chat, /className="ai-side-scroll ai-side-todo-scroll"/, 'Todo card must have its own scroll region');
assert.match(chat, /className="ai-side-scroll ai-side-changes-scroll"/, 'workspace change card must have its own scroll region');

console.log('Agent right-panel layout tests: all assertions passed.');
