// Kontrak IDE bawaan Ruang Kerja (editor, terminal, ekstensi, debugger).
// Dipakai bersama oleh proses main, preload, dan renderer.
//
// Aturan path: semua path file adalah ABSOLUT. Proses main menolak path yang
// berada di luar folder project aktif (kecuali file ekstensi di data dir).

export interface EditorOpResult {
  ok: boolean;
  error?: string;
}

export interface EditorFileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  /** Milidetik sejak epoch. */
  mtime: number;
}

export interface EditorFileData {
  path: string;
  content: string;
  mtime: number;
  /** true bila file dipotong karena melebihi batas baca. */
  truncated: boolean;
  /** true bila file terdeteksi biner dan tidak boleh dibuka di editor teks. */
  binary: boolean;
}

export interface EditorSearchHit {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface EditorWriteResult extends EditorOpResult {
  mtime: number;
}

export interface TerminalSessionInfo {
  id: string;
  title: string;
  shell: string;
}

export interface TerminalCreateOptions {
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
}

export interface TerminalExitEvent {
  id: string;
  code: number;
}

export interface VsxExtension {
  /** `namespace.name` */
  id: string;
  namespace: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  downloadCount: number;
  rating: number | null;
  iconUrl: string | null;
  publisher: string | null;
}

export interface VsxSearchResult {
  total: number;
  items: VsxExtension[];
}

export interface EditorThemeContribution {
  id: string;
  label: string;
  uiTheme: 'vs' | 'vs-dark' | 'hc-black' | null;
  /** Path absolut ke file tema JSON di dalam ekstensi. */
  file: string;
}

export interface EditorSnippetContribution {
  id: string;
  label: string;
  language: string;
  /** Path absolut ke file snippet JSON di dalam ekstensi. */
  file: string;
}

export interface InstalledExtension {
  id: string;
  version: string;
  displayName: string;
  publisher: string | null;
  description: string;
  themes: EditorThemeContribution[];
  snippets: EditorSnippetContribution[];
  /** Jumlah kontribusi lain yang belum didukung (mis. bahasa/LSP). */
  unsupportedContributions: number;
}

export interface InstallExtensionResult extends EditorOpResult {
  extension?: InstalledExtension;
}

export type DebugStatus = 'idle' | 'starting' | 'running' | 'paused' | 'stopped' | 'error';

export interface DebugPausedFrame {
  id: number;
  name: string;
  file: string | null;
  line: number;
}

export type DebugEvent =
  | { type: 'status'; status: DebugStatus; error?: string | null }
  | { type: 'paused'; reason: string; file: string | null; line: number; frames: DebugPausedFrame[] }
  | { type: 'resumed' }
  | { type: 'console'; level: 'log' | 'info' | 'warn' | 'error'; text: string }
  | { type: 'output'; text: string }
  | { type: 'exited'; code: number | null };

export interface DebugEvaluateResult extends EditorOpResult {
  result?: string;
  type?: string;
}

export interface EditorApi {
  listDir(path: string): Promise<EditorFileEntry[]>;
  readFile(path: string): Promise<EditorFileData>;
  writeFile(path: string, content: string): Promise<EditorWriteResult>;
  createFile(path: string): Promise<EditorOpResult>;
  createFolder(path: string): Promise<EditorOpResult>;
  renamePath(from: string, to: string): Promise<EditorOpResult>;
  deletePath(path: string): Promise<EditorOpResult>;
  search(query: string, opts?: { caseSensitive?: boolean; maxResults?: number }): Promise<EditorSearchHit[]>;

  createTerminal(opts?: TerminalCreateOptions): Promise<TerminalSessionInfo>;
  writeTerminal(id: string, data: string): Promise<void>;
  resizeTerminal(id: string, cols: number, rows: number): Promise<void>;
  killTerminal(id: string): Promise<void>;
  listTerminals(): Promise<TerminalSessionInfo[]>;
  onTerminalData(cb: (event: TerminalDataEvent) => void): () => void;
  onTerminalExit(cb: (event: TerminalExitEvent) => void): () => void;

  searchExtensions(query: string, offset?: number): Promise<VsxSearchResult>;
  listExtensions(): Promise<InstalledExtension[]>;
  installExtension(id: string, version?: string): Promise<InstallExtensionResult>;
  uninstallExtension(id: string): Promise<EditorOpResult>;
  readExtensionFile(path: string): Promise<string>;

  debugStart(entry: string): Promise<EditorOpResult>;
  debugStop(): Promise<void>;
  debugSetBreakpoints(points: Array<{ path: string; line: number }>): Promise<void>;
  debugResume(): Promise<void>;
  debugPause(): Promise<void>;
  debugStep(kind: 'over' | 'into' | 'out'): Promise<void>;
  debugEvaluate(expression: string): Promise<DebugEvaluateResult>;
  onDebugEvent(cb: (event: DebugEvent) => void): () => void;
}

/** Batas ukuran file yang bisa dibuka di editor teks. */
export const EDITOR_MAX_FILE_BYTES = 4 * 1024 * 1024;
