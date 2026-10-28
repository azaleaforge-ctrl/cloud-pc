import { contextBridge, ipcRenderer } from 'electron';
import type {
  ActionResult,
  AppState,
  CreateRoomInput,
  FetchReleasesResult,
  IdeInfo,
  JoinRoomInput,
  NotifyPayload,
  ProjectFile,
  RkApi,
  ServerLogLine,
} from '../shared/types';
import type {
  DebugEvent,
  EditorApi,
  EditorFileData,
  EditorFileEntry,
  EditorOpResult,
  EditorSearchHit,
  EditorWriteResult,
  InstallExtensionResult,
  InstalledExtension,
  TerminalCreateOptions,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionInfo,
  VsxSearchResult,
} from '../shared/editor';
import type { AgentEntry, ChatMessage, AgentEvent } from '../shared/agents';
import { APP_VERSION } from '../shared/types';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const editor: EditorApi = {
  listDir: (path: string): Promise<EditorFileEntry[]> => ipcRenderer.invoke('rk:editor:list-dir', path),
  readFile: (path: string): Promise<EditorFileData> => ipcRenderer.invoke('rk:editor:read-file', path),
  writeFile: (path: string, content: string): Promise<EditorWriteResult> => ipcRenderer.invoke('rk:editor:write-file', path, content),
  createFile: (path: string): Promise<EditorOpResult> => ipcRenderer.invoke('rk:editor:create-file', path),
  createFolder: (path: string): Promise<EditorOpResult> => ipcRenderer.invoke('rk:editor:create-folder', path),
  renamePath: (from: string, to: string): Promise<EditorOpResult> => ipcRenderer.invoke('rk:editor:rename', from, to),
  deletePath: (path: string): Promise<EditorOpResult> => ipcRenderer.invoke('rk:editor:delete', path),
  search: (query: string, opts): Promise<EditorSearchHit[]> => ipcRenderer.invoke('rk:editor:search', query, opts),
  createTerminal: (opts?: TerminalCreateOptions): Promise<TerminalSessionInfo> => ipcRenderer.invoke('rk:editor:term-create', opts),
  writeTerminal: (id: string, data: string): Promise<void> => ipcRenderer.invoke('rk:editor:term-write', id, data),
  resizeTerminal: (id: string, cols: number, rows: number): Promise<void> => ipcRenderer.invoke('rk:editor:term-resize', id, cols, rows),
  killTerminal: (id: string): Promise<void> => ipcRenderer.invoke('rk:editor:term-kill', id),
  listTerminals: (): Promise<TerminalSessionInfo[]> => ipcRenderer.invoke('rk:editor:term-list'),
  onTerminalData: (cb: (event: TerminalDataEvent) => void) => subscribe<TerminalDataEvent>('rk:editor:term-data', cb),
  onTerminalExit: (cb: (event: TerminalExitEvent) => void) => subscribe<TerminalExitEvent>('rk:editor:term-exit', cb),
  searchExtensions: (query: string, offset?: number): Promise<VsxSearchResult> => ipcRenderer.invoke('rk:editor:ext-search', query, offset),
  listExtensions: (): Promise<InstalledExtension[]> => ipcRenderer.invoke('rk:editor:ext-list'),
  installExtension: (id: string, version?: string): Promise<InstallExtensionResult> => ipcRenderer.invoke('rk:editor:ext-install', id, version),
  uninstallExtension: (id: string): Promise<EditorOpResult> => ipcRenderer.invoke('rk:editor:ext-uninstall', id),
  readExtensionFile: (path: string): Promise<string> => ipcRenderer.invoke('rk:editor:ext-read-file', path),
  debugStart: (entry: string): Promise<EditorOpResult> => ipcRenderer.invoke('rk:editor:debug-start', entry),
  debugStop: (): Promise<void> => ipcRenderer.invoke('rk:editor:debug-stop'),
  debugSetBreakpoints: (points): Promise<void> => ipcRenderer.invoke('rk:editor:debug-breakpoints', points),
  debugResume: (): Promise<void> => ipcRenderer.invoke('rk:editor:debug-resume'),
  debugPause: (): Promise<void> => ipcRenderer.invoke('rk:editor:debug-pause'),
  debugStep: (kind): Promise<void> => ipcRenderer.invoke('rk:editor:debug-step', kind),
  debugEvaluate: (expression: string) => ipcRenderer.invoke('rk:editor:debug-eval', expression),
  onDebugEvent: (cb: (event: DebugEvent) => void) => subscribe<DebugEvent>('rk:editor:debug-event', cb),
};

