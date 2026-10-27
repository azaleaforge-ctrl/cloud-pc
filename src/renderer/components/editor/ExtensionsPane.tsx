import { useMemo } from 'react';
import type { IdeWorkbench } from './types';
import { IconRefresh, Spinner } from '../icons';

interface Props {
  wb: IdeWorkbench;
}

/** Tema bawaan Monaco yang selalu tersedia, digabung dengan tema ekstensi. */
const BUILTIN_THEMES = [
  { id: 'rk-dark', label: 'Ruang Kerja Gelap' },
  { id: 'vs-dark', label: 'Visual Studio Dark' },
  { id: 'vs', label: 'Visual Studio Light' },
];

/** Sidebar Ekstensi: cari Open VSX, pasang/hapus, pemilih tema. */
export function ExtensionsPane({ wb }: Props) {
  const installedIds = useMemo(() => new Set(wb.installed.map((x) => x.id)), [wb.installed]);

  const themes = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ id: string; label: string }> = [];
    for (const t of [...BUILTIN_THEMES, ...wb.availableThemes]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      list.push(t);
    }
    return list;
  }, [wb.availableThemes]);

  return (
    <div className="ed-ext">
      <div className="ed-side-head" style={{ paddingBottom: 0 }}>
        <span className="ed-side-title">Ekstensi</span>
        <button
          type="button"
          className="ed-icon-btn"
          aria-label="Segarkan daftar terpasang"
          title="Segarkan daftar terpasang"
          onClick={() => void wb.refreshInstalled()}
        >
          <IconRefresh size={15} />
        </button>
      </div>
      <input
        className="ed-input"
        style={{ marginTop: 2 }}
        type="text"
        value={wb.extensionQuery}
        placeholder="Cari di Open VSX…"
        aria-label="Cari ekstensi di Open VSX"
        onChange={(e) => wb.setExtensionQuery(e.target.value)}
      />

      <div className="ed-ext-list">
        {wb.extensionBusy ? (
          <div className="ed-empty">
            <Spinner size={18} />
            <span>Mencari ekstensi…</span>
          </div>
        ) : wb.extensionResults.length > 0 ? (
          <>
            <div className="ed-side-section">Hasil Open VSX</div>
            {wb.extensionResults.map((ext) => {
              const isInstalled = installedIds.has(ext.id);
              return (
                <div className="ed-ext-card" key={ext.id}>
                  <span className="ed-ext-icon" aria-hidden="true">
                    {ext.iconUrl ? <img src={ext.iconUrl} alt="" loading="lazy" /> : (ext.displayName[0] ?? '?').toUpperCase()}
                  </span>
                  <div className="ed-ext-meta">
                    <div className="ed-ext-name">
                      <span title={ext.id}>{ext.displayName}</span>
                      <small>v{ext.version}</small>
                    </div>
                    <div className="ed-ext-desc">{ext.description || ext.displayName}</div>
                    <div className="ed-ext-name" style={{ marginTop: 2 }}>
                      <small>{ext.publisher ?? ext.namespace}</small>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`ed-ext-install${isInstalled ? ' installed' : ''}`}
                    disabled={wb.extensionBusy}
                    onClick={() => void (isInstalled ? wb.uninstallExtension(ext.id) : wb.installExtension(ext.id))}
                  >
                    {isInstalled ? 'Hapus' : 'Pasang'}
                  </button>
                </div>
              );
            })}
          </>
        ) : wb.extensionQuery.trim() ? (
          <div className="ed-empty">
            <span>Tidak ada ekstensi ditemukan.</span>
          </div>
        ) : null}

        <div className="ed-side-section">Terpasang</div>
        {wb.installed.length === 0 ? (
          <div className="ed-empty-inline" style={{ padding: '2px 14px' }}>
            Belum ada ekstensi terpasang.
          </div>
        ) : (
          wb.installed.map((ext) => (
            <div className="ed-ext-card" key={ext.id}>
              <span className="ed-ext-icon" aria-hidden="true">
                {(ext.displayName[0] ?? '?').toUpperCase()}
              </span>
              <div className="ed-ext-meta">
                <div className="ed-ext-name">
                  <span title={ext.id}>{ext.displayName}</span>
                  <small>v{ext.version}</small>
                </div>
                <div className="ed-ext-desc">
                  {ext.description || ext.id}
                  {ext.themes.length > 0 ? ` · ${ext.themes.length} tema` : ''}
                  {ext.snippets.length > 0 ? ` · ${ext.snippets.length} snippet` : ''}
                  {ext.unsupportedContributions > 0 ? ` · ${ext.unsupportedContributions} kontribusi belum didukung` : ''}
                </div>
              </div>
              <button
                type="button"
                className="ed-ext-install installed"
                disabled={wb.extensionBusy}
                onClick={() => void wb.uninstallExtension(ext.id)}
              >
                Hapus
              </button>
            </div>
          ))
        )}

        <div className="ed-side-section">Tema Warna</div>
        <div className="ed-theme-row">
          <select
            className="ed-select"
            value={wb.monacoTheme}
            aria-label="Tema warna editor"
            onChange={(e) => wb.setMonacoTheme(e.target.value)}
          >
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
