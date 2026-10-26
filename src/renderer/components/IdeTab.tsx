import { useState } from 'react';
import type { AppState, IdeInfo } from '../../shared/types';
import { IconCode, IconFolder, IconMonitor, IconRefresh, Spinner } from './icons';
import { Badge, EmptyState } from './ui';

const SOURCE_LABEL: Record<IdeInfo['source'], { label: string; tone: 'teal' | 'amber' | 'slate' }> = {
  registry: { label: 'Registry', tone: 'teal' },
  folder: { label: 'Folder', tone: 'amber' },
  path: { label: 'PATH', tone: 'slate' },
};

export function IdeTab({
  state,
  onError,
}: {
  state: AppState;
  onError: (message: string) => void;
}) {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const scanning = state.idesScanning || rescanning;

  const openIde = async (ide: IdeInfo) => {
    setOpeningId(ide.id);
    try {
      const res = await window.rk.openIde(ide.id);
      if (!res.ok) onError(res.error ?? `Gagal membuka ${ide.name}.`);
    } catch {
      onError(`Gagal membuka ${ide.name}.`);
    } finally {
      setOpeningId(null);
    }
  };

  const rescan = async () => {
    setRescanning(true);
    try {
      await window.rk.scanIdes();
    } catch {
      onError('Gagal memindai IDE terpasang.');
    } finally {
      setRescanning(false);
    }
  };

  return (
    <div className="tab">
      <div className="tab-heading">
        <div>
          <h2>IDE</h2>
          <p>IDE yang terdeteksi di laptop ini. Buka folder project langsung dari sini.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={rescan} disabled={scanning}>
          {scanning ? <Spinner size={15} /> : <IconRefresh size={15} />}
          {scanning ? 'Memindai…' : 'Rescan IDE'}
        </button>
      </div>

      {state.projectPath ? (
        <div className="open-target">
          <IconFolder size={15} />
          <span title={state.projectPath}>{state.projectPath}</span>
        </div>
      ) : null}

      {state.ides.length === 0 ? (
        <EmptyState
          icon={<IconMonitor size={26} />}
          title="Belum ada IDE terdeteksi"
          desc="Install VS Code, Cursor, Antigravity, atau IDE lainnya di laptop ini, lalu klik Rescan IDE untuk memindai ulang."
        >
          <button type="button" className="btn btn-primary" onClick={rescan} disabled={scanning}>
            {scanning ? <Spinner size={15} /> : <IconRefresh size={15} />}
            {scanning ? 'Memindai…' : 'Rescan IDE'}
          </button>
        </EmptyState>
      ) : (
        <div className="ide-grid">
          {state.ides.map((ide) => {
            const src = SOURCE_LABEL[ide.source];
            const opening = openingId === ide.id;
            return (
              <div key={ide.id} className="ide-card">
                <div className="ide-top">
                  <span className="icon-chip">
                    <IconCode size={16} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="ide-name">{ide.name}</div>
                    <div className="ide-exe" title={ide.exe}>
                      {ide.exe}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge tone={src.tone}>{src.label}</Badge>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openIde(ide)}
                  disabled={opening}
                >
                  {opening ? <Spinner size={15} /> : <IconCode size={15} />}
                  {opening ? 'Membuka…' : 'Buka di IDE'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
