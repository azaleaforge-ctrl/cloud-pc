import './editor.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState } from '../../../shared/types';
import { LogoMark, IconBot } from '../icons';
import { useIdeWorkbench } from './useIdeWorkbench';
import { MonacoPane } from './MonacoPane';
import { ActivityBar } from './ActivityBar';
import { ExplorerPane } from './ExplorerPane';
import { SearchPane } from './SearchPane';
import { ExtensionsPane } from './ExtensionsPane';
import { TabBar } from './TabBar';
import { StatusBar } from './StatusBar';
import { PanelHost } from './PanelHost';
import { CommandPalette, type PaletteItem } from './CommandPalette';
import { AgentChat } from './AgentChat';
import type { PanelView, SideView } from './types';
import { IconError, IconX } from '../icons';

interface Props {
  state: AppState;
  active: boolean;
  onError: (message: string) => void;
}

type PaletteMode = 'commands' | 'files' | 'themes';

const SIDE_MIN = 180;
const SIDE_MAX = 420;
const PANEL_MIN = 60;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readSize(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = Number(localStorage.getItem(key));
    if (Number.isFinite(raw) && raw > 0) return clamp(raw, min, max);
  } catch {
    // localStorage tidak tersedia — pakai default.
  }
  return fallback;
}

function relPath(root: string | null, path: string): string {
  if (!root) return path;
  const normRoot = root.replace(/[\\/]+$/, '');
  if (path.toLowerCase().startsWith(normRoot.toLowerCase())) {
    return path.slice(normRoot.length).replace(/^[\\/]+/, '') || path;
  }
  return path;
}

function maxPanelHeight(): number {
  return Math.round(window.innerHeight * 0.85);
}

/** Resizer pointer-events + keyboard (role="separator"). */
function Resizer({
  orientation,
  label,
  onDelta,
  onDoubleClick,
}: {
  orientation: 'vertical' | 'horizontal';
  label: string;
  onDelta: (delta: number) => void;
  onDoubleClick?: () => void;
}) {
  const [dragging, setDragging] = useState(false);

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    let last = orientation === 'vertical' ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      const cur = orientation === 'vertical' ? ev.clientX : ev.clientY;
      // Horizontal resizer (panel): dragging UP should expand panel (negative delta = increase height)
      // because panel is anchored at bottom. Vertical resizer (sidebar): dragging RIGHT expands (positive).
      const delta = orientation === 'vertical' ? cur - last : last - cur;
      onDelta(delta);
      last = cur;
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      setDragging(false);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    let delta: number | null = null;
    if (orientation === 'vertical') {
      if (e.key === 'ArrowRight') delta = 16;
      if (e.key === 'ArrowLeft') delta = -16;
    } else {
      // Panel: ArrowUp expands (increase height), ArrowDown collapses
      if (e.key === 'ArrowUp') delta = 16;
      if (e.key === 'ArrowDown') delta = -16;
    }
    if (delta !== null) {
      e.preventDefault();
      onDelta(delta);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      className={`ed-resizer ${orientation === 'vertical' ? 'ed-resizer-v' : 'ed-resizer-h'}${dragging ? ' dragging' : ''}`}
      onPointerDown={start}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    />
  );
}

/** Petunjuk saat belum ada file terbuka. */
function EditorEmpty({ onQuickOpen }: { onQuickOpen: () => void }) {
  return (
    <div className="ed-editor-empty">
      <LogoMark size={46} />
      <p className="ed-editor-empty-title">Ruang Kerja Editor</p>
      <div className="ed-editor-empty-keys">
        <span>
          <kbd>Ctrl</kbd>+<kbd>P</kbd> buka file
        </span>
        <span>
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> daftar perintah
        </span>
        <button type="button" className="ed-debug-btn" onClick={onQuickOpen}>
          Buka File…
        </button>
      </div>
    </div>
  );
}

