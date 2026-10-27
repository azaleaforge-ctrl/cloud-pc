// Pane terminal xterm. Isi terminal tidak disimpan di React: xterm memegang
// buffer, hook hanya meneruskan event IPC mentah lewat `onTerminalSessionData`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import type { IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import type { TerminalSessionInfo } from '../../../shared/editor';
import { IconPlus, IconTerminal, IconTrash, IconX, IconMaximize, IconMinimize } from '../icons';
import { onTerminalSessionData } from './useIdeWorkbench';

const MONO_FONT = "'Cascadia Code', 'Cascadia Mono', Consolas, '\''JetBrains Mono'\'', '\''Courier New'\'', monospace";

const XTERM_THEME = {
  background: '#0b0f17',
  foreground: '#d7e0ea',
  cursor: '#2dd4bf',
  cursorAccent: '#0b0f17',
  selectionBackground: 'rgba(29, 78, 216, 0.3)',
  selectionInactiveBackground: 'rgba(148, 163, 184, 0.18)',
  black: '#0b0f17',
  red: '#fb7185',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#818cf8',
  magenta: '#c084fc',
  cyan: '#2dd4bf',
  white: '#d7e0ea',
  brightBlack: '#4b5a6b',
  brightRed: '#fda4af',
  brightGreen: '#6ee7b7',
  brightYellow: '#fcd34d',
  brightBlue: '#a5b4fc',
  brightMagenta: '#d8b4fe',
  brightCyan: '#5eead4',
  brightWhite: '#f1f5f9',
};

interface ManagedTerminal {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  host: HTMLDivElement;
  inputSub: IDisposable;
  dataSub: IDisposable;
  keySub: IDisposable;
}

