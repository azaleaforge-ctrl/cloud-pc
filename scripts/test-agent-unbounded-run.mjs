import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const agentPath = join(root, 'src', 'main', 'editor', 'agent.ts');
const agent = await readFile(agentPath, 'utf8');
const policy = await readFile(join(root, 'src', 'main', 'editor', 'agentTodoPolicy.ts'), 'utf8');

assert.match(agent, /while\s*\(!session\.killed\)/, 'agent should continue until final response or explicit cancellation');
assert.match(agent, /await executeTool\(session, userDataDir, root, call/, 'tool execution must not be gated behind Todo or repeat-count checks');
assert.doesNotMatch(agent, /MAX_AGENT_TOOL_CALLS|MAX_AGENT_RUN_MS|MAX_AGENT_RUN_MINUTES/, 'no global tool-call or elapsed-run cap should remain');
assert.doesNotMatch(agent, /MAX_NO_PROGRESS_REPLIES|MAX_IDENTICAL_NO_PROGRESS_ACTIONS|suppressedNoProgressActions|repeatedNoProgressActionSignature/, 'no repeat/no-progress mechanism should suppress or stop work');
assert.doesNotMatch(agent, /shouldBlockToolUntilTodoPlan|Tool ditahan: buat Todo List|Tool ditahan: tidak ada task Todo/, 'Todo state must never gate workspace or terminal tools');
assert.doesNotMatch(agent, /Agent terblokir:|Safety budget mencapai/, 'runtime must not emit the removed agent-blocked messages');

assert.match(agent, /workspaceReadCache/, 'file contents should be cached for the active run');
assert.match(agent, /workspaceReadRanges/, 'duplicate file ranges should not be sent again');
assert.match(agent, /workspaceReadNextLine/, 'file reading should continue from the next unread line by default');
assert.match(agent, /start_line/, 'read_project_file should support line-range continuation');
assert.match(agent, /12_000/, 'individual file chunks should stay below the tool-result payload cap');
assert.doesNotMatch(agent, /maksimum 1 MB|MAX_READ_BYTES/, 'the old one-megabyte read cap should be removed');

assert.match(policy, /return false;/, 'Todo compatibility policy should never block a tool');
assert.match(agent, /Todo List hanya panel progres opsional/, 'Todo is documented as optional progress metadata');
assert.match(agent, /kegagalan .* tidak boleh membuat run dihentikan/, 'tool failures must be recoverable by the ongoing loop');

console.log('Agent continuation and workspace read-cache checks passed.');
