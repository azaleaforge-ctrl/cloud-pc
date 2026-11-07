import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chat = await readFile(join(root, 'src/renderer/components/editor/AgentChat.tsx'), 'utf8');
const css = await readFile(join(root, 'src/renderer/components/editor/agent-progress.css'), 'utf8');
const shared = await readFile(join(root, 'src/shared/agents.ts'), 'utf8');
const parser = await readFile(join(root, 'src/main/editor/modelCapabilities.ts'), 'utf8');
const editorShell = await readFile(join(root, 'src/renderer/components/editor/EditorShell.tsx'), 'utf8');
const runtime = await readFile(join(root, 'src/main/editor/agent.ts'), 'utf8');
const main = await readFile(join(root, 'src/main/index.ts'), 'utf8');

assert.ok(chat.includes("if (command === '/model') {") && chat.includes('openModelPicker();'),
  '/model must open the separate model picker');
assert.ok(chat.includes('className="ai-model-dialog" role="dialog" aria-modal="true"'),
  'the model picker must be an accessible modal dialog');
assert.ok(chat.includes('aria-label="Pilih model AI"'), 'the modal must have a clear accessible name');
assert.ok(chat.includes("event.key === 'Escape'") && chat.includes('setModelPickerOpen(false)'),
  'Escape must close the model picker');
assert.ok(chat.includes('event.target === event.currentTarget') && chat.includes('setModelPickerOpen(false)'),
  'clicking the overlay backdrop must close the picker');
assert.ok(chat.includes('aria-label="Tutup pemilih model"'), 'the dialog must have a visible close control');
assert.ok(chat.includes('Model aktif ·') || chat.includes('MODEL AKTIF ·'),
  'the active provider/model should be highlighted at the top');
assert.ok(chat.includes('routerStatus?.model ??') && chat.includes('routerStatus?.providerName ??'),
  'the active provider and selected model must be bound to actual runtime config');

assert.ok(chat.includes('id="rk-model-search"') && chat.includes('value={modelSearchQuery}') && chat.includes('setModelSearchQuery(event.target.value)'),
  'search must be a controlled input that updates the displayed model list');
assert.ok(chat.includes('modelCatalogOptions = useMemo') && chat.includes('modelSearchQuery.trim().toLowerCase()'),
  'search must filter catalogue entries instead of only changing the query text');
assert.ok(chat.includes("['free', 'Gratis / Free Tier', modelCostCounts.free]") &&
  chat.includes("['premium', 'Premium', modelCostCounts.premium]") &&
  chat.includes("['unknown', 'Harga belum diketahui', modelCostCounts.unknown]"),
  'price filters must distinguish free, premium and missing price metadata');
assert.ok(chat.includes("modelCostFilter === 'free' ? model.costTier === 'free' || model.freePlanEligible === true") &&
  chat.includes('model.freePlanEligible') && chat.includes("model.costTier === 'premium'"),
  'Free filter must include documented Groq Free Plan models without changing unknown price metadata');
assert.ok(chat.includes("model.costTier === 'free'") && chat.includes("model.costTier === 'premium'") &&
  chat.includes("'Harga belum diketahui'"),
  'missing pricing data must not be silently advertised as free or premium');
assert.ok(chat.includes('model.inputModalities') && chat.includes('model.outputModalities') &&
  chat.includes('model.supportedParameters') && chat.includes('model.supportedGenerationMethods'),
  'modality and tool indicators must be built from model catalogue metadata');
assert.ok(chat.includes('Modalitas dan dukungan tools belum tercantum di metadata'),
  'the picker must disclose incomplete capability metadata instead of guessing');
assert.ok(chat.includes('model.contextLength') && chat.includes('model.promptPrice') && chat.includes('model.completionPrice'),
  'context length and prices should render only when catalogue metadata provides them');
assert.ok(chat.includes('onClick={() => void saveSelectedModel()}') &&
  chat.includes('window.rk.agentSelectModel(selectedModelDraft.trim())'),
  'apply must persist the selected ID to the runtime, not just update the modal');

assert.ok(shared.includes("'groq'") && main.includes("groq: 'https://api.groq.com/openai/v1'"),
  'Groq must be registered as a separate provider with its official API endpoint');
assert.ok(main.includes("case 'groq': return (process.env.GROQ_API_KEY ?? '').trim();") &&
  main.includes("'agent-' + provider + '-api-key.enc'"),
  'Groq credentials must use their own encrypted per-provider storage and environment variable');
assert.ok(main.includes("groq: 'qwen/qwen3.8-27b'") &&
  main.includes("['openrouter', 'gemini', 'groq', 'legacy']"),
  'Groq must be selectable and default to a documented Free Plan coding model');
