# Ruang Kerja v1.0.2 — Phase 6: Persistent Sessions, Compaction, Checkpoints, Rewind & Redo

**Status:** Implementation submitted for review; CI pending  
**Base commit:** \`e26338f461a2cb4974cd0adc65a500eaec3632f1\` (Phase 5 merge)  
**Application version:** \`1.0.1\` (no version bump or public release)

## Goal

Complete the planned agent-runtime phases by making conversation history durable across app restarts, retaining isolated per-session memory, compacting old conversation context, and making agent-authored file changes recoverable without overwriting unrelated manual edits.

## Session history

- Adds a main-process session store in \`src/main/editor/agentSessionStore.ts\`. Session JSON records live under the application's user-data directory in \`ai-sessions\`, outside project folders and outside the shared workspace.
- Persists conversation ID/title, timestamps, associated workspace path, active agent ID, chat transcript, compact context summary/cursor, Todo state, and checkpoint metadata.
- Startup loads the most recently updated session. The History panel lists other saved sessions, lets the user reopen them, and requires confirmation before deleting one.
- “Chat Baru” starts a new isolated session. It no longer erases every file in the shared \`ai-memory/sessions\` directory. Deleting a session removes only that session's record and matching memory file.
- The renderer communicates with the store using narrow, typed IPC methods in \`window.rk\`. It does not gain Node.js or filesystem access.
- Messages and session metadata are stored locally, not sent to a Ruang Kerja collaboration peer or synchronized through the workspace. Transcript data is stored as local app JSON; the API key remains separate in Electron \`safeStorage\`.

## Context compaction and resume

- The app retains the visible transcript and adds a deterministic compact summary of older user/assistant messages to the agent's system context when the history exceeds the configured count/size threshold.
- Recent messages remain available separately, so compaction reduces model context without deleting the displayed transcript.
- Autosaves are serialized per session and the summary cursor never moves backward if multiple saves finish out of order.
- Limits: 1,000 messages per session; 80,000 characters per message; 20 MB serialized session record. Reaching a limit returns a visible save error instead of silently truncating the entire transcript.
- Attachments are persisted as metadata only. The attachment payload registry remains process-local, so files/images that were attached before a restart may need to be reattached before they can be analyzed again.

## Durable file checkpoints

- Each agent runtime run groups file changes written through the \`write_project_file\` tool into one checkpoint. Each file checkpoint stores pre-change existence/content and post-change content plus SHA-256 hashes.
- Checkpoints survive app restarts and are linked to the saved conversation. The Checkpoints panel shows the affected relative paths and whether each group is applied or rewound.
- Rewind verifies the active workspace root and the current hash/existence of every target before writing any file. If a user or another process changed a target after the checkpoint, the entire operation is rejected before it starts overwriting files.
- Redo has the symmetric guard: the file must still match its original pre-change state, including non-existence for files the agent created.
- Rewind/redo uses staged writes, rejects absolute/traversal paths, symbolic links, private-key/credential-like paths, and non-regular files, and requires the user's turn to be active in a collaboration room.
- Bounds: up to 50 checkpoints per session; up to 50 files and 8 MB of pre/post content in a checkpoint; individual file content up to 1 MB; overall session record up to 20 MB.
- Only writes routed through \`write_project_file\` are checkpointed in this phase. Terminal commands, external IDE edits, collaboration-peer changes, and manual file edits are not automatically captured by these agent checkpoints. If external edits cause a hash conflict, rewind/redo refuses to proceed.

## Tests

The new \`npm run test:agent-sessions\` suite covers:
- Durable save/load and session ordering/title metadata.
- Summary compaction while retaining the displayed transcript.
- File rewind and redo.
- Deletion of files created by the agent.
- Conflict detection when a target is manually modified.
- Workspace/path boundary checks.
- Deleting one session without deleting another session's memory.

\`npm run test:agent-runtime\` now includes session/checkpoint tests together with Todo, terminal, attachment, web research, and model capability tests. CI continues with TypeScript typecheck and app build.

A green CI run validates automated unit/build paths, not a packaged Windows manual test against the user's actual project folders. The manual acceptance check should include app restart/history restore, a tool-authored file rewind/redo, and an intentional conflict after manual file editing.

## Scope boundaries

This phase does not add cloud-synced chat history, transcript export/import, persistent attachment binary payloads, version-control-style Git integration, terminal-command rewind, a general filesystem snapshot, arbitrary provider endpoints, new credentials, or an automatic public release. The app remains on version 1.0.1 until the combined v1.0.2 release is separately approved.

## Roadmap completion

The v1.0.2 implementation plan defines Phase 1 through Phase 6 as its six feature phases after the Phase 0 architecture audit. Phase 6 is the final planned feature phase in that document. This does not mean the app is released: review/merge, packaged Windows regression tests, and an explicitly approved release/version bump remain separate work.
