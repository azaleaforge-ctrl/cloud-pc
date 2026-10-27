import type { AppState } from '../../../shared/types';
import type { DebugStatus } from '../../../shared/editor';
import type { IdeWorkbench, PanelView } from './types';
import { IconError, IconWarn } from '../icons';

interface Props {
  wb: IdeWorkbench;
  state: AppState;
  onShowPanel: (view: PanelView) => void;
}

const DEBUG_LABEL: Record<DebugStatus, string> = {
  idle: 'Debug',
  starting: 'Memulai debug…',
  running: 'Debug berjalan',
  paused: 'Debug dijeda',
  stopped: 'Debug berhenti',
  error: 'Debug gagal',
};

const DEBUG_DOT: Record<DebugStatus, string> = {
  idle: '',
  starting: 'running',
  running: 'running',
  paused: 'paused',
  stopped: '',
  error: 'error',
};

function relPath(root: string | null, path: string): string {
  if (!root) return path;
  const normRoot = root.replace(/[\\/]+$/, '');
  if (path.toLowerCase().startsWith(normRoot.toLowerCase())) {
    return path.slice(normRoot.length).replace(/^[\\/]+/, '') || path;
  }
  return path;
}

/** Baris status paling bawah: path, kursor, bahasa, debug, giliran. */
export function StatusBar({ wb, state, onShowPanel }: Props) {
  const holding = state.queue.holder === state.selfId;
  const activeFile = wb.openFiles.find((f) => f.path === wb.activePath);
  const errors = wb.problems.filter((p) => p.severity === 'error').length;
  const warnings = wb.problems.filter((p) => p.severity === 'warning').length;

  return (
    <div className="ed-statusbar" role="contentinfo" aria-label="Status editor">
      <button
        type="button"
        className="ed-status-item"
        title="Buka Debug Console"
        onClick={() => onShowPanel('debug')}
      >
        <span className={`ed-debug-status-dot ${DEBUG_DOT[wb.debug.status]}`} aria-hidden="true" />
        {DEBUG_LABEL[wb.debug.status]}
      </button>
      <button
        type="button"
        className="ed-status-item"
        title="Buka panel Masalah"
        onClick={() => onShowPanel('problems')}
      >
        <span className="ed-status-sev-error">
          <IconError size={12} />
        </span>
        {errors}
        <span className="ed-status-sev-warning">
          <IconWarn size={12} />
        </span>
        {warnings}
      </button>
      <span className={`ed-status-item ed-status-turn${holding ? '' : ' wait'}`}>
        Giliran: {holding ? 'kamu' : 'menunggu'}
      </span>
      {wb.activePath && (
        <span className="ed-status-item ed-status-path" title={wb.activePath}>
          {relPath(state.projectPath, wb.activePath)}
        </span>
      )}
      <span className="ed-status-spacer" />
      <span className="ed-status-item">
        Ln {wb.cursor.line}, Col {wb.cursor.column}
      </span>
      {wb.cursor.selected > 0 && <span className="ed-status-item">Sel {wb.cursor.selected}</span>}
      <span className="ed-status-item">{activeFile?.language ?? 'plaintext'}</span>
      <span className="ed-status-item">Spaces: 2</span>
      <span className="ed-status-item">UTF-8</span>
      <span className="ed-status-item">LF</span>
    </div>
  );
}