/** Chrome IDE bawaan: activity bar, sidebar, editor, panel, status bar. */
export function EditorShell({ state, active, onError }: Props) {
  const wb = useIdeWorkbench(state.projectPath);

  const [sideView, setSideView] = useState<SideView>('explorer');
  const [sideOpen, setSideOpen] = useState(true);
  const [sideWidth, setSideWidth] = useState(() => readSize('rk.ide.sideWidth', 248, SIDE_MIN, SIDE_MAX));
  const [panelView, setPanelView] = useState<PanelView>('terminal');
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelHeight, setPanelHeight] = useState(() =>
    readSize('rk.ide.panelHeight', 220, PANEL_MIN, maxPanelHeight()),
  );
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [agentChatOpen, setAgentChatOpen] = useState(false);

  // Listen for Ctrl+Shift+L toggle via custom event from StatusBar button
  useEffect(() => {
    const handler = () => setAgentChatOpen((o) => !o);
    window.addEventListener('rk:ai-chat-toggle', handler);
    return () => window.removeEventListener('rk:ai-chat-toggle', handler);
  }, []);

  // Laporan aktivitas untuk sistem antrian (throttle >= 5 detik).
  const lastReport = useRef(0);
  const reportActivity = useCallback((source?: 'ui' | 'file' | React.PointerEvent) => {
    const now = Date.now();
    if (now - lastReport.current < 5000) return;
    lastReport.current = now;
    const activitySource = typeof source === 'object' ? 'ui' : (source ?? 'ui');
    void window.rk.reportActivity(activitySource).catch(() => undefined);
  }, []);

  // Teruskan error workbench ke onError sekali per error baru.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const reportedError = useRef<string | null>(null);
  useEffect(() => {
    if (wb.error) {
      if (reportedError.current !== wb.error) {
        reportedError.current = wb.error;
        onErrorRef.current(wb.error);
      }
    } else {
      reportedError.current = null;
    }
  }, [wb.error]);

  // Persistensi ukuran panel.
  useEffect(() => {
    try {
      localStorage.setItem('rk.ide.sideWidth', String(sideWidth));
    } catch {
      // abaikan
    }
  }, [sideWidth]);
  useEffect(() => {
    try {
      localStorage.setItem('rk.ide.panelHeight', String(panelHeight));
    } catch {
      // abaikan
    }
  }, [panelHeight]);

  const showPanel = useCallback((view: PanelView) => {
    setPanelView(view);
    setPanelOpen(true);
  }, []);

  const togglePanelView = useCallback(
    (view: PanelView) => {
      if (panelOpen && panelView === view) setPanelOpen(false);
      else {
        setPanelView(view);
        setPanelOpen(true);
      }
    },
    [panelOpen, panelView],
  );

  const toggleSideView = useCallback(
    (view: SideView) => {
      if (sideOpen && sideView === view) setSideOpen(false);
      else {
        setSideView(view);
        setSideOpen(true);
      }
    },
    [sideOpen, sideView],
  );

  const collapseAll = useCallback(() => {
    for (const key of Object.keys(wb.expanded)) {
      if (wb.expanded[key]) wb.toggleDir(key);
    }
  }, [wb]);

  // Pintasan keyboard global area IDE.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === 's' && e.shiftKey) {
        e.preventDefault();
        void wb.saveAll();
        reportActivity('file');
      } else if (key === 's') {
        e.preventDefault();
        void wb.save();
        reportActivity('file');
      } else if (key === 'p' && e.shiftKey) {
        e.preventDefault();
        setPalette('commands');
      } else if (key === 'p') {
        e.preventDefault();
        setPalette('files');
      } else if (key === 'b') {
        e.preventDefault();
        setSideOpen((o) => !o);
      } else if (key === 'j' || key === '`' || e.code === 'Backquote') {
        e.preventDefault();
        setPanelOpen((o) => !o);
      } else if (key === 'w') {
        e.preventDefault();
        if (wb.activePath) wb.closeFile(wb.activePath);
      } else if (key === 'l' && e.shiftKey) {
        e.preventDefault();
        setAgentChatOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, wb, reportActivity]);

  // Item palette per mode.
  const paletteItems = useMemo<PaletteItem[]>(() => {
    if (palette === 'commands') {
      return [
        { id: 'save', label: 'Simpan', hint: 'Ctrl+S', run: () => void wb.save() },
        { id: 'saveAll', label: 'Simpan Semua', hint: 'Ctrl+Shift+S', run: () => void wb.saveAll() },
        { id: 'newTerminal', label: 'Terminal: Buat Terminal Baru', run: () => void wb.newTerminal() },
        { id: 'togglePanel', label: 'Tampilan: Buka/Tutup Panel Bawah', hint: 'Ctrl+`', run: () => setPanelOpen((o) => !o) },
        { id: 'toggleSide', label: 'Tampilan: Buka/Tutup Sidebar', hint: 'Ctrl+B', run: () => setSideOpen((o) => !o) },
        { id: 'showProblems', label: 'Tampilkan Masalah', run: () => showPanel('problems') },
        { id: 'showOutput', label: 'Tampilkan Output', run: () => showPanel('output') },
        { id: 'showDebug', label: 'Tampilkan Debug Console', run: () => showPanel('debug') },
        { id: 'startDebug', label: 'Debug: Mulai Debugging', run: () => void wb.startDebug() },
        { id: 'stopDebug', label: 'Debug: Hentikan Debugging', run: () => void wb.stopDebug() },
        { id: 'pickTheme', label: 'Preferensi: Ganti Tema Warna', run: () => setPalette('themes') },
        { id: 'refreshExplorer', label: 'Explorer: Segarkan', run: () => wb.refreshDir() },
        { id: 'installExt', label: 'Ekstensi: Cari & Pasang Ekstensi', run: () => { setSideView('extensions'); setSideOpen(true); } },
        { id: 'collapseFolders', label: 'Explorer: Tutup Semua Folder', run: collapseAll },
      ];
    }
    if (palette === 'themes') {
      return wb.availableThemes.map((t) => ({
        id: t.id,
        label: `Tema: ${t.label}`,
        run: () => wb.setMonacoTheme(t.id),
      }));
    }
    // Quick Open: kumpulkan file dari tree yang sudah dimuat.
    const files: PaletteItem[] = [];
    const walk = (dir: string) => {
      for (const entry of wb.tree[dir] ?? []) {
        if (entry.isDir) walk(entry.path);
        else
          files.push({
            id: entry.path,
            label: relPath(wb.root, entry.path),
            run: () => {
              wb.openFile(entry.path);
              reportActivity();
            },
          });
      }
    };
    if (wb.root) walk(wb.root);
    return files;
  }, [palette, wb, collapseAll, showPanel, reportActivity]);

  const palettePlaceholder =
    palette === 'commands'
      ? 'Ketik nama perintah…'
      : palette === 'themes'
        ? 'Pilih tema warna…'
        : 'Ketik nama file untuk dibuka…';

  const activeFile = wb.openFiles.find((f) => f.path === wb.activePath) ?? null;

  const crumbs = useMemo(() => {
    if (!wb.activePath) return [] as string[];
    return relPath(wb.root, wb.activePath).split(/[\\/]/).filter(Boolean);
  }, [wb.activePath, wb.root]);

  const openFileAt = useCallback(
    (path: string, line?: number) => {
      wb.openFile(path, line != null ? { line } : undefined);
      reportActivity();
    },
    [wb, reportActivity],
  );

  return (
    <div className={`ed-root${active ? '' : ' is-hidden'}`}>
      <ActivityBar
        sideView={sideView}
        sideOpen={sideOpen}
        panelView={panelView}
        panelOpen={panelOpen}
        onSideView={toggleSideView}
        onTogglePanel={togglePanelView}
      />

      <div className="ed-body">
        <div className="ed-workarea">
          {sideOpen && (
            <>
              <aside className="ed-side" style={{ width: sideWidth }}>
                {sideView === 'explorer' && (
                  <ExplorerPane wb={wb} reportActivity={reportActivity} onError={onError} />
                )}
                {sideView === 'search' && <SearchPane wb={wb} reportActivity={reportActivity} />}
                {sideView === 'extensions' && <ExtensionsPane wb={wb} />}
              </aside>
              <Resizer
                orientation="vertical"
                label="Ubah lebar sidebar"
                onDelta={(d) => setSideWidth((w) => clamp(w + d, SIDE_MIN, SIDE_MAX))}
              />
            </>
          )}

          <div className="ed-main">
            {wb.error && (
              <div className="ed-error-banner" role="alert">
                <IconError size={14} />
                <span className="ed-error-text">{wb.error}</span>
                <button
                  type="button"
                  className="ed-icon-btn"
                  aria-label="Tutup pesan galat"
                  title="Tutup"
                  onClick={() => wb.clearError()}
                >
                  <IconX size={13} />
                </button>
              </div>
            )}

            <TabBar wb={wb} reportActivity={reportActivity} />

            {wb.activePath && crumbs.length > 0 && (
              <div className="ed-breadcrumb" aria-label="Lokasi file">
                {crumbs.map((crumb, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    {i > 0 && (
                      <span className="ed-crumb-sep" aria-hidden="true">
                        ›
                      </span>
                    )}
                    <span className={`ed-crumb${i === crumbs.length - 1 ? ' current' : ''}`}>{crumb}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="ed-editor" onPointerDown={reportActivity}>
              {wb.activePath ? (
                <div className="ed-editor-host">
                  <MonacoPane
                    path={wb.activePath}
                    value={wb.content}
                    language={activeFile?.language ?? 'plaintext'}
                    theme={wb.monacoTheme}
                    reveal={wb.reveal}
                    breakpoints={wb.activePath ? (wb.breakpoints[wb.activePath] ?? []) : []}
                    onChange={(value) => {
                      wb.changeContent(value);
                      reportActivity('file');
                    }}
                    onSave={() => {
                      void wb.save();
                      reportActivity('file');
                    }}
                    onCursor={wb.setCursor}
                    onToggleBreakpoint={(line) => {
                      if (wb.activePath) wb.toggleBreakpoint(wb.activePath, line);
                    }}
                    onMarkers={(problems) => {
                      if (wb.activePath) wb.reportMarkers(wb.activePath, problems);
                    }}
                  />
                </div>
              ) : (
                <EditorEmpty onQuickOpen={() => setPalette('files')} />
              )}
            </div>

            {panelOpen && (
              <>
                <Resizer
                  orientation="horizontal"
                  label="Ubah tinggi panel"
                  onDelta={(d) => setPanelHeight((h) => clamp(h + d, PANEL_MIN, maxPanelHeight()))}
                  onDoubleClick={() => setPanelOpen(false)}
                />
                <div className="ed-panel" style={{ height: panelHeight }}>
                  <PanelHost
                    wb={wb}
                    view={panelView}
                    onView={setPanelView}
                    onClose={() => setPanelOpen(false)}
                    onOpenFile={openFileAt}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <StatusBar wb={wb} state={state} onShowPanel={showPanel} />
      </div>

      <CommandPalette
        open={palette !== null}
        placeholder={palettePlaceholder}
        items={paletteItems}
        onClose={() => setPalette(null)}
      />
      <AgentChat
        wb={{ root: wb.root, activePath: wb.activePath }}
        visible={agentChatOpen}
        onToggle={() => setAgentChatOpen(false)}
      />
    </div>
  );
}
