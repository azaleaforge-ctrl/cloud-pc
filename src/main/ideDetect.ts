import { spawn, execFile } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { ActionResult, IdeInfo } from '../shared/types';

interface IdeDef {
  id: string;
  name: string;
  pattern: RegExp;
  exes: string[];
}

/** Urutan menentukan prioritas tampilan; vscode harus sebelum visualstudio. */
const CATALOG: IdeDef[] = [
  { id: 'vscode', name: 'Visual Studio Code', pattern: /visual studio code/i, exes: ['Code.exe'] },
  { id: 'cursor', name: 'Cursor', pattern: /\bcursor\b/i, exes: ['Cursor.exe'] },
  { id: 'antigravity', name: 'Antigravity', pattern: /antigravity/i, exes: ['Antigravity.exe'] },
  { id: 'windsurf', name: 'Windsurf', pattern: /windsurf/i, exes: ['Windsurf.exe'] },
  { id: 'trae', name: 'Trae', pattern: /\btrae\b/i, exes: ['Trae.exe'] },
  { id: 'zed', name: 'Zed', pattern: /\bzed\b/i, exes: ['Zed.exe'] },
  { id: 'sublime', name: 'Sublime Text', pattern: /sublime text/i, exes: ['sublime_text.exe'] },
  { id: 'intellij', name: 'IntelliJ IDEA', pattern: /intellij idea/i, exes: ['idea64.exe', 'idea.exe'] },
  { id: 'webstorm', name: 'WebStorm', pattern: /webstorm/i, exes: ['webstorm64.exe', 'webstorm.exe'] },
  { id: 'pycharm', name: 'PyCharm', pattern: /pycharm/i, exes: ['pycharm64.exe', 'pycharm.exe'] },
  { id: 'phpstorm', name: 'PhpStorm', pattern: /phpstorm/i, exes: ['phpstorm64.exe', 'phpstorm.exe'] },
  { id: 'goland', name: 'GoLand', pattern: /goland/i, exes: ['goland64.exe', 'goland.exe'] },
  { id: 'rider', name: 'Rider', pattern: /\brider\b/i, exes: ['rider64.exe', 'rider.exe'] },
  { id: 'androidstudio', name: 'Android Studio', pattern: /android studio/i, exes: ['studio64.exe'] },
  { id: 'visualstudio', name: 'Visual Studio', pattern: /^visual studio(?! code)/i, exes: ['devenv.exe'] },
];

const CLI_TO_ID: Record<string, string> = {
  code: 'vscode',
  cursor: 'cursor',
  antigravity: 'antigravity',
  windsurf: 'windsurf',
  trae: 'trae',
  zed: 'zed',
  subl: 'sublime',
  idea: 'intellij',
  idea64: 'intellij',
  webstorm: 'webstorm',
  pycharm: 'pycharm',
  phpstorm: 'phpstorm',
  goland: 'goland',
  rider: 'rider',
  studio64: 'androidstudio',
  devenv: 'visualstudio',
};

const CATALOG_ORDER = new Map(CATALOG.map((def, index) => [def.id, index]));
const EXE_TO_DEF = new Map<string, IdeDef>();
for (const def of CATALOG) {
  for (const exe of def.exes) EXE_TO_DEF.set(exe.toLowerCase(), def);
}

const DETECT_BUDGET_MS = 5200;

interface RegEntry {
  name?: string;
  icon?: string;
  location?: string;
}

function run(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(
        file,
        args,
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => {
          if (error && !stdout) {
            resolve('');
            return;
          }
          resolve(String(stdout ?? ''));
        },
      );
    } catch {
      resolve('');
    }
  });
}

function parseRegistry(text: string): RegEntry[] {
  const entries: RegEntry[] = [];
  let current: RegEntry | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*HKEY_/i.test(line)) {
      if (current) entries.push(current);
      current = {};
      continue;
    }
    const match = /^\s+(DisplayName|DisplayIcon|InstallLocation)\s+REG_[A-Z_]+\s+(.+)$/i.exec(line);
    if (!match || !current) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'displayname') current.name = value;
    else if (key === 'displayicon') current.icon = value;
    else current.location = value;
  }
  if (current) entries.push(current);
  return entries.filter((entry) => typeof entry.name === 'string' && entry.name.length > 0);
}

function cleanIconPath(icon: string): string {
  let value = icon.trim();
  if (value.startsWith('"')) {
    const end = value.indexOf('"', 1);
    value = end > 0 ? value.slice(1, end) : value.slice(1);
  } else {
    value = value.replace(/,\s*-?\d+\s*$/, '');
  }
  return value.trim();
}

/** Cari exe kandidat di dalam folder (BFS terbatas). */
async function findExeIn(dir: string, exes: string[], depth: number): Promise<string | null> {
  const wanted = new Set(exes.map((exe) => exe.toLowerCase()));
  const queue: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < 200) {
    const item = queue.shift();
    if (!item) break;
    visited++;
    let entries;
    try {
      entries = await fsp.readdir(item.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(item.dir, entry.name);
      if (entry.isFile() && wanted.has(entry.name.toLowerCase())) return abs;
      if (entry.isDirectory() && item.depth < depth) {
        queue.push({ dir: abs, depth: item.depth + 1 });
      }
    }
  }
  return null;
}

