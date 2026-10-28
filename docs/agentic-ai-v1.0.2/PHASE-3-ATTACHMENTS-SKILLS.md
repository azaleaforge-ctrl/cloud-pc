# Ruang Kerja v1.0.2 — Phase 3: AI Attachments and Skills

**Status:** Implemented on a feature branch; pending CI and user review  
**Base commit:** \`11dc5fe5ce27b545ae5ac85ddf4f7389b58fce5e\`  
**Application version:** \`1.0.1\` (not bumped in this phase)

## Scope

Adds a main-process attachment pipeline to built-in AI chat and replaces the editor's visible Extensions navigation with a Skills pane. This phase does not implement an external Skill marketplace or a full plugin/MCP runtime.

## Attachments

- Choose files with Electron's native file dialog. Renderer state holds opaque IDs, filenames, MIME types and sizes only, never absolute paths or raw image data.
- Images: PNG, JPG/JPEG, WebP and GIF. They are passed as OpenAI-compatible \`image_url\` data URLs; image understanding depends on the configured model/router accepting image input.
- Documents: PDF, DOCX, XLSX and PPTX. PDF extraction is best-effort for selectable text; Office OpenXML content is converted to text/cell values.
- Text/code files: common source, config, Markdown, log, JSON and tabular text formats.
- Limits: 10 files per message, 25 MiB per file, 12 MiB per image, 50 MiB per selection, about 100 MiB retained in memory, one-hour expiry and bounded extracted text.
- Paths are processed in Electron main and never written to the workspace. Attachments are sent only for the user turn that selected them.

## Limitations

- Scanned/image-only PDFs do not receive OCR. If no text can be extracted, the app says so rather than claiming the scan was read.
- Office extraction is text-oriented; layout, evaluated formulas, charts, notes, comments and embedded media are not preserved.
- PDF parsing is best-effort, not a complete PDF implementation.
- Image understanding is provider/model dependent; the app does not invent a visual description if the model/router rejects multimodal content.

## Skills navigation

- Adds a built-in \`Document & Attachment Analysis\` skill and a Skills pane listing all built-in skills connected to the agent.
- Replaces the editor activity-bar Extensions entry and command-palette action with Skills.
- Keeps the internal extension subsystem because editor theme contributions still use installed-extension metadata.
- Does not load or execute external skill code. Third-party installation/manual activation, plugins and MCP remain out of scope.

A public design reference is [magnus919/agent-skills — Documents](https://github.com/magnus919/agent-skills/blob/main/documents/SKILL.md). Ruang Kerja uses a local TypeScript extraction path rather than importing executable external code.

## Validation

- \`npm run test:agent-attachments\`: text extraction, a basic PDF stream, DOCX extraction, image payload isolation and unsupported-type rejection.
- \`npm run test:agent-runtime\`: Todo, terminal runtime and attachment tests.
- CI also runs TypeScript typecheck and application build.

Passing CI does not replace a packaged-Windows UI test with the configured model/router.

## Not included

OCR, faithful Office layout, third-party Skill installation, manual activation, plugin/MCP runtime, persisted chat history and rewind, semantic indexing, live web/version intelligence, version bump or public release.
