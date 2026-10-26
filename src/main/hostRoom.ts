import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  ActionResult,
  AppState,
  Member,
  NotifyPayload,
  ServerState,
  WireMessage,
} from '../shared/types';
import { getLanIp } from './discovery';
import { isIgnoredRelative, MAX_SYNC_BYTES, resolveInside, scanFiles, toRel } from './fsScan';
import { decodeWire, isOpen, sendWire } from './wire';

export interface HostRoomOptions {
  code: string;
  roomName: string;
  hostName: string;
  hostId: string;
  projectPath: string;
  initialHolder: string | null;
  emit: (patch: Partial<AppState>) => void;
  notify: (n: NotifyPayload) => void;
}

export interface HostRoom {
  readonly code: string;
  readonly port: number;
  takeTurn(): ActionResult;
  releaseTurn(): ActionResult;
  approveQueue(requesterId: string): ActionResult;
  deferQueue(requesterId: string): ActionResult;
  reportActivity(memberId: string, source: string): void;
  setServerState(state: ServerState): void;
  close(): Promise<void>;
}

interface Client {
  id: string;
  name: string;
  ws: WebSocket;
  lastSeen: number;
}

interface FileMeta {
  mtime: number;
  size: number;
}

const HEARTBEAT_MS = 20_000;
const CLIENT_TIMEOUT_MS = 60_000;
const DEBOUNCE_MS = 50;
const SYNC_DEBOUNCE_MS = 300;
const IDLE_TIMEOUT_MS = 120_000; // 2 menit idle → auto release

