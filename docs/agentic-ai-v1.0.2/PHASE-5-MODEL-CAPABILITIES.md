# Ruang Kerja v1.0.2 — Phase 5: Model Selection and Capability Diagnostics

**Status:** Implemented on a feature branch; awaiting CI and user review  
**Base commit:** \`c31f41c2ad31dc74d075a736dd4c2eb9ccbae936\` (Phase 4 merge)  
**Application version:** \`1.0.1\` (no version bump or release)

## Goal

Replace the fixed-model-only workflow with controlled OpenAI-compatible model discovery and explicit capability tests. This stage focuses on the managed 9router primary/fallback endpoints; it does not add arbitrary endpoint editing or another credential provider.

## Included

### Model catalog
- Adds \`agentListModels\` using each configured endpoint's \`/models\` API.
- Accepts standard OpenAI-compatible \`data\` or \`models\` arrays, drops invalid IDs, deduplicates entries, sorts them, and caps the displayed catalog at 500 models.
- Tries the secondary endpoint if the primary catalog fails.
- The UI has a model ID field for provider-specific IDs plus a list loaded from the provider. Discovery is explicit and reports its endpoint and retrieval time.

### Selection and persistence
- Adds \`agentSelectModel\` and persists a validated, non-secret model ID in the application's user-data directory.
- The model selector affects new LLM chat-completion requests and the connection test; it is no longer only a label in settings.
- The API key continues to be stored through Electron safeStorage and is never placed in the catalog or diagnostic result.
- Invalid model IDs are rejected. Only the application-managed primary/fallback endpoints are used.

### Capability report
\`agentDiagnoseModel\` checks:

1. **Chat completion:** a simple prompt must return a recognizable completion response.
2. **Function tool-calling:** the response must contain the requested diagnostic function call.
3. **Image input:** the endpoint must accept a small diagnostic image payload and return a valid completion response.

Each check records supported, unsupported, or unknown status and its duration. An accepted image request confirms API format acceptance, not visual accuracy. Unsupported vs unknown depends on what the provider returns; capability behavior can vary by model version, endpoint, account, and router.

### UX
- Model ID input, discovered-model dropdown, save action, capability-diagnostic action, retrieval timestamp, and per-capability report are added to the existing AI settings panel.
- A changed model must be saved before running diagnostics to avoid checking a stale selection.
- Errors are shown with bounded messages; the UI does not expose the API key.

## Reliability and safety
- Uses bounded response-body reads and per-request timeouts.
- Does not allow the renderer to configure arbitrary hosts or send API keys to model URLs supplied by a model.
- The catalog and capabilities are point-in-time observations, not a permanent guarantee. A failed model list does not prevent a validated custom model ID from being entered and tested.
- Existing terminal approval, workspace path protections, and live-research safety boundaries are unchanged.

## Tests and CI
\`npm run test:agent-model-capabilities\` covers model ID validation, OpenAI-compatible catalog parsing, primary/fallback discovery, successful chat/tool/vision probes, provider-rejected capabilities, ambiguous results, and missing credentials with mocked responses.

\`npm run test:agent-runtime\` includes the new suite with the previous Todo, terminal, attachment, and research tests. CI then runs TypeScript typecheck and application build.

A passing unit/CI run does not guarantee every remote provider behaves consistently or replace a packaged Windows UI test against the user's live 9router account.

## Not included
Arbitrary provider endpoints, multiple credential profiles, vendor-specific API adapters, performance benchmarking, cost estimation, prompt/context-window metadata guarantees, automatic fallback model switching, local-model discovery, model marketplace, plugin/MCP runtime, persistent session history/rewind, app version bump, or public release.
