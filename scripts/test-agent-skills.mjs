import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
  skills.includes("i.test(documentIntentText)) add('document-analysis')"),
  'document skills must use the request or active file, not unrelated filenames in project inventory',
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
assert.ok(agent.includes('selectSkillsForToolActivity(skillSelections, call.name, call.arguments)'),
  'runtime must emit only skills relevant to the current tool step');
assert.ok(agent.includes("emit(session, { type: 'skills', skills: [] })"),
  'skills must be cleared between model-reasoning phases and when a run finishes');
const temp = await mkdtemp(join(tmpdir(), 'rk-agent-skills-'));
try {
  const bundlePath = join(temp, 'skills.cjs');
  await build({
    entryPoints: [join(root, 'src/main/editor/skills.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  const require = createRequire(import.meta.url);
  const { selectAgentSkills, selectSkillsForToolActivity } = require(bundlePath);
  const selectedIds = (userText, activePath = null, inventory = '', context = '') =>
    selectAgentSkills(userText, activePath, inventory, context).map((skill) => skill.id);

  const followUpSkills = selectedIds(
    'lanjutkan',
    null,
    'README.md',
    'Perbaiki endpoint API yang error dan tambahkan regression test',
  );
  assert.ok(followUpSkills.includes('backend-development'), 'a follow-up must retain relevant backend context');
  assert.ok(followUpSkills.includes('debugging'), 'a follow-up must retain relevant debugging context');
  assert.ok(followUpSkills.includes('tdd'), 'a follow-up must retain relevant verification context');

  const contextFreeSkills = selectedIds('lanjutkan', null, 'README.md');
  assert.ok(!contextFreeSkills.includes('backend-development') && !contextFreeSkills.includes('debugging'),
    'a short message without prior context must not invent a task category');

  const standaloneSkills = selectedIds(
    'Jelaskan format tanggal ISO',
    null,
    'README.md',
    'Perbaiki endpoint API yang error',
  );
  assert.ok(!standaloneSkills.includes('backend-development') && !standaloneSkills.includes('debugging'),
    'a new standalone request must not inherit an unrelated prior task');

  const unrelatedDocumentInventory = selectedIds('Perbaiki tombol submit', null, 'docs/archive.pdf');
  assert.ok(!unrelatedDocumentInventory.includes('document-analysis'),
    'an unrelated PDF in project inventory must not trigger document-analysis');

  const activeDocument = selectedIds('Ringkas isi file', 'docs/report.pdf', 'README.md');
  assert.ok(activeDocument.includes('document-analysis'),
    'an actively selected document must still trigger document-analysis');

  const liveSelections = selectAgentSkills(
    'Ubah UI frontend dan tambahkan test',
    'src/App.tsx',
    'src/App.tsx',
  );
  const readStep = selectSkillsForToolActivity(liveSelections, 'read_project_file', '{"path":"src/App.tsx"}').map((skill) => skill.id);
  assert.deepEqual(readStep, ['context'], 'a file-read step should activate only the context skill');
  const writeStep = selectSkillsForToolActivity(liveSelections, 'write_project_file', '{"path":"src/App.tsx"}').map((skill) => skill.id);
  assert.ok(writeStep.includes('safe-code-changes') && writeStep.includes('frontend-ui-engineering'),
    'frontend file writes should activate code-change and frontend skills');
  assert.ok(!writeStep.includes('context'), 'the context skill should turn off when the runtime moves to a write step');
  const testStep = selectSkillsForToolActivity(liveSelections, 'run_terminal', '{"command":"npm run test"}').map((skill) => skill.id);
  assert.deepEqual(testStep, ['tdd'], 'a test command should activate only verification-related skills');
  const unknownStep = selectSkillsForToolActivity(liveSelections, 'ask_user', '{}');
  assert.equal(unknownStep.length, 0, 'unrelated interactions should leave all skills inactive');

  console.log('Agent skill selection behavior checks passed.');
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('Agent skill selection regression checks passed.');