async function resolveFromRegistry(def: IdeDef, entry: RegEntry, deadline: number): Promise<string | null> {
  const icon = entry.icon ? cleanIconPath(entry.icon) : '';
  if (icon && icon.toLowerCase().endsWith('.exe') && existsSync(icon)) {
    if (def.exes.some((exe) => exe.toLowerCase() === basename(icon).toLowerCase())) return icon;
  }
  if (entry.location && existsSync(entry.location)) {
    const hit = await findExeIn(entry.location, def.exes, 3);
    if (hit) return hit;
  }
  if (icon && Date.now() < deadline) {
    const iconDir = dirname(icon);
    if (existsSync(iconDir)) {
      const hit = await findExeIn(iconDir, def.exes, 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Kumpulkan exe dari folder umum; batas kedalaman + jumlah folder agar cepat. */
async function scanExeFolder(root: string, depth: number, deadline: number): Promise<string[]> {
  const hits: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < 350 && Date.now() < deadline) {
    const item = queue.shift();
    if (!item) break;
    visited++;
    let entries;
    try {
      entries = await fsp.readdir(item.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(item.dir, entry.name);
      if (entry.isFile()) {
        if (EXE_TO_DEF.has(entry.name.toLowerCase())) hits.push(abs);
      } else if (entry.isDirectory() && item.depth < depth) {
        queue.push({ dir: abs, depth: item.depth + 1 });
      }
    }
  }
  return hits;
}

function uniqueFile(path: string): string | null {
  try {
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

export async function detectIdes(): Promise<IdeInfo[]> {
  if (process.platform !== 'win32') return [];
  const deadline = Date.now() + DETECT_BUDGET_MS;
  const byPath = new Map<string, IdeInfo>();
  const byId = new Set<string>();

  const add = (ideId: string, exe: string, source: IdeInfo['source']): void => {
    if (byId.has(ideId)) return;
    const resolved = uniqueFile(exe);
    if (!resolved) return;
    const key = resolved.toLowerCase();
    if (byPath.has(key)) return;
    const def = CATALOG.find((item) => item.id === ideId);
    if (!def) return;
    byId.add(ideId);
    byPath.set(key, { id: def.id, name: def.name, exe: resolved, source });
  };

  // 1. Registry (HKCU, HKLM, HKLM WOW6432Node)
  try {
    const keys = [
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ];
    const outputs = await Promise.all(keys.map((key) => run('reg.exe', ['query', key, '/s'], 2500)));
    const entries = outputs.flatMap(parseRegistry);
    const resolved = await Promise.all(
      entries.map(async (entry) => {
        const def = CATALOG.find((item) => item.pattern.test(entry.name ?? ''));
        if (!def) return null;
        const exe = await resolveFromRegistry(def, entry, deadline);
        return exe ? { def, exe } : null;
      }),
    );
    for (const item of resolved) if (item) add(item.def.id, item.exe, 'registry');
  } catch {
    // registry tidak terbaca; lanjut ke folder
  }

  // 2. Folder umum
  try {
    const roots: Array<{ dir: string; depth: number }> = [];
    const localAppData = process.env.LOCALAPPDATA;
    const programFiles = process.env.ProgramFiles ?? process.env.PROGRAMFILES;
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? process.env['PROGRAMFILES(X86)'];
    if (localAppData) roots.push({ dir: join(localAppData, 'Programs'), depth: 2 });
    if (programFiles) roots.push({ dir: programFiles, depth: 2 });
    if (programFilesX86) roots.push({ dir: programFilesX86, depth: 2 });
    const scans = await Promise.all(
      roots.filter((root) => existsSync(root.dir)).map((root) => scanExeFolder(root.dir, root.depth, deadline)),
    );
    for (const exe of scans.flat()) {
      const def = EXE_TO_DEF.get(basename(exe).toLowerCase());
      if (def) add(def.id, exe, 'folder');
    }
  } catch {
    // scan folder gagal; lanjut ke PATH
  }

  // 3. PATH
  try {
    const names = Object.keys(CLI_TO_ID);
    const found = await Promise.all(
      names.map(async (name) => {
        const output = await run('where.exe', [name], 1500);
        const first = output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        return first ? { name, path: first } : null;
      }),
    );
    for (const item of found) {
      if (!item) continue;
      const ideId = CLI_TO_ID[item.name];
      if (!ideId) continue;
      const ext = extname(item.path).toLowerCase();
      if (ext !== '.exe' && ext !== '.cmd' && ext !== '.bat') continue;
      add(ideId, item.path, 'path');
    }
  } catch {
    // where.exe tidak tersedia
  }

  return [...byPath.values()].sort((a, b) => {
    const orderA = CATALOG_ORDER.get(a.id) ?? 99;
    const orderB = CATALOG_ORDER.get(b.id) ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });
}

export async function openInIde(ide: IdeInfo, folder: string): Promise<ActionResult> {
  try {
    if (process.platform !== 'win32') return { ok: false, error: 'Membuka IDE hanya didukung di Windows.' };
    if (!ide || !ide.exe) return { ok: false, error: 'Lokasi IDE tidak diketahui. Coba scan ulang.' };
    if (!existsSync(ide.exe)) return { ok: false, error: `IDE tidak ditemukan di ${ide.exe}` };
    if (!existsSync(folder)) return { ok: false, error: 'Folder project tidak ditemukan.' };

    const ext = extname(ide.exe).toLowerCase();
    if (ext === '.exe') {
      const child = spawn(ide.exe, [folder], { detached: true, stdio: 'ignore' });
      child.on('error', () => undefined);
      child.unref();
      return { ok: true };
    }

    const child = spawn('cmd.exe', ['/c', 'start', '""', `"${ide.exe}"`, `"${folder}"`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    child.on('error', () => undefined);
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
