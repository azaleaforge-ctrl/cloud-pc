// Kontrak bersama antara proses main, preload, dan renderer.
// Semua tipe di file ini adalah satu-satunya sumber kebenaran untuk IPC.

export type Role = 'none' | 'host' | 'member';

export type MemberStatus = 'working' | 'queued' | 'idle' | 'offline';

export interface Member {
  id: string;
  name: string;
  isHost: boolean;
  status?: MemberStatus;
}

export interface QueueState {
  holder: string | null;
  queue: string[];
  holderLastActivity: number | null;
  holderActivitySource: string | null;
}

export type QueueNoticeMode = 'bar' | 'decision' | 'deferred';

export interface QueueNotice {
  mode: QueueNoticeMode;
  requesterId: string;
  requesterName: string;
  holderName: string;
  expiresAt: number | null;
  deferredUntil: number | null;
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
  /** URL that can be opened on this machine (localhost / local proxy). */
  url: string | null;
  /** Port advertised to room members (possibly a LAN proxy port). */
  port: number | null;
  /** Port the framework itself is listening on, before the optional LAN proxy. */
  targetPort?: number | null;
  /** True when Ruang Kerja has to expose a localhost-bound server through a proxy. */
  proxied?: boolean;
  logs: string[];
  error?: string | null;
}

export interface IdeInfo {
  id: string;
  name: string;
  /** Executable path; null if this catalog entry is not installed. */
  exe: string | null;
  /** Whether this IDE was found on the current Windows installation. */
  installed: boolean;
  /** Official vendor download page, when known. */
  downloadUrl?: string | null;
  /** Dari mana IDE ditemukan */
  source: 'registry' | 'folder' | 'path' | 'shortcut' | 'catalog';
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
  /** File-project real-time (host scan + perubahan sinkron) */
  projectFiles: ProjectFile[];
  /** Status update aplikasi real-time */
  update: UpdateState;
  /** Notifikasi antrean persisten: muncul di sisi holder/requester. */
  queueNotice: QueueNotice | null;
  /** IDE sedang ditanam ke jendela Ruang Kerja (Windows). */
  ideMode: boolean;
  activeIdeId: string | null;
}

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'latest' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  progress: number | null;
  error: string | null;
  /** Byte terunduh menurut event electron-updater. */
  transferred?: number;
  /** Total byte installer yang sedang diunduh. */
  total?: number;
  /** Kecepatan unduh aktual yang dilaporkan downloader, byte/detik. */
  bytesPerSecond?: number;
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

export interface ProjectFile {
  path: string;
  size: number;
  /** Filesystem modification timestamp in milliseconds since Unix epoch. */
  mtime: number;
  /** ISO string of last modification */
  modified: string;
  /** True when this entry represents a directory rather than a file. */
  isDirectory?: boolean;
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
  closeIde(): Promise<ActionResult>;
  approveQueue(requesterId: string): Promise<ActionResult>;
  deferQueue(requesterId: string): Promise<ActionResult>;
  reportActivity(source?: string): Promise<void>;
  rescanFramework(): Promise<FrameworkInfo | null>;
  startServer(): Promise<ActionResult>;
  stopServer(): Promise<ActionResult>;
  checkForUpdates(): Promise<ActionResult>;
  installUpdate(): Promise<ActionResult>;
  fetchReleaseNotes(): Promise<FetchReleasesResult>;
  listProjectFiles(): Promise<ProjectFile[]>;
  onState(cb: (state: AppState) => void): () => void;
  onNotify(cb: (payload: NotifyPayload) => void): () => void;
  onServerLog(cb: (payload: ServerLogLine) => void): () => void;
}

/** Payload mentah protokol WebSocket host <-> member. */
export type WireMessage =
  | { t: 'hello'; name: string; clientId: string }
  | { t: 'welcome'; selfId: string; code: string; roomName: string; hostName: string; members: Member[]; holder: string | null; queue: string[]; holderLastActivity: number | null; holderActivitySource: string | null; hostIp: string; server: ServerState }
  | { t: 'state'; members: Member[]; holder: string | null; queue: string[]; holderLastActivity: number | null; holderActivitySource: string | null; server: ServerState }
  | { t: 'tree-begin'; total: number }
  | { t: 'file'; path: string; b64: string; mtime: number }
  | { t: 'tree-end' }
  | { t: 'fs'; op: 'add' | 'change' | 'unlink'; path: string; b64?: string; mtime?: number; from?: string }
  | { t: 'error'; message: string }
  | { t: 'notify'; kind: NotifyPayload['kind']; message: string }
  | { t: 'turn-taken'; holder: string; name: string }
  | { t: 'turn-released'; holder: string | null; name?: string }
  | { t: 'queue-prompt'; requesterId: string; requesterName: string; holderName: string; expiresAt: number | null; mode: 'bar' | 'decision' }
  | { t: 'queue-deferred'; requesterId: string; requesterName: string; holderName: string; until: number }
  | { t: 'queue-approve'; requesterId: string }
  | { t: 'queue-defer'; requesterId: string }
  | { t: 'activity'; source: string }
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

export const APP_VERSION = '0.3.6';
