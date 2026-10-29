import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, safeStorage, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import type {
  ActionResult,
  AppState,
  CreateRoomInput,
  DiscoveredRoom,
  FrameworkInfo,
  IdeInfo,
  JoinRoomInput,
  NotifyPayload,
  ProjectFile,
  ReleaseInfo,
  ServerState,
  UpdateState,
} from '../shared/types';
import type { AgentCheckpointActionResult, AgentEvent, AgentProviderId, AgentRouterStatus, AgentRouterTestResult, AgentSessionData, AgentSessionSaveInput, ChatMessage } from '../shared/agents';
import { diagnoseModelCapabilities, listAvailableModels, normalizeModelId, testProviderConnection } from './editor/modelCapabilities';
import { APP_VERSION } from '../shared/types';
import { StateStore } from './store';
import { detectFramework } from './frameworkDetect';
import { detectIdes } from './ideDetect';
import { findRoom, getLanIp, startAdvertise, stopAdvertise } from './discovery';
import { createHostRoom, type HostRoom } from './hostRoom';
import { joinAsMember, type MemberRoom } from './memberRoom';
import { startDevServer, type DevServerHandle } from './devServer';
import { createWorkspaceService } from './editor/workspace';
import { createTerminalService } from './editor/terminal';
import { createExtensionService } from './editor/extensions';
import { createDebugService } from './editor/debugger';
import { createAgentService } from './editor/agent';
import {
  deleteAgentSession,
  listAgentCheckpoints,
  listAgentSessions,
  loadAgentSession,
  redoAgentCheckpoint,
  rewindAgentCheckpoint,
  saveAgentSession,
} from './editor/agentSessionStore';
import type { RouterConfig } from '../shared/agents';
import { importAgentSkill, listInstalledAgentSkills, uninstallAgentSkill } from './editor/installedSkills';
import { importMcpPluginConfig, listMcpPlugins, probeMcpPlugin, removeMcpPlugin, setMcpPluginEnabled } from './editor/mcpPlugins';
import { scanProjectEntries } from './fsScan';
import { watchProjectFileChanges, type ProjectFileWatch } from './projectFileWatcher';
import { openEmbeddedIde, closeEmbeddedIde, resizeEmbeddedIde, focusEmbeddedIde } from './nativeHost';
import { startActivityMonitor } from './activityMonitor';
import { canPersistProviderKeySafely } from './editor/providerSecurity';

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  // Do not let a second launch initialize room sockets, tray icons, or background services.
  app.exit(0);
} else {
let updateState: UpdateState = { status: 'idle', version: null, progress: null, error: null, transferred: 0, total: 0, bytesPerSecond: 0 };
let updateCheckPromise: Promise<void> | null = null;
let lastProgressEmitAt = 0;
let updateInstallRequested = false;

function emitUpdateState(state: UpdateState): void {
  updateState = state;
  store.patch({ update: state });
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
// Differential NSIS updates stay enabled. A version-aware override lets GitHub find
// the blockmap attached to the installed version's release instead of falling back
// to a full installer download when the release base URL changes.
autoUpdater.disableDifferentialDownload = false;
autoUpdater.previousBlockmapBaseUrlOverride = `https://github.com/azaleaforge-ctrl/cloud-pc/releases/download/v${APP_VERSION}`;

autoUpdater.on('checking-for-update', () => {
  emitUpdateState({ status: 'checking', version: updateState.version, progress: null, error: null, transferred: 0, total: 0, bytesPerSecond: 0 });
});
autoUpdater.on('update-available', (info) => {
  updateInstallRequested = false;
  emitUpdateState({ status: 'available', version: info.version, progress: 0, error: null, transferred: 0, total: 0, bytesPerSecond: 0 });
});
autoUpdater.on('update-not-available', () => {
  emitUpdateState({ status: 'latest', version: null, progress: null, error: null, transferred: 0, total: 0, bytesPerSecond: 0 });
});
autoUpdater.on('error', (err: Error) => {
  emitUpdateState({
    status: 'error',
    version: updateState.version,
    progress: updateState.progress,
    error: err.message,
    transferred: updateState.transferred ?? 0,
    total: updateState.total ?? 0,
    bytesPerSecond: updateState.bytesPerSecond ?? 0,
  });
});
autoUpdater.on('download-progress', (progress) => {
  // Avoid flooding React/Electron with redundant progress events while still keeping
  // the visible progress and speed smooth. Always publish the final progress event.
  const now = Date.now();
  if (now - lastProgressEmitAt < 250 && progress.percent < 100) return;
  lastProgressEmitAt = now;
  emitUpdateState({
    status: 'downloading',
    version: updateState.version,
    progress: progress.percent,
    error: null,
    transferred: progress.transferred,
    total: progress.total,
    bytesPerSecond: progress.bytesPerSecond,
  });
});
autoUpdater.on('update-downloaded', (info) => {
  emitUpdateState({
    status: 'downloaded',
    version: info.version,
    progress: 100,
    error: null,
    transferred: updateState.total ?? updateState.transferred ?? 0,
    total: updateState.total ?? 0,
    bytesPerSecond: 0,
  });
  if (store.get().role === 'none') {
    setTimeout(() => autoUpdater.quitAndInstall(), 2500).unref?.();
  }
});

function checkForUpdates(): Promise<void> {
  if (process.env.NODE_ENV === 'development') return Promise.resolve();
  // Build tanpa kanal rilis (mis. `electron-builder --dir` atau versi portabel)
  // tidak punya app-update.yml; jangan munculkan status error karena itu.
  if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) return Promise.resolve();
  if (updateCheckPromise) return updateCheckPromise;
  // autoDownload is enabled: don't start another check/download while one is
  // already available, downloading, or ready to install.
  if (['available', 'downloading', 'downloaded'].includes(updateState.status)) return Promise.resolve();
  updateCheckPromise = autoUpdater.checkForUpdates()
    .then(() => undefined)
    .catch((err: Error) => {
      if (updateState.status !== 'error' || updateState.error !== err.message) {
        emitUpdateState({
          status: 'error', version: updateState.version, progress: updateState.progress, error: err.message,
          transferred: updateState.transferred ?? 0, total: updateState.total ?? 0, bytesPerSecond: updateState.bytesPerSecond ?? 0,
        });
      }
    })
    .finally(() => { updateCheckPromise = null; });
  return updateCheckPromise;
}
interface Settings {
  selfId: string;
  selfName: string;
  lastFolder?: string;
  /** Last app version that successfully started, used to count real installed updates. */
  lastLaunchedVersion?: string;
  /** Successful version transitions since the last history cleanup. */
  successfulUpdatesSinceHistoryCleanup?: number;
  /** Number of oldest release-note entries hidden after completed cleanup cycles. */
  hiddenReleaseHistoryCount?: number;
}

const settingsPath = () => join(app.getPath('userData'), 'settings.json');

function loadSettings(): Settings {
  try {
    const raw = readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      selfId: parsed.selfId ?? randomUUID(),
      selfName: parsed.selfName ?? 'Saya',
      lastFolder: parsed.lastFolder,
      // Prior releases did not persist this marker; use the last published baseline
      // so the first upgrade after this feature is counted for version-history cleanup.
      lastLaunchedVersion: parsed.lastLaunchedVersion ?? '0.3.2',
      successfulUpdatesSinceHistoryCleanup: parsed.successfulUpdatesSinceHistoryCleanup ?? 0,
      hiddenReleaseHistoryCount: parsed.hiddenReleaseHistoryCount ?? 0,
    };
  } catch {
    return {
      selfId: randomUUID(),
      selfName: 'Saya',
      lastLaunchedVersion: APP_VERSION,
      successfulUpdatesSinceHistoryCleanup: 0,
      hiddenReleaseHistoryCount: 0,
    };
  }
}

