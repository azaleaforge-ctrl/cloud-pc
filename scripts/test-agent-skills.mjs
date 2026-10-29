import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skills = await readFile(join(root, 'src/main/editor/skills.ts'), 'utf8');
const agent = await readFile(join(root, 'src/main/editor/agent.ts'), 'utf8');

assert.ok(
  skills.includes("conversationContext = ''"),
  'skill selection must accept optional prior user context',
);
assert.ok(
  skills.includes('const hasContinuationReference =') &&
    skills.includes('const shouldReuseConversation = Boolean(conversationContext.trim())'),
  'short or referential follow-ups must be able to reuse recent conversation intent',
);
assert.ok(
  skills.includes('const intentText = (shouldReuseConversation ? conversationContext + \' \' : \'\') + userText;'),
  'previous context must only be combined with the latest message when the latter is a follow-up',
);
for (const selector of ['codingTask', 'visualDesign', 'debugging', 'security', 'testing']) {
  const line = skills.split('\n').find((item) => item.startsWith('  const ' + selector + ' = '));
  assert.ok(line && line.includes('.test(intentLower)'), selector + ' selection must use effective task intent');
}
assert.ok(
  skills.includes("i.test(intentLower)) add('document-analysis')"),
  'document skills must be selected from request/attachment context, not unrelated filenames in project inventory',
);
assert.ok(
  agent.includes("const userMessages = inputMessages.filter((message) => message.role === 'user');") &&
    agent.includes('.slice(Math.max(0, userMessages.length - 4), -1)') &&
    agent.includes('.slice(-6000);'),
  'runtime must provide a bounded window of up to three prior user turns',
);
assert.ok(
  agent.includes('selectAgentSkills(latestUserText + \' \' + attachmentHints, activePath, inventory, priorUserContext)'),
  'runtime must pass prior user context into the skill selector',
);
console.log('Agent skill selection regression checks passed.');
