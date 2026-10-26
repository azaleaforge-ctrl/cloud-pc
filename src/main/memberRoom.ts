import { promises as fsp } from 'node:fs';
import { dirname } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { WebSocket } from 'ws';
import type {
  ActionResult,
  AppState,
  Member,
  NotifyPayload,
  ServerState,
  WireMessage,
} from '../shared/types';
import { isIgnoredRelative, MAX_SYNC_BYTES, resolveInside, scanFiles, toRel } from './fsScan';
import { decodeWire, isOpen, sendWire, type OutgoingWire } from './wire';

export interface MemberRoomOptions {
  host: string;
  port: number;
  code: string;
  memberName: string;
  memberId: string;
  localDir: string;
  emit: (patch: Partial<AppState>) => void;
  notify: (n: NotifyPayload) => void;
}

export interface MemberRoom {
  takeTurn(): ActionResult;
  releaseTurn(): ActionResult;
  close(): Promise<void>;
}

interface SnapshotFile {
  b64: string;
  mtime: number;
}

const WELCOME_TIMEOUT_MS = 8_000;
const HEARTBEAT_MS = 15_000;
const CLIENT_TIMEOUT_MS = 60_000;
const DEBOUNCE_MS = 50;
const SYNC_DEBOUNCE_MS = 300;

const LOST_MESSAGE = 'Koneksi ke host terputus';

