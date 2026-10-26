import dgram from 'node:dgram';
import os from 'node:os';
import type { DiscoveredRoom } from '../shared/types';

const APP_TAG = 'ruang-kerja';
const DISCOVERY_PORT = 47800;
const ADVERTISE_INTERVAL_MS = 1500;

interface Announce {
  app: string;
  code: string;
  name: string;
  port: number;
  ip: string;
}

let advSocket: dgram.Socket | null = null;
let advTimer: ReturnType<typeof setInterval> | null = null;
let advInfo: { code: string; name: string; port: number } | null = null;

/** IP LAN IPv4 (non-internal), diprioritaskan 192.168.x / 10.x / 172.16-31.x. */
export function getLanIp(): string | null {
  try {
    const candidates: string[] = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const iface of list ?? []) {
        if (iface.family !== 'IPv4' || iface.internal) continue;
        candidates.push(iface.address);
      }
    }
    if (candidates.length === 0) return null;
    const rank = (ip: string): number => {
      if (/^192\.168\./.test(ip)) return 0;
      if (/^10\./.test(ip)) return 1;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
      if (/^169\.254\./.test(ip)) return 4;
      return 3;
    };
    candidates.sort((a, b) => rank(a) - rank(b));
    return candidates[0];
  } catch {
    return null;
  }
}

function broadcastTargets(ip: string | null): string[] {
  const targets = new Set<string>(['255.255.255.255']);
  if (ip && ip.split('.').length === 4) {
    const parts = ip.split('.');
    targets.add(`${parts[0]}.${parts[1]}.${parts[2]}.255`);
  }
  return [...targets];
}

function sendAnnounce(): void {
  const socket = advSocket;
  const info = advInfo;
  if (!socket || !info) return;
  try {
    const ip = getLanIp();
    const payload = Buffer.from(
      JSON.stringify({
        app: APP_TAG,
        code: info.code,
        name: info.name,
        port: info.port,
        ip: ip ?? '0.0.0.0',
      } satisfies Announce),
      'utf8',
    );
    for (const target of broadcastTargets(ip)) {
      try {
        socket.send(payload, DISCOVERY_PORT, target);
      } catch {
        // jaringan berubah / socket tertutup
      }
    }
  } catch {
    // jangan pernah melempar dari iklan UDP
  }
}

function beginAdvertising(socket: dgram.Socket): void {
  if (advTimer) return;
  try {
    socket.setBroadcast(true);
  } catch {
    // sebagian jaringan menolak; tetap coba kirim
  }
  sendAnnounce();
  advTimer = setInterval(sendAnnounce, ADVERTISE_INTERVAL_MS);
  advTimer.unref?.();
}

export function startAdvertise(info: { code: string; name: string; port: number }): void {
  stopAdvertise();
  advInfo = { ...info };
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  advSocket = socket;
  let fallback = false;
  socket.on('error', () => {
    if (fallback || advSocket !== socket) return;
    // Port 47800 dipakai proses lain: tetap iklan lewat port ephemeral.
    fallback = true;
    try {
      socket.close();
    } catch {
      // abaikan
    }
    const alt = dgram.createSocket({ type: 'udp4' });
    advSocket = alt;
    alt.on('error', () => undefined);
    alt.bind(0, () => beginAdvertising(alt));
  });
  socket.bind(DISCOVERY_PORT, () => beginAdvertising(socket));
}

export function stopAdvertise(): void {
  if (advTimer) {
    clearInterval(advTimer);
    advTimer = null;
  }
  advInfo = null;
  const socket = advSocket;
  advSocket = null;
  if (!socket) return;
  try {
    socket.close();
  } catch {
    // sudah tertutup
  }
}

/** Cari room lewat announce UDP. Resolve null saat timeout. */
export function findRoom(code: string, timeoutMs = 4000): Promise<DiscoveredRoom | null> {
  const wanted = code.trim().toUpperCase();
  return new Promise<DiscoveredRoom | null>((resolveResult) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const finish = (room: DiscoveredRoom | null): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // sudah tertutup
      }
      resolveResult(room);
    };

    socket.on('error', () => finish(null));
    socket.on('message', (buf, rinfo) => {
      try {
        const data = JSON.parse(buf.toString('utf8')) as Partial<Announce>;
        if (data.app !== APP_TAG || typeof data.code !== 'string') return;
        if (data.code.trim().toUpperCase() !== wanted) return;
        const port = typeof data.port === 'number' ? data.port : 0;
        if (!port) return;
        finish({
          code: data.code.trim().toUpperCase(),
          name: typeof data.name === 'string' && data.name ? data.name : 'Ruangan',
          host: typeof data.ip === 'string' && data.ip ? data.ip : rinfo.address,
          port,
        });
      } catch {
        // paket asing, abaikan
      }
    });

    timer = setTimeout(() => finish(null), Math.max(200, timeoutMs));
    try {
      socket.bind(DISCOVERY_PORT, () => {
        try {
          socket.setBroadcast(true);
        } catch {
          // abaikan
        }
      });
    } catch {
      finish(null);
    }
  });
}
