import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'rk-stage7-integration-'));
const require = createRequire(import.meta.url);
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error instanceof Error ? error.message : String(error))); }
}

try {
  const securityBundle = join(temp, 'providerSecurity.cjs');
  await build({
    entryPoints: [join(root, 'src/main/editor/providerSecurity.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: securityBundle, logLevel: 'silent',
  });
  const security = require(securityBundle);

  test('rejects missing encryption and Linux basic_text/unknown storage backends', () => {
    assert.equal(security.canPersistProviderKeySafely('win32', false), false);
    assert.equal(security.canPersistProviderKeySafely('linux', true, 'basic_text'), false);
    assert.equal(security.canPersistProviderKeySafely('linux', true, 'unknown'), false);
    assert.equal(security.canPersistProviderKeySafely('linux', true, undefined), false);
    assert.equal(security.canPersistProviderKeySafely('linux', true, 'gnome_libsecret'), true);
    assert.equal(security.canPersistProviderKeySafely('linux', true, 'kwallet6'), true);
    assert.equal(security.canPersistProviderKeySafely('win32', true), true);
    assert.equal(security.canPersistProviderKeySafely('darwin', true), true);
    assert.equal(security.canPersistProviderKeySafely('freebsd', true), false);
  });

  test('redacts exact API keys and common provider key patterns from diagnostics', () => {
    const secret = 'rk-private-test-secret-90210';
    const text = security.redactSecretValues('request failed with ' + secret + ' and sk-or-v1-12345678901234567890', [secret]);
    assert.doesNotMatch(text, /rk-private-test-secret-90210|sk-or-v1-12345678901234567890/);
    assert.match(text, /\[REDACTED\]/);
  });

  test('normalizes authentication, quota, timeout and server errors without exposing response bodies', () => {
    assert.match(security.providerHttpErrorMessage(401, 'invalid key body', 'top-secret'), /API key tidak valid/);
    assert.match(security.providerHttpErrorMessage(403, 'denied', 'top-secret'), /akses provider ditolak/);
    assert.match(security.providerHttpErrorMessage(429, 'quota body containing top-secret', 'top-secret'), /kuota provider tercapai/);
    assert.match(security.providerHttpErrorMessage(504, 'timeout details', 'top-secret'), /kehabisan waktu/);
    assert.match(security.providerHttpErrorMessage(503, 'raw upstream stack', 'top-secret'), /gangguan sementara/);
    const generic = security.providerHttpErrorMessage(400, 'bad input: top-secret', 'top-secret');
    assert.doesNotMatch(generic, /top-secret/);
  });

  const [main, agent, providers, capabilities, attachment, sessions, sessionTests, chat, css, editorCss, providerTests, pkg] = await Promise.all([
    readFile(join(root, 'src/main/index.ts'), 'utf8'),
    readFile(join(root, 'src/main/editor/agent.ts'), 'utf8'),
    readFile(join(root, 'src/main/editor/agentProviders.ts'), 'utf8'),
    readFile(join(root, 'src/main/editor/modelCapabilities.ts'), 'utf8'),
    readFile(join(root, 'src/main/editor/agentAttachments.ts'), 'utf8'),
    readFile(join(root, 'src/main/editor/agentSessionStore.ts'), 'utf8'),
    readFile(join(root, 'scripts/test-agent-sessions.mjs'), 'utf8'),
    readFile(join(root, 'src/renderer/components/editor/AgentChat.tsx'), 'utf8'),
    readFile(join(root, 'src/renderer/components/editor/agent-progress.css'), 'utf8'),
    readFile(join(root, 'src/renderer/components/editor/editor.css'), 'utf8'),
    readFile(join(root, 'scripts/test-agent-providers.mjs'), 'utf8'),
    readFile(join(root, 'package.json'), 'utf8'),
  ]);

  test('provider/model selection is resolved per provider and runtime requests use the selected model', () => {
    assert.match(main, /models:\s*\[getSelectedAgentModel\(provider\)\]/);
    assert.match(main, /saveSelectedAgentModel\(model\)/);
    assert.match(main, /function getRouterConfig\(\): RouterConfig \| null/);
    assert.match(agent, /model:\s*config\.models\[0\] \|\| session\.agent\.model \|\| DEFAULT_MODEL/);
    assert.match(providers, /const model = config\.models\[0\] \|\| 'gemini-3\.8-flash'/);
    assert.match(chat, /window\.rk\.agentSelectModel\(selectedModelDraft\.trim\(\)\)/);
    assert.match(chat, /window\.rk\.agentStartChat\(activeAgent\.id/);
  });

  test('API key status is metadata-only, the renderer masks key input, and storage rejects unsafe backend', () => {
    const statusStart = main.indexOf('function getAgentRouterStatus()');
    const keySaveStart = main.indexOf('function saveAgentRouterKey(');
    assert.ok(statusStart >= 0 && keySaveStart > statusStart);
    assert.doesNotMatch(main.slice(statusStart, keySaveStart), /apiKey\s*[:,]/);
    assert.match(main, /canPersistProviderKeySafely\(/);
    assert.match(main, /chmodSync\([^\n]*0o600/);
    assert.match(chat, /id="rk-router-key"[\s\S]{0,180}type="password"/);
    assert.doesNotMatch(chat, /console\.(?:log|warn|error)\([^\n]*apiKey/i);
  });

  test('image attachments flow from main-process opaque references into real provider chat payloads', () => {
    assert.match(attachment, /dataUrl: 'data:' \+ mime \+ ';base64,'/);
    assert.match(attachment, /return parsed\.map\(\(\{ id, name, mimeType, size \}\)/);
    assert.match(agent, /resolveAgentAttachments\(message\.attachments \?\? \[\]\)/);
    assert.match(agent, /type: 'image_url', image_url: \{ url: item\.dataUrl \}/);
    assert.match(agent, /body: JSON\.stringify\(\{[\s\S]*?messages,[\s\S]*?stream: true/);
    assert.match(providers, /return \{ inlineData: \{ mimeType, data \} \}/);
    assert.match(providers, /'x-goog-api-key': config\.apiKey/);
    assert.match(providerTests, /converts embedded image data URLs to Gemini inlineData/);
    assert.match(providerTests, /sensitive-test-key/);
  });

  test('audio/video and scanned PDF use a bounded native Gemini media path', () => {
    assert.match(attachment, /'\.mp3':'audio\/mpeg'/);
    assert.match(attachment, /'\.mp4':'video\/mp4'/);
    assert.match(attachment, /DIRECT_MEDIA_BATCH_MAX/);
    assert.match(attachment, /PDF asli akan dikirim ke model multimodal/);
    assert.match(main, /'mp3','wav','m4a','aac','flac','ogg','mp4','mov','avi','webm'/);
    assert.match(agent, /type: 'media_url'/);
    assert.match(agent, /mediaGuidance\.push\('Untuk audio/);
    assert.match(agent, /mediaGuidance\.push\('Untuk video/);
    assert.match(agent, /mediaGuidance\.push\('Untuk PDF hasil scan/);
    assert.match(agent, /directMedia\.length && config\.provider !== 'gemini'/);
    assert.match(providers, /item\.type === 'media_url'/);
    assert.match(providerTests, /routes audio, video and scanned PDF data URLs through Gemini native inlineData/);
  });

  test('per-message Refork/Copy/Rewind actions are linked to persisted run IDs and Ctrl+R cannot reload the app', () => {
    assert.match(chat, /className="ai-message-actions"/);
    assert.match(chat, /Salin prompt/);
    assert.match(chat, /Revert \/ Refork/);
    assert.match(chat, /const reforkFromMessage = useCallback/);
    assert.match(chat, /setConversationId\(branchId\)/);
    assert.match(chat, /const rewindFromMessage = useCallback/);
    assert.match(chat, /event\.stopImmediatePropagation\(\)/);
    assert.match(chat, /runId: result\.sessionId/);
    assert.match(chat, /findCheckpointForMessage\(item\.message, messages, checkpoints\)/);
    assert.match(sessions, /message\.runId/);
    assert.match(sessionTests, /loaded\.messages\[0\]\.runId/);
    assert.match(editorCss, /\.ai-message-actions-menu/);
  });

  test('provider failures and diagnostic responses are redacted and quota/timeouts have clear messages', () => {
    assert.match(agent, /providerHttpErrorMessage\(response\.status, body, config\.apiKey\)/);
    assert.match(providers, /providerHttpErrorMessage\(response\.status, detail, config\.apiKey\)/);
    assert.match(providers, /redactSecretValues\(message, \[config\.apiKey\]\)/);
    assert.match(capabilities, /providerHttpErrorMessage\(response\.status, detail, config\.apiKey\)/);
    assert.match(capabilities, /redactSecretValues\(\(error as Error\)\.message/);
  });

  test('legacy session/checkpoint schema remains readable and conflict-safe regressions are in the suite', () => {
    assert.match(sessions, /const SCHEMA_VERSION = 1/);
    assert.match(sessions, /record\.schemaVersion !== SCHEMA_VERSION/);
    assert.match(sessionTests, /assert\.equal\(loaded\.schemaVersion,1\)/);
    assert.match(sessionTests, /refuses rewind if the target was manually modified after checkpoint/);
    assert.match(sessionTests, /refuses checkpoint paths outside the workspace and workspace mismatch/);
  });

  test('model and sessions modals keep independent scrolling and fit small viewports', () => {
    assert.match(css, /\.ai-model-dialog\s*\{[\s\S]*?max-height:[^;]+;[\s\S]*?overflow:\s*hidden/);
    assert.match(css, /\.ai-model-options\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain/);
    assert.match(css, /\.ai-sessions-modal-list\s*\{[\s\S]*?max-height:[^;]+;[\s\S]*?overflow-y:\s*auto/);
    assert.match(css, /min-height:\s*min\(300px, calc\(100vh - 48px\)\)/);
  });

  test('integration regression suite is included in the runtime gate', () => {
    const scripts = JSON.parse(pkg).scripts;
    assert.equal(scripts['test:stage7-integration'], 'node scripts/test-stage7-integration.mjs');
    assert.match(scripts['test:agent-runtime'], /npm run test:stage7-integration/);
  });

  console.log('\nStage 7 integration tests: ' + passed + ' passed, ' + failed + ' failed.');
  if (failed) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
