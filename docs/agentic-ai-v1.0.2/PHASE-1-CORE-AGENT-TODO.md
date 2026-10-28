# Ruang Kerja v1.0.2 — Phase 1: Core Agent Engine and Todo Orchestrator

**Status:** Implemented in a feature branch; awaiting CI validation and user review  
**Base version:** 1.0.1  
**Release target:** 1.0.2 (not bumped in this phase)  
**Scope:** Core agent run lifecycle, Todo List tool contract and validation, tool/run status events, bounded continuation, and focused tests.

## 1. What changed

### 1.1 Todo contract and validation

Added `src/main/editor/agentTodo.ts` with a pure `applyAgentTodoUpdate` validator.

The model can register `todo_read` and `todo_write` tools. Todo items have:

- Stable ID and title.
- Status: `pending`, `in_progress`, `completed`, or `blocked`.
- Priority and dependency list.
- Verification criteria.
- Blocked reason where applicable.
- Completion evidence and timestamps.

The validator checks array/item shape, task ID uniqueness and format, dependency existence, dependency cycles, single active task, retention of existing task IDs, blocked reasons, and legal status transitions. It prevents a task from becoming completed on its first appearance or while not previously in progress, requires specific completion evidence, and prevents starting a dependent task until its prerequisites were completed by a previous Todo update.

Todo state currently lives in an in-memory map keyed by conversation ID. When a subsequent user request starts after the prior plan is fully completed, it gets a fresh plan; unfinished/blocked tasks remain available for follow-up. Persistent sessions and durable Todo storage are deferred to the later session/memory phase.

### 1.2 Agent execution lifecycle

- Removed the fixed `MAX_AGENT_STEPS = 8` loop.
- Replaced it with a continuation loop that does not stop merely because a fixed number of model turns elapsed.
- Added explicit run outcomes: completed, blocked, cancelled, and failed.
- Added structured tool activity events with running/completed/failed statuses.
- Added guards so nontrivial coding tasks create a Todo List before project file tools or terminal commands execute.
- When a coding request returns text while its Todo List remains incomplete, the runtime gives corrective continuation prompts. If the model still does not progress, the run is reported as blocked, not completed.
- Identical tool failures are tracked by a hash of tool name, arguments, and failure output. After the configured repeated-failure threshold, the run becomes blocked rather than looping forever.
- Added bounded safety budgets for tool calls, runtime duration, repeated failures, and no-progress replies.

The run loop is no longer capped at eight steps. It is not literally unbounded: safety budgets remain necessary to avoid infinite loops, excessive tool execution, or runaway cost. When a budget is reached, unfinished work is explicitly reported as blocked and is not declared complete.

### 1.3 Configurable safety budgets

Defaults and optional environment overrides:

| Environment variable | Default | Allowed range |
|---|---:|---:|
| `RK_AGENT_MAX_TOOL_CALLS` | 100 | 1–1000 |
| `RK_AGENT_MAX_RUN_MINUTES` | 30 minutes | 1–180 |
| `RK_AGENT_MAX_REPEATED_FAILURES` | 3 repeats | 2–10 |
| `RK_AGENT_MAX_NO_PROGRESS_REPLIES` | 2 replies | 1–5 |

Invalid values fall back to defaults. These are safety budgets, not progress steps, and do not represent build-success criteria.

### 1.4 Renderer feedback

The AI chat now renders:

- A Todo List with task status, verification criteria, and completion evidence.
- Recent tool activity, including whether each invocation is running, completed, or failed.
- A run result banner with outcome, message, tool-call count, and elapsed seconds.

Terminal state events include completed/cancelled/blocked outcomes and are treated as terminal by the renderer and collaboration queue tracking.

### 1.5 Tests and CI

Added `scripts/test-agent-todo.mjs` and `npm run test:agent-todo`. CI invokes this test suite before TypeScript typecheck and application build.

The test suite covers valid sequential plans, duplicate IDs, missing dependencies, cycles, multiple active tasks, prerequisite enforcement, premature completion, missing completion evidence, completion progression, missing task IDs, blocked reasons, and completed-task immutability.

## 2. Explicitly not implemented in Phase 1

The following remain for later approved phases:

- Autonomous build/repair loop and long-running streaming terminal processes (Phase 2).
- Automatic project indexing and file discovery (Phase 3).
- Web search, official-doc/registry version verification, and live time/world data tools (Phase 4).
- Advanced provider/model capability management (Phase 5).
- Durable session history, cross-restart persistence, compaction, durable checkpoints, rewind, and redo (Phase 6).
- Skills installer, native plugin runtime, MCP management, attachment pipeline, and slash command picker (later phases).
- Product version bump, release notes for 1.0.2, and public release.

Terminal command approval remains in place. This phase does not claim build/test success for user projects; build automation belongs to Phase 2.

## 3. Validation status

GitHub Actions is the source of truth for the branch's automated results. Before merging, verify:

1. `npm ci` succeeds.
2. `npm run test:agent-todo` passes.
3. `npm run typecheck` passes.
4. `npm run build` passes.

No local packaged Windows GUI/end-to-end test is claimed by this document.
