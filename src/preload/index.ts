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
import { APP_VERSION } from '../shared/types';

const api: RkApi = {
  version: APP_VERSION,
  getState: () => ipcRenderer.invoke('rk:get-state'),
  pickFolder: () => ipcRenderer.invoke('rk:pick-folder'),
  createRoom: (input: CreateRoomInput) => ipcRenderer.invoke('rk:create-room', input),
  joinRoom: (input: JoinRoomInput) => ipcRenderer.invoke('rk:join-room', input),
  leaveRoom: () => ipcRenderer.invoke('rk:leave-room'),
  setMemberName: (name: string) => ipcRenderer.invoke('rk:set-member-name', name),
  takeTurn: () => ipcRenderer.invoke('rk:take-turn'),
  releaseTurn: () => ipcRenderer.invoke('rk:release-turn'),
  scanIdes: (): Promise<IdeInfo[]> => ipcRenderer.invoke('rk:scan-ides'),
  openIde: (ideId: string) => ipcRenderer.invoke('rk:open-ide', ideId),
  rescanFramework: () => ipcRenderer.invoke('rk:rescan-framework'),
  startServer: () => ipcRenderer.invoke('rk:start-server'),
  stopServer: () => ipcRenderer.invoke('rk:stop-server'),
  checkForUpdates: () => ipcRenderer.invoke('rk:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('rk:install-update'),
  fetchReleaseNotes: () => ipcRenderer.invoke('rk:fetch-release-notes'),
  listProjectFiles: (): Promise<ProjectFile[]> => ipcRenderer.invoke('rk:list-project-files'),
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
};

contextBridge.exposeInMainWorld('rk', api);
