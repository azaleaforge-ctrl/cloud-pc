import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type RememberedPermissionKind = 'terminal' | 'mcp';

type StoredPermissionFile = {
  version: 1;
  grants: Array<{ key: string; createdAt: number }>;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, stableValue(record[key])]));
}

/**
 * Remember the user's approval for one exact action in one exact workspace.
 * Whitespace inside commands and MCP argument values is deliberately preserved:
 * "always allow" must never expand into a broad command or tool permission.
 */
export function createRememberedPermissionKey(
  kind: RememberedPermissionKind,
  projectPath: string,
  action: unknown,
): string {
  const normalizedPath = process.platform === 'win32' ? projectPath.trim().toLowerCase() : projectPath.trim();
  const payload = JSON.stringify(stableValue({ kind, projectPath: normalizedPath, action }));
  return createHash('sha256').update(payload).digest('hex');
}

export class RememberedPermissionStore {
  private readonly filePath: string;
  private grants = new Map<string, number>();
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoredPermissionFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.grants)) return;
      for (const item of parsed.grants) {
        if (!item || typeof item !== 'object') continue;
        const entry = item as { key?: unknown; createdAt?: unknown };
        if (typeof entry.key === 'string' && /^[a-f0-9]{64}$/.test(entry.key)) {
          this.grants.set(entry.key, typeof entry.createdAt === 'number' ? entry.createdAt : Date.now());
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('Daftar izin tersimpan tidak dapat dibaca: ' + ((error as Error).message || 'kesalahan tidak diketahui'));
      }
    }
  }

  has(key: string): boolean {
    return this.grants.has(key);
  }

  async remember(key: string): Promise<void> {
    await this.load();
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Kunci izin permanen tidak valid.');
    if (this.grants.has(key)) return;
    const previousGrants = new Map(this.grants);
    this.grants.set(key, Date.now());
    // Keep the allow-list small and bounded. Oldest grants are removed first.
    while (this.grants.size > 300) {
      const oldest = [...this.grants.entries()].sort((a, b) => a[1] - b[1])[0];
      if (!oldest) break;
      this.grants.delete(oldest[0]);
    }
    const snapshot: StoredPermissionFile = {
      version: 1,
      grants: [...this.grants.entries()].map(([grantKey, createdAt]) => ({ key: grantKey, createdAt })),
    };
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tempPath = this.filePath + '.tmp';
      await writeFile(tempPath, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', mode: 0o600 });
      try {
        await rename(tempPath, this.filePath);
      } catch (error) {
        await rm(this.filePath, { force: true }).catch(() => undefined);
        await rename(tempPath, this.filePath);
        if ((error as Error).message) { /* preserve the successful fallback rename */ }
      }
    });
    try {
      await this.writeQueue;
    } catch (error) {
      // Do not keep an unpersisted grant active in memory after a failed save.
      this.grants = previousGrants;
      throw error;
    }
  }
}
