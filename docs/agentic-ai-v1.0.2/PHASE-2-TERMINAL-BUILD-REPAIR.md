# Ruang Kerja v1.0.2 — Phase 2: Terminal Runtime and Build Verification

**Status:** Implemented on a feature branch; awaiting CI validation and user review  
**Base commit:** `4538ad85ff55877c8340e933d76d5cc49c95f903`  
**Base application version:** `1.0.1`  
**Release target:** `1.0.2` (not bumped in this phase)

## 1. Scope

Phase 2 focuses on reliable foreground command execution and evidence-based build/test verification. It does not add the later project index, live web/version intelligence, durable sessions, attachments, Skill installer, Plugin/MCP runtime, or slash-command picker.

## 2. Terminal runtime

Added `src/main/editor/terminalRuntime.ts`, a Node.js process runner independent of Electron UI.

It provides:

- Streaming stdout and stderr events as a command runs.
- Actual process close/exit-code reporting.
- Command duration and explicit terminal lifecycle states.
- Configurable timeout, bounded retained output, and chunked output events.
- Cancellation and best-effort process-tree termination; Windows uses `taskkill /T /F`, while POSIX platforms terminate the detached process group.
- A result object that distinguishes `completed`, `failed`, `timed_out`, and `cancelled`.

The agent still executes commands from the active workspace root. The existing user approval prompt remains in place before a command starts. The default foreground-command timeout is now 600 seconds, configurable via `RK_AGENT_DEFAULT_COMMAND_TIMEOUT_SECONDS` (10–3600 seconds). The model may request `timeout_seconds` within the same range for a particular command. Command timeout is capped by the remaining overall agent-run budget.

This runner is for finite foreground tasks such as dependency installation, build, lint, typecheck, and tests. Persistent development servers should continue to use Ruang Kerja's existing development-server subsystem; starting one as a foreground agent command would eventually reach its configured timeout.

## 3. Cancellation and process lifecycle

The active LLM run stores a cancel callback for its current terminal command.

When the user stops the agent or the application disposes the run:

- The command process tree is asked to stop.
- The LLM request is aborted.
- The agent emits the existing explicit cancelled run outcome.
- The renderer and collaboration queue receive terminal state changes so a stopped agent does not leave a room marked busy.

Timeout and cancellation are separately represented; neither is reported as a successful command.

## 4. Agentic terminal feedback

The shared event contract now includes terminal-process lifecycle events and streamed terminal-output events.

The Agentic Coding chat shows:

- The command text and current status.
- Streaming command output while the process runs.
- The actual exit code when the command ends.
- Duration and timeout/failure/cancellation details.

The visible tool-activity list also distinguishes tool failures from successful completion. A nonzero exit code is treated as a failed tool result and is returned to the model for diagnosis and correction.

## 5. Autonomous build/test verification

The agent instructions now require it to inspect the project's scripts/configuration and choose an available project-appropriate verification command after source code or build configuration changes.

The runtime records successful terminal checks only when a recognized check/build/test/lint/typecheck command exits with code 0. A successful dependency installation alone does not count as build verification.

After a source-code/configuration write, if no recognized verification command has succeeded after the latest code change, the agent is instructed to continue the run and perform a relevant check. If the check fails, its output/exit code is returned so the model can repair the code and rerun the check. If the agent stops responding with unfinished work, the run is reported as blocked rather than successful.

Todo items whose title or verification criteria explicitly require build/test/lint/typecheck/checking also cannot transition to completed without a successful terminal verification recorded after that task started.

This is a runtime enforcement layer, not a mathematical guarantee that all code is correct. Verification-command detection relies on command names and project context; unsupported custom check commands may require adding a matching detector in a future refinement.

## 6. Tests and CI

Added `scripts/test-agent-terminal.mjs` with tests for:

1. stdout/stderr capture and streamed output events.
2. Nonzero exit-code reporting.
3. Timeout and process termination.
4. Explicit cancellation.
5. Bounded retained command output.

Added `npm run test:agent-terminal` and `npm run test:agent-runtime`. CI now runs the combined Todo Orchestrator and terminal-runtime tests, followed by TypeScript typecheck and application build.

Required CI checks:

- `npm ci`
- `npm run test:agent-runtime`
- `npm run typecheck`
- `npm run build`

A green CI run checks the test runner, TypeScript, and application bundling. It does not replace a manual packaged-Windows test of the full AI workflow and approval dialog.

## 7. Safety boundaries retained

- Commands still require explicit user approval.
- Commands execute in the active workspace root.
- Shell output retention remains bounded, while output is streamed in chunks.
- Long-lived development servers are not silently detached by this phase.
- Timeouts, cancellations, and nonzero exits are never presented as a successful build.
- Application version remains `1.0.1`; there is no public release or `1.0.2` version bump in Phase 2.

## 8. Not included

- Trusted-workspace auto-approval policy UI.
- Background terminal process manager for persistent servers.
- A complete automatic dependency/framework detector.
- A persistent session database or checkpoint/rewind.
- Live web search and framework-release verification.
- Skill, plugin, and MCP installers/runtimes.
- Attachment/document reading pipeline.
- v1.0.2 release packaging.

These remain in their later approved phases or separate planned scope.

## 9. Phase 2 exit checklist

- [x] Dedicated foreground terminal runtime with stream output and exit status.
- [x] Configurable timeout and cancellation hook.
- [x] Typed terminal lifecycle/output events.
- [x] Terminal panel in Agentic Coding chat.
- [x] Build/test verification is recorded from command exit code, not model claims.
- [x] Terminal runtime tests added to CI.
- [ ] GitHub Actions checks pass.
- [ ] User reviews and approves this phase before Phase 3 starts.
