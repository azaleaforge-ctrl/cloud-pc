import { useEffect, useState } from 'react';
import type { AppState, ProjectFile } from '../../shared/types';
import { IconFile, IconFolder } from './icons';

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(exp === 0 ? 0 : 1)} ${SIZE_UNITS[exp]}`;
}

function timeAgo(iso: string): string {
  const now = Date.now();
  const target = new Date(iso).getTime();
  const diff = now - target;
  if (diff < 5000) return 'baru saja';
  if (diff < 60_000) return `${Math.floor(diff / 1000)} detik lalu`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} menit lalu`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} jam lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
  file?: ProjectFile;
}

function buildTree(files: ProjectFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      if (!current.children) current.children = [];
      let child = current.children.find((c) => c.name === part && c.isDir === !isFile);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isDir: !isFile,
          children: isFile ? undefined : [],
          file: isFile ? file : undefined,
        };
        current.children.push(child);
      } else if (isFile) {
        child.file = file;
      }
      if (!isFile) current = child;
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
        <IconFile size={13} />
        <span className="tree-file-name" title={f.path}>
          {f.path.split('/').pop()}
        </span>
        <span className="tree-file-meta">
          {formatSize(f.size)} · {timeAgo(f.modified)}
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
      >
        <IconFolder size={13} />
        <span className="tree-dir-name">{node.name || 'Project'}</span>
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

  useEffect(() => {
    setFiles(state.projectFiles ?? []);
  }, [state.projectFiles]);

  // Auto-refresh ketika sync state berubah (real-time)
  useEffect(() => {
    if (!state.projectPath) {
      setFiles([]);
      return;
    }
    window.rk.listProjectFiles().then((f) => setFiles(f)).catch(() => undefined);
  }, [state.projectPath, state.sync.lastSync, state.sync.status]);

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
