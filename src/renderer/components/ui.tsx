import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppState } from '../../shared/types';
import { IconCheck, IconCopy, IconFolder, IconMonitor, IconWifi, IconX } from './icons';

type Tone = 'teal' | 'amber' | 'green' | 'red' | 'slate';

export function Badge({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return <span className={`dot dot-${tone}${pulse ? ' dot-pulse' : ''}`} aria-hidden="true" />;
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </label>
  );
}

export function CopyButton({
  text,
  label = 'Salin',
  className = 'btn btn-ghost btn-sm',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button type="button" className={className} onClick={copy}>
      {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
      {copied ? 'Tersalin' : label}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  desc,
  children,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
      {children}
    </div>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function formatUpdateBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return (value / Math.pow(1024, index)).toFixed(index >= 2 ? 1 : 0) + ' ' + units[index];
}

function formatUpdateSpeed(value: number): string {
  return value > 0 ? formatUpdateBytes(value) + '/s' : '…';
}

/** Baris status bawah app: versi, IP LAN, jumlah IDE. */
export function FooterBar({
  state,
  compact = false,
  onVersionClick,
}: { state: AppState; compact?: boolean; onVersionClick?: () => void }) {
  return (
    <>
      <span className="footer-item version-item" onClick={onVersionClick} role={onVersionClick ? 'button' : undefined} tabIndex={onVersionClick ? 0 : undefined} onKeyDown={onVersionClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onVersionClick(); }} : undefined}>
        <b>v{window.rk.version}</b>
        {onVersionClick && <span className="version-hint">▼</span>}
      </span>
      {state.update && (
        <span className="footer-item update-item">
          {state.update.status === 'checking' ? (
            <span className="update-status checking">Memeriksa...</span>
          ) : state.update.status === 'downloading' ? (
            <span className={'update-inline' + (compact ? ' compact' : '')} title={
              'Download ' + Math.round(state.update.progress ?? 0) + '% — ' +
              formatUpdateBytes(state.update.transferred ?? 0) + ' / ' +
              formatUpdateBytes(state.update.total ?? 0) + ' — ' +
              formatUpdateSpeed(state.update.bytesPerSecond ?? 0)
            }>
              <b className="update-inline-percent">{Math.round(state.update.progress ?? 0)}%</b>
              <span className="update-inline-track"><span style={{ width: Math.min(100, Math.max(0, state.update.progress ?? 0)) + '%' }} /></span>
              <span className="update-inline-speed">{formatUpdateSpeed(state.update.bytesPerSecond ?? 0)}</span>
            </span>
          ) : state.update.status === 'downloaded' ? (
            <button
              type="button"
              className="btn btn-ghost btn-xs update-install"
              onClick={() => window.rk.installUpdate()}
              title="Pasang pembaruan dan restart"
            >
              Pasang Sekarang
            </button>
          ) : state.update.status === 'available' ? (
            <span className="update-status available">Menyiapkan…</span>
          ) : state.update.status === 'latest' ? (
            <span className="update-status latest">Terbaru</span>
          ) : state.update.status === 'error' ? (
            <span className="update-status error" title={state.update.error ?? ''}>
              Gagal
            </span>
          ) : null}
        </span>
      )}
      <span className="footer-item">
        <IconWifi size={compact ? 12 : 13} />
        IP LAN <b>{state.lanAddress ?? 'tidak terdeteksi'}</b>
      </span>
      <span className="footer-item">
        <IconMonitor size={compact ? 12 : 13} />
        <b>{state.ides.length}</b> IDE terdeteksi
      </span>
    </>
  );
}

/** Kotak tampilan path folder + tombol pilih. */
export function FolderPicker({
  folder,
  onPick,
  disabled,
}: {
  folder: string | null;
  onPick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={`folder-box${folder ? ' filled' : ''}`}>
      <span
        style={{ flex: 'none', display: 'inline-flex', color: folder ? 'var(--teal)' : 'var(--text-3)' }}
      >
        <IconFolder size={16} />
      </span>
      {folder ? (
        <span className="folder-path" title={folder}>
          {folder}
        </span>
      ) : (
        <span className="folder-empty">Belum ada folder dipilih</span>
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={onPick} disabled={disabled}>
        Pilih Folder
      </button>
    </div>
  );
}

export function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="toast-close" onClick={onClick} aria-label={label}>
      <IconX size={14} />
    </button>
  );
}

export function VersionModal({
  open,
  onClose,
}: { open: boolean; onClose: () => void }) {
  const [releases, setReleases] = useState<Array<{
    tag: string;
    name: string | null;
    body: string | null;
    published_at: string;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    window.rk.fetchReleaseNotes().then((res) => {
      if (res.ok && res.releases) {
        setReleases(res.releases.filter((r) => !r.draft));
      } else {
        setError(res.error ?? 'Gagal memuat riwayat versi.');
      }
      setLoading(false);
    });
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label="Riwayat Versi"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Riwayat Versi & Perubahan</h3>
          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                const res = await window.rk.checkForUpdates().catch(() => null);
                console.log('update check', res);
              }}
              title="Periksa pembaruan aplikasi"
            >
              Cek Pembaruan
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              Tutup
            </button>
          </div>
        </div>
        {loading && <div className="modal-loading">Memuat riwayat versi…</div>}
        {error && <div className="modal-error">{error}</div>}
        {!loading && !error && (
          <div className="release-list">
            {releases.length === 0 ? (
              <div className="empty">
                <p>Belum ada riwayat versi.</p>
              </div>
            ) : (
              releases.map((rel) => (
                <article key={rel.tag} className="release-card">
                  <div className="release-head">
                    <div>
                      <span className="release-tag">{rel.tag}</span>
                      {rel.name && <span className="release-name">{rel.name}</span>}
                      <time className="release-date" dateTime={rel.published_at}>
                        {new Date(rel.published_at).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                  </div>
                  <div className="release-body">
                    {rel.body ? (
                      <div
                        className="release-markdown"
                        dangerouslySetInnerHTML={{ __html: markdownToHtml(rel.body) }}
                      />
                    ) : (
                      <span className="release-empty">Tidak ada catatan rilis.</span>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function markdownToHtml(md: string): string {
  return md
    .replace(/###\s+(.+)/g, '<h4>$1</h4>')
    .replace(/##\s+(.+)/g, '<h3>$1</h3>')
    .replace(/#\s+(.+)/g, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/```[\s\S]*?```/g, (m) => `<pre>${m.replace(/```/g, '').trim()}</pre>`)
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<p>\s*(<h[2-4]>)/g, '$1')
    .replace(/(<\/h[2-4]>)\s*<\/p>/g, '$1')
    .replace(/<p>\s*(<ul>)/g, '$1')
    .replace(/(<\/ul>)\s*<\/p>/g, '$1')
    .replace(/<p>\s*(<pre>)/g, '$1')
    .replace(/(<\/pre>)\s*<\/p>/g, '$1');
}
