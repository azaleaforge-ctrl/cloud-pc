# Ruang Kerja v1.0.2 — Phase 0 Architecture Audit

**Status:** Audit completed; no runtime code changed  
**Baseline branch:** `main`  
**Baseline commit:** `a1db643172aa08876384bd33baf3d761b9c973e7`  
**Baseline version:** `1.0.1`  
**Purpose:** Establish the current architecture, integration contracts, CI baseline, known gaps, and acceptance criteria before feature implementation begins.

> This document is an engineering baseline for the v1.0.2 plan. It does not declare future features implemented, does not bump the app version, and does not authorize proceeding to Phase 1.

## 1. Audit scope

The audit reviewed the current package scripts and CI workflow, the Electron main-process agent service, renderer chat, shared agent types, preload IPC bridge, framework detection, and current Skills/Plugins catalog.

Relevant files:

- `src/main/editor/agent.ts` — LLM/CLI agent runtime, tool definitions, execution loop, terminal execution, session memory.
- `src/shared/agents.ts` — current message, agent, file-change, and event contracts.
- `src/preload/index.ts` — typed renderer-to-main API exposed as `window.rk`.
- `src/main/index.ts` — IPC handlers, agent event forwarding, collaboration queue busy-state integration.
- `src/renderer/components/editor/AgentChat.tsx` — chat state, current conversation identifier, message rendering, skills indicator, diff UI, composer.
- `src/main/editor/skills.ts` — built-in skill definitions, heuristic selection, local skill-file installation and loading.
- `src/renderer/components/SkillsPluginsTab.tsx` — curated reference catalog for skills and plugins/MCP.
- `src/renderer/components/editor/ActivityBar.tsx`, `ExtensionsPane.tsx`, `EditorShell.tsx` — editor-side extension UI and editor command palette.
- `.github/workflows/ci.yml` — current automated CI.
- `scripts/test-devserver.mjs` — standalone dev-server test script.

This is a source-level audit plus a check of the most recent GitHub Actions status. It is not a local Windows GUI/manual end-to-end test.

## 2. Current architecture

The current built-in AI chat path is:

1. Renderer `AgentChat.tsx` builds a message list and sends a request through `window.rk.agentStartChat(...)`.
2. The preload bridge forwards that request through Electron IPC.
3. Main-process handlers in `src/main/index.ts` validate project/queue preconditions and call the agent service.
4. `createAgentService` in `src/main/editor/agent.ts` prepares workspace inventory, active-file context (when one is selected), skill instructions, and temporary session memory.
5. The runtime calls an OpenAI-compatible `/chat/completions` endpoint, streams server-sent events, and exposes a fixed set of tools to the model.
6. Tool results are appended to the current model request. Renderer events show output, activity, permission prompts, skill selection, file changes, and run state.
7. The main process also tracks active agent sessions to inform the existing Ruang Kerja collaboration queue.

The application remains an Electron + React + TypeScript application. The agent is currently implemented as a custom TypeScript service inside the Electron main process; this plan does not introduce the OpenCode engine.

### 2.1 Current built-in tools

The runtime currently defines tools for:

- Listing project files.
- Reading a project file.
- Writing/creating a project file.
- Searching project-file text.
- Reading session memory.
- Writing session memory.
- Requesting execution of a terminal command.

The file tools resolve paths against the workspace root and reject sensitive file paths. The runtime has a 1 MiB read limit, an 18,000-character tool-output limit, and a 120-second terminal-command timeout. The current model loop uses `MAX_AGENT_STEPS = 8`; the loop can stop at that limit regardless of whether the requested task or build has succeeded.

### 2.2 Existing boundaries

- Renderer access to the main process is routed through the preload API `window.rk`.
- Agent messages/events are typed in `src/shared/agents.ts`.
- Main process enforces the existing room-turn requirement before an AI chat starts in an active collaboration room.
- Terminal commands currently require explicit user approval and are executed from the workspace root.
- Existing editor terminal, editor extension, debugger, server, file watcher, and collaboration queue services are separate from the built-in AI agent service.

Future work must preserve these boundaries unless a change is deliberate, documented, and tested.

## 3. Baseline contracts today

### 3.1 Current chat message

The current `ChatMessage` is text-oriented:

- `id`
- `role`: system, user, or assistant
- `content`: string
- `ts`
- optional `streaming`

It has no structured attachment list, tool-result transcript, persistent-session reference, per-turn file checkpoint, or message metadata for rewind.

### 3.2 Current agent events

The current `AgentEvent` union covers:

- streamed output
- error and exit
- run state
- activity text
- file changes
- terminal permission request/result
- selected skills

Todo updates, explicit tool start/finish events, source citations, attachment processing, session lifecycle, checkpoint/rewind results, plugin lifecycle, and MCP connection/tool status are not represented in the current event contract.

### 3.3 Current IPC entry points

