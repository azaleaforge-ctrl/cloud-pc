import { useEffect } from 'react';
import type { NotifyPayload } from '../../shared/types';
import { IconError, IconInfo, IconWarn, IconX, IconZap } from './icons';

export interface ToastItem {
  id: number;
  kind: NotifyPayload['kind'];
  message: string;
}

const DURATION_MS: Record<NotifyPayload['kind'], number> = {
  info: 5000,
  warn: 5000,
  error: 5000,
  turn: 5000,
};

const ICONS: Record<NotifyPayload['kind'], typeof IconInfo> = {
  info: IconInfo,
  warn: IconWarn,
  error: IconError,
  turn: IconZap,
};

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const h = window.setTimeout(() => onDismiss(item.id), DURATION_MS[item.kind]);
    return () => window.clearTimeout(h);
  }, [item.id, item.kind, onDismiss]);

  const Icon = ICONS[item.kind];
  return (
    <div className={`toast toast-${item.kind}`}>
      <span className="toast-icon">
        <Icon size={17} />
      </span>
      <span className="toast-msg">{item.message}</span>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(item.id)}
        aria-label="Tutup notifikasi"
      >
        <IconX size={14} />
      </button>
    </div>
  );
}

export function Toasts({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" aria-live="polite" role="status">
      {items.map((t) => (
        <Toast key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
