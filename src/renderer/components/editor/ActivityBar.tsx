import type { PanelView, SideView } from './types';
import { IconFolder, IconPlay, IconTerminal } from '../icons';

interface Props {
  sideView: SideView;
  sideOpen: boolean;
  panelView: PanelView;
  panelOpen: boolean;
  onSideView: (view: SideView) => void;
  onTogglePanel: (view: PanelView) => void;
}

/** Ikon lokal (tidak ada di icons.tsx). */
function IconSearch({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.8-3.8" />
    </svg>
  );
}

function IconBlocks({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" />
      <path d="M16.75 13.2v7.3M13.1 16.85h7.3" strokeLinecap="round" />
    </svg>
  );
}

/** Bar ikon vertikal 48px di sisi kiri, gaya VS Code. */
export function ActivityBar({ sideView, sideOpen, panelView, panelOpen, onSideView, onTogglePanel }: Props) {
  const sideItems: Array<{ id: SideView; label: string; icon: React.ReactNode }> = [
    { id: 'explorer', label: 'Explorer', icon: <IconFolder size={21} /> },
    { id: 'search', label: 'Cari', icon: <IconSearch size={21} /> },
    { id: 'extensions', label: 'Ekstensi', icon: <IconBlocks size={21} /> },
  ];

  return (
    <nav className="ed-activity" aria-label="Bar aktivitas IDE">
      {sideItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`ed-activity-btn${sideOpen && sideView === item.id ? ' active' : ''}`}
          aria-label={item.label}
          aria-pressed={sideOpen && sideView === item.id}
          title={item.label}
          onClick={() => onSideView(item.id)}
        >
          {item.icon}
        </button>
      ))}
      <span className="ed-activity-spacer" />
      <button
        type="button"
        className={`ed-activity-btn${panelOpen && panelView === 'terminal' ? ' active' : ''}`}
        aria-label="Terminal"
        aria-pressed={panelOpen && panelView === 'terminal'}
        title="Terminal (Ctrl+`)"
        onClick={() => onTogglePanel('terminal')}
      >
        <IconTerminal size={21} />
      </button>
      <button
        type="button"
        className={`ed-activity-btn${panelOpen && panelView === 'debug' ? ' active' : ''}`}
        aria-label="Debug Console"
        aria-pressed={panelOpen && panelView === 'debug'}
        title="Debug Console"
        onClick={() => onTogglePanel('debug')}
      >
        <IconPlay size={21} />
      </button>
    </nav>
  );
}