The preload currently exposes methods including:

- `agentList`
- `agentGetConfig`, `agentSaveConfig`, `agentTestConfig`
- `agentBeginSession`
- `agentStartChat`
- `agentApproveTool`
- `agentStop`
- CLI agent input/resize methods
- `onAgentEvent`

Future APIs should be designed as typed, narrow capabilities through the preload bridge. Do not expose unrestricted Node.js or filesystem access to the renderer.

## 4. Confirmed functional gaps

### 4.1 Agent planning and completion

- The hard cap of eight model/tool steps can terminate a task before completion.
- Todo List state is not part of the agent event contract or an enforced execution workflow.
- Completion is not tied to a shared set of task acceptance checks such as build/test success.
- Terminal output is collected and returned after the process closes rather than being represented as a full stream of command lifecycle events.
- Tool retries, repeated-error detection, resource budgets, cancellation semantics, and an explicit blocked outcome need a deliberate contract.

### 4.2 Session and memory lifecycle

- Renderer chat messages are kept in React state rather than durable session storage.
- `loadSavedMessages()` intentionally removes the legacy `rk.ai.chatHistory` localStorage key and starts with an empty message list.
- A new conversation calls `beginConversation`.
- The main-process implementation deletes the entire `ai-memory/sessions` directory before initializing the new conversation's Markdown memory file.

This means the current memory is temporary task context, not a persistent session-history system. Future persistent sessions must not reuse this directory-wide deletion behavior.

### 4.3 Project context

- The agent gets a workspace inventory and can read files with tools.
- The active editor file is added to initial context only when the user has selected a file.
- The runtime does not yet maintain a semantic/symbol index or a background project-context service.
- Reading all file contents into a single prompt would be unsafe for context-window use and should not be the implementation strategy. The target is indexed discovery and on-demand reading of relevant files.

### 4.4 Fresh data and time

- The current built-in agent tool registry contains no web-search, web-read, current-time, package-registry, or official-documentation tool.
- Framework detection is currently for local project/server launching; it does not establish the latest framework release.
- New-project creation therefore needs a separate version-verification workflow, rather than relying on a model's prior knowledge.
- Local time and world data have different sources: time should come from a trustworthy system clock/time-zone representation; changing external facts should be verified through a web/API source.

### 4.5 Skills, plugins, and MCP

- Ten built-in curated skills are defined in `src/main/editor/skills.ts`; selection is mostly rule/keyword-based.
- Built-in skill files are written under the application's user-data directory and loaded into the system prompt.
- The Skills/Plugins page currently contains 15 skill references and 10 plugin/MCP references; its entries link to upstream repositories.
- The catalog itself does not install the entries or activate them inside the agent runtime.
- MCP references in the current catalog are not the same thing as native plugin packages. The future UI and contracts must distinguish Skills, Plugins, and MCP servers.
- The editor still contains the legacy extension view/runtime. The agreed UI direction is to remove extension navigation from the editor and expose AI skills/plugin/MCP management through their intended Ruang Kerja areas, while deciding explicitly whether existing editor extension capability is retired or retained internally.

### 4.6 Attachments, messages, and rewind

- There is no attachment collection in `ChatMessage` and no full file-upload processing pipeline in the AI composer.
- Current user messages have no message action menu comparable to the requested edit/copy/rewind flow.
- File changes currently carry old/new contents for display, and the UI maintains a bounded in-memory list of changes.
- The current diff viewer is an overlay; file details also appear in the change list and right-hand panel.
- There is no durable checkpoint chain connected to an individual assistant turn, no conflict-safe rewind, and no redo/unrevert flow.
- The future attachment target is a maximum of 500 MB per file at the UI/pipeline level, subject to safe processing and the selected model/provider's actual input capabilities. A 500 MB file must not be passed raw to a model as one request.

## 5. CI and test baseline

### 5.1 Current CI

The latest GitHub Actions CI run at audit time was run #115 for commit `a1db643`, and it completed successfully. Its steps were:

1. Checkout.
2. Set up Node.js 22 on `windows-latest`.
3. `npm ci`.
4. `npm run typecheck`.
5. `npm run build`.

The latest release workflow run for the same commit also completed successfully, including the workflow's release-artifact validation. References:

- CI: https://github.com/azaleaforge-ctrl/cloud-pc/actions/runs/40660446281
- Release workflow: https://github.com/azaleaforge-ctrl/cloud-pc/actions/runs/40660446373

This establishes that the current source passes the configured TypeScript and application-build checks on the runner. It does not prove chat behavior, terminal automation, attachment parsing, plugin loading, session persistence, rewind, or packaged-app UX.

### 5.2 Existing test coverage gap

