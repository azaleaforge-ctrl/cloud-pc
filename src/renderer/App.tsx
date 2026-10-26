import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, NotifyPayload } from '../shared/types';
import { Landing } from './components/Landing';
import { Shell } from './components/Shell';
import { Toasts, type ToastItem } from './components/Toasts';
import { LogoMark } from './components/icons';
import { FooterBar } from './components/ui';

function Splash({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  return (
    <div className="splash">
      <LogoMark size={46} />
      <div className="splash-title">Ruang Kerja</div>
      {error ? (
        <>
          <p className="splash-error">{error}</p>
          <button type="button" className="btn btn-ghost" onClick={onRetry}>
            Coba Lagi
          </button>
        </>
      ) : (
        <>
          <div className="skel skel-bar" />
          <span className="splash-sub">Menyiapkan ruang kerja…</span>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logsRef = useRef<string[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);

  const pushToast = useCallback((kind: NotifyPayload['kind'], message: string) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-4), { id, kind, message }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notifyError = useCallback((message: string) => pushToast('error', message), [pushToast]);

  const clearLogs = useCallback(() => {
    logsRef.current = [];
    setLogs([]);
  }, []);

  const resetLogsAfterLeave = useCallback(() => {
    logsRef.current = [];
    setLogs([]);
  }, []);

  useEffect(() => {
    let alive = true;

    const applyLogs = (next: string[]) => {
      logsRef.current = next;
      setLogs(next);
    };

    (async () => {
      try {
        const s = await window.rk.getState();
        if (!alive) return;
        setState((prev) => prev ?? s);
        if (logsRef.current.length === 0 && s.server.logs.length > 0) applyLogs(s.server.logs);
      } catch {
        if (alive) setLoadError('Gagal mengambil state awal dari aplikasi.');
      }
    })();

    const offState = window.rk.onState((s) => {
      setState(s);
      // Snapshot log dari main bersifat otoritatif; stream onServerLog bisa
      // lebih dulu, jadi hanya menimpa bila snapshot lebih panjang / reset.
      const snap = s.server.logs;
      const cur = logsRef.current;
      if (snap.length > cur.length) applyLogs(snap);
      else if (snap.length === 0 && (s.server.status === 'starting' || s.server.status === 'idle')) {
        applyLogs([]);
      }
    });
    const offNotify = window.rk.onNotify((n) => pushToast(n.kind, n.message));
    const offLog = window.rk.onServerLog((l) => {
      applyLogs([...logsRef.current, l.line].slice(-600));
    });

    return () => {
      alive = false;
      offState();
      offNotify();
      offLog();
    };
  }, [pushToast]);

  if (!state) {
    return (
      <>
        <Splash error={loadError} onRetry={() => window.location.reload()} />
        <Toasts items={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <div className="app">
      {state.role === 'none' ? (
        <Landing state={state} onError={notifyError} />
      ) : (
        <Shell
          state={state}
          logs={logs}
          onError={notifyError}
          onClearLogs={clearLogs}
          onRoomLeft={resetLogsAfterLeave}
        />
      )}
      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  );
}
