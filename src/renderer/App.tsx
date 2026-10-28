import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, NotifyPayload } from '../shared/types';
import { Landing } from './components/Landing';
import { Shell } from './components/Shell';
import { Toasts, type ToastItem } from './components/Toasts';
import { IconCheck, IconError, IconInfo, IconRefresh, LogoMark, IconDownload } from './components/icons';
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
  const conflict = notice.mode === 'conflict';

  const approve = () => { void window.rk.approveQueue(notice.requesterId); };
  const defer = () => { void window.rk.deferQueue(notice.requesterId); };

  return (
    <div className={'queue-notice ' + (conflict ? 'conflict' : decision ? 'decision' : 'bar') + (deferred ? ' deferred' : '')}>
      <div className="queue-notice-main">
        <strong>
          {conflict
            ? 'Ada yang meminta giliran'
            : decision
              ? 'Giliran berikutnya menunggu'
              : deferred
                ? 'Permintaan giliran ditunda'
                : 'Ada anggota yang sedang antre'}
        </strong>
        <span>
          {conflict
            ? notice.requesterName + ' meminta giliran saat kamu sedang bekerja. Selesaikan atau lepaskan giliranmu.'
            : decision
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

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.max(0, Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1));
  const amount = value / Math.pow(1024, index);
  return amount.toFixed(index >= 2 ? 1 : 0) + ' ' + units[index];
}

function formatSpeed(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'Mengukur kecepatan…';
  return formatBytes(value) + '/s';
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return Math.ceil(seconds) + ' dtk tersisa';
  return Math.floor(seconds / 60) + ' m ' + Math.ceil(seconds % 60) + ' dtk tersisa';
}

function UpdateNotice({ state }: { state: AppState }) {
  const update = state.update;
  const [actionPending, setActionPending] = useState(false);
  const [errorVisible, setErrorVisible] = useState(true);
  const isError = update.status === 'error';
  const visible = ['checking', 'available', 'downloading', 'downloaded', 'error'].includes(update.status);

  useEffect(() => {
    if (!isError) {
      setErrorVisible(true);
      return;
    }
    setErrorVisible(true);
    const timer = window.setTimeout(() => setErrorVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [isError, update.error, update.version]);

  if (!visible || (isError && !errorVisible)) return null;

  const progress = Math.min(100, Math.max(0, update.progress ?? 0));
  const transferred = update.transferred ?? 0;
  const total = update.total ?? 0;
  const speed = update.bytesPerSecond ?? 0;
  const remainingBytes = Math.max(0, total - transferred);
  const eta = speed > 0 && total > 0 ? formatEta(remainingBytes / speed) : '';
  const retry = async () => {
    setActionPending(true);
    try { await window.rk.checkForUpdates(); }
    finally { setActionPending(false); }
  };
  const download = async () => {
    setActionPending(true);
    try { await window.rk.downloadUpdate(); }
    finally { setActionPending(false); }
  };
  const install = async () => {
    setActionPending(true);
    try { await window.rk.installUpdate(); }
    finally { setActionPending(false); }
  };

  const title = update.status === 'checking' ? 'Memeriksa pembaruan'
    : update.status === 'available' ? 'Pembaruan tersedia'
    : update.status === 'downloading' ? 'Mengunduh Ruang Kerja ' + (update.version ?? '')
    : update.status === 'downloaded' ? 'Pembaruan siap dipasang'
    : 'Pembaruan gagal';

  return (
    <aside className={'update-notice update-notice-' + update.status} role="status" aria-live="polite">
      <div className="update-notice-heading">
        <span className="update-notice-icon">
          {update.status === 'error' ? <IconError size={18} /> : update.status === 'downloaded' ? <IconCheck size={18} /> : <IconInfo size={18} />}
        </span>
        <div className="update-notice-copy">
          <strong>{title}</strong>
          <span>{update.status === 'checking' ? 'Memeriksa rilis terbaru dari GitHub…'
            : update.status === 'available' ? 'Klik tombol Update untuk mengunduh.'
            : update.status === 'downloading' ? 'Notifikasi ini akan tetap tampil sampai proses unduhan selesai.'
            : update.status === 'downloaded' ? 'File sudah diunduh dan siap diverifikasi oleh installer.'
            : (update.error ?? 'Unduhan tidak berhasil diselesaikan.')}</span>
        </div>
      </div>
      {update.status === 'downloading' || update.status === 'available' || update.status === 'downloaded' ? (
        <div className="update-notice-progress">
          <div className="update-progress-track" aria-label={'Progres download ' + Math.round(progress) + '%'}>
            <span style={{ width: progress + '%' }} />
          </div>
          <div className="update-progress-meta">
            <b>{Math.round(progress)}%</b>
            <span>{total > 0 ? formatBytes(transferred) + ' / ' + formatBytes(total) : update.status === 'downloaded' ? 'Download selesai' : update.status === 'available' ? 'Siap diunduh' : 'Menyiapkan ukuran file…'}</span>
          </div>
          {update.status === 'downloading' ? (
            <div className="update-progress-details">
              <span>Kecepatan <b>{formatSpeed(speed)}</b></span>
              {eta ? <span>{eta}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {update.status === 'available' ? (
        <button type="button" className="btn btn-warning btn-sm update-notice-action" onClick={() => void download()} disabled={actionPending}>
          <IconDownload size={14} /> Update
        </button>
      ) : update.status === 'downloaded' ? (
        <button type="button" className="btn btn-primary btn-sm update-notice-action" onClick={() => void install()} disabled={actionPending}>
          <IconCheck size={14} /> Pasang & mulai ulang
        </button>
      ) : update.status === 'error' ? (
        <button type="button" className="btn btn-ghost btn-sm update-notice-action" onClick={() => void retry()} disabled={actionPending}>
          <IconRefresh size={14} /> {actionPending ? 'Memeriksa…' : 'Coba lagi'}
        </button>
      ) : null}
    </aside>
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
      <UpdateNotice state={state} />
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
