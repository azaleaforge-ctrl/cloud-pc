import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import AdmZip from 'adm-zip';
import type {
  EditorOpResult,
  EditorSnippetContribution,
  EditorThemeContribution,
  InstalledExtension,
  InstallExtensionResult,
  VsxExtension,
  VsxSearchResult,
} from '../../shared/editor';

export interface ExtensionService {
  search(query: string, offset?: number): Promise<VsxSearchResult>;
  list(): Promise<InstalledExtension[]>;
  install(id: string, version?: string): Promise<InstallExtensionResult>;
  uninstall(id: string): Promise<EditorOpResult>;
  readFile(path: string): Promise<string>;
}

const OPEN_VSX = 'https://open-vsx.org/api';
const FETCH_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 20;
const MAX_EXTENSION_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_EXTRACT_BYTES = 128 * 1024 * 1024;
const USER_AGENT = 'RuangKerja/IDE (+https://github.com/ruang-kerja)';

/** Bentuk entri manifest.json di data dir. */
interface ManifestEntry {
  id: string;
  version: string;
  displayName: string;
  publisher: string | null;
  description: string;
  dir: string;
  themes: EditorThemeContribution[];
  snippets: EditorSnippetContribution[];
  unsupported: number;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'item';
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Pisahkan `namespace.name` dengan aman (nama ekstensi boleh mengandung titik). */
function parseExtensionId(id: string): { namespace: string; name: string; full: string } | null {
  const raw = typeof id === 'string' ? id.trim() : '';
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  const namespace = raw.slice(0, dot);
  const name = raw.slice(dot + 1);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(namespace)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null;
  return { namespace, name, full: `${namespace}.${name}` };
}

async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
  } catch {
    throw new Error('Gagal terhubung ke Open VSX. Periksa koneksi internet lalu coba lagi.');
  }
  if (!response.ok) {
    throw new Error(`Open VSX menolak permintaan (HTTP ${response.status}).`);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error('Balasan Open VSX tidak bisa dibaca.');
  }
}

async function fetchBuffer(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT },
    });
  } catch {
    throw new Error('Gagal mengunduh ekstensi dari Open VSX. Periksa koneksi internet.');
  }
  if (!response.ok) {
    throw new Error(`Unduhan ekstensi gagal (HTTP ${response.status}).`);
  }
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch {
    throw new Error('Unduhan ekstensi terputus. Coba lagi.');
  }
}

function absoluteUrl(url: string): string {
  try {
    return new URL(url, 'https://open-vsx.org').href;
  } catch {
    return url;
  }
}

function mapVsxItem(raw: unknown): VsxExtension | null {
  const item = asRecord(raw);
  if (!item) return null;
  const namespace = asString(item.namespace);
  const name = asString(item.name);
  if (!namespace || !name) return null;
  const files = asRecord(item.files);
  const icon = files ? asString(files.icon) : null;
  const publisherRaw = item.publisher;
  const publisherRecord = asRecord(publisherRaw);
  const publisher =
    asString(publisherRaw) ??
    (publisherRecord ? asString(publisherRecord.publisherName) ?? asString(publisherRecord.loginName) : null) ??
    namespace;
  return {
    id: `${namespace}.${name}`,
    namespace,
    name,
    displayName: asString(item.displayName) ?? name,
    description: asString(item.description) ?? '',
    version: asString(item.version) ?? '',
    downloadCount: asNumber(item.downloadCount) ?? 0,
    rating: asNumber(item.averageRating),    iconUrl: icon ? absoluteUrl(icon) : null,
    publisher,
  };
}

/** Nama entri ZIP yang aman: relatif, tanpa `..`, tanpa drive/UNC. */
function safeEntryName(name: string): string | null {
  const normalized = name.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized) return null;
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
  const parts = normalized.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  if (parts.some((part) => part === '..')) return null;
  return parts.join('/');
}