export async function joinAsMember(opts: MemberRoomOptions): Promise<MemberRoom> {
  const socket = new WebSocket(`ws://${opts.host}:${opts.port}`);

  let selfId = opts.memberId;
  let members: Member[] = [];
  let holder: string | null = null;
  let queue: string[] = [];
  let server: ServerState = { status: 'idle', url: null, port: null, logs: [] };

  let closed = false;
  let welcomed = false;
  let lastMessage = Date.now();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;

  const snapshot = new Map<string, SnapshotFile>();
  const knownFiles = new Set<string>();
  const suppressed = new Map<string, number>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const emitQueue = (): void => {
    opts.emit({ members, queue: { holder, queue: [...queue] }, server });
  };

  const scheduleSyncEmit = (): void => {
    if (closed) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      if (closed) return;
      opts.emit({ sync: { status: 'ready', files: knownFiles.size, lastSync: Date.now() } });
    }, SYNC_DEBOUNCE_MS);
    syncTimer.unref?.();
  };

  const consumeSuppressed = (relPath: string): boolean => {
    const ts = suppressed.get(relPath);
    if (ts === undefined) return false;
    suppressed.delete(relPath);
    return Date.now() - ts < 5000;
  };

  const pruneSuppressed = (): void => {
    if (suppressed.size < 60) return;
    const now = Date.now();
    for (const [path, ts] of suppressed) {
      if (now - ts > 10_000) suppressed.delete(path);
    }
  };

  const touchKnown = (relPath: string, exists: boolean): void => {
    const before = knownFiles.size;
    if (exists) knownFiles.add(relPath);
    else knownFiles.delete(relPath);
    if (knownFiles.size !== before) scheduleSyncEmit();
  };

  const applyRemoteFs = async (msg: Extract<WireMessage, { t: 'fs' }>): Promise<void> => {
    const relPath = typeof msg.path === 'string' ? msg.path : '';
    if (!relPath || isIgnoredRelative(relPath)) return;
    const abs = resolveInside(opts.localDir, relPath);
    if (!abs) return;

    try {
      if (msg.op === 'unlink') {
        suppressed.set(relPath, Date.now());
        try {
          await fsp.unlink(abs);
        } catch {
          // sudah tidak ada
        }
        touchKnown(relPath, false);
        pruneSuppressed();
        return;
      }
      if (!msg.b64) return;
      const buf = Buffer.from(msg.b64, 'base64');
      if (buf.length > MAX_SYNC_BYTES) return;
      await fsp.mkdir(dirname(abs), { recursive: true });
      await fsp.writeFile(abs, buf);
      const mtime = typeof msg.mtime === 'number' && msg.mtime > 0 ? msg.mtime : Date.now();
      try {
        await fsp.utimes(abs, new Date(mtime), new Date(mtime));
      } catch {
        // abaikan
      }
      suppressed.set(relPath, Date.now());
      touchKnown(relPath, true);
      pruneSuppressed();
    } catch {
      // tulis gagal (izin / disk); biarkan host tetap otoritatif
    }
  };

  const publishLocalChange = async (event: 'add' | 'change' | 'unlink', relPath: string): Promise<void> => {
    if (closed || holder !== selfId) return;
    if (consumeSuppressed(relPath)) return;
    const abs = resolveInside(opts.localDir, relPath);
    if (!abs) return;

    if (event === 'unlink') {
      touchKnown(relPath, false);
      sendWire(socket, { t: 'fs', op: 'unlink', path: relPath, mtime: Date.now() });
      return;
    }

    try {
      const stat = await fsp.stat(abs);
      if (!stat.isFile()) return;
      if (stat.size > MAX_SYNC_BYTES) {
        opts.notify({ kind: 'warn', message: `File ${relPath} lebih dari 8 MB, tidak disinkronkan.` });
        return;
      }
      const buf = await fsp.readFile(abs);
      const mtime = Math.round(stat.mtime.getTime());
      touchKnown(relPath, true);
      sendWire(socket, { t: 'fs', op: event, path: relPath, b64: buf.toString('base64'), mtime });
    } catch {
      // file hilang sebelum dibaca
    }
  };

  const startWatcher = (): void => {
    if (watcher || closed) return;
    try {
      watcher = watch(opts.localDir, {
        ignoreInitial: true,
        ignored: (path: string) => {
          const relPath = toRel(opts.localDir, path);
          if (!relPath || relPath.startsWith('..')) return false;
          return isIgnoredRelative(relPath);
        },
      });
      watcher.on('all', (event, absPath) => {
        if (event !== 'add' && event !== 'change' && event !== 'unlink') return;
        const relPath = toRel(opts.localDir, absPath);
        if (!relPath || relPath.startsWith('..') || isIgnoredRelative(relPath)) return;
        if (holder !== selfId) return;
        const previous = pending.get(relPath);
        if (previous) clearTimeout(previous);
        const timer = setTimeout(() => {
          pending.delete(relPath);
          if (event === 'unlink') void publishLocalChange('unlink', relPath);
          else void publishLocalChange(event, relPath);
        }, DEBOUNCE_MS);
        pending.set(relPath, timer);
      });
      watcher.on('error', () => undefined);
    } catch {
      watcher = null;
    }
  };

  const stopWatcher = async (): Promise<void> => {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    if (watcher) {
      try {
        await watcher.close();
      } catch {
        // abaikan
      }
      watcher = null;
    }
  };

  const cleanup = (): void => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
  };

  const connectionLost = (): void => {
    if (closed) return;
    closed = true;
    cleanup();
    void stopWatcher();
    opts.emit({
      sync: { status: 'error', files: knownFiles.size, lastSync: null, message: LOST_MESSAGE },
    });
    opts.notify({ kind: 'error', message: LOST_MESSAGE });
  };

  const applySnapshot = async (): Promise<void> => {
    const entries = [...snapshot.entries()];
    for (const [relPath, item] of entries) {
      if (closed) return;
      const abs = resolveInside(opts.localDir, relPath);
      if (!abs) continue;
      try {
        const buf = Buffer.from(item.b64, 'base64');
        if (buf.length > MAX_SYNC_BYTES) continue;
        await fsp.mkdir(dirname(abs), { recursive: true });
        await fsp.writeFile(abs, buf);
        if (item.mtime > 0) {
          try {
            await fsp.utimes(abs, new Date(item.mtime), new Date(item.mtime));
          } catch {
            // abaikan
          }
        }
        knownFiles.add(relPath);
      } catch {
        // file gagal ditulis; lanjut
      }
    }

    // Hapus file lokal yang tidak ada di snapshot host (kecuali folder IGNORED_DIRS).
    try {
      const local = await scanFiles(opts.localDir);
      for (const file of local) {
        if (snapshot.has(file.path)) continue;
        try {
          await fsp.unlink(file.abs);
        } catch {
          // abaikan
        }
        knownFiles.delete(file.path);
      }
    } catch {
      // abaikan
    }

    snapshot.clear();
    if (closed) return;
    opts.emit({ sync: { status: 'ready', files: knownFiles.size, lastSync: Date.now() } });
    startWatcher();
  };

  const handleMessage = (msg: OutgoingWire): void => {
    switch (msg.t) {
      case 'welcome': {
        selfId = msg.selfId || opts.memberId;
        members = msg.members ?? [];
        holder = msg.holder ?? null;
        queue = msg.queue ?? [];
        server = msg.server ?? server;
        emitQueue();
        break;
      }
      case 'state': {
        const previousHolder = holder;
        members = msg.members ?? [];
        holder = msg.holder ?? null;
        queue = msg.queue ?? [];
        server = msg.server ?? server;
        emitQueue();
        if (previousHolder !== holder) {
          if (holder === selfId) {
            opts.notify({ kind: 'turn', message: 'Giliranmu sekarang - silakan mulai bekerja' });
          } else if (previousHolder === selfId) {
            opts.notify({ kind: 'info', message: 'Giliranmu selesai' });
          }
        }
        break;
      }
      case 'tree-begin':
        snapshot.clear();
        opts.emit({ sync: { status: 'syncing', files: 0, lastSync: null } });
        break;
      case 'file':
        snapshot.set(msg.path, { b64: msg.b64, mtime: msg.mtime });
        break;
      case 'tree-end':
        void applySnapshot();
        break;
      case 'fs':
        void applyRemoteFs(msg);
        break;
      case 'notify':
        opts.notify({ kind: msg.kind, message: msg.message });
        break;
      case 'error':
        opts.notify({ kind: 'error', message: msg.message });
        break;
      case 'ping':
        sendWire(socket, { t: 'pong' });
        break;
      default:
        break;
    }
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Tidak bisa terhubung ke host'));
      try {
        socket.terminate();
      } catch {
        // abaikan
      }
    }, WELCOME_TIMEOUT_MS);

    const fail = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('Tidak bisa terhubung ke host'));
    };

    socket.on('open', () => {
      sendWire(socket, { t: 'hello', name: opts.memberName, clientId: opts.memberId });
    });

    socket.on('message', (raw) => {
      lastMessage = Date.now();
      const msg = decodeWire(raw);
      if (!msg) return;
      if (!welcomed) {
        if (msg.t !== 'welcome') return;
        welcomed = true;
        settled = true;
        clearTimeout(timer);
        handleMessage(msg);
        resolve();
        return;
      }
      handleMessage(msg);
    });

    socket.on('error', () => {
      if (!welcomed) fail();
    });

    socket.on('close', () => {
      if (!welcomed) {
        fail();
        return;
      }
      connectionLost();
    });
  });

  heartbeat = setInterval(() => {
    if (closed) return;
    if (Date.now() - lastMessage > CLIENT_TIMEOUT_MS) {
      connectionLost();
      try {
        socket.terminate();
      } catch {
        // abaikan
      }
      return;
    }
    sendWire(socket, { t: 'ping' });
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    takeTurn: (): ActionResult => {
      if (closed || !isOpen(socket)) return { ok: false, error: LOST_MESSAGE };
      sendWire(socket, { t: 'take' });
      return { ok: true };
    },
    releaseTurn: (): ActionResult => {
      if (closed || !isOpen(socket)) return { ok: false, error: LOST_MESSAGE };
      sendWire(socket, { t: 'release' });
      return { ok: true };
    },
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      cleanup();
      await stopWatcher();
      try {
        socket.close();
      } catch {
        // abaikan
      }
      try {
        socket.terminate();
      } catch {
        // abaikan
      }
    },
  };
}
