import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const SENSITIVE_COMPONENT = /(?:^\.env(?:$|\.)|(?:^|[._-])(?:secret|secrets|credential|credentials|token|private[_-]?key)(?:[._-]|$)|(?:^|[\\/])id_rsa$|\.(?:pem|pfx|key)$)/i;

export interface WorkspacePathOptions {
  /** Allow a target that does not exist yet, after validating its existing ancestors. */
  allowMissing?: boolean;
  /** Reject symbolic links in every existing path component. Use for mutations. */
  rejectSymlinks?: boolean;
  /** Block sensitive names in both the requested and canonical paths. */
  blockSensitive?: boolean;
}

export interface ResolvedWorkspacePath {
  root: string;
  target: string;
  /** Canonical path relative to root, with forward slashes. */
  rel: string;
}

function toRelativePath(root: string, target: string): string {
  return relative(root, target).split(sep).join('/');
}

export function isSensitiveWorkspacePath(pathValue: string): boolean {
  return pathValue.split(/[\\/]/).some((part) => SENSITIVE_COMPONENT.test(part));
}

function assertWithinRoot(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === '' || rel === '.') return;
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error('Path ditolak: tool hanya boleh bekerja di dalam folder proyek.');
  }
}

async function assertNoSymlinkComponents(root: string, target: string): Promise<void> {
  const rel = relative(root, target);
  if (!rel || rel === '.') return;
  let current = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) {
        throw new Error('Path ditolak: operasi tulis melalui symbolic link tidak diizinkan.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('symbolic link')) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

/**
 * Resolve a workspace path against the canonical project root. Sensitive-file
 * checks run against both the user-supplied path and the real path after
 * symlink resolution, closing alias-based secret access. Mutations can reject
 * symlinks in every existing component to avoid writing through an alias.
 */
export async function resolveWorkspacePath(
  rootPath: string,
  requestedPath: string,
  options: WorkspacePathOptions = {},
): Promise<ResolvedWorkspacePath> {
  const inputRoot = resolve(rootPath);
  const root = await realpath(inputRoot);
  const raw = (typeof requestedPath === 'string' ? requestedPath : '.').trim() || '.';

  let target: string;
  if (isAbsolute(raw)) {
    const absoluteRequested = resolve(raw);
    // Renderer paths can retain a Windows 8.3 alias while realpath() returns
    // the long canonical name. Map paths relative to either representation.
    const inputRelative = relative(inputRoot, absoluteRequested);
    const canonicalRelative = relative(root, absoluteRequested);
    const isInsideRelative = (value: string): boolean =>
      value === '' || value === '.' || (value !== '..' && !value.startsWith('..' + sep) && !isAbsolute(value));

    if (isInsideRelative(inputRelative)) {
      target = resolve(root, inputRelative);
    } else if (isInsideRelative(canonicalRelative)) {
      target = resolve(root, canonicalRelative);
    } else {
      throw new Error('Path ditolak: tool hanya boleh bekerja di dalam folder proyek.');
    }
  } else {
    target = resolve(root, raw);
  }
  assertWithinRoot(root, target);

  const requestedRel = toRelativePath(root, target);
  if (options.blockSensitive && isSensitiveWorkspacePath(requestedRel)) {
    throw new Error('Akses ditolak untuk file yang berpotensi berisi secret atau kredensial.');
  }
  if (options.rejectSymlinks) await assertNoSymlinkComponents(root, target);

  try {
    const actual = await realpath(target);
    assertWithinRoot(root, actual);
    const rel = toRelativePath(root, actual);
    if (options.blockSensitive && isSensitiveWorkspacePath(rel)) {
      throw new Error('Akses ditolak untuk file yang berpotensi berisi secret atau kredensial.');
    }
    return { root, target: actual, rel };
  } catch (error) {
    if (!options.allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;

    // Resolve the nearest existing ancestor. This also detects an ancestor
    // that resolves outside the workspace when symlink rejection is disabled.
    let ancestor = dirname(target);
    while (true) {
      try {
        const actualAncestor = await realpath(ancestor);
        assertWithinRoot(root, actualAncestor);
        const missingSuffix = relative(ancestor, target);
        const actualTarget = resolve(actualAncestor, missingSuffix);
        assertWithinRoot(root, actualTarget);
        const rel = toRelativePath(root, actualTarget);
        if (options.blockSensitive && isSensitiveWorkspacePath(rel)) {
          throw new Error('Akses ditolak untuk file yang berpotensi berisi secret atau kredensial.');
        }
        return { root, target: actualTarget, rel };
      } catch (ancestorError) {
        if ((ancestorError as NodeJS.ErrnoException).code !== 'ENOENT') throw ancestorError;
        const parent = dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }
  }
}
