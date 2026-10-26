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

function QueueNotice({ state }: { state: AppState }) {
  const notice = state.queueNotice;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!notice || (!notice.expiresAt && !notice.deferredUntil)) return;
    const id = window.setInterval(() => tick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [notice]);

  if (!notice) return null;
  const target = notice.expiresAt ?? notice.deferredUntil;
  const remaining = target ? Math.max(0, target - Date.now()) : null;
  const seconds = remaining === null ? null : Math.ceil(remaining / 1000);
  const decision = notice.mode === 'decision';
  const deferred = notice.mode === 'deferred';

  const approve = () => { void window.rk.approveQueue(notice.requesterId); };
  const defer = () => { void window.rk.deferQueue(notice.requesterId); };

  return (
    <div className={'queue-notice ' + (decision ? 'decision' : 'bar') + (deferred ? ' deferred' : '')}>
      <div className="queue-notice-main">
        <strong>{decision ? 'Giliran berikutnya menunggu' : deferred ? 'Permintaan giliran ditunda' : 'Ada anggota yang sedang antre'}</strong>
        <span>
          {decision
            ? notice.requesterName + ' ingin bekerja berikutnya.'
            : deferred
              ? 'Akan diminta kembali dalam ' + Math.floor((seconds ?? 0) / 60) + ':' + String((seconds ?? 0) % 60).padStart(2, '0')
              : notice.requesterName + ' sedang menunggu giliran.'}
        </span>
      </div>
      {decision ? (
        <div className="queue-notice-actions">
          <span className="queue-notice-countdown">{seconds ?? 0}s</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={approve}>Approve</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={defer}>Masih bekerja</button>
        </div>
      ) : null}
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
    let lastReport = 0;
    const report = () => {
      const now = Date.now();
      if (now - lastReport < 3000) return;
      lastReport = now;
      void window.rk.reportActivity('ui');
    };
    window.addEventListener('keydown', report);
    window.addEventListener('pointerdown', report);
    window.addEventListener('wheel', report, { passive: true });

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
      window.removeEventListener('keydown', report);
      window.removeEventListener('pointerdown', report);
      window.removeEventListener('wheel', report);
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
      <QueueNotice state={state} />
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
