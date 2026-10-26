import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell } from 'electron';
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
  ServerState,
  UpdateState,
} from '../shared/types';
import { APP_VERSION } from '../shared/types';
import { StateStore } from './store';
import { detectFramework } from './frameworkDetect';
import { detectIdes } from './ideDetect';
import { findRoom, getLanIp, startAdvertise, stopAdvertise } from './discovery';
import { createHostRoom, type HostRoom } from './hostRoom';
import { joinAsMember, type MemberRoom } from './memberRoom';
import { startDevServer, type DevServerHandle } from './devServer';
import { scanFiles } from './fsScan';
import { openEmbeddedIde, closeEmbeddedIde, resizeEmbeddedIde } from './nativeHost';
import { startActivityMonitor } from './activityMonitor';

let updateState: UpdateState = { status: 'idle', version: null, progress: null, error: null, transferred: 0, total: 0, bytesPerSecond: 0 };
let updateCheckPromise: Promise<void> | null = null;
let lastProgressEmitAt = 0;
let updateInstallRequested = false;

function emitUpdateState(state: UpdateState): void {
  updateState = state;
  store.patch({ update: state });
}

autoUpdater.autoDownload = true;
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
    };
  } catch {
    return { selfId: randomUUID(), selfName: 'Saya' };
  }
}

function saveSettings(settings: Settings): void {
  mkdirSync(dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

const settings = loadSettings();
saveSettings(settings);

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
  queue: { holder: null, queue: [], holderLastActivity: null, holderActivitySource: null },
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
let hostRoom: HostRoom | null = null;
let memberRoom: MemberRoom | null = null;
let devServer: DevServerHandle | null = null;
let framework: FrameworkInfo | null = null;
let stopActivityMonitor: (() => void) | null = null;

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
    queue: { holder: null, queue: [] },
    framework: null,
    server: { status: 'idle', url: null, port: null, logs: [] },
    sync: { status: 'off', files: 0, lastSync: null },
    projectFiles: [],
    update: { status: 'idle', version: null, progress: null, error: null },
    queueNotice: null,
    ideMode: false,
    activeIdeId: null,
  });
  framework = null;
}

async function shutdownRoom(): Promise<void> {
  stopActivityMonitor?.();
  stopActivityMonitor = null;
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
      queue: { holder: settings.selfId, queue: [], holderLastActivity: Date.now(), holderActivitySource: 'room-start' },
      lanAddress: getLanIp(),
    });
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
    if (devServer) return { ok: false, error: 'Server sudah berjalan.' };
    devServer = await startDevServer({
      framework,
      cwd: state.projectPath,
      onLog: pushServerLog,
      onState: applyServerState,
    });
    return { ok: true };
  } catch (err) {
    devServer = null;
    applyServerState({ ...store.get().server, status: 'error', error: (err as Error).message });
    return { ok: false, error: (err as Error).message };
  }
}

async function handleStopServer(): Promise<ActionResult> {
  if (!devServer) return { ok: false, error: 'Server tidak sedang berjalan.' };
  await devServer.stop();
  devServer = null;
  applyServerState({ ...store.get().server, status: 'stopped', url: null, port: null });
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
  ipcMain.handle('rk:scan-ides', () => scanIdesAndUpdate());
  ipcMain.handle('rk:open-ide', async (_e, ideId: string) => {
    const state = store.get();
    const ide = state.ides.find((item) => item.id === ideId);
    if (!ide) return { ok: false, error: 'IDE tidak ditemukan, coba rescan.' };
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
      return { ok: true, error: 'Auto-update tidak berjalan di mode development.' };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  ipcMain.handle('rk:install-update', async () => {
    try {
      if (updateState.status === 'downloaded') {
        setImmediate(() => autoUpdater.quitAndInstall());
        return { ok: true };
      }
      if (updateState.status === 'available' || updateState.status === 'downloading') {
        await autoUpdater.downloadUpdate();
        return { ok: true };
      }
      if (updateState.status === 'latest' || updateState.status === 'idle') {
        return { ok: false, error: 'Tidak ada pembaruan untuk dipasang.' };
      }
      return { ok: false, error: 'Status pembaruan tidak dikenali.' };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  ipcMain.handle('rk:fetch-release-notes', async () => {
    try {
      const owner = 'azaleaforge-ctrl';
      const repo = 'cloud-pc';
      const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=20`;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Ruang-Kerja-Updater',
      };
      const token = process.env.GH_TOKEN;
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const releases = await res.json();
      return {
        ok: true,
        releases: releases.map((r: any) => ({
          tag: r.tag_name,
          name: r.name,
          body: r.body,
          published_at: r.published_at,
          prerelease: r.prerelease,
          draft: r.draft,
        })),
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  ipcMain.handle('rk:list-project-files', async () => {
    const state = store.get();
    if (!state.projectPath) return [];
    try {
      const files = await scanFiles(state.projectPath);
      return files.map((f) => ({
        path: f.path,
        size: f.size,
        mtime: f.mtime,
        modified: new Date(f.mtime * 1000).toISOString(),
      }));
    } catch {
      return [];
    }
  });
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
  win.once('ready-to-show', () => win?.show());
  win.on('resize', () => {
    void resizeEmbeddedIde(win!);
  });
  win.on('close', (e) => {
    // Klik X / Alt+F4: sembunyikan ke tray, jangan keluar.
    e.preventDefault();
    win?.hide();
  });
  win.on('focus', () => {
    win?.setOpacity(1);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
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
  stopAdvertise();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