- `package.json` does not currently define a general `test` script.
- `scripts/test-devserver.mjs` exists as a standalone dev-server test, but the current CI workflow does not run it.
- No dedicated agent-runtime unit tests, tool-execution tests, session lifecycle tests, or renderer interaction tests were found in the reviewed project tree.
- No automated end-to-end scenario currently checks that the AI can create a project, run a build, fix a build error, and prove completion.

### 5.3 Baseline testing requirements for later phases

Add targeted tests with each subsystem, rather than waiting until the last phase. At minimum the plan needs:

- Agent run lifecycle, cancellation, loop continuation, repeated-error handling, and blocked outcome.
- Tool registry/schema validation and tool permission behavior.
- Workspace boundary and sensitive-file protections.
- Terminal exit code, timeout, cancellation, output truncation, and process cleanup.
- Todo task status and prerequisite ordering.
- Session creation, persistence, resume, and deletion confirmation.
- Checkpoint/rewind/redo with detection of manual file edits.
- Skill discovery/loading and plugin/MCP lifecycle errors.
- Attachment type/size validation, parser limits, and model capability mismatch.
- Freshness source/timestamp reporting and fallback behavior when the web/API is unavailable.
- Renderer smoke tests and Windows packaged-app regression checks.

## 6. Proposed runtime contracts (design target only)

No contracts in this section have been implemented by this audit. They are the design direction to review before Phase 1 and refine when each subsystem is built.

### 6.1 Run lifecycle

Use explicit, typed run events/state for:

- run started
- plan/todo changed
- tool started
- tool output/progress
- permission requested/resolved
- tool completed/failed
- file checkpoint created
- model/context status changed
- verification started/result
- run completed, cancelled, or blocked

A final state must include the outcome and verification evidence. UI text by itself is not evidence of success.

### 6.2 Todo item

Each todo item should have a stable identifier, description, status, prerequisite identifiers, optional verification criteria, and timestamps. Only one or more tasks whose prerequisites are satisfied may be active. Marking a task completed should require its completion condition; a failed build cannot be marked successful.

### 6.3 Tool definition and permission

A tool should register a stable name, description, input schema, execution handler, capability category, and permission policy. Validate the model's arguments before execution. A permission decision must be attached to the specific run/tool invocation and must not silently grant broader access.

### 6.4 Session and checkpoint

A persistent session should own its messages, summaries, todos, attachments metadata, runs, and checkpoint references. Checkpoints should record per-file pre/post state and verify current file state before restoring. Session deletion must not erase unrelated sessions.

### 6.5 Fresh-data evidence

A live fact should be represented with its value, source, retrieval timestamp, and freshness/context as applicable. The model must distinguish retrieved current data from its own prior knowledge and disclose when verification failed.

## 7. Risk register

| Risk | Why it matters | Direction |
|---|---|---|
| Unbounded agent loop | Can consume tokens/time without progress | Configurable resource limits, repeated-error detection, cancellation, explicit blocked state |
| Dangerous terminal/plugin code | Can damage files or access secrets | Permission profiles, workspace boundary, isolation where practical, logs and clear approval |
| Context overload | Sending all files can exceed model limits and worsen reasoning | Project index plus on-demand file reading |
| Stale framework facts | Model may generate old package versions | Registry/official-doc verification and recorded retrieval timestamp |
| Session data loss | Current new-session path deletes the shared memory directory | Per-session storage and migration plan before persistence work |
| Inaccurate completion | AI can claim success without a successful build | Exit code + required checks + explicit verification evidence |
| External dependency outages | Registry/web/MCP/model may be unavailable | Retry policy, cache with age, transparent blocked outcome |
| Regression to collaboration features | Agent work informs queue state | Keep queue state and room preconditions covered by regression tests |

## 8. Phase 0 decisions and exit criteria

This phase establishes facts and contracts; it does not implement the engine changes.

### Confirmed decisions

- Ruang Kerja will use its own TypeScript agent engine; the OpenCode engine will not be embedded or used as the runtime.
- OpenCode and other agent products are references for concepts and behavior only.
- The public application release remains at 1.0.1 during development; v1.0.2 is reserved for the combined final release.
- Implementations are separated into stages, each with its own checks and review.
- Do not proceed to Phase 1 without explicit user approval after Phase 0 is reported.

### Phase 0 exit checklist

- [x] Existing agent and IPC architecture mapped at source level.
- [x] Existing chat, tool, event, skill, terminal, session, and diff contracts reviewed.
- [x] Current CI workflow and latest run status checked.
- [x] Missing automated test coverage and test gaps documented.
- [x] Future runtime contract and main risks documented.
- [x] No application runtime code or release version changed.
- [ ] User reviews and approves Phase 0 before Phase 1 starts.

### Not included in Phase 0

No Todo Orchestrator, autonomous build loop, project index, web tools, version checker, session database, checkpoint store, attachment pipeline, Skills installer, Plugin runtime, MCP runtime, UI command picker, or v1.0.2 release has been implemented here.