export function TerminalPane({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onClose,
}: {
  sessions: TerminalSessionInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClose: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionsRef = useRef(new Map<string, ManagedTerminal>());
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showSearch, setShowSearch] = useState(false);

  // ---- buat / buang instance xterm mengikuti daftar sesi ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const managed = sessionsRef.current;
    const alive = new Set(sessions.map((session) => session.id));

    for (const [id, entry] of Array.from(managed.entries())) {
      if (alive.has(id)) continue;
      entry.inputSub.dispose();
      entry.dataSub.dispose();
      entry.keySub.dispose();
      entry.term.dispose();
      entry.host.remove();
      managed.delete(id);
    }

    for (const session of sessions) {
      if (managed.has(session.id)) continue;
      const host = document.createElement('div');
      host.dataset.session = session.id;
      host.style.cssText = 'position:absolute;inset:0;padding:6px 2px 2px 8px;display:block;';
      host.style.display = session.id === activeIdRef.current ? 'block' : 'none';
      container.appendChild(host);

      const term = new Terminal({
        fontFamily: MONO_FONT,
        fontSize: 12.5,
        lineHeight: 1.25,
        cursorBlink: true,
        scrollback: 10000,
        allowTransparency: false,
        theme: XTERM_THEME,
        rightClickSelectsWord: true,
        unicodeVersion: '15',
        convertEol: true,
        screenReaderMode: false,
      });
      const fit = new FitAddon();
      const search = new SearchAddon();
      term.loadAddon(fit);
      term.loadAddon(search);
      term.loadAddon(new WebLinksAddon());
      term.open(host);
      
      // Handle input - send to main process
      const inputSub = term.onData((data) => {
        void window.rk.editor.writeTerminal(session.id, data).catch(() => undefined);
      });
      
      // Handle key events for search and other shortcuts
      const keySub = term.onKey((event) => {
        if (event.key === 'f' && (event.domEvent.ctrlKey || event.domEvent.metaKey)) {
          event.domEvent.preventDefault();
          setShowSearch(true);
          setTimeout(() => term.focus(), 0);
        }
      });

      managed.set(session.id, { term, fit, search, host, inputSub, dataSub: { dispose: () => {} }, keySub });
    }
  }, [sessions]);

  // ---- data dari main -> xterm (satu langganan untuk semua pane) ----
  useEffect(() => onTerminalSessionData((event) => {
    sessionsRef.current.get(event.id)?.term.write(event.data);
  }), []);

  // ---- ukuran ----
  const fitTerminal = useCallback((id: string) => {
    const entry = sessionsRef.current.get(id);
    if (!entry) return;
    if (entry.host.offsetParent === null || entry.host.clientWidth === 0) return;
    try {
      entry.fit.fit();
    } catch {
      return; // elemen belum terukur
    }
    void window.rk.editor.resizeTerminal(id, entry.term.cols, entry.term.rows).catch(() => undefined);
  }, []);

  // ---- visibilitas + fokus mengikuti sesi aktif ----
  useEffect(() => {
    for (const [id, entry] of sessionsRef.current) {
      entry.host.style.display = id === activeId ? 'block' : 'none';
    }
    if (!activeId) return;
    const frame = requestAnimationFrame(() => {
      const entry = sessionsRef.current.get(activeId);
      if (!entry) return;
      fitTerminal(activeId);
      // Jangan rebut fokus kalau panel terminal memang sedang tersembunyi.
      if (entry.host.offsetParent !== null) entry.term.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId, sessions, fitTerminal]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const fitVisible = () => {
      frame = 0;
      for (const [id, entry] of sessionsRef.current) {
        if (entry.host.offsetParent !== null) fitTerminal(id);
      }
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(fitVisible);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [fitTerminal]);

  // ---- bersih-bersih: sesi pty tetap hidup di main ----
  useEffect(() => () => {
    for (const entry of sessionsRef.current.values()) {
      entry.inputSub.dispose();
      entry.dataSub.dispose();
      entry.keySub.dispose();
      entry.term.dispose();
    }
    sessionsRef.current.clear();
  }, []);

  // ---- search functionality ----
  const handleSearch = useCallback((term: string) => {
    setSearchTerm(term);
    if (!activeId) return;
    const entry = sessionsRef.current.get(activeId);
    if (!entry) return;
    if (term) {
      entry.search.findNext(term);
    } else {
      entry.search.clear();
    }
  }, [activeId]);

  const handleSearchNext = useCallback(() => {
    if (!activeId) return;
    const entry = sessionsRef.current.get(activeId);
    if (!entry) return;
    entry.search.findNext(searchTerm);
  }, [activeId, searchTerm]);

  const handleSearchPrev = useCallback(() => {
    if (!activeId) return;
    const entry = sessionsRef.current.get(activeId);
    if (!entry) return;
    entry.search.findPrevious(searchTerm);
  }, [activeId, searchTerm]);

  // ---- menu klik kanan ----
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const copySelection = async (id: string) => {
    const text = sessionsRef.current.get(id)?.term.getSelection();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch { /* diabaikan */ }
      area.remove();
    }
  };

  const pasteClipboard = async (id: string) => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) sessionsRef.current.get(id)?.term.paste(text);
    } catch {
      // Tidak ada akses clipboard: pengguna masih bisa pakai Ctrl+V di terminal.
    }
  };

  const closeMenu = () => setMenu(null);

  return (
    <div className="rk-term" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#0b0f17' }}>
      <div
        className="rk-term-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderBottom: '1px solid rgba(148, 163, 184, 0.14)',
          background: '#0c111d',
          flex: '0 0 auto',
        }}
      >
        <span style={{ display: 'inline-flex', color: 'var(--teal, #2dd4bf)' }}><IconTerminal size={14} /></span>
        <select
          aria-label="Pilih sesi terminal"
          value={activeId ?? ''}
          onChange={(event) => onSelect(event.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            background: 'rgba(148, 163, 184, 0.07)',
            color: 'var(--text-2, #a3aec4)',
            border: '1px solid rgba(148, 163, 184, 0.14)',
            borderRadius: 7,
            padding: '3px 6px',
            font: '600 11px/1.4 var(--font, system-ui)',
          }}
        >
          {sessions.length === 0 ? <option value="">Belum ada terminal</option> : null}
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>{session.title}</option>
          ))}
        </select>
        <button type="button" className="icon-btn" title="Terminal baru" aria-label="Terminal baru" onClick={() => onCreate()}>
          <IconPlus size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Tutup terminal"
          aria-label="Tutup terminal"
          disabled={!activeId}
          onClick={() => { if (activeId) onClose(activeId); }}
        >
          <IconTrash size={14} />
        </button>
        {showSearch && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: '0 0 auto' }}>
            <input
              type="text"
              placeholder="Cari di terminal..."
              value={searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.shiftKey) handleSearchPrev();
                  else handleSearchNext();
                } else if (e.key === 'Escape') {
                  setShowSearch(false);
                  setSearchTerm('');
                  sessionsRef.current.get(activeId!)?.search.clear();
                }
              }}
              style={{
                background: 'rgba(148, 163, 184, 0.07)',
                color: 'var(--text, #e8edf6)',
                border: '1px solid rgba(148, 163, 184, 0.14)',
                borderRadius: 7,
                padding: '3px 8px',
                font: '500 11px/1.4 var(--font, system-ui)',
                width: 200,
              }}
              autoFocus
            />
            <button type="button" className="icon-btn" title="Sebelumnya" onClick={handleSearchPrev}><IconX size={14} /></button>
            <button type="button" className="icon-btn" title="Berikutnya" onClick={handleSearchNext}><IconX size={14} /></button>
            <button type="button" className="icon-btn" title="Tutup pencarian" onClick={() => { setShowSearch(false); setSearchTerm(''); sessionsRef.current.get(activeId!)?.search.clear(); }}><IconX size={14} /></button>
          </div>
        )}
        {!showSearch && (
          <button type="button" className="icon-btn" title="Cari (Ctrl+F)" onClick={() => setShowSearch(true)}><IconX size={14} /></button>
        )}
      </div>

      <div
        ref={containerRef}
        className="rk-term-body"
        style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', background: '#0b0f17' }}
        onContextMenu={(event) => {
          const element = (event.target as HTMLElement | null)?.closest('[data-session]') as HTMLElement | null;
          const id = element?.dataset.session;
          if (!id) return;
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, id });
        }}
      >
        {sessions.length === 0 ? (
          <div
            style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-3, #6b7690)',
              font: '500 12px/1.5 var(--font, system-ui)', pointerEvents: 'none',
            }}
          >
            <IconTerminal size={22} />
            <span>Belum ada terminal. Klik + untuk membuka shell.</span>
          </div>
        ) : null}
      </div>

      {menu ? (
        <div
          role="menu"
          style={{
            position: 'fixed',
            left: Math.min(menu.x, window.innerWidth - 150),
            top: Math.min(menu.y, window.innerHeight - 110),
            zIndex: 60,
            minWidth: 140,
            padding: 4,
            background: '#0c111d',
            border: '1px solid rgba(148, 163, 184, 0.26)',
            borderRadius: 9,
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
            font: '500 12px/1.4 var(--font, system-ui)',
            color: 'var(--text, #e8edf6)',
          }}
        >
          {[
            { label: 'Copy', run: () => { void copySelection(menu.id); } },
            { label: 'Paste', run: () => { void pasteClipboard(menu.id); } },
            { label: 'Clear', run: () => sessionsRef.current.get(menu.id)?.term.clear() },
            { label: 'Cari (Ctrl+F)', run: () => { setShowSearch(true); closeMenu(); } },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px',
                background: 'transparent', border: 0, borderRadius: 6, cursor: 'pointer',
                color: 'inherit', font: 'inherit',
              }}
              onMouseEnter={(event) => { event.currentTarget.style.background = 'rgba(148, 163, 184, 0.12)'; }}
              onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
              onClick={() => { item.run(); closeMenu(); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
