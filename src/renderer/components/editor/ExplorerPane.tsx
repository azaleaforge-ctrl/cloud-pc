import { useEffect, useState, type ReactNode } from 'react';
import type { IdeWorkbench } from './types';
import { IconCopy, IconFile, IconFolder, IconPlus, IconRefresh, IconTrash, IconX } from '../icons';

interface Props {
  wb: IdeWorkbench;
  reportActivity: () => void;
  onError: (message: string) => void;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

function parentOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return i > 0 ? path.slice(0, i) : path;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function Chevron() {
  return (
    <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function IconPencil({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4l11-11a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M13.5 6.5l3 3" />
    </svg>
  );
}

function IconCollapse({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4l5 5-5 5M12 19h7" />
      <path d="M19 4l-5 5 5 5" opacity="0.45" />
    </svg>
  );
}

interface MenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

interface CreateState {
  dir: string;
  kind: 'file' | 'folder';
}

/** Sidebar Explorer: tree folder/file + aksi buat/ganti nama/hapus. */
export function ExplorerPane({ wb, reportActivity, onError }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [creating, setCreating] = useState<CreateState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const startCreate = (dir: string, kind: 'file' | 'folder') => {
    setRenaming(null);
    setCreating({ dir, kind });
    setDraft('');
  };

  const startRename = (path: string) => {
    setCreating(null);
    setRenaming(path);
    setDraft(baseName(path));
  };

  const commitCreate = async () => {
    if (!creating) return;
    const name = draft.trim();
    const { dir, kind } = creating;
    setCreating(null);
    if (!name) return;
    const target = joinPath(dir, name);
    try {
      const res = kind === 'file'
        ? await window.rk.editor.createFile(target)
        : await window.rk.editor.createFolder(target);
      if (!res.ok) {
        onError(res.error ?? 'Gagal membuat.');
        return;
      }
      wb.refreshDir(dir);
      if (kind === 'file') {
        wb.openFile(target);
        reportActivity();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal membuat.');
    }
  };

  const commitRename = async () => {
    if (!renaming) return;
    const name = draft.trim();
    const from = renaming;
    setRenaming(null);
    if (!name || name === baseName(from)) return;
    const to = joinPath(parentOf(from), name);
    try {
      const res = await window.rk.editor.renamePath(from, to);
      if (!res.ok) {
        onError(res.error ?? 'Gagal mengganti nama.');
        return;
      }
      wb.refreshDir(parentOf(from));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal mengganti nama.');
    }
  };

  const doDelete = async (path: string) => {
    try {
      const res = await window.rk.editor.deletePath(path);
      if (!res.ok) {
        onError(res.error ?? 'Gagal menghapus.');
        return;
      }
      wb.refreshDir(parentOf(path));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Gagal menghapus.');
    }
  };

  const collapseAll = () => {
    for (const key of Object.keys(wb.expanded)) {
      if (wb.expanded[key]) wb.toggleDir(key);
    }
  };

  const renderLevel = (dir: string): ReactNode[] => {
    const entries = wb.tree[dir] ?? [];
    const nodes: ReactNode[] = [];

    if (creating && creating.dir === dir) {
      nodes.push(
        <div className="ed-tree-row" key="__create">
          <span className="ed-tree-chevron" />
          <span className="ed-tree-icon">
            {creating.kind === 'file' ? <IconFile size={14} /> : <IconFolder size={14} />}
          </span>
          <input
            className="ed-tree-input"
            autoFocus
            value={draft}
            placeholder={creating.kind === 'file' ? 'nama-file.ts' : 'nama-folder'}
            aria-label={creating.kind === 'file' ? 'Nama file baru' : 'Nama folder baru'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitCreate();
              if (e.key === 'Escape') setCreating(null);
            }}
            onBlur={() => setCreating(null)}
          />
        </div>,
      );
    }

    for (const entry of entries) {
      const isRenaming = renaming === entry.path;
      nodes.push(
        <div
          key={entry.path}
          className={`ed-tree-row${entry.path === wb.activePath ? ' active' : ''}`}
          title={entry.path}
          onClick={() => {
            if (entry.isDir) {
              wb.toggleDir(entry.path);
            } else {
              wb.openFile(entry.path);
              reportActivity();
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, path: entry.path, isDir: entry.isDir });
          }}
        >
          <span className={`ed-tree-chevron${wb.expanded[entry.path] ? ' open' : ''}`}>
            {entry.isDir ? <Chevron /> : null}
          </span>
          <span className="ed-tree-icon">
            {entry.isDir ? <IconFolder size={15} /> : <IconFile size={14} />}
          </span>
          {isRenaming ? (
            <input
              className="ed-tree-input"
              autoFocus
              value={draft}
              aria-label="Nama baru"
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename();
                if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={() => setRenaming(null)}
            />
          ) : (
            <span className="ed-tree-name">{entry.name}</span>
          )}
        </div>,
      );
      if (entry.isDir && wb.expanded[entry.path]) {
        nodes.push(
          <div className="ed-tree-kids" key={`${entry.path}::kids`}>
            {renderLevel(entry.path)}
          </div>,
        );
      }
    }
    return nodes;
  };

  const rootReady = wb.root != null;
  const rootEmpty = rootReady && (wb.tree[wb.root as string] ?? []).length === 0;

  return (
    <>
      <div className="ed-side-head">
        <span className="ed-side-title">Explorer</span>
        <button
          type="button"
          className="ed-icon-btn"
          aria-label="File Baru"
          title="File Baru"
          disabled={!rootReady}
          onClick={() => wb.root && startCreate(wb.root, 'file')}
        >
          <IconPlus size={15} />
        </button>
        <button
          type="button"
          className="ed-icon-btn"
          aria-label="Folder Baru"
          title="Folder Baru"
          disabled={!rootReady}
          onClick={() => wb.root && startCreate(wb.root, 'folder')}
        >
          <IconFolder size={15} />
        </button>
        <button
          type="button"
          className="ed-icon-btn"
          aria-label="Segarkan Explorer"
          title="Segarkan"
          onClick={() => wb.refreshDir()}
        >
          <IconRefresh size={15} />
        </button>
        <button
          type="button"
          className="ed-icon-btn"
          aria-label="Tutup Semua Folder"
          title="Tutup Semua Folder"
          onClick={collapseAll}
        >
          <IconCollapse size={15} />
        </button>
      </div>

      <div className="ed-tree" role="tree" aria-label="File project">
        {rootReady ? (
          renderLevel(wb.root as string)
        ) : (
          <div className="ed-empty">Belum ada folder project.</div>
        )}
        {rootReady && rootEmpty && !creating && (
          <div className="ed-tree-hint">
            Folder masih kosong.<br />
            Buat file pertamamu lewat tombol <strong>+</strong> di atas.
          </div>
        )}
      </div>

      {menu && (
        <div
          className="ed-menu"
          role="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 210),
            top: Math.min(menu.y, window.innerHeight - 140),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="ed-menu-item"
            onClick={() => {
              const path = menu.path;
              setMenu(null);
              startRename(path);
            }}
          >
            <IconPencil size={14} /> Ganti Nama
          </button>
          <button
            type="button"
            role="menuitem"
            className="ed-menu-item danger"
            onClick={() => {
              const path = menu.path;
              setMenu(null);
              void doDelete(path);
            }}
          >
            <IconTrash size={14} /> Hapus
          </button>
          <button
            type="button"
            role="menuitem"
            className="ed-menu-item"
            onClick={() => {
              const path = menu.path;
              setMenu(null);
              void navigator.clipboard.writeText(path).catch(() => undefined);
            }}
          >
            <IconCopy size={14} /> Salin Path
          </button>
        </div>
      )}
    </>
  );
}