const api: RkApi = {
  version: APP_VERSION,
  editor,
  getState: () => ipcRenderer.invoke('rk:get-state'),
  pickFolder: () => ipcRenderer.invoke('rk:pick-folder'),
  createRoom: (input: CreateRoomInput) => ipcRenderer.invoke('rk:create-room', input),
  joinRoom: (input: JoinRoomInput) => ipcRenderer.invoke('rk:join-room', input),
  leaveRoom: () => ipcRenderer.invoke('rk:leave-room'),
  setMemberName: (name: string) => ipcRenderer.invoke('rk:set-member-name', name),
  takeTurn: () => ipcRenderer.invoke('rk:take-turn'),
  releaseTurn: () => ipcRenderer.invoke('rk:release-turn'),
  requestTurn: () => ipcRenderer.invoke('rk:request-turn'),
  scanIdes: (): Promise<IdeInfo[]> => ipcRenderer.invoke('rk:scan-ides'),
  openIde: (ideId: string) => ipcRenderer.invoke('rk:open-ide', ideId),
  closeIde: () => ipcRenderer.invoke('rk:close-ide'),
  approveQueue: (requesterId: string) => ipcRenderer.invoke('rk:approve-queue', requesterId),
  deferQueue: (requesterId: string) => ipcRenderer.invoke('rk:defer-queue', requesterId),
  reportActivity: (source?: string) => ipcRenderer.invoke('rk:report-activity', source),
  rescanFramework: () => ipcRenderer.invoke('rk:rescan-framework'),
  startServer: () => ipcRenderer.invoke('rk:start-server'),
  stopServer: () => ipcRenderer.invoke('rk:stop-server'),
  checkForUpdates: () => ipcRenderer.invoke('rk:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('rk:download-update'),
  installUpdate: () => ipcRenderer.invoke('rk:install-update'),
  fetchReleaseNotes: (forceRefresh = false) => ipcRenderer.invoke('rk:fetch-release-notes', forceRefresh),
  listProjectFiles: (): Promise<ProjectFile[]> => ipcRenderer.invoke('rk:list-project-files'),
  onProjectFilesChanged: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('rk:project-files-changed', listener);
    return () => ipcRenderer.removeListener('rk:project-files-changed', listener);
  },
  onState: (cb: (state: AppState) => void) => {
    const listener = (_e: unknown, state: AppState) => cb(state);
    ipcRenderer.on('rk:state', listener);
    return () => ipcRenderer.removeListener('rk:state', listener);
  },
  onNotify: (cb: (payload: NotifyPayload) => void) => {
    const listener = (_e: unknown, payload: NotifyPayload) => cb(payload);
    ipcRenderer.on('rk:notify', listener);
    return () => ipcRenderer.removeListener('rk:notify', listener);
  },
  onServerLog: (cb: (payload: ServerLogLine) => void) => {
    const listener = (_e: unknown, payload: ServerLogLine) => cb(payload);
    ipcRenderer.on('rk:server-log', listener);
    return () => ipcRenderer.removeListener('rk:server-log', listener);
  },

  // --- AI Agent ---
  agentList: (): Promise<AgentEntry[]> => ipcRenderer.invoke('rk:agent:list'),
  agentGetConfig: () => ipcRenderer.invoke('rk:agent:get-config'),
  agentSaveConfig: (apiKey: string) => ipcRenderer.invoke('rk:agent:save-config', apiKey),
  agentTestConfig: () => ipcRenderer.invoke('rk:agent:test-config'),
  agentApproveTool: (sessionId: string, requestId: string, approved: boolean) => ipcRenderer.invoke('rk:agent:approve-tool', sessionId, requestId, approved),
  agentStartChat: (agentId: string, messages?: ChatMessage[], activePath?: string | null) => ipcRenderer.invoke('rk:agent:start-chat', agentId, messages ?? [], activePath ?? null),
  agentStartCli: (agentId: string, cols: number, rows: number) => ipcRenderer.invoke('rk:agent:start-cli', agentId, cols, rows),
  agentSendInput: (sessionId: string, data: string) => ipcRenderer.invoke('rk:agent:send-input', sessionId, data),
  agentResize: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('rk:agent:resize', sessionId, cols, rows),
  agentStop: (sessionId: string) => ipcRenderer.invoke('rk:agent:stop', sessionId),
  onAgentEvent: (cb: (payload: { sessionId: string; event: AgentEvent }) => void) => {
    const listener = (_e: unknown, payload: { sessionId: string; event: AgentEvent }) => cb(payload);
    ipcRenderer.on('rk:agent:event', listener);
    return () => ipcRenderer.removeListener('rk:agent:event', listener);
  },
};

contextBridge.exposeInMainWorld('rk', api);
