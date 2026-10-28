import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react';
import type { AppState } from '../../shared/types';
import { IconCode, IconGlobe, IconHourglass, IconMonitor, IconServer, IconUsers, IconZap, LogoMark, IconFolder, IconExtension, IconBot } from './icons';
import { RoomTab } from './RoomTab';
import { QueueTab } from './QueueTab';
import { ExtensionsTab } from './ExtensionsTab';
import { ServerTab } from './ServerTab';
import { WebTab } from './WebTab';
import { FileTab } from './FileTab';
import { FooterBar, VersionModal } from './ui';

type TabId = 'room' | 'file' | 'queue' | 'extensions' | 'editor' | 'server' | 'web';

// Editor selalu di-mount (background), tidak di-lazy load agar terminal & state tetap hidup
import { EditorShell } from './editor/EditorShell';

interface ShellProps {
  state: AppState;
  logs: string[];
  onError: (message: string) => void;
  onClearLogs: () => void;
  onRoomLeft: () => void;
}

function EmbeddedIdeBar({ state }: { state: AppState }) {
  const ide = state.ides.find((item) => item.id === state.activeIdeId);
  return (
    <div className="embedded-ide-bar">
      <button type="button" className="embedded-ide-menu" onClick={() => window.rk.closeIde()} aria-label="Kembali ke Ruang Kerja" title="Kembali ke Ruang Kerja">
        <span className="hamburger"><i /><i /><i /></span>
      </button>
      <div className="embedded-ide-title">
        <span>{ide?.name ?? 'IDE'}</span>
        <small>{state.roomName ?? 'Ruang Kerja'}</small>
      </div>
      <button type="button" className="embedded-ide-back" onClick={() => window.rk.closeIde()}>Kembali ke Ruang Kerja</button>
    </div>
  );
}

export function Shell({ state, logs, onError, onClearLogs, onRoomLeft }: ShellProps) {
  if (state.ideMode) {
    return <div className="ide-mode-shell"><EmbeddedIdeBar state={state} /></div>;
  }
  const [tab, setTab] = useState<TabId>('room');
  const [showVersion, setShowVersion] = useState(false);
  const [checkingUpdate, setChecking] = useState(false);
  const [webUrl, setWebUrl] = useState(state.server.url ?? '');
  const holding = state.queue.holder === state.selfId;
  const webAvailable = state.server.status === 'running' && !!state.server.url;

  // Tab Website hilang saat server berhenti - kembali ke Server.
  useEffect(() => {
    if (tab === 'web' && !webAvailable) setTab('server');
  }, [tab, webAvailable]);

  // Sync webUrl with server.url when it changes (e.g., server starts)
  useEffect(() => {
    if (state.server.url && state.server.url !== webUrl) {
      setWebUrl(state.server.url);
    }
  }, [state.server.url]);

  const handleWebUrlChange = (url: string) => {
    setWebUrl(url);
  };

  const tabs: Array<{ id: TabId; label: string; icon: ReactElement; dot?: 'green' }> = [
    { id: 'room', label: 'Ruangan', icon: <IconUsers size={17} /> },
    { id: 'file', label: 'File', icon: <IconFolder size={17} /> },
    { id: 'editor', label: 'Editor', icon: <IconCode size={17} /> },
    { id: 'queue', label: 'Antrian', icon: <IconHourglass size={17} /> },
    { id: 'extensions', label: 'Ekstensi', icon: <IconExtension size={17} /> },
    { id: 'server', label: 'Server', icon: <IconServer size={17} /> },
  ];
  if (webAvailable) {
    tabs.push({ id: 'web', label: 'Website', icon: <IconGlobe size={17} />, dot: 'green' });
  }

  return (
    <div className="shell">
      <header className="app-header">
        <div className="brand">
          <LogoMark size={24} />
          <div className="brand-name">Ruang Kerja</div>
        </div>
        <div className="header-divider" />
        <div className="header-room">
          <span className="header-room-name">{state.roomName}</span>
          <span className="header-code">{state.code}</span>
        </div>
        <div className="header-right">
          {holding ? (
            <span className="turn-pill">
              <IconZap size={14} />
              Kamu memegang giliran
            </span>
          ) : null}
          <span className="role-chip">{state.role === 'host' ? 'Host' : 'Anggota'}</span>
          {tab === 'editor' && (
            <button
              type="button"
              className="ai-header-btn"
              title="AI Agent Chat (Ctrl+Shift+L)"
              onClick={() => window.dispatchEvent(new CustomEvent('rk:ai-chat-toggle'))}
            >
              <IconBot size={18} />
            </button>
          )}
        </div>
      </header>

      <div className="shell-body">
        <nav className="sidebar" aria-label="Navigasi tab">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`nav-item${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              {t.icon}
              {t.label}
              {t.dot ? <span className={`dot dot-${t.dot} nav-dot`} /> : null}
            </button>
          ))}
          <div className="sidebar-foot">
            <FooterBar state={state} compact />
          </div>
        </nav>

        <main className={'content' + (tab === 'editor' ? ' content-editor' : '')}>
          {tab === 'room' ? (
            <RoomTab state={state} onError={onError} onLeft={onRoomLeft} />
          ) : tab === 'file' ? (
            <FileTab state={state} />
          ) : tab === 'queue' ? (
            <QueueTab state={state} onError={onError} />
          ) : tab === 'extensions' ? (
            <ExtensionsTab state={state} onError={onError} />
          ) : tab === 'server' ? (
            <ServerTab
              state={state}
              logs={logs}
              onError={onError}
              onClearLogs={onClearLogs}
              onOpenWeb={() => setTab('web')}
            />
          ) : tab === 'web' ? (
            <WebTab
              url={webUrl}
              projectPath={state.projectPath}
              onUrlChange={handleWebUrlChange}
            />
          ) : null}
          <EditorShell state={state} active={tab === 'editor'} onError={onError} />
        </main>
      </div>

      <footer className="app-footer">
        <FooterBar state={state} onVersionClick={() => setShowVersion(true)} />
        <span className="footer-item" style={{ marginLeft: 'auto' }}>
          {state.hostAddress ? (
            <>
              Host <b>{state.hostAddress}</b>
            </>
          ) : (
            <>
              Sinkron <b>{state.sync.files} berkas</b>
            </>
          )}
        </span>
      </footer>
      <VersionModal open={showVersion} onClose={() => setShowVersion(false)} />
    </div>
  );
}
