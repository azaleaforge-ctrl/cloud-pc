import { useMemo } from 'react';
import type { IdeWorkbench, ProblemItem } from './types';
import { IconError, IconInfo, IconWarn } from '../icons';

interface Props {
  wb: IdeWorkbench;
  onOpenFile: (path: string, line?: number) => void;
}

const SEV_ICON = {
  error: <IconError size={13} className="sev-error" />,
  warning: <IconWarn size={13} className="sev-warning" />,
  info: <IconInfo size={13} className="sev-info" />,
} as const;

/** Panel Masalah: daftar diagnostic dikelompokkan per file. */
export function ProblemsPane({ wb, onOpenFile }: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, ProblemItem[]>();
    for (const p of wb.problems) {
      const list = map.get(p.path);
      if (list) list.push(p);
      else map.set(p.path, [p]);
    }
    return [...map.entries()];
  }, [wb.problems]);

  if (wb.problems.length === 0) {
    return (
      <div className="ed-problems">
        <div className="ed-empty">Tidak ada masalah terdeteksi.</div>
      </div>
    );
  }

  return (
    <div className="ed-problems" role="list" aria-label="Daftar masalah">
      {groups.map(([path, items]) => (
        <div role="listitem" key={path}>
          <div className="ed-problem-file" title={path}>
            {path.split(/[\\/]/).pop()}
            <small style={{ fontWeight: 400, color: 'var(--ed-text-3)' }}>{items.length}</small>
          </div>
          {items.map((p, i) => (
            <button
              type="button"
              key={`${p.line}-${p.column}-${i}`}
              className="ed-problem-row"
              onClick={() => onOpenFile(p.path, p.line)}
              title={`${p.message}${p.source ? ` (${p.source})` : ''}`}
            >
              {SEV_ICON[p.severity]}
              <span className="ed-problem-msg">{p.message}</span>
              {p.source && <span className="ed-problem-loc">{p.source}</span>}
              <span className="ed-problem-loc">
                baris {p.line}, kolom {p.column}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
