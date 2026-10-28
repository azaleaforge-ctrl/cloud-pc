import { useEffect, useState } from 'react';
import type { AppState } from '../../shared/types';
import { IconHourglass, IconInfo, IconZap, IconUserCheck } from './icons';
import { Badge } from './ui';

export function QueueTab({
  state,
  onError,
}: {
  state: AppState;
  onError: (message: string) => void;
}) {
  const holding = state.queue.holder === state.selfId;
  const agentBusy = state.queue.agentBusy === true;
  const holder = state.members.find((m) => m.id === state.queue.holder) ?? null;
  const myPos = state.queue.queue.indexOf(state.selfId);
  const nameOf = (id: string) => state.members.find((m) => m.id === id)?.name ?? 'Anggota';

  const holderName = holder?.name ?? '—';
  const isIdle = !state.queue.holder;
  const startedAt = state.queue.holderStartedAt;
  const [nowTick, setNowTick] = useState(Date.now());

  // Hitung durasi bekerja + countdown idle (untuk UI, sekadar referensi visual)
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const formatDuration = (ms: number): string => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}m ${s}s`;
  };

  // Listener error dari queue (tidak dipakai lagi tapi tetap di API)
  void onError;

  return (
    <div className="tab">
      <div className="tab-heading">
        <div>
          <h2>Antrian Giliran</h2>
          <p>Sistem antrian real-time: otomatis saat mulai bekerja, manual request, atau idle timeout.</p>
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
              ? agentBusy ? 'AI Coding Agent sedang bekerja' : 'Giliranmu - sedang bekerja'
              : isIdle
                ? 'Ruang kerja kosong'
                : agentBusy ? `${holderName} menjalankan AI Coding Agent` : `${holderName} sedang bekerja`}
          </div>
          <div className="turn-hero-sub">
            {agentBusy && !isIdle
              ? 'Giliran tetap terkunci selama AI menyelesaikan tugas. Antrian akan meminta keputusan setelah agent selesai.'
              : startedAt && !isIdle
                ? `${nameOf(state.queue.holder!)} bekerja selama ${formatDuration(nowTick - startedAt)}`
                : holding
                  ? 'Giliran akan otomatis dilepas setelah 2 menit tidak ada aktivitas.'
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

      {!isIdle && !holding && (
        <div className="turn-request-bar">
          <button
            type="button"
            className="btn btn-warning btn-sm"
            onClick={async () => {
              const res = await window.rk.requestTurn();
              if (!res.ok) onError(res.error ?? 'Gagal meminta giliran.');
            }}
          >
            <IconUserCheck size={14} /> Meminta Giliran
          </button>
          <span className="turn-request-hint">
            Minta giliran ke {holderName}. {holderName} akan menerima notifikasi.
          </span>
        </div>
      )}

      {holding && (
        <section className="card" aria-label="Idle timer">
          <div className="card-head">
            <span className="icon-chip">
              <IconHourglass size={16} />
            </span>
            <h3 className="card-title">{agentBusy ? 'AI Coding Agent aktif' : 'Idle Auto-Release'}</h3>
          </div>
          <p className="card-sub">
            {agentBusy
              ? 'Timer idle ditangguhkan selama AI mengerjakan tugas. Giliran tetap milikmu sampai agent selesai atau kamu menghentikannya.'
              : 'Giliran akan otomatis dilepas setelah 2 menit tidak ada aktivitas. Setelah dilepas, rekan berikutnya bisa mendapat giliran.'}
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={agentBusy}
            title={agentBusy ? 'Hentikan AI Coding Agent terlebih dahulu.' : 'Lepas giliran sekarang'}
            onClick={async () => {
              const res = await window.rk.releaseTurn();
              if (!res.ok) onError(res.error ?? 'Gagal melepas giliran.');
            }}
          >
            {agentBusy ? 'AI sedang bekerja…' : 'Lepas Giliran Sekarang'}
          </button>
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
            {agentBusy ? holderName + ' sedang menjalankan AI Coding Agent.' : holderName + ' sedang bekerja.'}
            {' '}Kamu antre di posisi {myPos >= 0 ? myPos + 1 : '-'} dan akan mendapatkan giliran
            setelah pekerjaan selesai dan aturan antrian diproses.
          </p>
          {myPos >= 0 ? null : (
            <p className="card-sub">
              Kamu tidak ada di antrian. Klik "Meminta Giliran" di atas untuk masuk ke antrian.
            </p>
          )}
        </section>
      )}

      <section className="card" aria-label="Daftar anggota sedang bekerja">
        <div className="card-head">
          <span className="icon-chip">
            <IconZap size={16} />
          </span>
          <h3 className="card-title">Sedang Bekerja</h3>
        </div>
        {!isIdle ? (
          <div className="queue-list">
            <div className={`queue-row${state.queue.holder === state.selfId ? ' self' : ''}`}>
              <span className="queue-pos">#</span>
              <span className={`avatar${state.queue.holder === state.selfId ? ' avatar-host' : ''}`}>
                {holderName.charAt(0).toUpperCase()}
              </span>
              <span className="member-name">{holderName}</span>
              {state.queue.holder === state.selfId ? <span className="member-you">(kamu)</span> : null}
              <span className="member-end">
                {agentBusy ? <Badge tone="amber">AI Coding</Badge> : <Badge tone={state.queue.holder === state.selfId ? 'amber' : 'teal'}>Bekerja</Badge>}
              </span>
              {startedAt ? (
                <span className="queue-time">{formatDuration(nowTick - startedAt)}</span>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="card-sub">Tidak ada yang sedang bekerja.</p>
        )}
      </section>

      <section className="card" aria-label="Daftar antrean">
        <div className="card-head">
          <span className="icon-chip">
            <IconHourglass size={16} />
          </span>
          <h3 className="card-title">Antrean Menunggu ({state.queue.queue.length})</h3>
        </div>
        {state.queue.queue.length === 0 ? (
          <p className="card-sub">Belum ada yang antre.</p>
        ) : (
          <div className="queue-list">
            {state.queue.queue.map((id, i) => (
              <div key={id} className={`queue-row${id === state.selfId ? ' self' : ''}`}>
                <span className="queue-pos">{i + 1}</span>
                <span className="avatar">{nameOf(id).charAt(0).toUpperCase()}</span>
                <span className="member-name">{nameOf(id)}</span>
                {id === state.selfId ? <span className="member-you">(kamu)</span> : null}
                <span className="member-end">
                  {id === state.selfId ? <Badge tone="amber">Giliranmu</Badge> : <Badge tone="slate">Menunggu</Badge>}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="rules-card">
        <IconInfo size={17} />
        <span>
          <b>Aturan otomatis:</b> giliran mengikuti aktivitas editor dan terminal. Ketika AI Coding Agent sedang berjalan,
          giliran tidak dilepas oleh timer idle. Setelah agent selesai, pemegang giliran diberi waktu 15 detik untuk
          menerima atau menunda permintaan berikutnya; jika tidak merespons, antrian disetujui otomatis.
        </span>
      </div>
    </div>
  );
}