function mapThemes(
  contributes: Record<string, unknown> | null,
  fullId: string,
  extDir: string,
): EditorThemeContribution[] {
  const themes: EditorThemeContribution[] = [];
  for (const raw of asArray(contributes?.themes)) {
    const theme = asRecord(raw);
    if (!theme) continue;
    const relPath = asString(theme.path);
    const label = asString(theme.label) ?? (relPath ? basename(relPath) : null);
    if (!relPath || !label) continue;
    const file = resolve(extDir, relPath);
    if (!isInside(extDir, file)) continue;
    const uiRaw = asString(theme.uiTheme);
    const uiTheme =
      uiRaw === 'vs' || uiRaw === 'vs-dark' || uiRaw === 'hc-black' ? uiRaw : ('vs-dark' as const);
    themes.push({ id: `${fullId}.theme.${slugify(label)}`, label, uiTheme, file });
  }
  return themes;
}

function mapSnippets(
  contributes: Record<string, unknown> | null,
  fullId: string,
  extDir: string,
): EditorSnippetContribution[] {
  const snippets: EditorSnippetContribution[] = [];
  for (const raw of asArray(contributes?.snippets)) {
    const snippet = asRecord(raw);
    if (!snippet) continue;
    const relPath = asString(snippet.path);
    if (!relPath) continue;
    const file = resolve(extDir, relPath);
    if (!isInside(extDir, file)) continue;
    const languageRaw = snippet.language;
    const language =
      asString(languageRaw) ?? asString(asArray(languageRaw)[0]) ?? basename(file).replace(/\.json$/i, '');
    const label = basename(file);
    snippets.push({
      id: `${fullId}.snippet.${slugify(language)}.${slugify(label)}`,
      label,
      language,
      file,
    });
  }
  return snippets;
}

/** Jumlah key contributes yang belum didukung (languages, grammars, debuggers, dst). */
function countUnsupported(contributes: Record<string, unknown> | null): number {
  if (!contributes) return 0;
  const supported = new Set(['themes', 'snippets']);
  return Object.keys(contributes).filter((key) => !supported.has(key)).length;
}

