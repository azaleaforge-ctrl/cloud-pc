// Kontrak bersama antara proses main, preload, dan renderer.
// Semua tipe di file ini adalah satu-satunya sumber kebenaran untuk IPC.

export type Role = 'none' | 'host' | 'member';

export interface Member {
  id: string;
  name: string;
  isHost: boolean;
}

export interface QueueState {
  holder: string | null;
  queue: string[];
}

export interface FrameworkInfo {
  id: string;
  name: string;
  /** Perintah lengkap yang dijalankan, mis. "npm run dev" */
  command: string;
  /** Argumen perintah; bila kosong, command dipecah dengan shell */
  args: string[];
  /** Folder kerja = folder project */
  cwd: string;
  /** npm | pnpm | yarn | bun | composer | python | system */
  packageManager: string;
  detectedPort: number | null;
  notes?: string;
}

export type ServerStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

export interface ServerState {
  status: ServerStatus;
  url: string | null;
  port: number | null;
  logs: string[];
  error?: string | null;
}

export interface IdeInfo {
  id: string;
  name: string;
  exe: string;
  /** Dari mana IDE ditemukan */
  source: 'registry' | 'folder' | 'path';
}

export type SyncStatus = 'off' | 'syncing' | 'ready' | 'error';

export interface SyncState {
  status: SyncStatus;
  files: number;
  lastSync: number | null;
  message?: string;
}

export interface DiscoveredRoom {
  code: string;
  name: string;
  host: string;
  port: number;
}

export interface NotifyPayload {
  kind: 'info' | 'warn' | 'error' | 'turn';
  message: string;
}

export interface AppState {
  role: Role;
  code: string | null;
  roomName: string | null;
  selfId: string;
  selfName: string;
  /** Alamat IP host/LAN dari laptop ini */
  lanAddress: string | null;
  /** Alamat host saat menjadi member */
  hostAddress: string | null;
  /** Folder project master (host) / salinan lokal (member) */
  projectPath: string | null;
  members: Member[];
  queue: QueueState;
  framework: FrameworkInfo | null;
  server: ServerState;
  ides: IdeInfo[];
  /** true jika sedang scanning IDE */
  idesScanning: boolean;
  sync: SyncState;
  discovered: DiscoveredRoom[];
}

export interface CreateRoomInput {
  folder: string;
  roomName: string;
  memberName: string;
}

export interface JoinRoomInput {
  code: string;
  memberName: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface ServerLogLine {
  line: string;
}

export interface ReleaseInfo {
  tag: string;
  name: string | null;
  body: string | null;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
}

export interface FetchReleasesResult {
  ok: boolean;
  error?: string;
  releases?: ReleaseInfo[];
}

export interface RkApi {
  version: string;
  getState(): Promise<AppState>;
  pickFolder(): Promise<string | null>;
  createRoom(input: CreateRoomInput): Promise<ActionResult>;
  joinRoom(input: JoinRoomInput): Promise<ActionResult>;
  leaveRoom(): Promise<void>;
  setMemberName(name: string): Promise<void>;
  takeTurn(): Promise<ActionResult>;
  releaseTurn(): Promise<ActionResult>;
  scanIdes(): Promise<IdeInfo[]>;
  openIde(ideId: string): Promise<ActionResult>;
  rescanFramework(): Promise<FrameworkInfo | null>;
  startServer(): Promise<ActionResult>;
  stopServer(): Promise<ActionResult>;
  checkForUpdates(): Promise<ActionResult>;
  fetchReleaseNotes(): Promise<FetchReleasesResult>;
  onState(cb: (state: AppState) => void): () => void;
  onNotify(cb: (payload: NotifyPayload) => void): () => void;
  onServerLog(cb: (payload: ServerLogLine) => void): () => void;
}

/** Payload mentah protokol WebSocket host <-> member. */
export type WireMessage =
  | { t: 'hello'; name: string; clientId: string }
  | { t: 'welcome'; selfId: string; code: string; roomName: string; hostName: string; members: Member[]; holder: string | null; queue: string[]; hostIp: string; server: ServerState }
  | { t: 'state'; members: Member[]; holder: string | null; queue: string[]; server: ServerState }
  | { t: 'tree-begin'; total: number }
  | { t: 'file'; path: string; b64: string; mtime: number }
  | { t: 'tree-end' }
  | { t: 'fs'; op: 'add' | 'change' | 'unlink'; path: string; b64?: string; mtime?: number; from?: string }
  | { t: 'error'; message: string }
  | { t: 'notify'; kind: NotifyPayload['kind']; message: string }
  | { t: 'turn-taken'; holder: string; name: string }
  | { t: 'turn-released'; holder: string | null; name?: string }
  | { t: 'ping' }
  | { t: 'pong' };

export const IGNORED_DIRS = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  '.turbo',
  '.cache',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
  'release',
  '.DS_Store',
];

export const APP_VERSION = '0.1.0';
