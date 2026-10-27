import { promises as fsp } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { shell } from 'electron';
import { IGNORED_DIRS } from '../../shared/types';
import {
  EDITOR_MAX_FILE_BYTES,
  type EditorFileData,
  type EditorFileEntry,
  type EditorOpResult,
  type EditorSearchHit,
  type EditorWriteResult,
} from '../../shared/editor';

const IGNORED = new Set(IGNORED_DIRS);
/** Byte awal yang diperiksa untuk mendeteksi file biner. */
const BINARY_SNIFF_BYTES = 8192;
/** File lebih besar dari ini dilewati saat pencarian teks. */
const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024;
const SEARCH_DEFAULT_MAX = 300;
const SEARCH_PREVIEW_MAX = 240;
/** Pengaman agar pencarian tidak menjelajah project raksasa tanpa batas. */
const SEARCH_MAX_FILES = 20000;

export interface WorkspaceService {
  listDir(path: string): Promise<EditorFileEntry[]>;
  readFile(path: string): Promise<EditorFileData>;
  writeFile(path: string, content: string): Promise<EditorWriteResult>;
  createFile(path: string): Promise<EditorOpResult>;
  createFolder(path: string): Promise<EditorOpResult>;
  renamePath(from: string, to: string): Promise<EditorOpResult>;
  deletePath(path: string): Promise<EditorOpResult>;
  search(query: string, opts?: { caseSensitive?: boolean; maxResults?: number }): Promise<EditorSearchHit[]>;
}

function requireRoot(getRoot: () => string | null): string {
  const root = getRoot();
  if (!root) throw new Error('Belum ada project.');
  return resolve(root);
}

/** true bila target berada di dalam root (root itu sendiri dianggap di dalam). */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Validasi path dari renderer: harus absolut dan berada di dalam root project. */
function safeResolve(root: string, input: string): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Path tidak valid.');
  if (!isAbsolute(input)) throw new Error('Path harus absolut.');
  const abs = resolve(input);
  if (!isInside(root, abs)) throw new Error('Path di luar folder project.');
  return abs;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isBinaryBuffer(buf: Buffer): boolean {
  const limit = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < limit; i += 1) {
    if (buf[i] === 0x00) return true;
  }
  return false;
}

/**
 * Pastikan menulis ke `abs` tidak keluar dari root lewat symlink.
 * Folder tujuan dibuat lebih dulu agar realpath-nya bisa diperiksa.
 */
