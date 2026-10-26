import { useState } from 'react';
import type { AppState } from '../../shared/types';
import { IconHourglass, IconInfo, IconZap, Spinner } from './icons';
import { Badge } from './ui';

export function QueueTab({
  state,
  onError,
}: {
  state: AppState;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const holding = state.queue.holder === state.selfId;
  const holder = state.members.find((m) => m.id === state.queue.holder) ?? null;
  const myPos = state.queue.queue.indexOf(state.selfId);
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? 'Anggota';

  // Aturan main: takeTurn gagal bila masih ada antrian di depan.
  const blockedByQueue = state.queue.queue.length > 0 && myPos !== 0;
  const canTake = !holding && !blockedByQueue;
  const reason = holding
    ? 'Kamu sedang memegang giliran.'
    : blockedByQueue
      ? 'Masih ada antrian lain di depanmu.'
      : null;

  const takeTurn = async () => {
    setBusy(true);
    try {
      const res = await window.rk.takeTurn();
      if (!res.ok) onError(res.error ?? 'Gagal mengambil giliran.');
    } catch {
      onError('Gagal mengambil giliran.');
    } finally {
      setBusy(false);
    }
  };

  const releaseTurn = async () => {
    setBusy(true);
    try {
      const res = await window.rk.releaseTurn();
      if (!res.ok) onError(res.error ?? 'Gagal melepas giliran.');
    } catch {
      onError('Gagal melepas giliran.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tab">
      <div className="tab-heading">
        <div>
          <h2>Antrian Giliran</h2>
          <p>Siapa yang sedang bekerja dan siapa yang menunggu.</p>
        </div>
      </div>

      <section
        className={`turn-hero${holding ? ' holding' : ''}`}
        aria-live="polite"
        aria-label="Status giliran"
      >
        <span className={`turn-hero-icon ${holding ? 'turn-hero-icon-amber' : 'turn-hero-icon-teal'}`}>
          {holding ? <IconZap size={26} /> : <IconHourglass size={26} />}
        </span>
        <div>
          <div className="turn-hero-title">
            {holding
              ? 'Giliranmu — sedang bekerja'
              : holder
                ? `${holder.name} sedang bekerja`
                : 'Tidak ada yang memegang giliran'}
          </div>
          <div className="turn-hero-sub">
            {holding
              ? 'Lepaskan giliran saat selesai agar rekan lain bisa lanjut.'
              : holder
                ? myPos >= 0
                  ? `Kamu antre di posisi ${myPos + 1}. Tunggu giliranmu dipanggil.`
                  : 'Ambil giliran untuk mulai bekerja atau masuk antrean.'
                : 'Ruang kerja bebas — ambil giliran untuk mulai bekerja.'}
          </div>
        </div>
        <div className="turn-hero-action">
          {holding ? (
            <button type="button" className="btn btn-ghost" onClick={releaseTurn} disabled={busy}>
              {busy ? <Spinner size={15} /> : null}
              Lepas Giliran
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={takeTurn}
              disabled={!canTake || busy}
            >
              {busy ? <Spinner size={16} /> : <IconZap size={17} />}
              Ambil Giliran
            </button>
          )}
          {reason ? <span className="turn-reason">{reason}</span> : null}
        </div>
      </section>

      <section className="card" aria-label="Daftar antrean">
        <div className="card-head">
          <span className="icon-chip">
            <IconHourglass size={16} />
          </span>
          <h3 className="card-title">Antrean ({state.queue.queue.length})</h3>
        </div>
        {state.queue.queue.length === 0 ? (
          <p className="card-sub">Belum ada yang antre.</p>
        ) : (
          <div className="queue-list">
            {state.queue.queue.map((id, i) => (
              <div key={id} className={`queue-row${id === state.selfId ? ' self' : ''}`}>
                <span className="queue-pos">{i + 1}</span>
                <span className={`avatar${id === state.queue.holder ? ' avatar-host' : ''}`}>
                  {nameOf(id).charAt(0).toUpperCase()}
                </span>
                <span className="member-name">{nameOf(id)}</span>
                {id === state.selfId ? <span className="member-you">(kamu)</span> : null}
                <span className="member-end">
                  {id === state.selfId ? <Badge tone="teal">Giliranmu</Badge> : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="rules-card">
        <IconInfo size={17} />
        <span>
          <b>Aturan main:</b> hanya satu orang yang boleh bekerja pada satu waktu supaya perubahan
          berkas tidak bentrok. Ambil giliran saat ruang kerja bebas, dan lepas begitu selesai —
          orang berikutnya langsung dilanjutkan.
        </span>
      </div>
    </div>
  );
}
