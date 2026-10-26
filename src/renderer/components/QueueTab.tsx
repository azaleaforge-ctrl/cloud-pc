import { useEffect, useState } from 'react';
import type { AppState } from '../../shared/types';
import { IconHourglass, IconInfo, IconZap } from './icons';
import { Badge } from './ui';

export function QueueTab({
  state,
  onError,
}: {
  state: AppState;
  onError: (message: string) => void;
}) {
  const holding = state.queue.holder === state.selfId;
  const holder = state.members.find((m) => m.id === state.queue.holder) ?? null;
  const myPos = state.queue.queue.indexOf(state.selfId);
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? 'Anggota';

  const holderName = holder?.name ?? '—';
  const isIdle = !state.queue.holder;

  // Hitung countdown idle (untuk UI, sekadar referensi visual)
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Listener error dari queue (tidak dipakai lagi tapi tetap di API)
  void onError;

  return (
    <div className="tab">
      <div className="tab-heading">
        <div>
          <h2>Antrian Giliran</h2>
          <p>Giliran dikerjakan otomatis — mulailah mengedit berkas untuk dapat giliran.</p>
        </div>
      </div>

      <section
        className={`turn-hero${holding ? ' holding' : ''} ${isIdle ? ' idle' : ''}`}
        aria-live="polite"
        aria-label="Status giliran"
      >
        <span className={`turn-hero-icon ${holding ? 'turn-hero-icon-amber' : isIdle ? 'turn-hero-icon-teal' : 'turn-hero-icon-amber'}`}>
          {holding ? <IconZap size={26} /> : <IconHourglass size={26} />}
        </span>
        <div>
          <div className="turn-hero-title">
            {holding
              ? 'Giliranmu - sedang bekerja'
              : isIdle
                ? 'Ruang kerja kosong'
                : `${holderName} sedang bekerja`}
          </div>
          <div className="turn-hero-sub">
            {holding
              ? 'Giliran akan otomatis dilepas setelah 2 menit tidak ada perubahan berkas.'
              : isIdle
                ? myPos >= 0
                  ? `Kamu antre di posisi ${myPos + 1}. Mulai edit untuk dapat giliran.`
                  : 'Ruang kerja kosong. Mulai edit berkas untuk dapat giliran otomatis.'
                : myPos >= 0
                  ? `Kamu antre di posisi ${myPos + 1}. Tunggu giliranmu.`
                  : 'Pegang giliran saat ruang kosong dengan mulai mengedit.'}
          </div>
        </div>
      </section>

      {holding && (
        <section className="card" aria-label="Idle timer">
          <div className="card-head">
            <span className="icon-chip">
              <IconHourglass size={16} />
            </span>
            <h3 className="card-title">Idle Auto-Release</h3>
          </div>
          <p className="card-sub">
            Giliran akan otomatis dilepas jika tidak ada perubahan selama 2 menit.
            Setelah melepas, rekan berikutnya langsung dapat giliran.
          </p>
        </section>
      )}

      {!holding && !isIdle && (
        <section className="card" aria-label="Waiting state">
          <div className="card-head">
            <span className="icon-chip">
              <IconInfo size={16} />
            </span>
            <h3 className="card-title">Menunggu Giliran</h3>
          </div>
          <p className="card-sub">
            {holderName} sedang bekerja. Kamu antre di posisi {myPos >= 0 ? myPos + 1 : '-'} dan akan
            mendapatkan giliran otomatis saat {holderName} selesai.
          </p>
        </section>
      )}

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
                  {id === state.selfId ? <Badge tone="amber">Giliranmu</Badge> : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="rules-card">
        <IconInfo size={17} />
        <span>
          <b>Aturan otomatis:</b> giliran diberikan otomatis saat kamu mulai mengedit berkas.
          Setelah 2 menit tidak ada perubahan, giliran dilepas otomatis dan rekan berikutnya
          dilanjutkan.
        </span>
      </div>
    </div>
  );
}
