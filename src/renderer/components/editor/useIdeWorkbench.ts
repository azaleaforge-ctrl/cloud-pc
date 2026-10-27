// State + aksi IDE bawaan Ruang Kerja.
//
// Semua panggilan IPC dibungkus try/catch dan bermuara ke `error`. Callback
// dibuat stabil (ref + setState fungsional) supaya chrome tidak render ulang
// berulang; `content` memang berubah setiap ketikan.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DebugEvent,
  EditorFileEntry,
  EditorSnippetContribution,
  InstalledExtension,
  TerminalDataEvent,
  TerminalSessionInfo,
  VsxExtension,
} from '../../../shared/editor';
import type {
  CursorInfo,
  DebugViewState,
  IdeWorkbench,
  OpenBuffer,
  OutputChannel,
  ProblemItem,
  RevealRequest,
} from './types';
import { DEFAULT_THEME, languageForPath } from './monaco';

const THEME_STORAGE_KEY = 'rk.ide.theme';
const MAX_OUTPUT_LINES = 2000;
const MAX_DEBUG_LINES = 500;
const ACTIVITY_THROTTLE_MS = 5000;
const FILE_EVENT_DEBOUNCE_MS = 250;

interface BufferState {
  content: string;
  dirty: boolean;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

function initialOutputs(): OutputChannel[] {
  return [
    { id: 'dev-server', label: 'Dev Server', lines: [] },
    { id: 'extensions', label: 'Ekstensi', lines: [] },
    { id: 'tasks', label: 'Tugas', lines: [] },
  ];
}

function pushLines(existing: string[], incoming: string[], max: number): string[] {
  if (incoming.length === 0) return existing;
  const next = existing.concat(incoming);
  return next.length > max ? next.slice(next.length - max) : next;
}

function linesOf(text: string): string[] {
  const parts = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  // Baris kosong terakhir hanya artefak newline.
  return parts[parts.length - 1] === '' ? parts.slice(0, -1) : parts;
}

function flattenBreakpoints(map: Record<string, number[]>): Array<{ path: string; line: number }> {
  return Object.entries(map).flatMap(([path, lines]) => lines.map((line) => ({ path, line })));
}

function readStoredTheme(): string {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

// ---- bus data terminal ----
// Hook tidak menyimpan isi terminal; event mentah diteruskan ke pane.

type TerminalDataListener = (event: TerminalDataEvent) => void;
const terminalDataListeners = new Set<TerminalDataListener>();
let terminalBridgeInstalled = false;

function installTerminalBridge(): void {
  if (terminalBridgeInstalled || !window.rk?.editor) return;
  terminalBridgeInstalled = true;
  window.rk.editor.onTerminalData((event) => {
    for (const listener of Array.from(terminalDataListeners)) {
      try {
        listener(event);
      } catch {
        // Satu pane bermasalah tidak boleh menghentikan pane lain.
      }
    }
  });
}

/** Berlangganan data terminal mentah (dipakai TerminalPane). */
export function onTerminalSessionData(cb: TerminalDataListener): () => void {
  installTerminalBridge();
  terminalDataListeners.add(cb);
  return () => {
    terminalDataListeners.delete(cb);
  };
}

const DEBUG_INITIAL: DebugViewState = { status: 'idle', frames: [], pausedAt: null, lines: [], error: null };

export function useIdeWorkbench(root: string | null): IdeWorkbench {
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<Record<string, EditorFileEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [buffers, setBuffers] = useState<Record<string, BufferState>>({});
  const [openOrder, setOpenOrder] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [cursor, setCursorState] = useState<CursorInfo>({ line: 1, column: 1, selected: 0 });
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const [markers, setMarkers] = useState<Record<string, ProblemItem[]>>({});
  const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>({});
  const [terminals, setTerminals] = useState<TerminalSessionInfo[]>([]);
  const [activeTerminal, setActiveTerminal] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<OutputChannel[]>(initialOutputs);
  const [installed, setInstalled] = useState<InstalledExtension[]>([]);
  const [extensionResults, setExtensionResults] = useState<VsxExtension[]>([]);
  const [extensionQuery, setExtensionQuery] = useState('');
  const [extensionBusy, setExtensionBusy] = useState(false);
  const [monacoTheme, setMonacoThemeState] = useState<string>(readStoredTheme);
  const [debug, setDebug] = useState<DebugViewState>(DEBUG_INITIAL);

  const latest = useRef({
    root, tree, expanded, buffers, openOrder, activePath, breakpoints, terminals, activeTerminal, installed,
  });
  latest.current = { root, tree, expanded, buffers, openOrder, activePath, breakpoints, terminals, activeTerminal, installed };

  const revealToken = useRef(0);
  const savedAt = useRef<Record<string, number>>({});
  const creatingTerminal = useRef(false);
  const lastActivity = useRef(0);
  const previousRoot = useRef<string | null>(root);

  // ---- aktivitas kolaborasi ----
  const reportActivity = useCallback((source: 'ui' | 'file' = 'ui') => {
    const now = Date.now();
    if (now - lastActivity.current < ACTIVITY_THROTTLE_MS) return;
    lastActivity.current = now;
    void window.rk.reportActivity(source).catch(() => undefined);
  }, []);

  // ---- explorer ----
  const loadDir = useCallback(async (path: string) => {
    try {
      const entries = await window.rk.editor.listDir(path);
      setTree((prev) => ({ ...prev, [path]: entries }));
    } catch (error) {
      setError(errorText(error, 'Gagal membaca folder ' + baseName(path)));
    }
  }, []);

  const refreshDirs = useCallback(async (dirs: string[]) => {
    for (const dir of Array.from(new Set(dirs))) {
      try {
        const entries = await window.rk.editor.listDir(dir);
        setTree((prev) => ({ ...prev, [dir]: entries }));
      } catch {
        // Folder bisa sudah dihapus/dipindah; biarkan isi lama.
      }
    }
  }, []);

  const toggleDir = useCallback((path: string) => {
    const nextOpen = !latest.current.expanded[path];
    setExpanded((prev) => ({ ...prev, [path]: nextOpen }));
    if (nextOpen && !latest.current.tree[path]) void loadDir(path);
  }, [loadDir]);

  const refreshDir = useCallback((path?: string) => {
    const currentRoot = latest.current.root;
    if (!currentRoot) return;
    const targets = path
      ? [path]
      : [currentRoot, ...Object.keys(latest.current.expanded).filter((dir) => latest.current.expanded[dir])];
    void refreshDirs(targets);
  }, [refreshDirs]);

  // ---- buffer ----
  const openFile = useCallback((path: string, options?: { line?: number; column?: number }) => {
    void (async () => {
      if (latest.current.activePath === path && !options?.line) return;
      if (!latest.current.buffers[path]) {
        try {
          const data = await window.rk.editor.readFile(path);
          if (data.binary) {
            setError('File biner tidak bisa dibuka di editor teks: ' + baseName(path));
            return;
          }
          if (data.truncated) {
            setError('File melebihi batas baca editor (4 MB), jadi tidak dibuka: ' + baseName(path));
            return;
          }
          setBuffers((prev) => ({ ...prev, [path]: { content: data.content, dirty: false } }));
          setOpenOrder((prev) => (prev.includes(path) ? prev : [...prev, path]));
        } catch (error) {
          setError(errorText(error, 'Gagal membuka ' + baseName(path)));
          return;
        }
      }
      setActivePath(path);
      if (options?.line) {
        const line = Math.max(1, options.line);
        const column = Math.max(1, options.column ?? 1);
        setCursorState({ line, column, selected: 0 });
        revealToken.current += 1;
        setReveal({ path, line, column, token: revealToken.current });
      } else {
        setCursorState({ line: 1, column: 1, selected: 0 });
      }
    })();
  }, []);

  const activateFile = useCallback((path: string) => {
    if (!latest.current.buffers[path]) {
      openFile(path);
      return;
    }
    setActivePath(path);
    setCursorState({ line: 1, column: 1, selected: 0 });
  }, [openFile]);

  const closeFile = useCallback((path: string) => {
    const order = latest.current.openOrder;
    setBuffers((prev) => {
      if (!prev[path]) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setOpenOrder((prev) => prev.filter((item) => item !== path));
    setMarkers((prev) => {
      if (!prev[path]) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
    delete savedAt.current[path];
    if (latest.current.activePath === path) {
      const index = order.indexOf(path);
      const next = order[index + 1] ?? order[index - 1] ?? null;
      setActivePath(next);
      setReveal(null);
      setCursorState({ line: 1, column: 1, selected: 0 });
    }
  }, []);

  const changeContent = useCallback((value: string) => {
    const path = latest.current.activePath;
    if (!path) return;
    setBuffers((prev) => (prev[path] ? { ...prev, [path]: { content: value, dirty: true } } : prev));
    // Tidak ada autosave: buffer tetap dirty sampai pengguna menyimpan.
    reportActivity();
  }, [reportActivity]);

  // ---- simpan ----
  const writePath = useCallback(async (path: string): Promise<boolean> => {
    const buffer = latest.current.buffers[path];
    if (!buffer) return false;
    const content = buffer.content;
    try {
      const result = await window.rk.editor.writeFile(path, content);
      if (!result.ok) {
        setError(result.error ?? 'Gagal menyimpan ' + baseName(path));
        return false;
      }
      savedAt.current[path] = Date.now();
      setBuffers((prev) => {
        const current = prev[path];
        if (!current) return prev;
        // Pengguna bisa mengetik selama penulisan berjalan: jangan bersihkan dirty bila isi berubah.
        return { ...prev, [path]: { content: current.content, dirty: current.content !== content } };
      });
      return true;
    } catch (error) {
      setError(errorText(error, 'Gagal menyimpan ' + baseName(path)));
      return false;
    }
  }, []);

  const save = useCallback(async () => {
    const path = latest.current.activePath;
    if (!path) return;
    if (await writePath(path)) reportActivity('file');
  }, [writePath, reportActivity]);

  const saveAll = useCallback(async () => {
    const dirty = Object.keys(latest.current.buffers).filter((path) => latest.current.buffers[path]?.dirty);
    for (const path of dirty) await writePath(path);
    if (dirty.length > 0) reportActivity('file');
  }, [writePath, reportActivity]);

  // ---- realtime: file berubah di disk / sync kolaborasi ----
  const reloadCleanBuffers = useCallback(async () => {
    const paths = Object.keys(latest.current.buffers).filter((path) => !latest.current.buffers[path]?.dirty);
    for (const path of paths) {
      // Lewati file yang baru saja kita tulis sendiri.
      if ((savedAt.current[path] ?? 0) > Date.now() - 800) continue;
      try {
        const data = await window.rk.editor.readFile(path);
        if (data.binary || data.truncated) continue;
        setBuffers((prev) => {
          const current = prev[path];
          // File dirty tidak boleh ditimpa.
          if (!current || current.dirty || current.content === data.content) return prev;
          return { ...prev, [path]: { content: data.content, dirty: false } };
        });
      } catch {
        // File bisa sementara tidak terbaca saat ditulis proses lain.
      }
    }
  }, []);

  // ---- problems ----
  const reportMarkers = useCallback((path: string, problems: ProblemItem[]) => {
    setMarkers((prev) => {
      const current = prev[path];
      if (current && current.length === problems.length) {
        const same = current.every((item, index) => {
          const next = problems[index];
          return next !== undefined && item.line === next.line && item.column === next.column
            && item.message === next.message && item.severity === next.severity;
        });
        if (same) return prev;
      }
      if (problems.length === 0) {
        if (!current) return prev;
        const next = { ...prev };
        delete next[path];
        return next;
      }
      return { ...prev, [path]: problems };
    });
  }, []);

  // ---- breakpoint ----
  const toggleBreakpoint = useCallback((path: string, line: number) => {
    const current = latest.current.breakpoints;
    const list = current[path] ?? [];
    const nextList = list.includes(line)
      ? list.filter((item) => item !== line)
      : [...list, line].sort((a, b) => a - b);
    const next = { ...current };
    if (nextList.length > 0) next[path] = nextList;
    else delete next[path];
    setBreakpoints(next);
    void window.rk.editor.debugSetBreakpoints(flattenBreakpoints(next))
      .catch((error) => setError(errorText(error, 'Gagal mengirim breakpoint ke debugger')));
  }, []);

  // ---- terminal ----
  const selectTerminal = useCallback((id: string) => {
    setActiveTerminal(id);
  }, []);

  const newTerminal = useCallback(async () => {
    // Cegah dua permintaan beruntun (StrictMode / klik ganda) membuat dua shell.
    if (creatingTerminal.current) return;
    creatingTerminal.current = true;
    try {
      const info = await window.rk.editor.createTerminal({ cwd: latest.current.root ?? undefined, cols: 120, rows: 30 });
      setTerminals((prev) => (prev.some((item) => item.id === info.id) ? prev : [...prev, info]));
      setActiveTerminal(info.id);
    } catch (error) {
      setError(errorText(error, 'Gagal membuat terminal'));
    } finally {
      creatingTerminal.current = false;
    }
  }, []);

  const closeTerminal = useCallback((id: string) => {
    const remaining = latest.current.terminals.filter((item) => item.id !== id);
    setTerminals(remaining);
    setActiveTerminal((active) => (active === id ? remaining[0]?.id ?? null : active));
    void window.rk.editor.killTerminal(id).catch((error) => {
      setError(errorText(error, 'Gagal menutup terminal'));
    });
  }, []);

  // ---- output ----
  const appendOutput = useCallback((channelId: string, text: string) => {
    const incoming = linesOf(text);
    if (incoming.length === 0) return;
    setOutputs((prev) => prev.map((channel) => (
      channel.id === channelId
        ? { ...channel, lines: pushLines(channel.lines, incoming, MAX_OUTPUT_LINES) }
        : channel
    )));
  }, []);

  const clearOutput = useCallback((channelId: string) => {
    setOutputs((prev) => prev.map((channel) => (
      channel.id === channelId ? { ...channel, lines: [] } : channel
    )));
  }, []);

  // ---- ekstensi ----
  const activateSnippets = useCallback(async (list: InstalledExtension[]) => {
    const snippets: EditorSnippetContribution[] = list.flatMap((extension) => extension.snippets);
    if (snippets.length === 0) return;
    try {
      const runtime = await import('./extensionRuntime');
      await runtime.registerExtensionSnippets(snippets, (path) => window.rk.editor.readExtensionFile(path));
    } catch {
      // Snippet rusak tidak boleh mengganggu IDE.
    }
  }, []);

  const refreshInstalled = useCallback(async () => {
    try {
      const list = await window.rk.editor.listExtensions();
      setInstalled(list);
      void activateSnippets(list);
    } catch (error) {
      setError(errorText(error, 'Gagal memuat daftar ekstensi terpasang'));
    }
  }, [activateSnippets]);

  const installExtension = useCallback(async (id: string) => {
    setExtensionBusy(true);
    try {
      const result = await window.rk.editor.installExtension(id);
      if (!result.ok || !result.extension) {
        setError(result.error ?? 'Gagal memasang ekstensi ' + id);
        return;
      }
      appendOutput('extensions', 'Ekstensi terpasang: ' + result.extension.displayName + ' v' + result.extension.version
        + (result.extension.unsupportedContributions > 0
          ? ' (' + result.extension.unsupportedContributions + ' kontribusi belum didukung)'
          : ''));
      await refreshInstalled();
    } catch (error) {
      setError(errorText(error, 'Gagal memasang ekstensi ' + id));
    } finally {
      setExtensionBusy(false);
    }
  }, [appendOutput, refreshInstalled]);

  const uninstallExtension = useCallback(async (id: string) => {
    setExtensionBusy(true);
    try {
      const result = await window.rk.editor.uninstallExtension(id);
      if (!result.ok) {
        setError(result.error ?? 'Gagal menghapus ekstensi ' + id);
        return;
      }
      appendOutput('extensions', 'Ekstensi dihapus: ' + id);
      const runtime = await import('./extensionRuntime');
      runtime.disposeAllSnippets();
      await refreshInstalled();
      // Tema dari ekstensi yang dihapus tidak boleh tertinggal aktif.
      const stillAvailable = latest.current.installed.some((extension) => extension.themes.some((theme) => theme.id === monacoTheme));
      if (!stillAvailable && monacoTheme !== DEFAULT_THEME) {
        setMonacoThemeState(DEFAULT_THEME);
        try { localStorage.setItem(THEME_STORAGE_KEY, DEFAULT_THEME); } catch { /* localStorage bisa diblokir */ }
      }
    } catch (error) {
      setError(errorText(error, 'Gagal menghapus ekstensi ' + id));
    } finally {
      setExtensionBusy(false);
    }
  }, [appendOutput, refreshInstalled, monacoTheme]);

  const setMonacoTheme = useCallback((theme: string) => {
    setMonacoThemeState(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage bisa diblokir; tema tetap aktif untuk sesi ini.
    }
    if (theme === DEFAULT_THEME) return;
    void (async () => {
      try {
        const contribution = latest.current.installed
          .flatMap((extension) => extension.themes)
          .find((item) => item.id === theme);
        if (!contribution) return;
        const runtime = await import('./extensionRuntime');
        await runtime.applyExtensionTheme(contribution, (path) => window.rk.editor.readExtensionFile(path));
        const monaco = await import('monaco-editor');
        monaco.editor.setTheme(theme);
      } catch (error) {
        setError(errorText(error, 'Gagal memuat tema ' + theme));
      }
    })();
  }, []);

  // ---- debug ----
  const pushDebugLines = useCallback((incoming: string[]) => {
    setDebug((prev) => ({ ...prev, lines: pushLines(prev.lines, incoming, MAX_DEBUG_LINES) }));
  }, []);

  const startDebug = useCallback(async () => {
    const path = latest.current.activePath;
    if (!path) {
      setDebug((prev) => ({ ...prev, status: 'error', error: 'Buka file JavaScript dulu sebelum memulai debug.' }));
      return;
    }
    if (!/\.(js|mjs|cjs)$/i.test(path)) {
      const message = 'Debugger Node hanya untuk JavaScript (bukan TypeScript)';
      setDebug((prev) => ({ ...prev, status: 'error', error: message, lines: pushLines(prev.lines, ['[error] ' + message], MAX_DEBUG_LINES) }));
      return;
    }
    setDebug((prev) => ({
      ...prev,
      status: 'starting',
      error: null,
      frames: [],
      pausedAt: null,
      lines: pushLines(prev.lines, ['[start] ' + baseName(path)], MAX_DEBUG_LINES),
    }));
    try {
      const result = await window.rk.editor.debugStart(path);
      if (!result.ok) {
        const message = result.error ?? 'Debugger gagal dimulai';
        setDebug((prev) => ({ ...prev, status: 'error', error: message, lines: pushLines(prev.lines, ['[error] ' + message], MAX_DEBUG_LINES) }));
      }
    } catch (error) {
      const message = errorText(error, 'Debugger gagal dimulai');
      setDebug((prev) => ({ ...prev, status: 'error', error: message }));
    }
  }, []);

  const stopDebug = useCallback(async () => {
    try {
      await window.rk.editor.debugStop();
      setDebug((prev) => ({ ...prev, status: 'stopped', frames: [], pausedAt: null }));
    } catch (error) {
      setDebug((prev) => ({ ...prev, error: errorText(error, 'Gagal menghentikan debugger') }));
    }
  }, []);

  const resumeDebug = useCallback(async () => {
    try {
      await window.rk.editor.debugResume();
    } catch (error) {
      setDebug((prev) => ({ ...prev, error: errorText(error, 'Gagal melanjutkan debugger') }));
    }
  }, []);

  const pauseDebug = useCallback(async () => {
    try {
      await window.rk.editor.debugPause();
    } catch (error) {
      setDebug((prev) => ({ ...prev, error: errorText(error, 'Gagal menjeda debugger') }));
    }
  }, []);

  const stepDebug = useCallback(async (kind: 'over' | 'into' | 'out') => {
    try {
      await window.rk.editor.debugStep(kind);
    } catch (error) {
      setDebug((prev) => ({ ...prev, error: errorText(error, 'Gagal melangkah di debugger') }));
    }
  }, []);

  const evaluateDebug = useCallback(async (expression: string) => {
    const trimmed = expression.trim();
    if (!trimmed) return;
    try {
      const result = await window.rk.editor.debugEvaluate(trimmed);
      const lines = result.ok
        ? ['> ' + trimmed, result.result ?? 'undefined']
        : ['> ' + trimmed, '[error] ' + (result.error ?? 'Evaluasi gagal')];
      pushDebugLines(lines);
    } catch (error) {
      pushDebugLines(['> ' + trimmed, '[error] ' + errorText(error, 'Evaluasi gagal')]);
    }
  }, [pushDebugLines]);

  const setCursor = useCallback((info: CursorInfo) => setCursorState(info), []);
  const clearError = useCallback(() => setError(null), []);

  // ---- efek root: reset + muat ----
  useEffect(() => {
    const rootChanged = previousRoot.current !== root;
    previousRoot.current = root;

    setTree({});
    setExpanded({});
    setBuffers({});
    setOpenOrder([]);
    setActivePath(null);
    setReveal(null);
    setCursorState({ line: 1, column: 1, selected: 0 });
    setMarkers({});
    setBreakpoints({});
    setTerminals([]);
    setActiveTerminal(null);
    setDebug(DEBUG_INITIAL);
    setError(null);
    savedAt.current = {};
    // Model Monaco hanya dibuang saat root benar-benar berganti (bukan mount awal),
    // supaya bundle Monaco tidak ikut dimuat saat IDE belum pernah dibuka.
    if (rootChanged) void import('./monaco').then((module) => module.disposeModels()).catch(() => undefined);
    if (!root) return;

    let cancelled = false;
    let timer = 0;

    const realtimeRefresh = async () => {
      const dirs = [root, ...Object.keys(latest.current.expanded).filter((dir) => latest.current.expanded[dir])];
      await refreshDirs(dirs);
      await reloadCleanBuffers();
    };

    void (async () => {
      const entries = await window.rk.editor.listDir(root).catch((error: unknown) => {
        setError(errorText(error, 'Gagal membaca folder project'));
        return null;
      });
      if (cancelled || !entries) return;
      setTree((prev) => ({ ...prev, [root]: entries }));
      setExpanded((prev) => ({ ...prev, [root]: true }));
    })();

    void window.rk.editor.listTerminals().then((list) => {
      if (cancelled) return;
      setTerminals(list);
      setActiveTerminal((prev) => prev ?? list[0]?.id ?? null);
    }).catch((error: unknown) => {
      if (!cancelled) setError(errorText(error, 'Gagal memuat daftar terminal'));
    });

    void refreshInstalled();

    const offFiles = window.rk.onProjectFilesChanged(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void realtimeRefresh(); }, FILE_EVENT_DEBOUNCE_MS);
    });

    const offExit = window.rk.editor.onTerminalExit((event) => {
      setTerminals((prev) => prev.filter((item) => item.id !== event.id));
      setActiveTerminal((active) => (active === event.id ? null : active));
    });

    const offDebug = window.rk.editor.onDebugEvent((event: DebugEvent) => {
      if (event.type === 'status') {
        setDebug((prev) => ({ ...prev, status: event.status, error: event.error ?? null }));
        return;
      }
      if (event.type === 'paused') {
        setDebug((prev) => ({
          ...prev,
          status: 'paused',
          frames: event.frames,
          pausedAt: event.file ? { path: event.file, line: event.line } : null,
          lines: pushLines(prev.lines, [
            '[paused] ' + event.reason + (event.file ? ' — ' + baseName(event.file) + ':' + event.line : ''),
          ], MAX_DEBUG_LINES),
        }));
        return;
      }
      if (event.type === 'resumed') {
        setDebug((prev) => ({ ...prev, status: 'running', frames: [], pausedAt: null }));
        return;
      }
      if (event.type === 'console') {
        setDebug((prev) => ({ ...prev, lines: pushLines(prev.lines, ['[console] ' + event.text], MAX_DEBUG_LINES) }));
        return;
      }
      if (event.type === 'output') {
        setDebug((prev) => ({ ...prev, lines: pushLines(prev.lines, linesOf(event.text), MAX_DEBUG_LINES) }));
        return;
      }
      // exited
      setDebug((prev) => ({
        ...prev,
        status: 'stopped',
        frames: [],
        pausedAt: null,
        lines: pushLines(prev.lines, ['[exit] kode ' + (event.code ?? 'null')], MAX_DEBUG_LINES),
      }));
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      offFiles();
      offExit();
      offDebug();
    };
  }, [root, refreshDirs, reloadCleanBuffers, refreshInstalled]);

  // ---- log dev server -> channel Output ----
  useEffect(() => window.rk.onServerLog((payload) => {
    appendOutput('dev-server', payload.line);
  }), [appendOutput]);

  // ---- pencarian ekstensi (debounce) ----
  useEffect(() => {
    const query = extensionQuery.trim();
    if (!query) {
      setExtensionResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void window.rk.editor.searchExtensions(query)
        .then((result) => setExtensionResults(result.items))
        .catch((error: unknown) => setError(errorText(error, 'Gagal mencari ekstensi')));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [extensionQuery]);

  // ---- tema tersimpan: definisikan ulang setelah daftar ekstensi dimuat ----
  useEffect(() => {
    if (monacoTheme === DEFAULT_THEME) return;
    if (!installed.some((extension) => extension.themes.some((theme) => theme.id === monacoTheme))) return;
    setMonacoTheme(monacoTheme);
  }, [monacoTheme, installed, setMonacoTheme]);

  // ---- turunan ----
  const openFiles = useMemo<OpenBuffer[]>(() => openOrder.map((path) => ({
    path,
    name: baseName(path),
    language: languageForPath(path),
    dirty: buffers[path]?.dirty ?? false,
  })), [openOrder, buffers]);

  const content = activePath ? buffers[activePath]?.content ?? '' : '';
  const activeDirty = activePath ? buffers[activePath]?.dirty ?? false : false;

  const problems = useMemo<ProblemItem[]>(() => {
    const result: ProblemItem[] = [];
    for (const list of Object.values(markers)) result.push(...list);
    return result;
  }, [markers]);

  const availableThemes = useMemo(() => {
    const themes = [{ id: DEFAULT_THEME, label: 'Ruang Kerja Dark' }];
    for (const extension of installed) {
      for (const theme of extension.themes) themes.push({ id: theme.id, label: theme.label });
    }
    return themes;
  }, [installed]);

  return useMemo<IdeWorkbench>(() => ({
    root,
    error,
    clearError,

    tree,
    expanded,
    toggleDir,
    refreshDir,

    openFiles,
    activePath,
    content,
    activeDirty,
    openFile,
    activateFile,
    closeFile,
    changeContent,
    save,
    saveAll,

    cursor,
    setCursor,
    reveal,

    problems,
    reportMarkers,

    breakpoints,
    toggleBreakpoint,

    terminals,
    activeTerminal,
    newTerminal,
    selectTerminal,
    closeTerminal,

    outputs,
    appendOutput,
    clearOutput,

    installed,
    extensionResults,
    extensionQuery,
    extensionBusy,
    setExtensionQuery,
    refreshInstalled,
    installExtension,
    uninstallExtension,

    debug,
    startDebug,
    stopDebug,
    resumeDebug,
    pauseDebug,
    stepDebug,
    evaluateDebug,

    monacoTheme,
    setMonacoTheme,
    availableThemes,
  }), [
    root, error, clearError, tree, expanded, toggleDir, refreshDir, openFiles, activePath, content, activeDirty,
    openFile, activateFile, closeFile, changeContent, save, saveAll, cursor, setCursor, reveal, problems,
    reportMarkers, breakpoints, toggleBreakpoint, terminals, activeTerminal, newTerminal, selectTerminal,
    closeTerminal, outputs, appendOutput, clearOutput, installed, extensionResults, extensionQuery,
    extensionBusy, refreshInstalled, installExtension, uninstallExtension, debug, startDebug, stopDebug,
    resumeDebug, pauseDebug, stepDebug, evaluateDebug, monacoTheme, setMonacoTheme, availableThemes,
  ]);
}