export async function createHostRoom(opts: HostRoomOptions): Promise<HostRoom> {
  const members = new Map<string, Member>();
  members.set(opts.hostId, { id: opts.hostId, name: opts.hostName, isHost: true });

  const clients = new Map<string, Client>();
  const fileIndex = new Map<string, FileMeta>();
  const suppressed = new Map<string, number>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  let holder: string | null = opts.initialHolder && members.has(opts.initialHolder) ? opts.initialHolder : null;
  const queue: string[] = [];
  let serverState: ServerState = { status: 'idle', url: null, port: null, logs: [] };
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
  let closed = false;
  let oversizeWarned = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let promptTimer: ReturnType<typeof setTimeout> | null = null;
  let repromptTimer: ReturnType<typeof setTimeout> | null = null;
  let holderLastActivity: number | null = holder ? Date.now() : null;
  let holderActivitySource: string | null = holder ? 'room-start' : null;
  let pendingPrompt: { requesterId: string; requesterName: string; expiresAt: number } | null = null;
  const snoozedUntil = new Map<string, number>();

  const clearPrompt = (): void => {
    if (promptTimer) clearTimeout(promptTimer);
    if (repromptTimer) clearTimeout(repromptTimer);
    promptTimer = null;
    repromptTimer = null;
    pendingPrompt = null;
  };

  const updateStatuses = (): void => {
    for (const [id, member] of members) {
      member.status = id === holder ? 'working' : queue.includes(id) ? 'queued' : 'idle';
    }
  };

  const resetIdleTimer = (source = 'file'): void => {
    if (!holder) return;
    holderLastActivity = Date.now();
    holderActivitySource = source;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (holder && !closed) {
        void internalReleaseTurn(holder, true);
      }
    }, IDLE_TIMEOUT_MS);
    idleTimer.unref?.();
  };

  const wsServer = new WebSocketServer({ port: 0, host: '0.0.0.0' });
  await new Promise<void>((resolve, reject) => {
    wsServer.once('listening', () => resolve());
    wsServer.once('error', (err) => reject(err));
  });
  wsServer.on('error', () => undefined);
  const port = (wsServer.address() as AddressInfo).port;

  const listMembers = (): Member[] => [...members.values()];
  const queueState = () => ({ holder, queue: [...queue], holderLastActivity, holderActivitySource });

  const broadcast = (msg: WireMessage, exceptId?: string): void => {
    for (const client of clients.values()) {
      if (client.id === exceptId) continue;
      sendWire(client.ws, msg);
    }
  };

  const notifyMember = (memberId: string, kind: NotifyPayload['kind'], message: string): void => {
    if (memberId === opts.hostId) {
      opts.notify({ kind, message });
      return;
    }
    const client = clients.get(memberId);
    if (client) sendWire(client.ws, { t: 'notify', kind, message });
  };

  const emitQueue = (): void => {
    opts.emit({ members: listMembers(), queue: queueState() });
  };

  const sendState = (): void => {
    broadcast({ t: 'state', members: listMembers(), holder, queue: [...queue], holderLastActivity, holderActivitySource, server: serverState });
  };

  const scheduleSyncEmit = (): void => {
    if (closed) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      if (closed) return;
      (async () => {
        try {
          const files = await scanFiles(opts.projectPath);
          if (closed) return;
          opts.emit({
            sync: { status: 'ready', files: fileIndex.size, lastSync: Date.now() },
            projectFiles: files.map((f) => ({
              path: f.path,
              size: f.size,
              mtime: f.mtime,
              modified: new Date(f.mtime).toISOString(),
            })),
          });
        } catch {
          opts.emit({ sync: { status: 'ready', files: fileIndex.size, lastSync: Date.now() } });
        }
      })();
    }, SYNC_DEBOUNCE_MS);
    syncTimer.unref?.();
  };

  const pruneSuppressed = (): void => {
    if (suppressed.size < 60) return;
    const now = Date.now();
    for (const [path, ts] of suppressed) {
      if (now - ts > 10_000) suppressed.delete(path);
    }
  };

  const consumeSuppressed = (relPath: string): boolean => {
    const ts = suppressed.get(relPath);
    if (ts === undefined) return false;
    suppressed.delete(relPath);
    return Date.now() - ts < 5000;
  };

  const sendTree = async (ws: WebSocket, totalHint: number): Promise<void> => {
    const paths = [...fileIndex.keys()];
    sendWire(ws, { t: 'tree-begin', total: totalHint });
    for (const relPath of paths) {
      if (!isOpen(ws)) return;
      const abs = resolveInside(opts.projectPath, relPath);
      if (!abs) continue;
      try {
        const buf = await fsp.readFile(abs);
        if (buf.length > MAX_SYNC_BYTES) continue;
        const meta = fileIndex.get(relPath);
        sendWire(ws, {
          t: 'file',
          path: relPath,
          b64: buf.toString('base64'),
          mtime: meta?.mtime ?? Date.now(),
        });
      } catch {
        // file berubah/hilang saat dikirim; lewati
      }
    }
    sendWire(ws, { t: 'tree-end' });
  };

  const announceHolder = (memberId: string): void => {
    notifyMember(memberId, 'turn', 'Giliranmu sekarang - silakan mulai bekerja');
  };

  const applyHolderChange = (): void => {
    emitQueue();
    sendState();
  };

  const internalTakeTurn = (byId: string): ActionResult => {
    const member = members.get(byId);
    if (!member) return { ok: false, error: 'Anggota tidak dikenal.' };
    if (holder === byId) return { ok: false, error: 'Kamu sudah memegang giliran.' };

    if (holder === null) {
      holder = byId;
      updateStatuses();
      resetIdleTimer('turn');
      broadcast({ t: 'turn-taken', holder: byId, name: member.name });
      broadcast({ t: 'notify', kind: 'info', message: `${member.name} mulai bekerja` });
      if (byId !== opts.hostId) opts.notify({ kind: 'info', message: `${member.name} mulai bekerja` });
      announceHolder(byId);
      applyHolderChange();
      return { ok: true };
    }

    if (queue.includes(byId)) return { ok: false, error: 'Kamu sudah ada di antrian.' };
    queue.push(byId);
    updateStatuses();
    if (holder === opts.hostId) {
      opts.emit({ queueNotice: { mode: 'bar', requesterId: byId, requesterName: member.name, holderName: members.get(holder)?.name ?? 'Anggota', expiresAt: null, deferredUntil: null } });
    } else {
      const holderClient = holder ? clients.get(holder) : null;
      if (holderClient) sendWire(holderClient.ws, { t: 'queue-prompt', requesterId: byId, requesterName: member.name, holderName: members.get(holder)?.name ?? 'Anggota', expiresAt: null, mode: 'bar' });
    }
    broadcast({ t: 'notify', kind: 'info', message: `${member.name} masuk antrian (posisi ${queue.length})` });
    if (byId !== opts.hostId) opts.notify({ kind: 'info', message: `${member.name} masuk antrian` });
    applyHolderChange();
    return { ok: true };
  };

  const autoAssignFromFs = (byId: string): boolean => {
    const member = members.get(byId);
    if (!member) return false;
    if (holder === byId) {
      resetIdleTimer();
      return true;
    }
    if (holder === null) {
      // Auto-assign: tidak ada yang pegang → ini dapat giliran
      holder = byId;
      resetIdleTimer();
      broadcast({ t: 'turn-taken', holder: byId, name: member.name });
      broadcast({ t: 'notify', kind: 'info', message: `${member.name} mulai bekerja (otomatis)` });
      if (byId !== opts.hostId) opts.notify({ kind: 'info', message: 'Kamu dapat giliran bekerja' });
      announceHolder(byId);
      applyHolderChange();
      return true;
    }
    // Ada yang pegang giliran → masuk antrian
    if (!queue.includes(byId)) {
      queue.push(byId);
      broadcast({ t: 'notify', kind: 'info', message: `${member.name} masuk antrian (posisi ${queue.length})` });
      applyHolderChange();
    }
    return false;
  };

  const internalReleaseTurn = (byId: string, idle = false): ActionResult => {
    if (holder !== byId) return { ok: false, error: 'Kamu tidak sedang memegang giliran.' };
    const member = members.get(byId);
    const name = member?.name ?? 'Anggota';

    if (idle) {
      clearPrompt();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      holder = queue.shift() ?? null;
      holderLastActivity = holder ? Date.now() : null;
      holderActivitySource = holder ? 'idle-auto' : null;
      updateStatuses();
      broadcast({ t: 'turn-released', holder, name });
      broadcast({ t: 'notify', kind: 'warn', message: name + ' idle selama 2 menit - giliran dilepas otomatis.' });
      if (byId !== opts.hostId) opts.notify({ kind: 'warn', message: name + ' idle - giliran dilepas otomatis.' });
      if (holder) {
        const nextName = members.get(holder)?.name ?? 'Anggota';
        announceHolder(holder);
        if (holder !== opts.hostId) opts.notify({ kind: 'turn', message: nextName + ' sekarang mendapat giliran.' });
        resetIdleTimer('queue-auto');
      }
      applyHolderChange();
      return { ok: true };
    }

    if (queue.length > 0) {
      const requesterId = queue[0];
      const requester = members.get(requesterId);
      if (requester) {
        pendingPrompt = { requesterId, requesterName: requester.name, expiresAt: Date.now() + 15_000 };
        if (byId === opts.hostId) {
          opts.emit({ queueNotice: { mode: 'decision', requesterId, requesterName: requester.name, holderName: name, expiresAt: pendingPrompt.expiresAt, deferredUntil: null } });
        } else {
          const client = clients.get(byId);
          if (client) sendWire(client.ws, { t: 'queue-prompt', requesterId, requesterName: requester.name, holderName: name, expiresAt: pendingPrompt.expiresAt, mode: 'decision' });
        }
        promptTimer = setTimeout(() => {
          promptTimer = null;
          if (pendingPrompt?.requesterId === requesterId) approveQueue(requesterId);
        }, 15_000);
        promptTimer.unref?.();
        return { ok: true };
      }
    }

    clearPrompt();
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    holder = null;
    holderLastActivity = null;
    holderActivitySource = null;
    updateStatuses();
    broadcast({ t: 'turn-released', holder: null, name });
    broadcast({ t: 'notify', kind: 'info', message: name + ' selesai bekerja.' });
    if (byId !== opts.hostId) opts.notify({ kind: 'info', message: 'Kamu selesai bekerja.' });
    applyHolderChange();
    return { ok: true };
  };
  const approveQueue = (requesterId: string): ActionResult => {
    if (!holder || !pendingPrompt || pendingPrompt.requesterId !== requesterId) return { ok: false, error: 'Permintaan giliran sudah tidak aktif.' };
    const idx = queue.indexOf(requesterId);
    if (idx < 0) return { ok: false, error: 'Anggota tidak lagi berada di antrian.' };
    const requester = members.get(requesterId);
    const previousHolder = holder;
    const previousName = members.get(previousHolder)?.name ?? 'Anggota';
    queue.splice(idx, 1);
    clearPrompt();
    holder = requesterId;
    holderLastActivity = Date.now();
    holderActivitySource = 'approved';
    updateStatuses();
    if (previousHolder === opts.hostId) opts.emit({ queueNotice: null });
    broadcast({ t: 'turn-released', holder, name: previousName });
    if (requester) announceHolder(requesterId);
    resetIdleTimer('approved');
    applyHolderChange();
    return { ok: true };
  };

  const deferQueue = (requesterId: string): ActionResult => {
    if (!holder || !pendingPrompt || pendingPrompt.requesterId !== requesterId) return { ok: false, error: 'Permintaan giliran sudah tidak aktif.' };
    const requester = members.get(requesterId);
    if (!requester) return { ok: false, error: 'Anggota tidak dikenal.' };
    const holderName = members.get(holder)?.name ?? 'Anggota';
    const idx = queue.indexOf(requesterId);
    if (idx < 0) return { ok: false, error: 'Anggota tidak lagi berada di antrian.' };
    queue.splice(idx, 1);
    const until = Date.now() + 120_000;
    snoozedUntil.set(requesterId, until);
    clearPrompt();
    updateStatuses();
    if (holder === opts.hostId) opts.emit({ queueNotice: null });
    if (requesterId === opts.hostId) {
      opts.emit({ queueNotice: { mode: 'deferred', requesterId, requesterName: requester.name, holderName, expiresAt: null, deferredUntil: until } });
    } else {
      const requesterClient = clients.get(requesterId);
      if (requesterClient) sendWire(requesterClient.ws, { t: 'queue-deferred', requesterId, requesterName: requester.name, holderName, until });
    }
    const repush = setTimeout(() => {
      snoozedUntil.delete(requesterId);
      if (!members.has(requesterId) || queue.includes(requesterId) || holder === requesterId) return;
      queue.push(requesterId);
      updateStatuses();
      applyHolderChange();
      const requesterClient = clients.get(requesterId);
      if (requesterClient) sendWire(requesterClient.ws, { t: 'queue-prompt', requesterId, requesterName: requester.name, holderName, expiresAt: null, mode: 'bar' });
    }, 120_000);
    repush.unref?.();
    applyHolderChange();
    return { ok: true };
  };

  const reportActivity = (memberId: string, source: string): void => {
    if (memberId !== holder) return;
    resetIdleTimer(source);
    if (pendingPrompt) {
      const requesterId = pendingPrompt.requesterId;
      const requester = members.get(requesterId);
      clearPrompt();
      if (requester) {
        if (memberId === opts.hostId) {
          opts.emit({ queueNotice: { mode: 'bar', requesterId, requesterName: requester.name, holderName: members.get(memberId)?.name ?? 'Anggota', expiresAt: null, deferredUntil: null } });
        } else {
          const client = clients.get(memberId);
          if (client) sendWire(client.ws, { t: 'queue-prompt', requesterId, requesterName: requester.name, holderName: members.get(memberId)?.name ?? 'Anggota', expiresAt: null, mode: 'bar' });
        }
        repromptTimer = setTimeout(() => {
          repromptTimer = null;
          if (!holder || !queue.includes(requesterId) || pendingPrompt) return;
          pendingPrompt = { requesterId, requesterName: requester.name, expiresAt: Date.now() + 15_000 };
          if (holder === opts.hostId) {
            opts.emit({ queueNotice: { mode: 'decision', requesterId, requesterName: requester.name, holderName: members.get(holder)?.name ?? 'Anggota', expiresAt: pendingPrompt.expiresAt, deferredUntil: null } });
          } else {
            const client = clients.get(holder);
            if (client) sendWire(client.ws, { t: 'queue-prompt', requesterId, requesterName: requester.name, holderName: members.get(holder)?.name ?? 'Anggota', expiresAt: pendingPrompt.expiresAt, mode: 'decision' });
          }
          promptTimer = setTimeout(() => {
            promptTimer = null;
            if (pendingPrompt?.requesterId === requesterId) approveQueue(requesterId);
          }, 15_000);
          promptTimer.unref?.();
        }, 60_000);
        repromptTimer.unref?.();
      }
    }
    sendState();
  };
  const publishLocalChange = async (event: 'add' | 'change' | 'unlink', relPath: string): Promise<void> => {
    if (closed) return;
    if (consumeSuppressed(relPath)) return;
    if (holder !== opts.hostId) return;

    resetIdleTimer();

    if (event === 'unlink') {
      if (fileIndex.delete(relPath)) scheduleSyncEmit();
      broadcast({ t: 'fs', op: 'unlink', path: relPath, mtime: Date.now(), from: opts.hostId });
      return;
    }

    const abs = resolveInside(opts.projectPath, relPath);
    if (!abs) return;
    try {
      const stat = await fsp.stat(abs);
      if (!stat.isFile()) return;
      if (stat.size > MAX_SYNC_BYTES) {
        if (!oversizeWarned) {
          oversizeWarned = true;
          opts.notify({ kind: 'warn', message: 'File lebih dari 8 MB tidak disinkronkan.' });
        }
        return;
      }
      const buf = await fsp.readFile(abs);
      const mtime = Math.round(stat.mtime.getTime());
      const existed = fileIndex.has(relPath);
      fileIndex.set(relPath, { mtime, size: buf.length });
      if (!existed) scheduleSyncEmit();
      broadcast({ t: 'fs', op: event, path: relPath, b64: buf.toString('base64'), mtime, from: opts.hostId });
    } catch {
      // file sudah hilang
    }
  };

  const applyMemberFs = async (
    sender: Client,
    msg: Extract<WireMessage, { t: 'fs' }>,
  ): Promise<void> => {
    const relPath = typeof msg.path === 'string' ? msg.path : '';
    if (!relPath || isIgnoredRelative(relPath)) return;
    const abs = resolveInside(opts.projectPath, relPath);
    if (!abs) {
      sendWire(sender.ws, { t: 'error', message: `Path tidak valid: ${relPath}` });
      return;
    }

    try {
      if (msg.op === 'unlink') {
        suppressed.set(relPath, Date.now());
        try {
          await fsp.unlink(abs);
        } catch {
          // sudah tidak ada
        }
        if (fileIndex.delete(relPath)) scheduleSyncEmit();
        pruneSuppressed();
        broadcast(
          { t: 'fs', op: 'unlink', path: relPath, mtime: msg.mtime ?? Date.now(), from: sender.id },
          sender.id,
        );
        return;
      }

      if (!msg.b64) return;
      const buf = Buffer.from(msg.b64, 'base64');
      if (buf.length > MAX_SYNC_BYTES) {
        notifyMember(sender.id, 'warn', `File ${relPath} lebih dari 8 MB, dilewati.`);
        return;
      }
      await fsp.mkdir(dirname(abs), { recursive: true });
      await fsp.writeFile(abs, buf);
      const mtime = typeof msg.mtime === 'number' && msg.mtime > 0 ? msg.mtime : Date.now();
      try {
        await fsp.utimes(abs, new Date(mtime), new Date(mtime));
      } catch {
        // utimes bisa gagal di beberapa filesystem
      }
      suppressed.set(relPath, Date.now());
      fileIndex.set(relPath, { mtime, size: buf.length });
      pruneSuppressed();
      scheduleSyncEmit();
      broadcast(
        { t: 'fs', op: msg.op, path: relPath, b64: msg.b64, mtime, from: sender.id },
        sender.id,
      );
    } catch (err) {
      sendWire(sender.ws, { t: 'error', message: `Gagal menulis ${relPath}: ${(err as Error).message}` });
    }
  };

  const handleDisconnect = (client: Client): void => {
    if (clients.get(client.id) !== client) return;
    clients.delete(client.id);
    if (!members.has(client.id)) return;

    const wasHolder = holder === client.id;
    members.delete(client.id);
    const queueIndex = queue.indexOf(client.id);
    if (queueIndex >= 0) queue.splice(queueIndex, 1);
    if (wasHolder) {
      idleTimer && clearTimeout(idleTimer);
      idleTimer = null;
      holder = queue.shift() ?? null;
      if (holder) resetIdleTimer();
    }

    const message = `${client.name} terputus, giliran dilepas`;
    broadcast({ t: 'notify', kind: 'info', message });
    opts.notify({ kind: 'warn', message });
    if (wasHolder) {
      clearPrompt();
      if (holder) {
        announceHolder(holder);
        resetIdleTimer('disconnect');
      }
    }
    applyHolderChange();
  };

  wsServer.on('connection', (ws) => {
    let client: Client | null = null;
    const helloTimeout = setTimeout(() => {
      if (!client) {
        try {
          ws.close();
        } catch {
          // abaikan
        }
      }
    }, 10_000);
    helloTimeout.unref?.();

    ws.on('error', () => {
      try {
        ws.terminate();
      } catch {
        // abaikan
      }
    });

    ws.on('message', (raw) => {
      const msg = decodeWire(raw);
      if (!msg) return;

      if (msg.t === 'hello') {
        if (client) {
          client.lastSeen = Date.now();
          return;
        }
        clearTimeout(helloTimeout);
        const name = typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim() : 'Anggota';
        const id = typeof msg.clientId === 'string' && msg.clientId.trim() ? msg.clientId.trim() : randomUUID();
        const previous = clients.get(id);
        if (previous) {
          clients.delete(id);
          try {
            previous.ws.terminate();
          } catch {
            // abaikan
          }
        }
        client = { id, name, ws, lastSeen: Date.now() };
        clients.set(id, client);
        members.set(id, { id, name, isHost: false, status: queue.includes(id) ? 'queued' : 'idle' });

        sendWire(ws, {
          t: 'welcome',
          selfId: id,
          code: opts.code,
          roomName: opts.roomName,
          hostName: opts.hostName,
          members: listMembers(),
          holder,
          queue: [...queue],
          holderLastActivity,
          holderActivitySource,
          hostIp: getLanIp() ?? '127.0.0.1',
          server: serverState,
        });
        void sendTree(ws, fileIndex.size);

        broadcast({ t: 'notify', kind: 'info', message: `${name} bergabung ke ruangan` }, id);
        opts.notify({ kind: 'info', message: `${name} bergabung ke ruangan` });
        applyHolderChange();
        return;
      }

      if (!client) {
        sendWire(ws, { t: 'error', message: 'Kirim hello terlebih dahulu.' });
        return;
      }
      client.lastSeen = Date.now();

      switch (msg.t) {
        case 'take': {
          const result = internalTakeTurn(client.id);
          if (!result.ok) sendWire(ws, { t: 'error', message: result.error ?? 'Gagal mengambil giliran.' });
          break;
        }
        case 'release': {
          const result = internalReleaseTurn(client.id);
          if (!result.ok) sendWire(ws, { t: 'error', message: result.error ?? 'Gagal melepas giliran.' });
          break;
        }
        case 'activity':
          reportActivity(client.id, typeof msg.source === 'string' ? msg.source : 'ui');
          break;
        case 'queue-approve': {
          const result = approveQueue(msg.requesterId);
          if (!result.ok) sendWire(ws, { t: 'error', message: result.error ?? 'Gagal menyetujui antrian.' });
          break;
        }
        case 'queue-defer': {
          const result = deferQueue(msg.requesterId);
          if (!result.ok) sendWire(ws, { t: 'error', message: result.error ?? 'Gagal menunda antrian.' });
          break;
        }
        case 'fs': {
          if (client.id !== holder) {
            // Cek auto-assign atau queue
            if (autoAssignFromFs(client.id)) {
                void applyMemberFs(client, msg);
                return;
            }
            const pos = queue.indexOf(client.id);
            const posMsg = pos >= 0 ? ` (posisi antrian: ${pos + 1})` : '';
            sendWire(ws, { t: 'error', message: `Bukan giliranmu. Tunggu${posMsg} - giliran akan diberikan otomatis saat pemegang idle.` });
            break;
          }
          resetIdleTimer();
          void applyMemberFs(client, msg);
          break;
        }
        case 'ping':
          sendWire(ws, { t: 'pong' });
          break;
        default:
          break;
      }
    });

    ws.on('close', () => {
      clearTimeout(helloTimeout);
      if (client) handleDisconnect(client);
    });
  });

  try {
    watcher = watch(opts.projectPath, {
      ignoreInitial: true,
      ignored: (path: string) => {
        const relPath = toRel(opts.projectPath, path);
        if (!relPath || relPath.startsWith('..')) return false;
        return isIgnoredRelative(relPath);
      },
    });
    watcher.on('all', (event, absPath) => {
      if (event !== 'add' && event !== 'change' && event !== 'unlink') return;
      const relPath = toRel(opts.projectPath, absPath);
      if (!relPath || relPath.startsWith('..') || isIgnoredRelative(relPath)) return;
      if (holder !== opts.hostId) return;
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

  opts.emit({
    members: listMembers(),
    queue: queueState(),
    sync: { status: 'syncing', files: 0, lastSync: null },
    projectFiles: [],
  });

  void (async () => {
    try {
      const files = await scanFiles(opts.projectPath);
      if (closed) return;
      fileIndex.clear();
      let skipped = 0;
      for (const file of files) {
        if (file.size > MAX_SYNC_BYTES) {
          skipped++;
          continue;
        }
        fileIndex.set(file.path, { mtime: file.mtime, size: file.size });
      }
      if (skipped > 0) {
        opts.notify({ kind: 'warn', message: `${skipped} file lebih dari 8 MB dilewati saat sinkronisasi awal.` });
      }
      // Emit file list ke UI real-time
      opts.emit({
        sync: { status: 'ready', files: fileIndex.size, lastSync: Date.now() },
        projectFiles: files.map((f) => ({
          path: f.path,
          size: f.size,
          mtime: f.mtime,
          modified: new Date(f.mtime).toISOString(),
        })),
      });
    } catch {
      opts.emit({
        sync: { status: 'error', files: 0, lastSync: null, message: 'Gagal memindai folder project.' },
        projectFiles: [],
      });
    }
  })();

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const client of [...clients.values()]) {
      if (now - client.lastSeen > CLIENT_TIMEOUT_MS) {
        try {
          client.ws.terminate();
        } catch {
          // abaikan
        }
        continue;
      }
      sendWire(client.ws, { t: 'ping' });
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    code: opts.code,
    port,
    takeTurn: () => internalTakeTurn(opts.hostId),
    releaseTurn: () => internalReleaseTurn(opts.hostId),
    approveQueue: (requesterId: string) => approveQueue(requesterId),
    deferQueue: (requesterId: string) => deferQueue(requesterId),
    reportActivity: (memberId: string, source: string) => reportActivity(memberId, source),
    setServerState: (state: ServerState) => {
      serverState = { ...state, logs: [] };
      sendState();
    },
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      clearPrompt();
      snoozedUntil.clear();
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
      for (const client of clients.values()) {
        try {
          client.ws.terminate();
        } catch {
          // abaikan
        }
      }
      clients.clear();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1500);
        timer.unref?.();
        try {
          wsServer.close(() => {
            clearTimeout(timer);
            resolve();
          });
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    },
  };
}