async function prepareWriteTarget(root: string, abs: string): Promise<void> {
  const parent = dirname(abs);
  await fsp.mkdir(parent, { recursive: true });
  let realParent = parent;
  try {
    realParent = await fsp.realpath(parent);
  } catch {
    // parent baru saja dibuat; realpath gagal berarti tidak ada symlink untuk diikuti
  }
  if (!isInside(root, resolve(realParent))) throw new Error('Path di luar folder project.');
  try {
    const link = await fsp.lstat(abs);
    if (link.isSymbolicLink()) {
      const real = await fsp.realpath(abs);
      if (!isInside(root, resolve(real))) throw new Error('Path di luar folder project.');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'Path di luar folder project.') throw err;
    // file belum ada; aman ditulis
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Potong baris untuk preview hasil pencarian. */
function makePreview(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > SEARCH_PREVIEW_MAX ? trimmed.slice(0, SEARCH_PREVIEW_MAX) : trimmed;
}

export function createWorkspaceService(getRoot: () => string | null): WorkspaceService {
  return {
    async listDir(path: string): Promise<EditorFileEntry[]> {
      const root = requireRoot(getRoot);
      const abs = safeResolve(root, path);
      const dirents = await fsp.readdir(abs, { withFileTypes: true });
      const entries: EditorFileEntry[] = [];
      for (const dirent of dirents) {
        const full = join(abs, dirent.name);
        try {
          // stat mengikuti symlink supaya folder symlink tetap bisa dibuka
          const stat = await fsp.stat(full);
          const isDir = stat.isDirectory();
          entries.push({
            name: dirent.name,
            path: full,
            isDir,
            size: isDir ? 0 : stat.size,
            mtime: Math.round(stat.mtime.getTime()),
          });
        } catch {
          // entri hilang atau tidak bisa diakses; lewati
        }
      }
      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, 'id', { sensitivity: 'base' });
      });
      return entries;
    },

    async readFile(path: string): Promise<EditorFileData> {
      const root = requireRoot(getRoot);
      const abs = safeResolve(root, path);
      const stat = await fsp.stat(abs);
      if (stat.isDirectory()) throw new Error('Path adalah folder, bukan file.');
      const size = stat.size;
      const readBytes = Math.min(size, EDITOR_MAX_FILE_BYTES);
      let content = '';
      let binary = false;
      if (readBytes > 0) {
        const handle = await fsp.open(abs, 'r');
        try {
          const buf = Buffer.alloc(readBytes);
          const { bytesRead } = await handle.read(buf, 0, readBytes, 0);
          const slice = buf.subarray(0, bytesRead);
          binary = isBinaryBuffer(slice);
          // file biner tidak didekode; renderer menampilkan placeholder
          content = binary ? '' : slice.toString('utf8');
        } finally {
          await handle.close();
        }
      }
      return {
        path: abs,
        content,
        mtime: Math.round(stat.mtime.getTime()),
        truncated: size > EDITOR_MAX_FILE_BYTES,
        binary,
      };
    },

    async writeFile(path: string, content: string): Promise<EditorWriteResult> {
      try {
        const root = requireRoot(getRoot);
        const abs = safeResolve(root, path);
        await prepareWriteTarget(root, abs);
        await fsp.writeFile(abs, typeof content === 'string' ? content : String(content ?? ''), 'utf8');
        const stat = await fsp.stat(abs);
        return { ok: true, mtime: Math.round(stat.mtime.getTime()) };
      } catch (err) {
        return { ok: false, error: errMessage(err), mtime: 0 };
      }
    },

    async createFile(path: string): Promise<EditorOpResult> {
      try {
        const root = requireRoot(getRoot);
        const abs = safeResolve(root, path);
        await prepareWriteTarget(root, abs);
        try {
          await fsp.writeFile(abs, '', { encoding: 'utf8', flag: 'wx' });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
            return { ok: false, error: 'File sudah ada.' };
          }
          throw err;
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errMessage(err) };
      }
    },

    async createFolder(path: string): Promise<EditorOpResult> {
      try {
        const root = requireRoot(getRoot);
        const abs = safeResolve(root, path);
        if (abs === root) return { ok: true };
        await fsp.mkdir(abs, { recursive: true });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errMessage(err) };
      }
    },

    async renamePath(from: string, to: string): Promise<EditorOpResult> {
      try {
        const root = requireRoot(getRoot);
        const src = safeResolve(root, from);
        const dest = safeResolve(root, to);
        if (src === root) return { ok: false, error: 'Tidak bisa memindahkan folder project.' };
        if (src === dest) return { ok: true };
        if (dest.startsWith(src + '\\') || dest.startsWith(src + '/')) {
          return { ok: false, error: 'Tidak bisa memindahkan folder ke dalam dirinya sendiri.' };
        }
        await fsp.mkdir(dirname(dest), { recursive: true });
        try {
          await fsp.access(dest);
          return { ok: false, error: 'Tujuan sudah ada.' };
        } catch {
          // tujuan belum ada; lanjut
        }
        await fsp.rename(src, dest);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errMessage(err) };
      }
    },

    async deletePath(path: string): Promise<EditorOpResult> {
      try {
        const root = requireRoot(getRoot);
        const abs = safeResolve(root, path);
        if (abs === root) return { ok: false, error: 'Tidak bisa menghapus folder project.' };
        try {
          await shell.trashItem(abs);
        } catch {
          // recycle bin tidak tersedia (mis. drive jaringan); hapus permanen
          await fsp.rm(abs, { recursive: true, force: true });
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errMessage(err) };
      }
    },

    async search(
      query: string,
      opts?: { caseSensitive?: boolean; maxResults?: number },
    ): Promise<EditorSearchHit[]> {
      const root = requireRoot(getRoot);
      const needle = typeof query === 'string' ? query : '';
      if (!needle) return [];
      const maxResults = Math.max(1, Math.min(opts?.maxResults ?? SEARCH_DEFAULT_MAX, 2000));
      const flags = opts?.caseSensitive ? '' : 'i';
      let re: RegExp;
      try {
        re = new RegExp(escapeRegex(needle), flags);
      } catch {
        return [];
      }

      const hits: EditorSearchHit[] = [];
      let visited = 0;
      const walk = async (dir: string): Promise<void> => {
        if (hits.length >= maxResults || visited >= SEARCH_MAX_FILES) return;
        let dirents;
        try {
          dirents = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const dirent of dirents) {
          if (hits.length >= maxResults || visited >= SEARCH_MAX_FILES) return;
          if (IGNORED.has(dirent.name)) continue;
          const full = join(dir, dirent.name);
          if (dirent.isDirectory()) {
            await walk(full);
            continue;
          }
          if (!dirent.isFile()) continue;
          visited += 1;
          let size = 0;
          try {
            size = (await fsp.stat(full)).size;
          } catch {
            continue;
          }
          if (size === 0 || size > SEARCH_MAX_FILE_BYTES) continue;
          let buf: Buffer;
          try {
            buf = await fsp.readFile(full);
          } catch {
            continue;
          }
          if (isBinaryBuffer(buf)) continue;
          const lines = buf.toString('utf8').split(/\r?\n/);
          for (let i = 0; i < lines.length; i += 1) {
            if (hits.length >= maxResults) return;
            const line = lines[i];
            const match = re.exec(line);
            if (!match) continue;
            hits.push({
              path: full,
              line: i + 1,
              column: match.index + 1,
              preview: makePreview(line),
            });
          }
        }
      };

      await walk(root);
      return hits;
    },
  };
}
