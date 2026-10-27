// Kontrak UI internal IDE. Dimiliki bersama oleh chrome (EditorShell) dan pane
// berat (Monaco/Terminal). Jangan ubah tanpa menyamakan kedua sisi.
import type { DebugPausedFrame, DebugStatus, EditorFileEntry, InstalledExtension, TerminalSessionInfo, VsxExtension } from '../../../shared/editor';

export type SideView = 'explorer' | 'search' | 'extensions';

export type PanelView = 'terminal' | 'problems' | 'output' | 'debug';

export interface ProblemItem {
  path: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source?: string;
}

export interface OpenBuffer {
  path: string;
  name: string;
  language: string;
  dirty: boolean;
}

export interface OutputChannel {
  id: string;
  label: string;
  lines: string[];
}

export interface CursorInfo {
  line: number;
  column: number;
  selected: number;
}

export interface RevealRequest {
  path: string;
  line: number;
  column: number;
  /** Berubah setiap permintaan agar pane bisa mendeduplikasi. */
  token: number;
}

export interface DebugViewState {
  status: DebugStatus;
  frames: DebugPausedFrame[];
  pausedAt: { path: string; line: number } | null;
  lines: string[];
  error: string | null;
}

/** State + aksi IDE yang dipakai chrome. Diimplementasikan oleh useIdeWorkbench. */
export interface IdeWorkbench {
  root: string | null;
  error: string | null;
  clearError(): void;

  tree: Record<string, EditorFileEntry[]>;
  expanded: Record<string, boolean>;
  toggleDir(path: string): void;
  refreshDir(path?: string): void;

  openFiles: OpenBuffer[];
  activePath: string | null;
  content: string;
  activeDirty: boolean;
  openFile(path: string, options?: { line?: number; column?: number }): void;
  activateFile(path: string): void;
  closeFile(path: string): void;
  changeContent(value: string): void;
  save(): Promise<void>;
  saveAll(): Promise<void>;

  cursor: CursorInfo;
  setCursor(info: CursorInfo): void;
  reveal: RevealRequest | null;

  problems: ProblemItem[];
  reportMarkers(path: string, problems: ProblemItem[]): void;

  /** Breakpoint debug per path absolut -> daftar baris (1-based). */
  breakpoints: Record<string, number[]>;
  toggleBreakpoint(path: string, line: number): void;

  terminals: TerminalSessionInfo[];
  activeTerminal: string | null;
  newTerminal(): Promise<void>;
  selectTerminal(id: string): void;
  closeTerminal(id: string): void;

  outputs: OutputChannel[];
  appendOutput(channelId: string, text: string): void;
  clearOutput(channelId: string): void;

  installed: InstalledExtension[];
  extensionResults: VsxExtension[];
  extensionQuery: string;
  extensionBusy: boolean;
  setExtensionQuery(query: string): void;
  refreshInstalled(): Promise<void>;
  installExtension(id: string): Promise<void>;
  uninstallExtension(id: string): Promise<void>;

  debug: DebugViewState;
  startDebug(): Promise<void>;
  stopDebug(): Promise<void>;
  resumeDebug(): Promise<void>;
  pauseDebug(): Promise<void>;
  stepDebug(kind: 'over' | 'into' | 'out'): Promise<void>;
  evaluateDebug(expression: string): Promise<void>;

  /** Nama tema Monaco aktif (mis. 'rk-dark' atau 'vs-dark'). */
  monacoTheme: string;
  setMonacoTheme(theme: string): void;
  /** Tema ekstensi yang sudah diunduh dan siap dipakai. */
  availableThemes: Array<{ id: string; label: string }>;
}
