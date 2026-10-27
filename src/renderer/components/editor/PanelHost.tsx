import type { IdeWorkbench, PanelView } from './types';
import { TerminalPane } from './TerminalPane';
import { IconPlus, IconX } from '../icons';
import { ProblemsPane } from './ProblemsPane';
import { OutputPane } from './OutputPane';
import { DebugConsolePane } from './DebugConsolePane';

interface Props {
  wb: IdeWorkbench;
  view: PanelView;
  onView: (view: PanelView) => void;
  onClose: () => void;
  onOpenFile: (path: string, line?: number) => void;
}

/** Panel bawah: Terminal / Masalah / Output / Debug Console. */
export function PanelHost({ wb, view, onView, onClose, onOpenFile }: Props) {
  const errors = wb.problems.filter((p) => p.severity === 'error').length;
  const warnings = wb.problems.filter((p) => p.severity === 'warning').length;
  const problemCount = errors + warnings;

  const tabs: Array<{ id: PanelView; label: string; badge?: { n: number; tone: 'red' | 'amber' } }> = [
    { id: 'terminal', label: 'Terminal' },
    {
      id: 'problems',
      label: 'Masalah',
      badge: problemCount > 0 ? { n: problemCount, tone: errors > 0 ? 'red' : 'amber' } : undefined,
    },
    { id: 'output', label: 'Output' },
    { id: 'debug', label: 'Debug Console' },
  ];

  return (
    <>
      <div className="ed-panel-head" role="tablist" aria-label="Panel bawah">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={view === tab.id}
            className={`ed-panel-tab${view === tab.id ? ' active' : ''}`}
            onClick={() => onView(tab.id)}
          >
            {tab.label}
            {tab.badge && <span className={`ed-panel-badge ${tab.badge.tone}`}>{tab.badge.n}</span>}
          </button>
        ))}
        <span className="ed-panel-spacer" />
        {view === 'terminal' && (
          <button
            type="button"
            className="ed-icon-btn"
            aria-label="Terminal Baru"
            title="Terminal Baru"
            onClick={() => void wb.newTerminal()}
          >
            <IconPlus size={15} />
          </button>
        )}
        <button
          type="button"
          className="ed-icon-btn"
          aria-label="Tutup Panel"
          title="Tutup Panel (Ctrl+J)"
          onClick={onClose}
        >
          <IconX size={15} />
        </button>
      </div>

      <div className="ed-panel-body">
        {view === 'terminal' && (
          <div className="ed-term-host">
            <TerminalPane
              sessions={wb.terminals}
              activeId={wb.activeTerminal}
              onSelect={wb.selectTerminal}
              onCreate={() => void wb.newTerminal()}
              onClose={wb.closeTerminal}
            />
          </div>
        )}
        {view === 'problems' && <ProblemsPane wb={wb} onOpenFile={onOpenFile} />}
        {view === 'output' && <OutputPane wb={wb} />}
        {view === 'debug' && <DebugConsolePane wb={wb} onOpenFile={onOpenFile} />}
      </div>
    </>
  );
}
