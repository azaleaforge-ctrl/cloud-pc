import { promises as fsp } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { IGNORED_DIRS } from '../shared/types';

/** Batas ukuran file yang ikut disinkronkan. */
export const MAX_SYNC_BYTES = 8 * 1024 * 1024;

const IGNORED = new Set(IGNORED_DIRS);

export interface ScannedFile {
  /** Path relatif terhadap root, selalu memakai '/'. */
  path: string;
  abs: string;
  mtime: number;
  size: number;
}

export function isIgnoredName(name: string): boolean {
  return IGNORED.has(name) || name.startsWith('.rk-tmp');
}

export function isIgnoredRelative(relPath: string): boolean {
  return relPath
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((part) => isIgnoredName(part));
}

/** Path absolut -> path relatif berformat '/'; '' bila di luar root. */
export function toRel(root: string, abs: string): string {
  const rel = relative(resolve(root), resolve(abs));
  return rel.split(sep).join('/');
}

/**
 * Gabungkan path relatif ke root dengan validasi anti path-traversal.
 * Mengembalikan null bila relatif absolut, memakai '..', atau keluar dari root.
 */
export function resolveInside(root: string, relPath: string): string | null {
  if (!relPath || typeof relPath !== 'string') return null;
  const cleaned = relPath.replace(/\\/g, '/').trim();
  if (!cleaned || isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned)) return null;
  if (cleaned.split('/').some((part) => part === '..')) return null;
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, cleaned);
  const check = relative(rootAbs, abs);
  if (!check || check.startsWith('..') || isAbsolute(check)) return null;
  return abs;
}

/** Pindai seluruh file di bawah root, melewati folder IGNORED_DIRS. */
export async function scanFiles(root: string, limit = 20000): Promise<ScannedFile[]> {
  const out: ScannedFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (isIgnoredName(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fsp.stat(abs);
        if (!stat.isFile()) continue;
        out.push({
          path: toRel(root, abs),
          abs,
          mtime: Math.round(stat.mtime.getTime()),
          size: stat.size,
        });
      } catch {
        // file hilang saat dipindai; abaikan
      }
    }
  };
  await walk(resolve(root));
  return out;
}