function saveSettings(settings: Settings): void {
  mkdirSync(dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function recordSuccessfulVersionLaunch(settings: Settings): void {
  const lastVersion = settings.lastLaunchedVersion;
  // The first version with this feature initializes its marker. From the next release
  // onward, a launch of a strictly newer version counts as a completed update.
  if (lastVersion && compareVersions(APP_VERSION, lastVersion) > 0) {
    const updates = (settings.successfulUpdatesSinceHistoryCleanup ?? 0) + 1;
    if (updates >= 3) {
      settings.hiddenReleaseHistoryCount = (settings.hiddenReleaseHistoryCount ?? 0) + 3;
      settings.successfulUpdatesSinceHistoryCleanup = 0;
    } else {
      settings.successfulUpdatesSinceHistoryCleanup = updates;
    }
  }
  settings.lastLaunchedVersion = APP_VERSION;
  saveSettings(settings);
}

const settings = loadSettings();
recordSuccessfulVersionLaunch(settings);

const initialState: AppState = {
  role: 'none',
  code: null,
  roomName: null,
  selfId: settings.selfId,
  selfName: settings.selfName,
  lanAddress: getLanIp(),
  hostAddress: null,
  projectPath: null,
  members: [],
  queue: { holder: null, queue: [], holderLastActivity: null, holderActivitySource: null, holderStartedAt: null },
  framework: null,
  server: { status: 'idle', url: null, port: null, logs: [] },
  ides: [],
  idesScanning: false,
  sync: { status: 'off', files: 0, lastSync: null },
  discovered: [],
  projectFiles: [],
  update: { status: 'idle', version: null, progress: null, error: null },
  queueNotice: null,
  ideMode: false,
  activeIdeId: null,
};

const store = new StateStore(initialState);
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
app.on('second-instance', () => {
  if (!win || win.isDestroyed()) {
    void createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
});
let hostRoom: HostRoom | null = null;
let memberRoom: MemberRoom | null = null;
let devServer: DevServerHandle | null = null;
let framework: FrameworkInfo | null = null;
let stopActivityMonitor: (() => void) | null = null;
let projectFileWatcher: ProjectFileWatch | null = null;
let watchedProjectPath: string | null = null;
let isQuitting = false;

// IDE bawaan: service hidup selama aplikasi, tapi hanya melayani saat ada project.
const editorRoot = (): string | null => (store.get().role === 'none' ? null : store.get().projectPath);
const editorWorkspace = createWorkspaceService(editorRoot);
const editorTerminals = createTerminalService({
  getRoot: editorRoot,
  onData: (event) => send('rk:editor:term-data', event),
  onExit: (event) => send('rk:editor:term-exit', event),
});
const editorExtensions = createExtensionService(() => join(app.getPath('userData'), 'ide'));
const editorDebugger = createDebugService({ onEvent: (event) => send('rk:editor:debug-event', event) });

// AI Agent service — API key disimpan terenkripsi per-user; tidak dibundel ke aplikasi.
const LEGACY_ROUTER_ENDPOINT = process.env.RK_ROUTER_ENDPOINT ?? 'https://rbxludp.abc-tunnel.us/v1';
const LEGACY_ROUTER_FALLBACK_ENDPOINT = process.env.RK_ROUTER_FALLBACK ?? 'http://localhost:20128/v1';
const LEGACY_ROUTER_MODEL = 'ps/poolside/laguna-s-2.1(high)';
const PROVIDER_ENDPOINTS: Record<AgentProviderId, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  legacy: LEGACY_ROUTER_ENDPOINT,
};
const PROVIDER_DEFAULT_MODELS: Record<AgentProviderId, string> = {
  openrouter: 'openai/gpt-4o-mini',
  gemini: 'gemini-3.8-flash',
  legacy: LEGACY_ROUTER_MODEL,
};
const PROVIDER_NAMES: Record<AgentProviderId, string> = {
  openrouter: 'OpenRouter',
  gemini: 'Google Gemini API',
  legacy: '9router / OpenAI-compatible (Legacy)',
};

function routerKeyPath(): string {
  return join(app.getPath('userData'), '9router-api-key.enc');
}

function providerKeyPath(provider: AgentProviderId): string {
  return provider === 'legacy'
    ? routerKeyPath()
    : join(app.getPath('userData'), 'agent-' + provider + '-api-key.enc');
}

function providerSelectionPath(): string {
  return join(app.getPath('userData'), 'agent-provider-selection.json');
}

function selectedModelPath(): string {
  return join(app.getPath('userData'), 'agent-model-selection.json');
}

function isAgentProvider(value: unknown): value is AgentProviderId {
  return value === 'openrouter' || value === 'gemini' || value === 'legacy';
}

function providerKeyEncryptionAvailable(): boolean {
  let backend: string | undefined;
  if (process.platform === 'linux') {
    try {
      const storage = safeStorage as unknown as { getSelectedStorageBackend?: () => string };
      backend = storage.getSelectedStorageBackend?.();
    } catch {
      return false;
    }
  }
  return canPersistProviderKeySafely(process.platform, safeStorage.isEncryptionAvailable(), backend);
}

function readStoredProviderKey(provider: AgentProviderId): string {
  try {
    if (!providerKeyEncryptionAvailable()) return '';
    const path = providerKeyPath(provider);
    if (!existsSync(path)) return '';
    return safeStorage.decryptString(readFileSync(path));
  } catch {
    return '';
  }
}

function getProviderEnvironmentKey(provider: AgentProviderId): string {
  switch (provider) {
    case 'openrouter': return (process.env.OPENROUTER_API_KEY ?? '').trim();
    case 'gemini': return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    case 'legacy': return (process.env.RK_ROUTER_API_KEY ?? '').trim();
  }
}

function getProviderApiKey(provider: AgentProviderId): string {
  return getProviderEnvironmentKey(provider) || readStoredProviderKey(provider);
}

function getSelectedAgentProvider(): AgentProviderId {
  try {
    const raw = JSON.parse(readFileSync(providerSelectionPath(), 'utf8')) as { provider?: unknown };
    if (isAgentProvider(raw.provider)) return raw.provider;
  } catch {
    // Migrate existing installs that already stored an old 9router key.
  }
  if (getProviderEnvironmentKey('legacy') || readStoredProviderKey('legacy')) return 'legacy';
  if (getProviderEnvironmentKey('openrouter') || readStoredProviderKey('openrouter')) return 'openrouter';
  if (getProviderEnvironmentKey('gemini') || readStoredProviderKey('gemini')) return 'gemini';
  return 'openrouter';
}

function saveAgentProviderSelection(value: unknown): ActionResult {
  if (!isAgentProvider(value)) return { ok: false, error: 'Provider tidak dikenali.' };
  try {
    const path = providerSelectionPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ provider: value, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: 'Gagal menyimpan pilihan provider: ' + ((error as Error).message || 'kesalahan file') };
  }
}

function getSelectedAgentModel(provider: AgentProviderId = getSelectedAgentProvider()): string {
  try {
    const raw = JSON.parse(readFileSync(selectedModelPath(), 'utf8')) as {
      model?: unknown;
      models?: Partial<Record<AgentProviderId, unknown>>;
    };
    const providerModel = raw.models?.[provider];
    if (typeof providerModel === 'string') return normalizeModelId(providerModel);
    // Preserve the old single-model preference only for the legacy provider.
    if (provider === 'legacy' && typeof raw.model === 'string') return normalizeModelId(raw.model);
  } catch {
    // Use the provider's default model when no selection is saved yet.
  }
  return PROVIDER_DEFAULT_MODELS[provider];
}

function saveSelectedAgentModel(value: unknown, provider: AgentProviderId = getSelectedAgentProvider()): ActionResult {
  try {
    if (typeof value !== 'string') throw new Error('ID model harus berupa teks.');
    const model = normalizeModelId(value);
    const path = selectedModelPath();
    let previous: { model?: unknown; models?: Partial<Record<AgentProviderId, unknown>> } = {};
    try { previous = JSON.parse(readFileSync(path, 'utf8')) as typeof previous; } catch { /* initialize */ }
    const models = { ...(previous.models ?? {}), [provider]: model };
    writeFileSync(path, JSON.stringify({
      models,
      ...(provider === 'legacy'
        ? { model }
        : typeof previous.model === 'string' ? { model: previous.model } : {}),
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message || 'Gagal menyimpan model.' };
  }
}

function getProviderInfo(provider: AgentProviderId) {
  return {
    id: provider,
    name: PROVIDER_NAMES[provider],
    configured: !!getProviderApiKey(provider),
    endpoint: provider === 'legacy' ? LEGACY_ROUTER_ENDPOINT : PROVIDER_ENDPOINTS[provider],
    keyUrl: provider === 'openrouter' ? 'https://openrouter.ai/keys'
      : provider === 'gemini' ? 'https://aistudio.google.com/apikey' : '',
    docsUrl: provider === 'openrouter' ? 'https://openrouter.ai/docs/quickstart'
      : provider === 'gemini' ? 'https://ai.google.dev/gemini-api/docs' : '',
  };
}

function getProviderConfig(provider: AgentProviderId, allowEmptyKey = false): RouterConfig | null {
  const apiKey = getProviderApiKey(provider);
  if (!apiKey && !allowEmptyKey) return null;
  return {
    provider,
    apiKey,
    endpoint: PROVIDER_ENDPOINTS[provider],
    models: [getSelectedAgentModel(provider)],
    ...(provider === 'legacy' ? { fallbackEndpoint: LEGACY_ROUTER_FALLBACK_ENDPOINT } : {}),
  };
}

function getRouterConfig(): RouterConfig | null {
  return getProviderConfig(getSelectedAgentProvider());
}

function getAgentRouterStatus(): AgentRouterStatus {
  const provider = getSelectedAgentProvider();
  const info = getProviderInfo(provider);
  return {
    configured: info.configured,
    provider,
    providerName: info.name,
    providers: (['openrouter', 'gemini', 'legacy'] as AgentProviderId[]).map(getProviderInfo),
    keyUrl: info.keyUrl,
    docsUrl: info.docsUrl,
    endpoint: info.endpoint,
    fallbackEndpoint: provider === 'legacy' ? LEGACY_ROUTER_FALLBACK_ENDPOINT : '',
    model: getSelectedAgentModel(provider),
  };
}

function saveAgentRouterKey(input: unknown): { ok: boolean; error?: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Data konfigurasi provider tidak valid.' };
  const value = input as { provider?: unknown; apiKey?: unknown };
  if (!isAgentProvider(value.provider)) return { ok: false, error: 'Pilih provider yang tersedia.' };
  if (typeof value.apiKey !== 'string' || !value.apiKey.trim()) return { ok: false, error: 'API key tidak boleh kosong.' };
  const provider = value.provider;
  const clean = value.apiKey.trim();
  if (getProviderEnvironmentKey(provider)) {
    const envName = provider === 'openrouter' ? 'OPENROUTER_API_KEY'
      : provider === 'gemini' ? (process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY')
      : 'RK_ROUTER_API_KEY';
    return { ok: false, error: 'API key provider diatur melalui environment ' + envName + '; ubah konfigurasi environment untuk menggantinya.' };
  }
  if (!providerKeyEncryptionAvailable()) {
    return {
      ok: false,
      error: process.platform === 'linux'
        ? 'Keyring sistem tidak tersedia atau memakai backend basic_text. Aktifkan GNOME Keyring/KWallet agar API key dapat disimpan dengan aman.'
        : 'Penyimpanan kunci aman sistem operasi tidak tersedia. API key tidak disimpan.',
    };
  }
  try {
    mkdirSync(dirname(providerKeyPath(provider)), { recursive: true });
    const keyPath = providerKeyPath(provider);
    writeFileSync(keyPath, safeStorage.encryptString(clean), { mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(keyPath, 0o600);
    const selected = saveAgentProviderSelection(provider);
    if (!selected.ok) return selected;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: 'Gagal menyimpan API key terenkripsi: ' + ((error as Error).message || 'kesalahan file') };
  }
}

async function openProviderKeyPage(providerValue: unknown): Promise<ActionResult> {
  if (!isAgentProvider(providerValue)) return { ok: false, error: 'Provider tidak dikenali.' };
  const url = getProviderInfo(providerValue).keyUrl;
  if (!url) return { ok: false, error: 'Provider lama ini tidak memiliki halaman API key resmi yang terdaftar.' };
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: 'Gagal membuka halaman API key: ' + ((error as Error).message || 'kesalahan sistem') };
  }
}

async function testAgentRouter(): Promise<AgentRouterTestResult> {
  const config = getRouterConfig();
  if (!config?.apiKey) return { ok: false, message: 'Pilih provider lalu simpan API key sebelum menguji koneksi.' };
  return testProviderConnection(config);
}

const agentService = createAgentService(getRouterConfig);

function startProjectFilesWatcher(root: string): void {
  if (projectFileWatcher && watchedProjectPath === root) return;
  const previous = projectFileWatcher;
  projectFileWatcher = null;
  watchedProjectPath = root;
  if (previous) void previous.close().catch(() => undefined);
  try {
    projectFileWatcher = watchProjectFileChanges(root, () => {
      if (store.get().projectPath !== root) return;
      send('rk:project-files-changed', { changedAt: Date.now() });
    });
  } catch {
    projectFileWatcher = null;
  }
}

async function stopProjectFilesWatcher(): Promise<void> {
  const current = projectFileWatcher;
  projectFileWatcher = null;
  watchedProjectPath = null;
  if (current) await current.close().catch(() => undefined);
}

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function notify(payload: NotifyPayload): void {
  send('rk:notify', payload);
}

const emit = (patch: Partial<AppState>) => store.patch(patch);

function pushServerLog(line: string): void {
  send('rk:server-log', { line });
  const current = store.get().server;
  const logs = [...current.logs, line].slice(-600);
  store.patch({ server: { ...current, logs } });
}

function applyServerState(server: ServerState): void {
  store.patch({ server });
  if (hostRoom) {
    const lan = getLanIp();
    const publicServer: ServerState = {
      ...server,
      url: server.port && lan ? `http://${lan}:${server.port}` : server.url,
      logs: [],
    };
    hostRoom.setServerState(publicServer);
  }
}

function resetRoomState(): void {
  store.patch({
    role: 'none',
    code: null,
    roomName: null,
    hostAddress: null,
    projectPath: null,
    members: [],
    queue: { holder: null, queue: [], holderLastActivity: null, holderActivitySource: null, holderStartedAt: null },
    framework: null,
    server: { status: 'idle', url: null, port: null, logs: [] },
    sync: { status: 'off', files: 0, lastSync: null },
    projectFiles: [],
    // Update state is global and must continue while the user leaves/changes a room.
    queueNotice: null,
    ideMode: false,
    activeIdeId: null,
  });
  framework = null;
}

async function shutdownRoom(): Promise<void> {
  await stopProjectFilesWatcher();
  stopActivityMonitor?.();
  stopActivityMonitor = null;
  editorDebugger.dispose();
  editorTerminals.disposeAll();
  await closeEmbeddedIde().catch(() => undefined);
  store.patch({ ideMode: false, activeIdeId: null, queueNotice: null });
  if (devServer) {
    await devServer.stop().catch(() => undefined);
    devServer = null;
  }
  if (hostRoom) {
    await hostRoom.close().catch(() => undefined);
    hostRoom = null;
  }
  if (memberRoom) {
    await memberRoom.close().catch(() => undefined);
    memberRoom = null;
  }
  agentService.disposeAll();
  stopAdvertise();
}

function ensureString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} wajib diisi`);
  return value.trim();
}

async function handleCreateRoom(input: CreateRoomInput): Promise<ActionResult> {
  try {
    if (store.get().role !== 'none') return { ok: false, error: 'Sudah berada di ruangan. Keluar dulu.' };
    const folder = ensureString(input.folder, 'Folder project');
    if (!existsSync(folder)) return { ok: false, error: 'Folder project tidak ditemukan.' };
    const roomName = ensureString(input.roomName, 'Nama ruangan');
    const memberName = ensureString(input.memberName, 'Nama kamu');
    settings.selfName = memberName;
    settings.lastFolder = folder;
    saveSettings(settings);
    store.patch({ selfName: memberName });

    framework = detectFramework(folder);
    const room = await createHostRoom({
      code: await findUnusedCode(),
      roomName,
      hostName: memberName,
      hostId: settings.selfId,
      projectPath: folder,
      initialHolder: settings.selfId,
      emit,
      notify,
    });
    hostRoom = room;
    stopActivityMonitor = startActivityMonitor(folder, (source) => room.reportActivity(settings.selfId, source));
    startAdvertise({ code: room.code, name: roomName, port: room.port });
    store.patch({
      role: 'host',
      code: room.code,
      roomName,
      projectPath: folder,
      framework,
      members: [{ id: settings.selfId, name: memberName, isHost: true }],
      queue: { holder: settings.selfId, queue: [], holderLastActivity: Date.now(), holderActivitySource: 'room-start', holderStartedAt: Date.now() },
      lanAddress: getLanIp(),
    });
    startProjectFilesWatcher(folder);
    notify({ kind: 'info', message: `Ruangan aktif. Kode: ${room.code}` });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function findUnusedCode(): Promise<string> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    const found = await findRoom(code, 350);
    if (!found) return code;
  }
  throw new Error('Gagal membuat kode ruangan, coba lagi.');
}

async function handleJoinRoom(input: JoinRoomInput): Promise<ActionResult> {
  try {
    if (store.get().role !== 'none') return { ok: false, error: 'Sudah berada di ruangan. Keluar dulu.' };
    const code = ensureString(input.code, 'Kode ruangan').toUpperCase().replace(/\s+/g, '');
    const memberName = ensureString(input.memberName, 'Nama kamu');
    const room = await findRoom(code, 4000);
    if (!room) return { ok: false, error: 'Ruangan tidak ditemukan di jaringan ini. Pastikan host aktif dan WiFi sama.' };

    settings.selfName = memberName;
    saveSettings(settings);
    store.patch({ selfName: memberName });

    const localDir = join(app.getPath('userData'), 'rooms', code, 'project');
    mkdirSync(localDir, { recursive: true });

    const member = await joinAsMember({
      host: room.host,
      port: room.port,
      code,
      memberName,
      memberId: settings.selfId,
      localDir,
      emit,
      notify,
    });
    memberRoom = member;
    stopActivityMonitor = startActivityMonitor(localDir, (source) => { member.reportActivity(source); });
    store.patch({
      role: 'member',
      code,
      roomName: room.name,
      hostAddress: `${room.host}:${room.port}`,
      projectPath: localDir,
      lanAddress: getLanIp(),
    });
    startProjectFilesWatcher(localDir);
    notify({ kind: 'info', message: `Masuk ke ruangan ${room.name} (${code})` });
    return { ok: true };
  } catch (err) {
    memberRoom = null;
    return { ok: false, error: (err as Error).message };
  }
}

async function handleLeaveRoom(): Promise<void> {
  await shutdownRoom();
  resetRoomState();
  notify({ kind: 'info', message: 'Keluar dari ruangan.' });
}

function handleTakeTurn(): ActionResult {
  const state = store.get();
  if (state.role === 'none') return { ok: false, error: 'Belum masuk ruangan.' };
  if (state.queue.holder === state.selfId) return { ok: false, error: 'Kamu sudah memegang giliran.' };
  const queue = state.queue.queue;
  if (queue.length > 0 && queue[0] !== state.selfId) {
    return { ok: false, error: 'Masih ada antrian lain di depanmu.' };
  }
  // Host yang belum jadi holder: biarkan hostRoom.takeTurn yang handle (host selalu bisa ambil giliran jika kosong)
  // Member: jika holder null, ambil giliran langsung; jika ada holder lain, push ke queue
  if (hostRoom) return hostRoom.takeTurn();
  if (memberRoom) return memberRoom.takeTurn();
  return { ok: false, error: 'Sesi ruangan tidak aktif.' };
}

function handleReleaseTurn(): ActionResult {
  const state = store.get();
  if (state.role === 'none') return { ok: false, error: 'Belum masuk ruangan.' };
  if (state.queue.holder !== state.selfId) return { ok: false, error: 'Kamu tidak sedang memegang giliran.' };
  if (hostRoom) return hostRoom.releaseTurn();
  if (memberRoom) return memberRoom.releaseTurn();
  return { ok: false, error: 'Sesi ruangan tidak aktif.' };
}

async function handleStartServer(): Promise<ActionResult> {
  try {
    const state = store.get();
    if (state.role !== 'host') return { ok: false, error: 'Server dev hanya bisa dinyalakan oleh host.' };
    if (!framework || !state.projectPath) return { ok: false, error: 'Framework belum terdeteksi.' };
    if (devServer) {
      const status = store.get().server.status;
      if (status === 'running' || status === 'starting') return { ok: false, error: 'Server sudah berjalan.' };
      // Sisa proses dari percobaan sebelumnya: matikan dulu supaya start bersih.
      const stale = devServer;
      devServer = null;
      await stale.stop().catch(() => undefined);
    }
    let handle: DevServerHandle | null = null;
    handle = await startDevServer({
      framework,
      cwd: state.projectPath,
      onLog: pushServerLog,
      onState: applyServerState,
      onExit: () => {
        if (devServer === handle) devServer = null;
      },
    });
    devServer = handle;
    return { ok: true };
  } catch (err) {
    devServer = null;
    applyServerState({ ...store.get().server, status: 'error', error: (err as Error).message });
    return { ok: false, error: (err as Error).message };
  }
}

async function handleStopServer(): Promise<ActionResult> {
  if (!devServer) {
    // Status bisa tertinggal di error/starting walau proses sudah mati.
    const server = store.get().server;
    if (server.status === 'running' || server.status === 'starting' || server.status === 'error') {
      applyServerState({ ...server, status: 'stopped', url: null, port: null, targetPort: null, proxied: false, error: null });
      return { ok: true };
    }
    return { ok: false, error: 'Server tidak sedang berjalan.' };
  }
  const handle = devServer;
  devServer = null;
  await handle.stop();
  applyServerState({ ...store.get().server, status: 'stopped', url: null, port: null, targetPort: null, proxied: false, error: null });
  return { ok: true };
}

async function scanIdesAndUpdate(): Promise<IdeInfo[]> {
  store.patch({ idesScanning: true });
  try {
    const ides = await detectIdes();
    store.patch({ ides, idesScanning: false });
    return ides;
  } catch {
    store.patch({ idesScanning: false });
    return store.get().ides;
  }
}

const RELEASE_HISTORY_CACHE_TTL_MS = 1 * 60 * 60 * 1000; // 1 jam - cukup untuk refresh release notes

type ReleaseHistoryCache = { savedAt: number; releases: ReleaseInfo[] };

function releaseHistoryCachePath(): string {
  return join(app.getPath('userData'), 'release-history-cache.json');
}

function readReleaseHistoryCache(): ReleaseHistoryCache | null {
  try {
    const cachePath = releaseHistoryCachePath();
    if (!existsSync(cachePath)) return null;
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as ReleaseHistoryCache;
    if (!Array.isArray(parsed.releases) || typeof parsed.savedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeReleaseHistoryCache(releases: ReleaseInfo[]): void {
  try {
    const cachePath = releaseHistoryCachePath();
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ savedAt: Date.now(), releases }, null, 2), 'utf8');
  } catch {
    // The feature should continue working even if the local cache cannot be saved.
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

function atomHtmlToMarkdown(value: string): string {
  return decodeXmlEntities(value)
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, body: string) => '\n\n' + '#'.repeat(Number(level)) + ' ' + body + '\n\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<p\b[^>]*>/gi, '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function atomText(entry: string, tag: string): string | null {
  const match = entry.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  return match ? decodeXmlEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim() : null;
}

async function fetchReleaseHistoryFromAtom(): Promise<ReleaseInfo[]> {
  const response = await fetch('https://github.com/azaleaforge-ctrl/cloud-pc/releases.atom', {
    headers: { Accept: 'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8', 'User-Agent': 'Ruang-Kerja-Version-History' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('GitHub release feed HTTP ' + response.status);
  const xml = await response.text();
  const entries = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
  const releases: ReleaseInfo[] = [];
  for (const entry of entries) {
    const linkTags = [...entry.matchAll(/<link\b[^>]*\/?\s*>/gi)].map((match) => match[0]);
    const linkTag = linkTags.find((tag) => /rel=[\"']alternate[\"']/i.test(tag)) ?? linkTags[0] ?? '';
    const href = linkTag.match(/href=[\"']([^\"']+)[\"']/i)?.[1];
    const tag = href?.match(/\/releases\/tag\/([^/?#]+)/i)?.[1];
    if (!tag) continue;
    const decodedTag = decodeURIComponent(tag);
    const title = atomText(entry, 'title') ?? decodedTag;
    const updated = atomText(entry, 'published') ?? atomText(entry, 'updated');
    if (!updated || !Number.isFinite(Date.parse(updated))) continue;
    const content = entry.match(/<(?:content|summary)\b[^>]*>([\s\S]*?)<\/(?:content|summary)>/i)?.[1] ?? '';
    const body = content ? atomHtmlToMarkdown(content) : null;
    const isPrerelease = /(?:alpha|beta|rc|pre[- ]?release|nightly)/i.test(decodedTag + ' ' + title);
    releases.push({
      tag: decodedTag,
      name: title === decodedTag ? null : title,
      body: body || null,
      published_at: updated,
      prerelease: isPrerelease,
      draft: false,
    });
  }
  return releases.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)).slice(0, 3);
}

async function loadReleaseHistory(forceRefresh = false): Promise<{ ok: boolean; error?: string; releases?: ReleaseInfo[] }> {
  const cached = readReleaseHistoryCache();
  if (!forceRefresh && cached && Date.now() - cached.savedAt < RELEASE_HISTORY_CACHE_TTL_MS && cached.releases.length > 0) {
    return { ok: true, releases: cached.releases.slice(0, 3) };
  }

  let apiError = 'unknown error';
  try {
    const url = 'https://api.github.com/repos/azaleaforge-ctrl/cloud-pc/releases?per_page=100';
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'Ruang-Kerja-Updater' };
    const token = process.env.GH_TOKEN;
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      const rateLimited = response.status === 403 || response.status === 429;
      apiError = rateLimited
        ? 'GitHub API membatasi permintaan (HTTP ' + response.status + '). Beralih ke release feed.'
        : 'GitHub API HTTP ' + response.status;
      throw new Error(apiError);
    }
    const raw = await response.json() as any[];
    const releases = raw
      .filter((item) => !item.draft && !!item.published_at)
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
      .slice(0, 3)
      .map((item) => ({
        tag: String(item.tag_name),
        name: item.name ? String(item.name) : null,
        body: item.body ? String(item.body) : null,
        published_at: String(item.published_at),
        prerelease: Boolean(item.prerelease),
        draft: Boolean(item.draft),
      } satisfies ReleaseInfo));
    if (releases.length > 0) {
      writeReleaseHistoryCache(releases);
      return { ok: true, releases };
    }
    throw new Error('GitHub tidak mengembalikan rilis yang sudah diterbitkan.');
  } catch (error) {
    apiError = (error as Error).message || apiError;
  }

  try {
    const releases = await fetchReleaseHistoryFromAtom();
    if (releases.length > 0) {
      writeReleaseHistoryCache(releases);
      return { ok: true, releases };
    }
    throw new Error('Release feed tidak memuat versi yang dapat ditampilkan.');
  } catch (feedError) {
    if (cached && cached.releases.length > 0) {
      return { ok: true, releases: cached.releases.slice(0, 3) };
    }
    return {
      ok: false,
      error: 'Riwayat versi tidak dapat dimuat dari GitHub. ' + apiError + '; release feed: ' + ((feedError as Error).message || 'gagal diakses') + '. Coba lagi nanti.',
    };
  }
}

function registerIpc(): void {
  ipcMain.handle('rk:get-state', () => ({ ...store.get(), version: APP_VERSION }));
  ipcMain.handle('rk:pick-folder', async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Pilih folder project',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('rk:create-room', (_e, input: CreateRoomInput) => handleCreateRoom(input));
  ipcMain.handle('rk:join-room', (_e, input: JoinRoomInput) => handleJoinRoom(input));
  ipcMain.handle('rk:leave-room', () => handleLeaveRoom());
  ipcMain.handle('rk:set-member-name', (_e, name: string) => {
    const clean = ensureString(name, 'Nama');
    settings.selfName = clean;
    saveSettings(settings);
    store.patch({ selfName: clean });
  });
  ipcMain.handle('rk:take-turn', () => handleTakeTurn());
  ipcMain.handle('rk:release-turn', () => handleReleaseTurn());
  ipcMain.handle('rk:request-turn', () => {
    const state = store.get();
    if (state.role === 'none') return { ok: false, error: 'Belum masuk ruangan.' };
    if (state.role === 'host') return hostRoom ? hostRoom.takeTurn() : { ok: false, error: 'Sesi ruangan tidak aktif.' };
    // Member: send request-turn ke host
    if (memberRoom) return memberRoom.requestTurn();
    return { ok: false, error: 'Sesi ruangan tidak aktif.' };
  });
  ipcMain.handle('rk:scan-ides', () => scanIdesAndUpdate());
  ipcMain.handle('rk:open-ide', async (_e, ideId: string) => {
    const state = store.get();
    const ide = state.ides.find((item) => item.id === ideId);
    if (!ide) return { ok: false, error: 'IDE tidak ditemukan. Coba pindai ulang.' };
    if (!ide.installed || !ide.exe) return { ok: false, error: ide.name + ' belum terpasang. Unduh dari tautan resmi pada katalog IDE terlebih dahulu.' };
    if (!state.projectPath) return { ok: false, error: 'Belum ada folder project.' };
    const result = await openEmbeddedIde(ide, state.projectPath, win!);
    if (result.ok) store.patch({ ideMode: true, activeIdeId: ide.id });
    return result;
  });
  ipcMain.handle('rk:close-ide', async () => {
    await closeEmbeddedIde();
    store.patch({ ideMode: false, activeIdeId: null });
    return { ok: true };
  });
  ipcMain.handle('rk:approve-queue', (_e, requesterId: string) => {
    const state = store.get();
    if (hostRoom) return hostRoom.approveQueue(requesterId);
    if (memberRoom) return memberRoom.approveQueue(requesterId);
    return { ok: false, error: 'Sesi ruangan tidak aktif.' };
  });
  ipcMain.handle('rk:defer-queue', (_e, requesterId: string) => {
    const state = store.get();
    if (hostRoom) return hostRoom.deferQueue(requesterId);
    if (memberRoom) return memberRoom.deferQueue(requesterId);
    return { ok: false, error: 'Sesi ruangan tidak aktif.' };
  });
  ipcMain.handle('rk:report-activity', (_e, source?: string) => {
    const value = source || 'ui';
    if (hostRoom) hostRoom.reportActivity(settings.selfId, value);
    if (memberRoom) memberRoom.reportActivity(value);
  });
  ipcMain.handle('rk:rescan-framework', () => {
    const state = store.get();
    if (!state.projectPath) return null;
    framework = detectFramework(state.projectPath);
    store.patch({ framework });
    return framework;
  });
  ipcMain.handle('rk:start-server', () => handleStartServer());
  ipcMain.handle('rk:stop-server', () => handleStopServer());
  ipcMain.handle('rk:check-for-updates', async () => {
    if (process.env.NODE_ENV === 'development') {
      return { ok: false, error: 'Auto-update tidak berjalan di mode development.' };
    }
    await checkForUpdates();
    return updateState.status === 'error'
      ? { ok: false, error: updateState.error ?? 'Gagal memeriksa pembaruan.' }
      : { ok: true };
  });
  ipcMain.handle('rk:download-update', async () => {
    if (process.env.NODE_ENV === 'development') {
      return { ok: false, error: 'Auto-update tidak berjalan di mode development.' };
    }
    if (updateState.status === 'available') {
      try {
        await autoUpdater.downloadUpdate();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }
    if (updateState.status === 'downloading') return { ok: true };
    if (updateState.status === 'downloaded') return { ok: true };
    if (updateState.status === 'error') return { ok: false, error: updateState.error ?? 'Download pembaruan gagal.' };
    return { ok: false, error: 'Tidak ada pembaruan yang tersedia.' };
  });
  ipcMain.handle('rk:install-update', async () => {
    if (updateState.status === 'downloaded') {
      if (!updateInstallRequested) {
        updateInstallRequested = true;
        setImmediate(() => autoUpdater.quitAndInstall());
      }
      return { ok: true };
    }
    if (updateState.status === 'available' || updateState.status === 'downloading') {
      // autoDownload is enabled. Do not call downloadUpdate() a second time from UI;
      // this avoids duplicate download requests and keeps one authoritative progress stream.
      return { ok: true };
    }
    if (updateState.status === 'error') return { ok: false, error: updateState.error ?? 'Download pembaruan gagal.' };
    return { ok: false, error: 'Tidak ada pembaruan yang siap dipasang.' };
  });
  ipcMain.handle('rk:fetch-release-notes', async (_event, forceRefresh = false) => loadReleaseHistory(forceRefresh === true));
  ipcMain.handle('rk:list-project-files', async () => {
    const state = store.get();
    if (!state.projectPath) return [];
    try {
      const entries = await scanProjectEntries(state.projectPath);
      return entries.map((entry) => ({
        path: entry.path,
        size: entry.size,
        mtime: entry.mtime,
        // fsScan stores epoch milliseconds. Do not multiply by 1000.
        modified: new Date(entry.mtime).toISOString(),
        isDirectory: entry.isDirectory,
      }));
    } catch {
      return [];
    }
  });

  // --- IDE bawaan ---------------------------------------------------------
  ipcMain.handle('rk:editor:list-dir', (_e, path: string) => editorWorkspace.listDir(path));
  ipcMain.handle('rk:editor:read-file', (_e, path: string) => editorWorkspace.readFile(path));
  ipcMain.handle('rk:editor:write-file', (_e, path: string, content: string) => editorWorkspace.writeFile(path, content));
  ipcMain.handle('rk:editor:create-file', (_e, path: string) => editorWorkspace.createFile(path));
  ipcMain.handle('rk:editor:create-folder', (_e, path: string) => editorWorkspace.createFolder(path));
  ipcMain.handle('rk:editor:rename', (_e, from: string, to: string) => editorWorkspace.renamePath(from, to));
  ipcMain.handle('rk:editor:delete', (_e, path: string) => editorWorkspace.deletePath(path));
  ipcMain.handle('rk:editor:search', (_e, query: string, opts?: { caseSensitive?: boolean; maxResults?: number }) => editorWorkspace.search(query, opts));

  ipcMain.handle('rk:editor:term-create', (_e, opts) => editorTerminals.create(opts));
  ipcMain.handle('rk:editor:term-write', (_e, id: string, data: string) => editorTerminals.write(id, data));
  ipcMain.handle('rk:editor:term-resize', (_e, id: string, cols: number, rows: number) => editorTerminals.resize(id, cols, rows));
  ipcMain.handle('rk:editor:term-kill', (_e, id: string) => editorTerminals.kill(id));
  ipcMain.handle('rk:editor:term-list', () => editorTerminals.list());

  ipcMain.handle('rk:editor:ext-search', (_e, query: string, offset?: number) => editorExtensions.search(query, offset));
  ipcMain.handle('rk:editor:ext-list', () => editorExtensions.list());
  ipcMain.handle('rk:editor:ext-install', (_e, id: string, version?: string) => editorExtensions.install(id, version));
  ipcMain.handle('rk:editor:ext-uninstall', (_e, id: string) => editorExtensions.uninstall(id));
  ipcMain.handle('rk:editor:ext-read-file', (_e, path: string) => editorExtensions.readFile(path));

  ipcMain.handle('rk:editor:debug-start', (_e, entry: string) => editorDebugger.start(entry));
  ipcMain.handle('rk:editor:debug-stop', () => editorDebugger.stop());
  ipcMain.handle('rk:editor:debug-breakpoints', (_e, points: Array<{ path: string; line: number }>) => editorDebugger.setBreakpoints(points));
  ipcMain.handle('rk:editor:debug-resume', () => editorDebugger.resume());
  ipcMain.handle('rk:editor:debug-pause', () => editorDebugger.pause());
  ipcMain.handle('rk:editor:debug-step', (_e, kind: 'over' | 'into' | 'out') => editorDebugger.step(kind));
  ipcMain.handle('rk:editor:debug-eval', (_e, expression: string) => editorDebugger.evaluate(expression));

  // --- AI Agent IPC ---
  const activeAgentSessions = new Set<string>();
  let lastQueueAgentBusy: boolean | null = null;
  let lastQueueRoomKey = '';
  const updateQueueAgentBusy = (): void => {
    const state = store.get();
    const roomKey = state.role + ':' + (state.code ?? '');
    const busy = activeAgentSessions.size > 0;
    if (lastQueueAgentBusy === busy && lastQueueRoomKey === roomKey) return;
    lastQueueAgentBusy = busy;
    lastQueueRoomKey = roomKey;
    if (state.role === 'host' && hostRoom) hostRoom.setAgentBusy(settings.selfId, busy);
    else if (state.role === 'member' && memberRoom) memberRoom.setAgentBusy(busy);
  };
  const emitAgentSessionEvent = (event: AgentEvent, sessionId: string): void => {
    if (event.type === 'state') {
      if (event.state.status === 'starting' || event.state.status === 'running') activeAgentSessions.add(sessionId);
      else activeAgentSessions.delete(sessionId);
    } else if (event.type === 'error' || event.type === 'exit') {
      activeAgentSessions.delete(sessionId);
    }
    // Re-evaluate room identity on each event as the user may have joined or left a room
    // while an agent session was still running.
    updateQueueAgentBusy();
    send('rk:agent:event', { sessionId, event });
  };
  ipcMain.handle('rk:agent:list', () => agentService.listAgents());
  ipcMain.handle('rk:agent:get-config', () => getAgentRouterStatus());
  ipcMain.handle('rk:agent:save-config', (_e, input: unknown) => saveAgentRouterKey(input));
  ipcMain.handle('rk:agent:select-provider', (_e, provider: AgentProviderId) => saveAgentProviderSelection(provider));
  ipcMain.handle('rk:agent:open-provider-key-page', (_e, provider: AgentProviderId) => openProviderKeyPage(provider));
  ipcMain.handle('rk:agent:test-config', () => testAgentRouter());
  ipcMain.handle('rk:agent:list-sessions', () => listAgentSessions(app.getPath('userData')));
  ipcMain.handle('rk:agent:load-session', async (_e, id: string) => {
    try {
      const existing = await loadAgentSession(app.getPath('userData'), id);
      if (!existing) return { ok: false, error: 'Sesi tidak ditemukan.' };
      await agentService.beginConversation(id);
      const record = await loadAgentSession(app.getPath('userData'), id);
      if (!record) return { ok: false, error: 'Sesi tidak dapat dimuat.' };
      const session: AgentSessionData = {
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        projectPath: record.projectPath,
        activeAgentId: record.activeAgentId,
        messageCount: record.messages.length,
        ...([...record.messages].reverse().find(message => message.role !== 'system' && message.content)
          ? { lastMessage: [...record.messages].reverse().find(message => message.role !== 'system' && message.content)!.content.slice(0, 160) }
          : {}),
        hasSummary: !!record.summary,
        checkpointCount: record.checkpoints.length,
        messages: record.messages,
        summary: record.summary,
        summaryThroughTs: record.summaryThroughTs,
        todos: record.todos,
        checkpoints: record.checkpoints.map(checkpoint => ({
          id: checkpoint.id,
          runId: checkpoint.runId,
          createdAt: checkpoint.createdAt,
          projectPath: checkpoint.projectPath,
          status: checkpoint.status,
          paths: checkpoint.files.map(file => file.path),
        })),
      };
      return { ok: true, session };
    } catch (error) {
      return { ok: false, error: (error as Error).message || 'Gagal memuat sesi.' };
    }
  });
  ipcMain.handle('rk:agent:save-session', async (_e, input: AgentSessionSaveInput) => {
    try {
      const summary = await saveAgentSession(app.getPath('userData'), input);
      const record = await loadAgentSession(app.getPath('userData'), input.id);
      return {
        ok: true,
        summary: record?.summary ?? '',
        summaryThroughTs: record?.summaryThroughTs ?? 0,
        session: summary,
      };
    } catch (error) {
      return { ok: false, error: (error as Error).message || 'Gagal menyimpan riwayat sesi.' };
    }
  });
  ipcMain.handle('rk:agent:delete-session', async (_e, id: string) => {
    try {
      await deleteAgentSession(app.getPath('userData'), id);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message || 'Gagal menghapus sesi.' };
    }
  });
  ipcMain.handle('rk:agent:list-checkpoints', (_e, sessionId: string) =>
    listAgentCheckpoints(app.getPath('userData'), sessionId));
  const canMutateAgentWorkspace = (): ActionResult => {
    const state = store.get();
    if (!state.projectPath) return { ok: false, error: 'Workspace project tidak sedang terbuka.' };
    if (state.role !== 'none' && state.queue.holder !== settings.selfId) {
      return { ok: false, error: 'Pemulihan file hanya bisa dilakukan saat kamu memegang giliran kerja.' };
    }
    return { ok: true };
  };
  ipcMain.handle('rk:agent:rewind-checkpoint', async (_e, sessionId: string, checkpointId: string): Promise<AgentCheckpointActionResult> => {
    const permission = canMutateAgentWorkspace();
    if (!permission.ok) return { ok: false, message: permission.error ?? 'Akses workspace ditolak.' };
    const projectPath = store.get().projectPath!;
    const result = await rewindAgentCheckpoint(app.getPath('userData'), sessionId, projectPath, checkpointId);
    if (result.ok) send('rk:project-files-changed', { changedAt: Date.now() });
    return {
      ok: result.ok,
      message: result.message,
      ...(result.checkpoint ? { checkpoint: {
        id: result.checkpoint.id,
        runId: result.checkpoint.runId,
        createdAt: result.checkpoint.createdAt,
        projectPath: result.checkpoint.projectPath,
        status: result.checkpoint.status,
        paths: result.checkpoint.files.map(file => file.path),
      } } : {}),
    };
  });
  ipcMain.handle('rk:agent:redo-checkpoint', async (_e, sessionId: string, checkpointId: string): Promise<AgentCheckpointActionResult> => {
    const permission = canMutateAgentWorkspace();
    if (!permission.ok) return { ok: false, message: permission.error ?? 'Akses workspace ditolak.' };
    const projectPath = store.get().projectPath!;
    const result = await redoAgentCheckpoint(app.getPath('userData'), sessionId, projectPath, checkpointId);
    if (result.ok) send('rk:project-files-changed', { changedAt: Date.now() });
    return {
      ok: result.ok,
      message: result.message,
      ...(result.checkpoint ? { checkpoint: {
        id: result.checkpoint.id,
        runId: result.checkpoint.runId,
        createdAt: result.checkpoint.createdAt,
        projectPath: result.checkpoint.projectPath,
        status: result.checkpoint.status,
        paths: result.checkpoint.files.map(file => file.path),
      } } : {}),
    };
  });
  ipcMain.handle('rk:agent:list-models', async () => {
    const config = getRouterConfig();
    if (!config) return { ok: false, message: 'API key belum diatur.', models: [] };
    return listAvailableModels(config);
  });
  ipcMain.handle('rk:agent:select-model', (_e, model: string) => saveSelectedAgentModel(model));
  ipcMain.handle('rk:agent:diagnose-model', async () => {
    const provider = getSelectedAgentProvider();
    const selected = getSelectedAgentModel(provider);
    const config = getProviderConfig(provider, true)!;
    return diagnoseModelCapabilities(config, selected);
  });
  ipcMain.handle('rk:agent:list-skills', () => agentService.listSkills());
  ipcMain.handle('rk:agent:list-installed-skills', () => listInstalledAgentSkills(app.getPath('userData')));
  ipcMain.handle('rk:agent:import-skill', async () => {
    try {
      const selected = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Agent Skill Markdown', extensions: ['md', 'markdown'] }],
        title: 'Pilih file SKILL.md untuk diimpor',
      });
      if (selected.canceled || selected.filePaths.length === 0) return { ok: false, cancelled: true };
      return await importAgentSkill(app.getPath('userData'), selected.filePaths[0]);
    } catch (error) {
      return { ok: false, error: (error as Error).message || 'Skill gagal diimpor.' };
    }
  });
  ipcMain.handle('rk:agent:uninstall-skill', async (_e, id: string) => {
    try {
      return await uninstallAgentSkill(app.getPath('userData'), id);
    } catch (error) {
      return { ok: false, error: (error as Error).message || 'Skill gagal dihapus.' };
    }
  });
  ipcMain.handle('rk:agent:list-mcp-plugins', () => listMcpPlugins(app.getPath('userData')));
  ipcMain.handle('rk:agent:import-mcp-config', async () => {
    try {
      const selected = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Konfigurasi MCP JSON', extensions: ['json'] }],
        title: 'Pilih konfigurasi MCP',
        message: 'Impor konfigurasi server MCP lokal. Periksa command dan izin server sebelum mengaktifkannya.',
      });
      if (selected.canceled || selected.filePaths.length === 0) return { ok: false, cancelled: true };
      return await importMcpPluginConfig(app.getPath('userData'), selected.filePaths[0]);
    } catch (error) {
      return { ok: false, error: (error as Error).message || 'Konfigurasi MCP gagal diimpor.' };
    }
  });
  ipcMain.handle('rk:agent:set-mcp-plugin-enabled', async (_e, id: string, enabled: boolean) => {
    try { return await setMcpPluginEnabled(app.getPath('userData'), id, enabled); }
    catch (error) { return { ok: false, error: (error as Error).message || 'Status MCP plugin gagal diubah.' }; }
  });
  ipcMain.handle('rk:agent:remove-mcp-plugin', async (_e, id: string) => {
    try { return await removeMcpPlugin(app.getPath('userData'), id); }
    catch (error) { return { ok: false, error: (error as Error).message || 'MCP plugin gagal dihapus.' }; }
  });
  ipcMain.handle('rk:agent:probe-mcp-plugin', async (_e, id: string) => {
    try { return await probeMcpPlugin(app.getPath('userData'), id); }
    catch (error) { return { ok: false, error: (error as Error).message || 'Tes koneksi MCP gagal.', tools: [] }; }
  });
  ipcMain.handle('rk:agent:pick-attachments', async () => {
    try {
      const selected = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Lampiran AI', extensions: [
          'png','jpg','jpeg','webp','gif','pdf','docx','xlsx','pptx','txt','md','markdown','csv','tsv','json','jsonl',
          'xml','html','htm','css','js','jsx','ts','tsx','mjs','cjs','py','php','sql','yaml','yml','log','ini','toml','sh','ps1'
        ] }],
      });
      if (selected.canceled || selected.filePaths.length === 0) return { ok: true, attachments: [] };
      return { ok: true, attachments: await agentService.prepareAttachments(selected.filePaths) };
    } catch (error) {
      return { ok: false, error: (error as Error).message || 'Lampiran gagal diproses.' };
    }
  });
  ipcMain.handle('rk:agent:begin-session', async (_e, conversationId: string) => {
    try {
      await agentService.beginConversation(conversationId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message || 'Gagal membuat sesi AI.' };
    }
  });
  ipcMain.handle('rk:agent:start-chat', async (_e, agentId: string, messages: ChatMessage[] = [], activePath: string | null = null, conversationId: string = '') => {
    const projectPath = store.get().projectPath;
    try {
      if (!projectPath) return { ok: false, error: 'Belum ada folder project aktif di ruangan.' };
      if (store.get().role !== 'none' && store.get().queue.holder !== settings.selfId) {
        return { ok: false, error: 'AI Coding Agent hanya bisa mulai saat kamu memegang giliran kerja. Masuk antrian terlebih dahulu.' };
      }
      const sessionId = await agentService.startChat(agentId, projectPath, (event, eventSessionId) => {
        emitAgentSessionEvent(event, eventSessionId);
      }, messages, activePath, conversationId);
      return { ok: true, sessionId };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  ipcMain.handle('rk:agent:start-cli', async (_e, agentId: string, cols: number, rows: number) => {
    const state = store.get();
    const projectPath = state.projectPath;
    if (!projectPath) return { ok: false, error: 'Belum ada folder project.' };
    if (state.role !== 'none' && state.queue.holder !== settings.selfId) {
      return { ok: false, error: 'Agent CLI hanya bisa dimulai saat kamu memegang giliran kerja.' };
    }
    try {
      const sessionId = await agentService.startCli(agentId, projectPath, cols, rows, (event, eventSessionId) => {
        emitAgentSessionEvent(event, eventSessionId);
      });
      return { ok: true, sessionId };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  ipcMain.handle('rk:agent:approve-tool', (_e, sessionId: string, requestId: string, approved: boolean) =>
    agentService.approveTool(sessionId, requestId, approved));
  ipcMain.handle('rk:agent:answer-question', (_e, sessionId: string, requestId: string, answer: string) =>
    agentService.answerQuestion(sessionId, requestId, answer));
  ipcMain.handle('rk:agent:send-input', (_e, sessionId: string, data: string) => agentService.sendInput(sessionId, data));
  ipcMain.handle('rk:agent:resize', (_e, sessionId: string, cols: number, rows: number) => agentService.resizeTerminal(sessionId, cols, rows));
  ipcMain.handle('rk:agent:stop', (_e, sessionId: string) => agentService.stopAgent(sessionId));
}

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 680,
    title: 'Ruang Kerja',
    backgroundColor: '#0b0f17',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });
  // Treat the embedded browser as untrusted remote content. Do not allow a
  // page to smuggle a preload, enable Node integration, or start on an unsafe URL.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    let target: URL;
    try {
      target = new URL(params.src);
    } catch {
      event.preventDefault();
      return;
    }
    if ((target.protocol !== 'http:' && target.protocol !== 'https:') || target.username || target.password) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
  });

  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return;
    // The workspace is designed as a full desktop workspace, not a half-sized utility window.
    if (!win.isMaximized()) win.maximize();
    win.show();
  });
  let ideLayoutTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleIdeLayout = (): void => {
    if (ideLayoutTimer) clearTimeout(ideLayoutTimer);
    ideLayoutTimer = setTimeout(() => {
      ideLayoutTimer = null;
      if (win && !win.isDestroyed() && store.get().ideMode) {
        void resizeEmbeddedIde(win);
      }
    }, 90);
    ideLayoutTimer.unref?.();
  };
  const restoreIdeFocus = (): void => {
    const current = win;
    if (!current || current.isDestroyed() || !store.get().ideMode) return;
    void resizeEmbeddedIde(current).finally(() => {
      if (win === current && !current.isDestroyed() && store.get().ideMode) {
        void focusEmbeddedIde(current);
      }
    });
  };

  win.on('resize', scheduleIdeLayout);
  win.on('maximize', scheduleIdeLayout);
  win.on('unmaximize', scheduleIdeLayout);
  win.on('restore', scheduleIdeLayout);
  win.on('close', (e) => {
    // Klik X / Alt+F4: sembunyikan ke tray, jangan keluar.
    // Kecuali kalau app benar-benar mau quit (via tray menu "Keluar").
    if (isQuitting) return;
    e.preventDefault();
    win?.hide();
  });
  win.on('focus', () => {
    win?.setOpacity(1);
    if (store.get().ideMode) {
      const focusTimer = setTimeout(restoreIdeFocus, 120);
      focusTimer.unref?.();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if ((target.protocol === 'http:' || target.protocol === 'https:') &&
          !target.username && !target.password) {
        void shell.openExternal(target.toString()).catch(() => undefined);
      }
    } catch {
      // Invalid or non-web schemes are intentionally denied.
    }
    return { action: 'deny' };
  });
  await win.loadFile(join(__dirname, '../renderer/index.html'));

  // Tray: klik kiri ganti visible, klik kanan menu.
  tray = new Tray(join(__dirname, '../renderer/icon.png'));
  tray.setToolTip('Ruang Kerja');
  tray.on('click', () => {
    if (win && win.isVisible()) {
      win.hide();
    } else {
      win?.show();
      win?.focus();
    }
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Buka',
        click: () => {
          win?.show();
          win?.focus();
        },
      },
      {
        label: 'Cek Pembaruan',
        click: () => checkForUpdates(),
      },
      { type: 'separator' },
      {
        label: 'Keluar',
        click: () => {
          isQuitting = true;
          void shutdownRoom().finally(() => app.quit());
        },
      },
    ]),
  );
}

app.whenReady().then(async () => {
  registerIpc();
  store.onChange((state) => send('rk:state', state));
  await createWindow();
  void scanIdesAndUpdate();
  checkForUpdates();
  setInterval(() => checkForUpdates(), 30 * 60 * 1000).unref?.();
});

app.on('window-all-closed', () => {
  // Di Windows, jendela hanya disembunyikan ke tray (bukan keluar).
  if (process.platform !== 'win32') {
    void shutdownRoom().finally(() => app.quit());
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopAdvertise();
  editorDebugger.dispose();
  editorTerminals.disposeAll();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
}
