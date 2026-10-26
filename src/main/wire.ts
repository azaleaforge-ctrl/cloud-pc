import { WebSocket, type RawData } from 'ws';
import type { WireMessage } from '../shared/types';

/**
 * Pesan klien yang tidak tercantum di WireMessage kontrak bersama
 * (take/release hanya dikirim member -> host).
 */
export type ClientCommand = { t: 'take' } | { t: 'release' };

export type OutgoingWire = WireMessage | ClientCommand;

function rawToString(raw: RawData): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  return raw.toString('utf8');
}

export function decodeWire(raw: RawData): OutgoingWire | null {
  try {
    const parsed: unknown = JSON.parse(rawToString(raw));
    if (!parsed || typeof parsed !== 'object') return null;
    const type = (parsed as { t?: unknown }).t;
    if (typeof type !== 'string') return null;
    return parsed as OutgoingWire;
  } catch {
    return null;
  }
}

export function isOpen(ws: WebSocket): boolean {
  return ws.readyState === WebSocket.OPEN;
}

export function sendWire(ws: WebSocket, msg: OutgoingWire): boolean {
  if (!isOpen(ws)) return false;
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}
