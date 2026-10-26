import { useEffect, useState, type ReactElement } from 'react';
import type { AppState } from '../../shared/types';
import { IconGlobe, IconHourglass, IconMonitor, IconServer, IconUsers, IconZap, LogoMark } from './icons';
import { RoomTab } from './RoomTab';
import { QueueTab } from './QueueTab';
import { IdeTab } from './IdeTab';
import { ServerTab } from './ServerTab';
import { WebTab } from './WebTab';
import { FooterBar, VersionModal } from './ui';

type TabId = 'room' | 'queue' | 'ide' | 'server' | 'web';

interface ShellProps {
  state: AppState;
  logs: string[];
  onError: (message: string) => void;
  onClearLogs: () => void;
  onRoomLeft: () => void;
}

export function Shell({ state, logs, onError, onClearLogs, onRoomLeft }: ShellProps) {
  const [tab, setTab] = useState<TabId>('room');
  const [showVersion, setShowVersion] = useState(false);
  const holding = state.queue.holder === state.selfId;
  const webAvailable = state.server.status === 'running' && !!state.server.url;

  // Tab Website hilang saat server berhenti - kembali ke Server.
  useEffect(() => {
    if (tab === 'web' && !webAvailable) setTab('server');
  }, [tab, webAvailable]);

  const tabs: Array<{ id: TabId; label: string; icon: ReactElement; dot?: 'green' }> = [
    { id: 'room', label: 'Ruangan', icon: <IconUsers size={17} /> },
    { id: 'queue', label: 'Antrian', icon: <IconHourglass size={17} /> },
    { id: 'ide', label: 'IDE', icon: <IconMonitor size={17} /> },
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

        <main className="content">
          {tab === 'room' ? (
            <RoomTab state={state} onError={onError} onLeft={onRoomLeft} />
          ) : tab === 'queue' ? (
            <QueueTab state={state} onError={onError} />
          ) : tab === 'ide' ? (
            <IdeTab state={state} onError={onError} />
          ) : tab === 'server' ? (
            <ServerTab
              state={state}
              logs={logs}
              onError={onError}
              onClearLogs={onClearLogs}
              onOpenWeb={() => setTab('web')}
            />
          ) : (
            <WebTab url={state.server.url ?? ''} />
          )}
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
