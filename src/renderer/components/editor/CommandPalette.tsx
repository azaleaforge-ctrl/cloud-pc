import { useEffect, useRef, useState } from 'react';

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  placeholder: string;
  items: PaletteItem[];
  onClose: () => void;
}

/** Pencocokan subsequence sederhana, tidak peka huruf besar/kecil. */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let ti = 0;
  for (const ch of q) {
    ti = t.indexOf(ch, ti);
    if (ti === -1) return false;
    ti += 1;
  }
  return true;
}

/** Overlay Command Palette (Ctrl+Shift+P) / Quick Open (Ctrl+P). */
export function CommandPalette({ open, placeholder, items, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const filtered = query.trim() ? items.filter((item) => fuzzyMatch(query.trim(), item.label)) : items;
  const clamped = Math.min(index, Math.max(0, filtered.length - 1));

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const el = list?.children[clamped];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [open, clamped, query]);

  if (!open) return null;

  const pick = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div
      className="ed-palette-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ed-palette" role="dialog" aria-modal="true" aria-label={placeholder}>
        <input
          ref={inputRef}
          className="ed-palette-input"
          type="text"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex(Math.min(clamped + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex(Math.max(clamped - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(filtered[clamped]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="ed-palette-list" ref={listRef} role="listbox" aria-label="Hasil">
          {filtered.length === 0 ? (
            <div className="ed-palette-none">Tidak ada hasil untuk “{query.trim()}”.</div>
          ) : (
            filtered.map((item, i) => (
              <div
                key={item.id}
                role="option"
                aria-selected={i === clamped}
                className={`ed-palette-item${i === clamped ? ' selected' : ''}`}
                onMouseMove={() => setIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(item);
                }}
              >
                <span>{item.label}</span>
                {item.hint && <kbd>{item.hint}</kbd>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
