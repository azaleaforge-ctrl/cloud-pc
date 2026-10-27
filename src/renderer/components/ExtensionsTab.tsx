import { useMemo, useState } from 'react';
import type { AppState } from '../../shared/types';
import { IconRefresh, Spinner, IconExtension } from './icons';
import { Badge, EmptyState } from './ui';

export function ExtensionsTab({
  state,
  onError,
}: {
  state: AppState;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{
    id: string;
    displayName: string;
    version: string;
    description: string;
    publisher: string | null;
    iconUrl: string | null;
    namespace: string;
  }>>([]);
  const [searching, setSearching] = useState(false);
  const [installed, setInstalled] = useState<Array<{
    id: string;
    version: string;
    displayName: string;
    publisher: string | null;
    description: string;
    themes: Array<{ id: string; label: string }>;
    snippets: Array<{ id: string; label: string; language: string }>;
    unsupportedContributions: number;
  }>>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(true);

  const loadInstalled = async () => {
    setLoadingInstalled(true);
    try {
      const exts = await window.rk.editor.listExtensions();
      setInstalled(exts);
    } catch {
      onError('Gagal memuat ekstensi terpasang.');
    } finally {
      setLoadingInstalled(false);
    }
  };

  const searchExtensions = async (q: string) => {
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const result = await window.rk.editor.searchExtensions(q.trim());
      setSearchResults(result.items);
    } catch {
      onError('Gagal mencari ekstensi.');
    } finally {
      setSearching(false);
    }
  };

  const handleInstall = async (id: string) => {
    try {
      const result = await window.rk.editor.installExtension(id);
      if (!result.ok) {
        onError(result.error ?? 'Gagal memasang ekstensi.');
        return;
      }
      await loadInstalled();
      setQuery('');
      setSearchResults([]);
    } catch {
      onError('Gagal memasang ekstensi.');
    }
  };

  const handleUninstall = async (id: string) => {
    try {
      const result = await window.rk.editor.uninstallExtension(id);
      if (!result.ok) {
        onError(result.error ?? 'Gagal menghapus ekstensi.');
        return;
      }
      await loadInstalled();
    } catch {
      onError('Gagal menghapus ekstensi.');
    }
  };

  const installedIds = useMemo(() => new Set(installed.map((x) => x.id)), [installed]);

  return (
    <div className="tab">
      <div className="tab-heading">
        <div>
          <h2>Ekstensi Editor</h2>
          <p>Cari dan pasang ekstensi dari Open VSX. Ekstensi yang terpasang akan aktif otomatis di Editor.</p>
        </div>
      </div>

      <div className="ext-search-bar">
        <input
          className="ext-search-input"
          type="text"
          value={query}
          placeholder="Cari di Open VSX…"
          onChange={(e) => {
            setQuery(e.target.value);
            searchExtensions(e.target.value);
          }}
        />
        {searching && <Spinner size={16} />}
      </div>

      {loadingInstalled ? (
        <div className="ext-loading">
          <Spinner size={20} />
          <span>Memuat ekstensi terpasang…</span>
        </div>
      ) : (
        <>
          {query.trim() && searchResults.length > 0 && (
            <section className="ext-section">
              <h3>Hasil Pencarian ({searchResults.length})</h3>
              <div className="ext-grid">
                {searchResults.map((ext) => {
                  const isInstalled = installedIds.has(ext.id);
                  return (
                    <div key={ext.id} className="ext-card">
                      <span className="ext-icon">
                        {ext.iconUrl ? <img src={ext.iconUrl} alt="" loading="lazy" /> : (ext.displayName[0] ?? '?').toUpperCase()}
                      </span>
                      <div className="ext-meta">
                        <div className="ext-name">
                          <span title={ext.id}>{ext.displayName}</span>
                          <small>v{ext.version}</small>
                        </div>
                        <div className="ext-desc">{ext.description || ext.displayName}</div>
                        <div className="ext-publisher">
                          <small>{ext.publisher ?? ext.namespace}</small>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`ext-btn${isInstalled ? ' installed' : ''}`}
                        disabled={isInstalled}
                        onClick={() => handleInstall(ext.id)}
                      >
                        {isInstalled ? 'Terpasang' : 'Pasang'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="ext-section">
            <div className="ext-section-head">
              <h3>Terpasang ({installed.length})</h3>
              <button type="button" className="btn btn-ghost btn-sm" onClick={loadInstalled}>
                <IconRefresh size={14} /> Segarkan
              </button>
            </div>
            {installed.length === 0 ? (
              <EmptyState icon={<IconExtension size={26} />} title="Belum ada ekstensi terpasang" desc="Cari dan pasang ekstensi dari panel pencarian di atas." />
            ) : (
              <div className="ext-grid">
                {installed.map((ext) => (
                  <div key={ext.id} className="ext-card installed">
                    <span className="ext-icon">
                      {(ext.displayName[0] ?? '?').toUpperCase()}
                    </span>
                    <div className="ext-meta">
                      <div className="ext-name">
                        <span title={ext.id}>{ext.displayName}</span>
                        <small>v{ext.version}</small>
                      </div>
                      <div className="ext-desc">
                        {ext.description || ext.id}
                        {ext.themes.length > 0 ? ` · ${ext.themes.length} tema` : ''}
                        {ext.snippets.length > 0 ? ` · ${ext.snippets.length} snippet` : ''}
                        {ext.unsupportedContributions > 0 ? ` · ${ext.unsupportedContributions} kontribusi belum didukung` : ''}
                      </div>
                    </div>
                    <button type="button" className="ext-btn danger" onClick={() => handleUninstall(ext.id)}>
                      Hapus
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}