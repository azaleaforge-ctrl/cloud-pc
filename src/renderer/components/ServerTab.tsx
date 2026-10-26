import { useEffect, useRef, useState } from 'react';
import type { AppState, ServerStatus } from '../../shared/types';
import {
  IconExternal,
  IconGlobe,
  IconInfo,
  IconPlay,
  IconPower,
  IconRefresh,
  IconServer,
  IconStop,
  IconTerminal,
  IconTrash,
  Spinner,
} from './icons';
import { Badge } from './ui';

const STATUS_BADGE: Record<ServerStatus, { tone: 'teal' | 'green' | 'red' | 'slate'; label: string; pulse?: boolean }> = {
  idle: { tone: 'slate', label: 'Idle' },
  starting: { tone: 'teal', label: 'Menyalakan…', pulse: true },
  running: { tone: 'green', label: 'Berjalan' },
  stopped: { tone: 'slate', label: 'Berhenti' },
  error: { tone: 'red', label: 'Error' },
};

export function ServerTab({
  state,
  logs,
  onError,
  onClearLogs,
  onOpenWeb,
}: {
  state: AppState;
  logs: string[];
  onError: (message: string) => void;
  onClearLogs: () => void;
  onOpenWeb: () => void;
}) {
  const isHost = state.role === 'host';
  const fw = state.framework;
  const server = state.server;
  const status = STATUS_BADGE[server.status];

  const [busy, setBusy] = useState(false);
  const [rescanning, setRescanning] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
    setAutoScroll(atBottom);
  };

  const toggleServer = async () => {
    setBusy(true);
    try {
      const res = server.status === 'running' || server.status === 'starting'
        ? await window.rk.stopServer()
        : await window.rk.startServer();
      if (!res.ok) onError(res.error ?? 'Aksi server gagal.');
    } catch {
      onError('Aksi server gagal.');
    } finally {
      setBusy(false);
    }
  };

  const rescanFramework = async () => {
    setRescanning(true);
    try {
      await window.rk.rescanFramework();
    } catch {
      onError('Gagal memindai framework project.');
    } finally {
      setRescanning(false);
    }
  };

  return (
    <div className="tab">
      <div className="tab-heading">
        <div>
          <h2>Server Dev</h2>
          <p>Nyalakan dev server project dan pantau keluarannya.</p>
        </div>
      </div>

      <div className="server-tab">
        <div className="server-left">
          <section className="card" aria-label="Framework terdeteksi">
            <div className="card-head">
              <span className="icon-chip">
                <IconServer size={16} />
              </span>
              <h3 className="card-title">Framework</h3>
              <div className="card-title-row">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={rescanFramework}
                  disabled={rescanning}
                >
                  {rescanning ? <Spinner size={13} /> : <IconRefresh size={13} />}
                  Rescan
                </button>
              </div>
            </div>
            {fw ? (
              <dl className="kv-list">
                <div className="kv-row">
                  <dt className="kv-key">Nama</dt>
                  <dd className="kv-val">{fw.name}</dd>
                </div>
                <div className="kv-row">
                  <dt className="kv-key">Perintah</dt>
                  <dd className="kv-val mono">{fw.command}</dd>
                </div>
                <div className="kv-row">
                  <dt className="kv-key">Package manager</dt>
                  <dd className="kv-val">
                    <Badge tone="teal">{fw.packageManager}</Badge>
                  </dd>
                </div>
                <div className="kv-row">
                  <dt className="kv-key">Port</dt>
                  <dd className="kv-val mono">{fw.detectedPort ?? 'otomatis'}</dd>
                </div>
                {fw.notes ? (
                  <div className="kv-row">
                    <dt className="kv-key">Catatan</dt>
                    <dd className="kv-val card-sub">{fw.notes}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="card-sub">
                Framework belum terdeteksi. Coba Rescan, atau pastikan folder project berisi project
                yang dikenal (Node, PHP, Python, dll).
              </p>
            )}
          </section>

          <section className="card" aria-label="Kontrol server">
            <div className="card-head">
              <span className="icon-chip">
                <IconPower size={16} />
              </span>
              <h3 className="card-title">Kontrol</h3>
              <div className="card-title-row">
                <Badge tone={status.tone}>
                  {status.pulse ? <span className="dot dot-teal dot-pulse" /> : null}
                  {status.label}
                </Badge>
              </div>
            </div>

            {!isHost ? (
              <div className="server-note">
                <IconInfo size={16} />
                <span>
                  Server dijalankan oleh host. Kamu bisa melihat status dan log di sini, tapi tidak
                  bisa menyalakan atau mematikan.
                </span>
              </div>
            ) : null}

            {server.error ? (
              <div className="server-error" role="alert">
                <IconInfo size={15} />
                <span>{server.error}</span>
              </div>
            ) : null}

            {server.status === 'running' && server.url ? (
              <div className="server-url">
                <IconGlobe size={15} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{server.url}</span>
              </div>
            ) : null}

            {isHost ? (
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                {server.status === 'running' || server.status === 'starting' ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={toggleServer}
                    disabled={busy || server.status === 'starting'}
                  >
                    {busy ? <Spinner size={15} /> : <IconStop size={15} />}
                    Matikan Server
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={toggleServer}
                    disabled={busy || !fw}
                  >
                    {busy ? <Spinner size={15} /> : <IconPlay size={15} />}
                    Nyalakan Server
                  </button>
                )}
                {server.status === 'running' && server.url ? (
                  <button type="button" className="btn btn-ghost" onClick={onOpenWeb}>
                    <IconExternal size={15} />
                    Buka Website
                  </button>
                ) : null}
              </div>
            ) : server.status === 'running' && server.url ? (
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button type="button" className="btn btn-ghost" onClick={onOpenWeb}>
                  <IconExternal size={15} />
                  Buka Website
                </button>
              </div>
            ) : null}
          </section>
        </div>

        <section className="card log-card" aria-label="Log server">
          <div className="card-head">
            <span className="icon-chip">
              <IconTerminal size={16} />
            </span>
            <h3 className="card-title">Log Terminal</h3>
            <div className="card-title-row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClearLogs}>
                <IconTrash size={13} />
                Bersihkan
              </button>
            </div>
          </div>
          <div className="log-panel" ref={logRef} onScroll={onLogScroll}>
            {logs.length === 0 ? (
              <div className="log-empty">
                Belum ada log. Nyalakan server untuk melihat keluaran dev server di sini.
              </div>
            ) : (
              logs.map((line, i) => (
                <div key={i} className="log-line">
                  {line}
                </div>
              ))
            )}
          </div>
          <div className="log-foot">
            <span>{logs.length} baris</span>
            <span>{autoScroll ? 'Gulir otomatis aktif' : 'Gulir otomatis pause - naikkan ke bawah untuk lanjut'}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
