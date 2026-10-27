import { useEffect, useRef, useState } from 'react';
import type { DebugStatus } from '../../../shared/editor';
import type { IdeWorkbench } from './types';
import { IconPlay, IconStop } from '../icons';

interface Props {
  wb: IdeWorkbench;
  onOpenFile: (path: string, line?: number) => void;
}

const STATUS_LABEL: Record<DebugStatus, string> = {
  idle: 'Tidak aktif',
  starting: 'Memulai…',
  running: 'Berjalan',
  paused: 'Dijeda',
  stopped: 'Berhenti',
  error: 'Gagal',
};

const STATUS_DOT: Record<DebugStatus, string> = {
  idle: '',
  starting: 'running',
  running: 'running',
  paused: 'paused',
  stopped: '',
  error: 'error',
};

/** Panel Debug Console: status sesi, kontrol, frame, evaluasi ekspresi. */
export function DebugConsolePane({ wb, onOpenFile }: Props) {
  const [expr, setExpr] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const d = wb.debug;
  const canStart = d.status === 'idle' || d.status === 'stopped' || d.status === 'error';
  const canStop = d.status === 'starting' || d.status === 'running' || d.status === 'paused';
  const paused = d.status === 'paused';

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [d.lines.length]);

  const submit = async () => {
    const text = expr.trim();
    if (!text) return;
    setHistory((h) => [...h.filter((x) => x !== text), text].slice(-50));
    setHistIdx(-1);
    setExpr('');
    await wb.evaluateDebug(text);
  };

  return (
    <div className="ed-debug">
      <div className="ed-debug-toolbar">
        <span className="ed-debug-status">
          <span className={`ed-debug-status-dot ${STATUS_DOT[d.status]}`} aria-hidden="true" />
          {STATUS_LABEL[d.status]}
        </span>
        {canStart && (
          <button type="button" className="ed-debug-btn primary" onClick={() => void wb.startDebug()}>
            <IconPlay size={13} /> Mulai
          </button>
        )}
        {paused && (
          <button type="button" className="ed-debug-btn primary" onClick={() => void wb.resumeDebug()}>
            <IconPlay size={13} /> Lanjut
          </button>
        )}
        {paused && (
          <>
            <button type="button" className="ed-debug-btn" onClick={() => void wb.stepDebug('over')}>
              Step Over
            </button>
            <button type="button" className="ed-debug-btn" onClick={() => void wb.stepDebug('into')}>
              Step Into
            </button>
            <button type="button" className="ed-debug-btn" onClick={() => void wb.stepDebug('out')}>
              Step Out
            </button>
          </>
        )}
        {canStop && (
          <button type="button" className="ed-debug-btn" onClick={() => void wb.stopDebug()}>
            <IconStop size={13} /> Hentikan
          </button>
        )}
      </div>

      {d.error && <div className="ed-debug-error" role="alert">{d.error}</div>}

      {d.frames.length > 0 && (
        <div className="ed-frames" aria-label="Call stack">
          {d.frames.map((frame) => (
            <button
              type="button"
              key={frame.id}
              className="ed-frame"
              onClick={() => frame.file && onOpenFile(frame.file, frame.line)}
              title={frame.file ? `${frame.file}:${frame.line}` : `baris ${frame.line}`}
            >
              <span className="ed-frame-name">{frame.name}</span>
              <span className="ed-frame-loc">
                {frame.file ? `${frame.file.split(/[\\/]/).pop()}:${frame.line}` : `baris ${frame.line}`}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="ed-debug-scroll" ref={scrollRef}>
        {d.lines.length > 0 ? (
          d.lines.map((line, i) => <div key={i}>{line || '\u00a0'}</div>)
        ) : (
          <div className="ed-empty-inline">Belum ada output debug.</div>
        )}
      </div>

      <div className="ed-debug-input-row">
        <span className="ed-debug-prompt" aria-hidden="true">
          &gt;
        </span>
        <input
          className="ed-debug-input"
          type="text"
          value={expr}
          placeholder="Evaluasi ekspresi…"
          aria-label="Evaluasi ekspresi debug"
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            } else if (e.key === 'ArrowUp' && history.length > 0) {
              e.preventDefault();
              const next = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
              setHistIdx(next);
              setExpr(history[next] ?? '');
            } else if (e.key === 'ArrowDown' && histIdx >= 0) {
              e.preventDefault();
              const next = histIdx + 1;
              if (next >= history.length) {
                setHistIdx(-1);
                setExpr('');
              } else {
                setHistIdx(next);
                setExpr(history[next] ?? '');
              }
            }
          }}
        />
      </div>
    </div>
  );
}
