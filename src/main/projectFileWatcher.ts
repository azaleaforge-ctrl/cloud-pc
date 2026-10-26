import { watch, type FSWatcher } from 'chokidar';
import { isIgnoredRelative, toRel } from './fsScan';

export interface ProjectFileWatch {
  close(): Promise<void>;
}

/**
 * Watch project files for UI metadata refreshes, independently of the collaboration sync watcher.
 * This catches local editor saves, atomic rename saves, and writes received from another room member.
 */
export function watchProjectFileChanges(root: string, onChanged: () => void): ProjectFileWatch {
  let closed = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const watcher: FSWatcher = watch(root, {
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true,
    atomic: 250,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    ignored: (path: string) => {
      const rel = toRel(root, path);
      if (!rel || rel.startsWith('..')) return false;
      return isIgnoredRelative(rel);
    },
  });

  const schedule = (): void => {
    if (closed) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      if (!closed) onChanged();
    }, 100);
    debounce.unref?.();
  };

  watcher.on('all', (event, path) => {
    if (event !== 'add' && event !== 'change' && event !== 'unlink' && event !== 'addDir' && event !== 'unlinkDir') return;
    const rel = toRel(root, path);
    if (!rel || rel.startsWith('..') || isIgnoredRelative(rel)) return;
    schedule();
  });
  // Filesystem watch errors are non-fatal; room sync has its own watcher and the initial/manual scan still works.
  watcher.on('error', () => undefined);

  return {
    async close() {
      closed = true;
      if (debounce) clearTimeout(debounce);
      debounce = null;
      await watcher.close();
    },
  };
}