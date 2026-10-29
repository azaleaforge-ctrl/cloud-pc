import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chat = await readFile(join(root, 'src/renderer/components/editor/AgentChat.tsx'), 'utf8');
const css = await readFile(join(root, 'src/renderer/components/editor/agent-progress.css'), 'utf8');
const shared = await readFile(join(root, 'src/shared/agents.ts'), 'utf8');
const parser = await readFile(join(root, 'src/main/editor/modelCapabilities.ts'), 'utf8');

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
assert.ok(parser.includes('architecture.input_modalities') && parser.includes('pricing.prompt') &&
  parser.includes('supported_parameters') && parser.includes("'unknown'"),
  'the model metadata parser must preserve source capability fields and an unknown-price state');

console.log('Agent model-picker tests: all assertions passed.');
