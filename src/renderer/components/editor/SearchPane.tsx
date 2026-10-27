import { useEffect, useMemo, useState } from 'react';
import type { EditorSearchHit } from '../../../shared/editor';
import type { IdeWorkbench } from './types';
import { IconFile } from '../icons';

function IconSearch({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.8-3.8" />
    </svg>
  );
}

interface Props {
  wb: IdeWorkbench;
  reportActivity: () => void;
}

/** Sidebar Cari: cari teks di seluruh project, hasil dikelompokkan per file. */
export function SearchPane({ wb, reportActivity }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<EditorSearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHits([]);
      setBusy(false);
      setDone(false);
      return;
    }
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await window.rk.editor.search(trimmed, { maxResults: 200 });
        setHits(res);
      } catch {
        setHits([]);
      } finally {
        setBusy(false);
        setDone(true);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const groups = useMemo(() => {
    const map = new Map<string, EditorSearchHit[]>();
    for (const hit of hits) {
      const list = map.get(hit.path);
      if (list) list.push(hit);
      else map.set(hit.path, [hit]);
    }
    return [...map.entries()];
  }, [hits]);

  return (
    <div className="ed-search">
      <div className="ed-side-head" style={{ paddingBottom: 0 }}>
        <span className="ed-side-title">Cari</span>
      </div>
      <input
        className="ed-input"
        style={{ marginTop: 2 }}
        type="text"
        value={query}
        placeholder="Cari di seluruh file…"
        aria-label="Cari di seluruh file"
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="ed-search-results">
        {!query.trim() ? (
          <div className="ed-empty">
            <IconSearch size={22} />
            <span>Ketik untuk mencari teks di project.</span>
          </div>
        ) : busy ? (
          <div className="ed-search-meta">Mencari…</div>
        ) : groups.length === 0 ? (
          <div className="ed-search-meta">
            {done ? `Tidak ada hasil untuk “${query.trim()}”.` : ''}
          </div>
        ) : (
          <>
            <div className="ed-search-meta">
              {hits.length} hasil di {groups.length} file
            </div>
            {groups.map(([path, list]) => (
              <div key={path}>
                <div className="ed-search-file" title={path}>
                  <IconFile size={13} />
                  <span>{path.split(/[\\/]/).pop()}</span>
                  <small>{list.length}</small>
                </div>
                {list.map((hit, i) => (
                  <div
                    key={`${hit.line}-${hit.column}-${i}`}
                    className="ed-search-hit"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      wb.openFile(hit.path, { line: hit.line, column: hit.column });
                      reportActivity();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        wb.openFile(hit.path, { line: hit.line, column: hit.column });
                        reportActivity();
                      }
                    }}
                  >
                    <span className="ed-search-line">{hit.line}</span>
                    <span className="ed-search-preview">{hit.preview.trim()}</span>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
