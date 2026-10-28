import { useEffect, useState } from 'react';
import type { AppState, ProjectFile } from '../../shared/types';
import { IconFolder } from './icons';
import { FileTypeIcon } from './FileTypeIcon';

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(exp === 0 ? 0 : 1)} ${SIZE_UNITS[exp]}`;
}

function formatModifiedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Waktu tidak diketahui';
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFullDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Waktu tidak diketahui';
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
  file?: ProjectFile;
  metadata?: ProjectFile;
}

function buildTree(files: ProjectFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };
  for (const entry of files) {
    const parts = entry.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const isDir = !isLast || entry.isDirectory === true;
      if (!current.children) current.children = [];
      let child = current.children.find((item) => item.name === part && item.isDir === isDir);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isDir,
          children: isDir ? [] : undefined,
          file: isLast && !isDir ? entry : undefined,
          metadata: isLast && isDir ? entry : undefined,
        };
        current.children.push(child);
      } else if (isLast) {
        if (isDir) child.metadata = entry;
        else child.file = entry;
      }
      if (isDir) current = child;
    }
  }
  const sortChildren = (node: TreeNode): void => {
    if (node.children) {
      node.children.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(sortChildren);
    }
  };
  sortChildren(root);
  return root;
}

function FileTreeNode({ node }: { node: TreeNode }) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = node.isDir && node.children && node.children.length > 0;

  if (!node.isDir) {
    const f = node.file;
    if (!f) return null;
    return (
      <div className="tree-file" title={f.path}>
        <FileTypeIcon path={f.path} size="normal" />
        <span className="tree-file-name" title={f.path}>
          {f.path.split('/').pop()}
        </span>
        <span className="tree-file-meta" title={formatFullDateTime(f.modified)}>
          {formatSize(f.size)} · {formatModifiedDate(f.modified)}
        </span>
      </div>
    );
  }

  const handleToggle = () => {
    if (hasChildren) setExpanded((v) => !v);
  };

  return (
    <div className="tree-dir">
      <div
        className={`tree-dir-header${hasChildren ? ' clickable' : ' leaf'}`}
        onClick={handleToggle}
        role={hasChildren ? 'button' : undefined}
        aria-expanded={hasChildren ? expanded : undefined}
        title={node.metadata?.modified ? formatFullDateTime(node.metadata.modified) : node.path}
      >
        <IconFolder size={13} />
        <span className="tree-dir-name">{node.name || 'Project'}</span>
        {node.metadata?.modified ? (
          <span className="tree-dir-meta">{formatModifiedDate(node.metadata.modified)}</span>
        ) : null}
      </div>
      {expanded && hasChildren && (
        <div className="tree-children">
          {node.children!.map((child) => (
            <FileTreeNode key={child.path} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTab({ state }: { state: AppState }) {
  const [files, setFiles] = useState<ProjectFile[]>(state.projectFiles ?? []);

  // Read the live filesystem on entry and every time chokidar observes a save,
  // rename, create, delete, or directory change. This works for IDE saves and remote sync writes.
  useEffect(() => {
    if (!state.projectPath) {
      setFiles([]);
      return;
    }
    let active = true;
    let timer: number | null = null;
    const refresh = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        window.rk.listProjectFiles()
          .then((entries) => { if (active) setFiles(entries); })
          .catch(() => undefined);
      }, 120);
    };
    const unsubscribe = window.rk.onProjectFilesChanged(refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [state.projectPath]);

  const tree = buildTree(files);

  return (
    <div className="file-tab">
      <div className="file-header">
        <h3>Folder Project</h3>
        <span className="file-count">{files.length} berkas</span>
      </div>
      <div className="file-tree">
        {files.length === 0 ? (
          <div className="empty-file">
            <IconFolder size={32} />
            <p>Folder project kosong atau belum terhubung.</p>
          </div>
        ) : (
          <FileTreeNode node={tree} />
        )}
      </div>
    </div>
  );
}