assert.ok(chat.includes('<option value="groq">Groq Free Tier') &&
  chat.includes('Groq Free Tier') && chat.includes('model.freePlanEligible'),
  'the UI must identify Groq Free Plan models and explain their quota restrictions');
assert.ok(parser.includes('GROQ_FREE_PLAN_MODEL_IDS') &&
  parser.includes("'openai/gpt-oss-120b'") &&
  parser.includes("'openai/gpt-oss-20b'") &&
  parser.includes("'qwen/qwen3.8-27b'"),
  'only model IDs from the documented Groq Free Plan model list should be exposed');
assert.ok(!parser.includes("provider === 'groq' ? 'free'"),
  'Free Plan eligibility must not be misrepresented as zero per-token price metadata');

assert.ok(chat.includes('className="ai-settings-model-shortcut"') && chat.includes('onClick={openModelPicker}'),
  'the model picker must also be reachable from connection settings');
assert.ok(!chat.includes('className="ai-model-manager" ref={modelManagerRef}'),
  'the old inline model manager must be replaced, not duplicated alongside the modal');
assert.ok(css.includes('.ai-model-overlay {') && css.includes('.ai-model-dialog {'),
  'the picker must use a centered overlay and dedicated dialog surface');
assert.ok(css.includes('.ai-model-options {') && css.includes('overflow-y: auto;') &&
  css.includes('overscroll-behavior: contain;'),
  'the model list must have bounded independent scrolling');
assert.ok(shared.includes("export type AgentModelCostTier = 'free' | 'premium' | 'unknown'"),
  'the model cost classification must represent unknown metadata explicitly');
assert.ok(parser.includes('groq/openai/gpt-oss-120b(high)') && parser.includes('cf/@cf/qwen/qwen2.5-coder-32b-instruct(high)') && parser.includes('cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
  'the three requested 9router models must be pinned in the model catalogue');
assert.ok(parser.includes('ps/poolside/laguna-s-2.1(high)') && parser.includes('REMOVED_LEGACY_MODEL_IDS'),
  'the retired Poolside/Laguna model must be filtered from the 9router catalogue');
assert.ok(runtime.includes(`const DEFAULT_MODEL = 'groq/openai/gpt-oss-120b(high)';`),
  'the agent runtime fallback must use the new 9router model');
assert.ok(main.includes(`const LEGACY_ROUTER_MODEL = 'groq/openai/gpt-oss-120b(high)';`) &&
  main.includes('RETIRED_LEGACY_ROUTER_MODEL'),
  'saved installations must migrate away from the retired model and use the new fallback');
assert.ok(main.includes("const LEGACY_ROUTER_ENDPOINT = 'http://localhost:20128/v1';") &&
  !main.includes('LEGACY_ROUTER_FALLBACK_ENDPOINT') &&
  !main.includes('tailf34d89.ts.net'),
  '9Router must use localhost only; Tailscale and other remote fallbacks must be removed');
assert.ok(runtime.includes("const DEFAULT_ENDPOINT = 'http://localhost:20128/v1';") &&
  !runtime.includes('DEFAULT_FALLBACK_ENDPOINT') &&
  !runtime.includes('tailf34d89.ts.net'),
  'agent runtime must have exactly one local 9Router endpoint');
assert.ok(runtime.includes('const requestMessages = normalizeOpenAiToolCallMessages(messages);') &&
  runtime.includes('messages: requestMessages'),
  'strict OpenAI-compatible tool-call messages must be normalized before sending');
assert.ok(runtime.includes('Local-only mode intentionally does not retry against a remote service.'),
  'a failed local request must not silently leave the local machine');
assert.ok(!chat.includes('className="ai-agent-switcher"') && !chat.includes('Poolside Coding Agent'),
  'the Poolside agent switcher and branding must no longer appear in the editor chat UI');

assert.ok(!editorShell.includes('<span className="ed-ai-tab-title">AI Coding Agent</span>'),
  'the redundant AI Coding Agent label above the model selector must be removed');
assert.ok(editorShell.includes('className="ed-ai-tab-icon"') && editorShell.includes('className="ed-ai-tab-close"'),
  'the compact AI tab icon and close action must remain available');

assert.ok(parser.includes('const endpoints = [config.endpoint];'), 'model catalogue and diagnostics must also stay local-only');
assert.ok(parser.includes('architecture.input_modalities') && parser.includes('pricing.prompt') &&
  parser.includes('supported_parameters') && parser.includes("'unknown'"),
  'the model metadata parser must preserve source capability fields and an unknown-price state');

console.log('Agent model-picker tests: all assertions passed.');
