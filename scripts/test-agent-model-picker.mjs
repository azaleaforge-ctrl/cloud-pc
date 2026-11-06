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
assert.ok(chat.includes("['free', 'Gratis', modelCostCounts.free]") &&
  chat.includes("['premium', 'Premium', modelCostCounts.premium]") &&
  chat.includes("['unknown', 'Harga belum diketahui', modelCostCounts.unknown]"),
  'price filters must distinguish free, premium and missing price metadata');
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
assert.ok(main.includes("process.env.RK_ROUTER_ENDPOINT ?? 'http://localhost:20128/v1'") &&
  main.includes("process.env.RK_ROUTER_FALLBACK ?? 'https://bxludp.tailf34d89.ts.net/v1'"),
  '9router must prefer the local endpoint and use the requested Tailscale endpoint as fallback');
assert.ok(runtime.includes("const DEFAULT_ENDPOINT = 'http://localhost:20128/v1';") &&
  runtime.includes("const DEFAULT_FALLBACK_ENDPOINT = 'https://bxludp.tailf34d89.ts.net/v1';"),
  'runtime defaults must match the local-first endpoint order');
assert.ok(runtime.includes('if (response.ok) return response;') &&
  runtime.includes('A non-2xx response (including HTTP 503) falls through to the next endpoint.'),
  'HTTP 503 and other non-2xx responses must proceed to the fallback endpoint');
assert.ok(runtime.includes('AbortSignal.timeout(endpoint === endpoints[0] && endpoints.length > 1 ? 15_000 : 120_000)'),
  'an unreachable local endpoint must fail over without waiting for the full remote request timeout');
assert.ok(!chat.includes('className="ai-agent-switcher"') && !chat.includes('Poolside Coding Agent'),
  'the Poolside agent switcher and branding must no longer appear in the editor chat UI');

assert.ok(!editorShell.includes('<span className="ed-ai-tab-title">AI Coding Agent</span>'),
  'the redundant AI Coding Agent label above the model selector must be removed');
assert.ok(editorShell.includes('className="ed-ai-tab-icon"') && editorShell.includes('className="ed-ai-tab-close"'),
  'the compact AI tab icon and close action must remain available');

assert.ok(parser.includes('architecture.input_modalities') && parser.includes('pricing.prompt') &&
  parser.includes('supported_parameters') && parser.includes("'unknown'"),
  'the model metadata parser must preserve source capability fields and an unknown-price state');

console.log('Agent model-picker tests: all assertions passed.');