export function createExtensionService(getDataDir: () => string): ExtensionService {
  const extensionsDir = (): string => join(getDataDir(), 'extensions');
  const manifestPath = (): string => join(extensionsDir(), 'manifest.json');
  // operasi tulis manifest diserialkan supaya install bersamaan tidak saling menimpa
  let queue: Promise<unknown> = Promise.resolve();

  const withLock = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const readManifest = async (): Promise<ManifestEntry[]> => {
    let raw: string;
    try {
      raw = await fsp.readFile(manifestPath(), 'utf8');
    } catch {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
    const entries: ManifestEntry[] = [];
    for (const item of Array.isArray(parsed) ? parsed : []) {
      const record = asRecord(item);
      if (!record) continue;
      const id = asString(record.id);
      const version = asString(record.version);
      const dir = asString(record.dir);
      if (!id || !version || !dir) continue;
      const themes = asArray(record.themes)
        .map((value) => asRecord(value))
        .filter((value): value is Record<string, unknown> => value !== null)
        .map((value) => ({
          id: asString(value.id) ?? id,
          label: asString(value.label) ?? '',
          uiTheme:
            asString(value.uiTheme) === 'vs' ||
            asString(value.uiTheme) === 'vs-dark' ||
            asString(value.uiTheme) === 'hc-black'
              ? (asString(value.uiTheme) as EditorThemeContribution['uiTheme'])
              : null,
          file: asString(value.file) ?? '',
        }))
        .filter((value) => value.file.length > 0);
      const snippets = asArray(record.snippets)
        .map((value) => asRecord(value))
        .filter((value): value is Record<string, unknown> => value !== null)
        .map((value) => ({
          id: asString(value.id) ?? id,
          label: asString(value.label) ?? '',
          language: asString(value.language) ?? '',
          file: asString(value.file) ?? '',
        }))
        .filter((value) => value.file.length > 0);
      entries.push({
        id,
        version,
        displayName: asString(record.displayName) ?? id,
        publisher: asString(record.publisher),
        description: asString(record.description) ?? '',
        dir,
        themes,
        snippets,
        unsupported: asNumber(record.unsupported) ?? 0,
      });
    }
    return entries;
  };

  const writeManifest = async (entries: ManifestEntry[]): Promise<void> => {
    const dir = extensionsDir();
    await fsp.mkdir(dir, { recursive: true });
    const target = manifestPath();
    const temp = `${target}.${randomUUID()}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(entries, null, 2), 'utf8');
    await fsp.rename(temp, target);
  };

  const toInstalled = (entry: ManifestEntry): InstalledExtension => ({
    id: entry.id,
    version: entry.version,
    displayName: entry.displayName,
    publisher: entry.publisher,
    description: entry.description,
    themes: entry.themes,
    snippets: entry.snippets,
    unsupportedContributions: entry.unsupported,
  });

  /** Ekstrak ZIP ke folder tujuan; entri berbahaya (absolut / `..`) dilewati. */
  const extractZip = async (zip: AdmZip, targetDir: string): Promise<void> => {
    await fsp.mkdir(targetDir, { recursive: true });
    let total = 0;
    for (const entry of zip.getEntries()) {
      const safeName = safeEntryName(entry.entryName);
      if (!safeName) continue;
      const dest = resolve(targetDir, safeName);
      if (!isInside(targetDir, dest)) continue;
      if (entry.isDirectory) {
        await fsp.mkdir(dest, { recursive: true });
        continue;
      }
      const data = entry.getData();
      if (data.length > MAX_ENTRY_BYTES) continue;
      total += data.length;
      if (total > MAX_TOTAL_EXTRACT_BYTES) throw new Error('Isi ekstensi terlalu besar.');
      await fsp.mkdir(dirname(dest), { recursive: true });
      await fsp.writeFile(dest, data);
    }
  };

  return {
    async search(query: string, offset?: number): Promise<VsxSearchResult> {
      const q = typeof query === 'string' ? query.trim() : '';
      const start = Math.max(0, Math.floor(offset ?? 0));
      const url = `${OPEN_VSX}/-/search?query=${encodeURIComponent(q)}&size=${PAGE_SIZE}&offset=${start}&includeAllVersions=false`;
      const raw = asRecord(await fetchJson(url));
      const items = asArray(raw?.extensions)
        .map(mapVsxItem)
        .filter((item): item is VsxExtension => item !== null);
      return { total: asNumber(raw?.totalSize) ?? items.length, items };
    },

    async list(): Promise<InstalledExtension[]> {
      const entries = await readManifest();
      const alive: InstalledExtension[] = [];
      for (const entry of entries) {
        try {
          const stat = await fsp.stat(entry.dir);
          if (!stat.isDirectory()) continue;
        } catch {
          continue; // folder sudah hilang; jangan tampilkan
        }
        alive.push(toInstalled(entry));
      }
      return alive;
    },

    async install(id: string, version?: string): Promise<InstallExtensionResult> {
      const parsed = parseExtensionId(id);
      if (!parsed) return { ok: false, error: 'ID ekstensi tidak valid. Format: publisher.nama.' };
      let tempFile: string | null = null;
      try {
        let targetVersion = asString(version);
        if (!targetVersion) {
          const meta = asRecord(await fetchJson(`${OPEN_VSX}/${parsed.namespace}/${parsed.name}`));
          targetVersion = asString(meta?.version);
          if (!targetVersion) {
            return { ok: false, error: 'Versi ekstensi tidak ditemukan di Open VSX.' };
          }
        }
        const downloadUrl = `${OPEN_VSX}/${parsed.namespace}/${parsed.name}/${encodeURIComponent(targetVersion)}/file/${parsed.full}-${encodeURIComponent(targetVersion)}.vsix`;
        const buffer = await fetchBuffer(downloadUrl);

        const extRoot = extensionsDir();
        const destDir = join(extRoot, parsed.full, targetVersion);
        tempFile = join(tmpdir(), `rk-ext-${randomUUID()}.vsix`);
        await fsp.writeFile(tempFile, buffer);

        let zip: AdmZip;
        try {
          zip = new AdmZip(tempFile);
        } catch {
          return { ok: false, error: 'File ekstensi rusak (bukan VSIX yang valid).' };
        }

        const staging = `${destDir}.${randomUUID()}.tmp`;
        try {
          await extractZip(zip, staging);
          // baca manifest ekstensi dari hasil ekstrak
          const pkgPath = join(staging, 'extension', 'package.json');
          let pkgRaw: string;
          try {
            pkgRaw = await fsp.readFile(pkgPath, 'utf8');
          } catch {
            return { ok: false, error: 'Paket ekstensi tidak berisi extension/package.json.' };
          }
          let pkg: Record<string, unknown> | null = null;
          try {
            pkg = asRecord(JSON.parse(pkgRaw) as unknown);
          } catch {
            return { ok: false, error: 'package.json ekstensi tidak valid.' };
          }
          if (!pkg) return { ok: false, error: 'package.json ekstensi tidak valid.' };

          const extDir = join(staging, 'extension');
          const contributes = asRecord(pkg.contributes);
          const displayName = asString(pkg.displayName) ?? asString(pkg.name) ?? parsed.name;
          const publisher = asString(pkg.publisher) ?? parsed.namespace;
          const entry: ManifestEntry = {
            id: parsed.full,
            version: targetVersion,
            displayName,
            publisher,
            description: asString(pkg.description) ?? '',
            dir: destDir,
            themes: mapThemes(contributes, parsed.full, extDir),
            snippets: mapSnippets(contributes, parsed.full, extDir),
            unsupported: countUnsupported(contributes),
          };

          // path tema/snippet sementara menunjuk staging; pindahkan ke folder final
          const finalize = (file: string): string => join(destDir, relative(staging, file));
          entry.themes = entry.themes.map((theme) => ({ ...theme, file: finalize(theme.file) }));
          entry.snippets = entry.snippets.map((snippet) => ({ ...snippet, file: finalize(snippet.file) }));

          await fsp.rm(destDir, { recursive: true, force: true });
          await fsp.mkdir(join(extRoot, parsed.full), { recursive: true });
          await fsp.rename(staging, destDir);

          await withLock(async () => {
            const current = await readManifest();
            const next = current.filter((item) => item.id !== entry.id);
            next.push(entry);
            await writeManifest(next);
          });

          return { ok: true, extension: toInstalled(entry) };
        } finally {
          await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined);
        }
      } catch (err) {
        return { ok: false, error: errMessage(err) };
      } finally {
        if (tempFile) await fsp.rm(tempFile, { force: true }).catch(() => undefined);
      }
    },

    async uninstall(id: string): Promise<EditorOpResult> {
      const parsed = parseExtensionId(id);
      if (!parsed) return { ok: false, error: 'ID ekstensi tidak valid.' };
      try {
        const removed = await withLock(async () => {
          const current = await readManifest();
          const entry = current.find((item) => item.id === parsed.full);
          if (!entry) return null;
          const next = current.filter((item) => item.id !== parsed.full);
          await writeManifest(next);
          return entry;
        });
        if (!removed) return { ok: true };
        // hapus folder setelah manifest bersih supaya UI tidak menunjuk path mati
        await fsp
          .rm(join(extensionsDir(), parsed.full), { recursive: true, force: true })
          .catch(() => undefined);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errMessage(err) };
      }
    },

    async readFile(path: string): Promise<string> {
      const root = extensionsDir();
      if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Path ekstensi harus absolut.');
      const abs = resolve(path);
      if (!isInside(resolve(root), abs) || abs === resolve(root)) {
        throw new Error('Path di luar folder ekstensi.');
      }
      const stat = await fsp.stat(abs);
      if (!stat.isFile()) throw new Error('Path ekstensi bukan file.');
      if (stat.size > MAX_EXTENSION_FILE_BYTES) throw new Error('File ekstensi terlalu besar (maksimal 4 MB).');
      return fsp.readFile(abs, 'utf8');
    },
  };
}
