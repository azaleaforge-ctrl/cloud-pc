import { useMemo, useState } from 'react';
import type { AppState, IdeInfo } from '../../shared/types';
import { IconCode, IconFolder, IconMonitor, IconRefresh, IconExternal, Spinner } from './icons';
import { Badge, EmptyState } from './ui';

const SOURCE_LABEL: Record<IdeInfo['source'], { label: string; tone: 'teal' | 'amber' | 'slate' }> = {
  registry: { label: 'Registry', tone: 'teal' },
  folder: { label: 'Folder', tone: 'amber' },
  path: { label: 'PATH', tone: 'slate' },
  shortcut: { label: 'Shortcut', tone: 'amber' },
  catalog: { label: 'Katalog', tone: 'slate' },
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
  const [search, setSearch] = useState('');
  const scanning = state.idesScanning || rescanning;

  const filtered = useMemo(() => {
    const value = search.trim().toLowerCase();
    return state.ides.filter((ide) => !value || ide.name.toLowerCase().includes(value) || ide.id.toLowerCase().includes(value));
  }, [state.ides, search]);
  const installed = filtered.filter((ide) => ide.installed && !!ide.exe);
  const notInstalled = filtered.filter((ide) => !ide.installed || !ide.exe);

  const openIde = async (ide: IdeInfo) => {
    if (!ide.installed || !ide.exe) {
      onError(ide.name + ' belum terpasang. Klik Unduh untuk membuka situs resminya.');
      return;
    }
    setOpeningId(ide.id);
    try {
      const res = await window.rk.openIde(ide.id);
      if (!res.ok) onError(res.error ?? 'Gagal membuka ' + ide.name + '.');
    } catch {
      onError('Gagal membuka ' + ide.name + '.');
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

  const openDownload = (ide: IdeInfo) => {
    if (!ide.downloadUrl) {
      onError('Link unduhan resmi belum tersedia untuk ' + ide.name + '.');
      return;
    }
    window.open(ide.downloadUrl, '_blank', 'noopener,noreferrer');
  };

  const renderCard = (ide: IdeInfo) => {
    const src = SOURCE_LABEL[ide.source];
    const opening = openingId === ide.id;
    return (
      <div key={ide.id} className={'ide-card' + (!ide.installed ? ' ide-card-missing' : '')}>
        <div className="ide-top">
          <span className="icon-chip">
            <IconCode size={16} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="ide-name">{ide.name}</div>
            <div className="ide-exe" title={ide.exe ?? ide.downloadUrl ?? ide.name}>
              {ide.installed ? ide.exe : 'Belum terpasang di laptop ini'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge tone={ide.installed ? src.tone : 'slate'}>{ide.installed ? src.label : 'Belum terpasang'}</Badge>
        </div>
        {ide.installed ? (
          <button type="button" className="btn btn-primary" onClick={() => void openIde(ide)} disabled={opening}>
            {opening ? <Spinner size={15} /> : <IconCode size={15} />}
            {opening ? 'Membuka…' : 'Buka di Ruang Kerja'}
          </button>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => openDownload(ide)} disabled={!ide.downloadUrl}>
            <IconExternal size={15} />
            {ide.downloadUrl ? 'Unduh dari situs resmi' : 'Link unduhan tidak tersedia'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="tab">
      <div className="tab-heading">
        <div>
          <h2>IDE Eksternal</h2>
          <p>Cari IDE di laptop atau pilih IDE dari katalog. Jendela IDE yang kompatibel akan ditempatkan di dalam Ruang Kerja. Untuk menulis kode tanpa aplikasi lain, pakai tab <strong>Editor</strong>.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={rescan} disabled={scanning}>
          {scanning ? <Spinner size={15} /> : <IconRefresh size={15} />}
          {scanning ? 'Memindai…' : 'Pindai IDE'}
        </button>
      </div>

      {state.projectPath ? (
        <div className="open-target">
          <IconFolder size={15} />
          <span title={state.projectPath}>{state.projectPath}</span>
        </div>
      ) : null}

      <div className="ide-catalog-search">
        <IconMonitor size={16} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari Visual Studio Code, Antigravity, IntelliJ…" aria-label="Cari IDE" />
        <span>{filtered.length} IDE</span>
      </div>

      {installed.length > 0 ? (
        <section className="ide-section">
          <div className="ide-section-title"><h3>Terpasang</h3><span>{installed.length}</span></div>
          <div className="ide-grid">{installed.map(renderCard)}</div>
        </section>
      ) : null}

      {notInstalled.length > 0 ? (
        <section className="ide-section">
          <div className="ide-section-title"><h3>Katalog IDE</h3><span>{notInstalled.length} belum terpasang</span></div>
          <div className="ide-grid">{notInstalled.map(renderCard)}</div>
        </section>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState icon={<IconMonitor size={26} />} title="IDE tidak ditemukan" desc="Coba kata kunci lain atau pindai ulang aplikasi yang terpasang." />
      ) : null}

      <div className="ide-embedding-note">
        Catatan: setiap IDE tetap berjalan sebagai proses aslinya. Ruang Kerja menanamkan jendelanya ke area kerja Windows; tidak semua IDE mendukung embedding native dengan sempurna. IDE yang belum terpasang dapat diunduh melalui situs resminya.
      </div>
    </div>
  );
}