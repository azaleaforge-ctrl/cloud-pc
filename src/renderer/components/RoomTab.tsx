import { useState } from 'react';
import type { AppState, SyncState } from '../../shared/types';
import { IconInfo, IconKey, IconLogout, IconUsers } from './icons';
import { Badge, CopyButton, Dot, Modal } from './ui';

function syncBadge(sync: SyncState) {
  switch (sync.status) {
    case 'syncing':
      return <Badge tone="teal">Menyinkronkan…</Badge>;
    case 'ready':
      return <Badge tone="green">Siap</Badge>;
    case 'error':
      return <Badge tone="red">Gagal</Badge>;
    default:
      return <Badge tone="slate">Nonaktif</Badge>;
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function RoomTab({
  state,
  onError,
  onLeft,
}: {
  state: AppState;
  onError: (message: string) => void;
  onLeft: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const leave = async () => {
    setLeaving(true);
    try {
      await window.rk.leaveRoom();
      onLeft();
    } catch {
      onError('Gagal keluar dari ruangan.');
    } finally {
      setLeaving(false);
      setConfirming(false);
    }
  };

  const isHost = state.role === 'host';

  return (
    <div className="tab">
      <div className="tab-heading">
        <div>
          <h2>Ruangan</h2>
          <p>Informasi ruangan, anggota, dan status sinkronisasi folder project.</p>
        </div>
      </div>

      <div className="grid-2">
        <section className="card code-card" aria-label="Kode ruangan">
          <div className="card-head">
            <span className="icon-chip">
              <IconKey size={16} />
            </span>
            <h3 className="card-title">Kode Ruangan</h3>
          </div>
          <div className="room-code">{state.code}</div>
          <div className="code-actions">
            <CopyButton text={state.code ?? ''} label="Salin Kode" />
          </div>
          <p className="card-sub">Bagikan kode ini agar rekanmu bisa bergabung dari laptop lain.</p>
        </section>

        <section className="card" aria-label="Detail ruangan">
          <div className="card-head">
            <span className="icon-chip">
              <IconInfo size={16} />
            </span>
            <h3 className="card-title">Detail</h3>
          </div>
          <dl className="info-rows">
            <div className="info-row">
              <dt>Peran</dt>
              <dd>
                <Badge tone={isHost ? 'teal' : 'slate'}>{isHost ? 'Host' : 'Anggota'}</Badge>
              </dd>
            </div>
            <div className="info-row">
              <dt>Folder project</dt>
              <dd className="mono" title={state.projectPath ?? undefined}>
                {state.projectPath ?? '-'}
              </dd>
            </div>
            <div className="info-row">
              <dt>Sinkronisasi</dt>
              <dd style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {syncBadge(state.sync)}
                <span className="card-sub">
                  {state.sync.files} berkas
                  {state.sync.lastSync ? ` · ${formatTime(state.sync.lastSync)}` : ''}
                </span>
              </dd>
            </div>
            {state.sync.message ? (
              <div className="info-row">
                <dt>Catatan</dt>
                <dd className="card-sub">{state.sync.message}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>

      <section className="card" aria-label="Anggota ruangan">
        <div className="card-head">
          <span className="icon-chip">
            <IconUsers size={16} />
          </span>
          <h3 className="card-title">Anggota ({state.members.length})</h3>
        </div>
        <div className="member-list">
          {state.members.map((m) => (
            <div key={m.id} className={`member-row${m.id === state.selfId ? ' self' : ''}`}>
              <span className={`avatar${m.isHost ? ' avatar-host' : ''}`}>{m.name.charAt(0).toUpperCase()}</span>
              <span className="member-name">{m.name}</span>
              {m.id === state.selfId ? <span className="member-you">(kamu)</span> : null}
              <span className="member-end">
                {m.isHost ? <Badge tone="amber">Host</Badge> : null}
                <Dot tone={m.isHost ? 'teal' : 'green'} pulse={!m.isHost} />
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="leave-row">
        <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
          <IconLogout size={16} />
          Keluar Ruangan
        </button>
      </div>

      <Modal open={confirming} title="Keluar dari ruangan?" onClose={() => setConfirming(false)}>
        <p>
          Kamu akan terputus dari ruangan <b>{state.roomName}</b>. Folder salinan lokalmu tetap ada,
          tapi sinkronisasi berhenti.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
            Batal
          </button>
          <button type="button" className="btn btn-danger" onClick={leave} disabled={leaving}>
            {leaving ? 'Keluar…' : 'Ya, Keluar'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
