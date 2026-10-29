import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chat = await readFile(join(root, 'src/renderer/components/editor/AgentChat.tsx'), 'utf8');
const css = await readFile(join(root, 'src/renderer/components/editor/agent-progress.css'), 'utf8');
const editorCss = await readFile(join(root, 'src/renderer/components/editor/editor.css'), 'utf8');
const queueUi = await readFile(join(root, 'src/renderer/components/QueueTab.tsx'), 'utf8');
const queueHost = await readFile(join(root, 'src/main/hostRoom.ts'), 'utf8');

assert.ok(chat.includes('</think>'), 'think closing marker must be recognized');
assert.ok(chat.includes('ai-think-end'), 'think closing marker must have a visible indicator');
assert.ok(chat.includes('[ivxlcdmIVXLCDM]{2,}'), 'ordered list markers must support Roman numerals');
assert.ok(chat.includes('[a-zA-Z]'), 'ordered list markers must support alphabetic forms');
assert.ok(chat.includes('ai-markdown-task-mark'), 'task-list items must render a checkbox marker');
assert.ok(chat.includes("event.key === 'ArrowDown'") && chat.includes("event.key === 'ArrowUp'"), 'agent question choices must support arrow-key navigation');
assert.ok(chat.includes("event.key === 'Enter'"), 'agent question selection must require Enter/click confirmation');
assert.ok(chat.includes('const CUSTOM_QUESTION_OPTION = 4;'), 'Custom must be the explicit fourth answer option');
assert.ok(chat.includes('<strong>4. Custom (tulis sendiri)</strong>'), 'Custom must be visibly labelled as option four');
assert.ok(chat.includes('{selectedQuestionOption === CUSTOM_QUESTION_OPTION ? ('), 'manual input must stay hidden until Custom is selected');
assert.ok(chat.includes('const isCustomOptionSelected = selectedQuestionOption === CUSTOM_QUESTION_OPTION;'), 'custom text must only be sent when Custom is selected');
assert.ok(chat.includes('const count = agentQuestion.options.length + 1;'), 'keyboard navigation must include the Custom option');
assert.ok(chat.includes('onChange={(event) => setCustomQuestionAnswer(event.target.value)}'), 'typing a custom answer must preserve the selected Custom option');
assert.ok(chat.includes('type AgentWorkTimelineItem') && chat.includes('const items: AgentWorkTimelineItem[]'), 'messages and work results must share one timeline');
assert.ok(chat.includes('.sort((left, right) => left.ts - right.ts)'), 'conversation and tool cards must render in chronological order');
assert.ok(chat.includes("if (event.activity.status === 'running')") && chat.includes('next[index] = { ...next[index], streaming: false };'), 'assistant text must end before a tool card starts');
assert.ok(chat.includes('post-tool commentary in its own chat bubble'), 'assistant output after a tool must start a new bubble');
assert.ok(chat.includes('write_project_file: \'Tulis kode\''), 'file writes must have a clear coding activity label');
assert.ok(chat.includes('upsertAgentTerminalProcess(previous, event.process, 100)'), 'separate terminal results must be retained in the visible timeline');
assert.ok(!chat.includes('TerminalRunHistory') && !chat.includes('ai-run-details-scroll'), 'terminal and tool results must not remain compressed in the loading dock');
assert.ok(chat.includes('ai-side-skills-card') && editorCss.includes('.ai-side-skills-card'), 'active skills must be shown in the right work panel instead of above chat');
assert.ok(chat.includes('messages={messages}') && chat.includes('activities={toolActivities}') && chat.includes('terminalHistory={terminalHistory}'), 'assistant messages, tool activity, and terminal output must share one chronological renderer');
assert.ok(chat.includes('className="ai-side-tools-card"') && editorCss.includes('.ai-side-tools-card'), 'a compact tool usage summary must be available in the right panel');
assert.ok(chat.includes('AGENT_TOOL_DISPLAY_NAMES[item.name] || item.name'), 'the right tool panel must use readable names for the active tools');
assert.ok(editorCss.includes('overflow-y: auto;') && editorCss.includes('.ai-side-tools-scroll'), 'the right work panel must remain scrollable when skill/tool details grow');
assert.ok(chat.includes('return [...previous, nextMessage];'), 'model text emitted after a tool call must create a new assistant chat bubble');

assert.ok(css.includes('.ai-terminal-status-mark.status-completed') && css.includes('.ai-terminal-status-mark.status-failed'), 'terminal cards must show distinct success and failure marks');
assert.ok(css.includes('.ai-tool-activities.status-failed') && css.includes('.ai-tool-activities.status-completed'), 'tool cards must show success and failure states');


assert.ok(chat.includes('setTodos([]);') && chat.includes('setChanges([]);'), 'new tasks must clear previous Todo and workspace changes');
assert.ok(css.includes('list-style: decimal outside !important'), 'ordered-list markers must be visible despite global resets');
assert.ok(css.includes('.ai-rich-content p { margin: 0 0 12px'), 'paragraphs must have readable vertical spacing');
assert.ok(queueUi.includes('Daftar anggota idle'), 'queue UI must have an Idle section');
assert.ok(queueHost.includes('if (holder === null)') && queueHost.includes('void internalTakeTurn(memberId)'), 'first active member must acquire an empty room');
assert.ok(queueHost.includes('Date.now() - holderLastActivity >= IDLE_TIMEOUT_MS'), 'fresh activity must recover an expired idle turn');
assert.ok(chat.includes('available.filter((session) => sameWorkspacePath(session.projectPath, wb.root))'), 'initial session restore must be scoped to the selected project folder');
assert.ok(chat.includes('const sessionWorkspaceRef = useRef<string | null>(wb.root)'), 'workspace changes must be tracked independently');
assert.ok(chat.includes('const workspaceSessions = sessions.filter((session) => sameWorkspacePath(session.projectPath, wb.root))'), 'history UI must only show sessions for the active project folder');
assert.ok(chat.includes('setMessages([]);') && chat.includes('setConversationId(makeConversationId());'), 'switching project folders must create a fresh visible conversation');
console.log('Agent Markdown, Ask User, chronological chat timeline, terminal statuses, queue, and workspace-session regression checks passed.');
