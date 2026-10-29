import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chat = await readFile(join(root, 'src/renderer/components/editor/AgentChat.tsx'), 'utf8');
const css = await readFile(join(root, 'src/renderer/components/editor/editor.css'), 'utf8');
const stageCss = css.slice(css.lastIndexOf('/* ---------- v1.0.7 Stage 1: bounded, independently scrollable right-panel cards ---------- */'));

assert.ok(stageCss.length > 0, 'the right-panel layout rules for v1.0.7 Stage 1 must be present');
assert.ok(stageCss.includes('.ai-agent-sidepanel {'), 'the outer right panel must have explicit scroll rules');
assert.ok(stageCss.includes('overflow-y: auto;'), 'the outer right panel must scroll when total card height exceeds the viewport');
assert.ok(stageCss.includes('overscroll-behavior-y: contain;'), 'scrolling must be contained instead of unexpectedly chaining to the chat');
assert.ok(stageCss.includes('.ai-agent-sidepanel > .ai-side-card {\n  flex: 0 0 auto;'), 'cards must keep their natural height instead of expanding to crowd other cards');

for (const [selector, height] of [
  ['.ai-agent-sidepanel > .ai-side-card.ai-side-workspace-card {', '150px'],
  ['.ai-agent-sidepanel > .ai-side-card.ai-side-skills-card {', '210px'],
  ['.ai-agent-sidepanel > .ai-side-card.ai-side-tools-card {', '210px'],
]) {
  const start = stageCss.indexOf(selector);
  assert.notEqual(start, -1, selector + ' must define a height boundary');
  const end = stageCss.indexOf('}', start);
  assert.ok(stageCss.slice(start, end).includes('max-height: ' + height + ';'), selector + ' must cap height at ' + height);
}

const taskAndChangesRule = stageCss.slice(stageCss.indexOf('.ai-agent-sidepanel > .ai-side-card.ai-side-todo-card,'));
assert.ok(taskAndChangesRule.startsWith('.ai-agent-sidepanel > .ai-side-card.ai-side-todo-card,'), 'Todo and file-change cards must share bounded scrolling rules');
assert.ok(taskAndChangesRule.slice(0, taskAndChangesRule.indexOf('}')).includes('min-height: 130px;'), 'Todo/change cards must remain usable when empty');
assert.ok(taskAndChangesRule.slice(0, taskAndChangesRule.indexOf('}')).includes('max-height: 265px;'), 'Todo/change cards must show only a compact portion of long lists');

const innerScrollStart = stageCss.indexOf('.ai-agent-sidepanel .ai-side-scroll {');
assert.notEqual(innerScrollStart, -1, 'inner list scrollers must have their own rule');
const innerScroller = stageCss.slice(innerScrollStart, stageCss.indexOf('}', innerScrollStart));
assert.ok(innerScroller.includes('min-height: 0;'), 'inner scroll areas need min-height: 0 within a flex card');
assert.ok(innerScroller.includes('overflow-y: auto;'), 'each card list must scroll independently');
assert.ok(innerScroller.includes('overscroll-behavior-y: contain;'), 'inner scrolling must not chain to the parent');

for (const className of [
  'ai-side-scroll ai-side-skills-scroll',
  'ai-side-scroll ai-side-tools-scroll',
  'ai-side-scroll ai-side-todo-scroll',
  'ai-side-scroll ai-side-changes-scroll',
]) {
  assert.ok(chat.includes('className="' + className + '"'), className + ' must have its own scroll region');
}

console.log('Agent right-panel layout tests: all assertions passed.');
