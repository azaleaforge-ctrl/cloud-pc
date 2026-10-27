import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import type {
  DebugEvaluateResult,
  DebugEvent,
  DebugPausedFrame,
  DebugStatus,
  EditorOpResult,
} from '../../shared/editor';

export interface DebugService {
  start(entry: string): Promise<EditorOpResult>;
  stop(): Promise<void>;
  setBreakpoints(points: Array<{ path: string; line: number }>): Promise<void>;
  resume(): Promise<void>;
  pause(): Promise<void>;
  step(kind: 'over' | 'into' | 'out'): Promise<void>;
  evaluate(expression: string): Promise<DebugEvaluateResult>;
  dispose(): void;
}

/** Batas waktu menunggu inspector Node siap. */
const CONNECT_TIMEOUT_MS = 10_000;
/** Batas waktu satu panggilan CDP. */
const RPC_TIMEOUT_MS = 10_000;
const INSPECTOR_RE = /Debugger listening on ws:\/\/(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):(\d+)\/(\S+)/;
/** Penanda Node sedang menunggu debugger lepas sebelum benar-benar exit. */
const WAITING_RE = /Waiting for the debugger to disconnect/i;
const SUPPORTED_EXT = new Set(['.js', '.mjs', '.cjs']);
const STATUS_METHODS: Record<'over' | 'into' | 'out', string> = {
  over: 'Debugger.stepOver',
  into: 'Debugger.stepInto',
  out: 'Debugger.stepOut',
};

let cachedNodePath: string | null = null;

/** Cari binary node; di Electron process.execPath adalah Electron, bukan node. */
function resolveNodeBinary(): string {
  if (cachedNodePath) return cachedNodePath;
  if (process.platform !== 'win32') {
    cachedNodePath = 'node';
    return cachedNodePath;
  }
  try {
    const result = spawnSync('where.exe', ['node'], { windowsHide: true, encoding: 'utf8' });
    const first = (result.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (result.status === 0 && first) {
      cachedNodePath = first;
      return cachedNodePath;
    }
  } catch {
    // where.exe tidak tersedia; biarkan spawn memakai PATH
  }
  cachedNodePath = 'node';
  return cachedNodePath;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** URL file:// dari CDP -> path lokal; null bila bukan file. */
function urlToPath(url: string): string | null {
  if (!url.startsWith('file://')) return null;
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

/** Ubah RemoteObject CDP menjadi teks yang bisa dibaca manusia. */
function formatRemote(raw: unknown): string {
  const obj = asRecord(raw);
  if (!obj) return String(raw);
  const description = asString(obj.description);
  if (description) return description;
  if ('value' in obj) {
    const value = obj.value;
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  const unserializable = asString(obj.unserializableValue);
  if (unserializable) return unserializable;
  const preview = asRecord(obj.preview);
  if (preview) {
    const props = asArray(preview.properties)
      .map((prop) => asRecord(prop))
      .filter((prop): prop is Record<string, unknown> => prop !== null)
      .map((prop) => {
        const name = asString(prop.name) ?? '';
        const text = asString(prop.value) ?? asString(prop.type) ?? '';
        return `${name}: ${text}`;
      });
    if (props.length > 0) return `{ ${props.join(', ')} }`;
  }
  return asString(obj.type) ?? '';
}

function consoleLevel(type: string | null): 'log' | 'info' | 'warn' | 'error' {
  switch (type) {
    case 'warning':
    case 'warn':
      return 'warn';
    case 'error':
    case 'assert':
      return 'error';
    case 'info':
    case 'debug':
      return 'info';
    default:
      return 'log';
  }
}

class DebuggerController implements DebugService {
  private child: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<
    number,
    { resolve: (result: Record<string, unknown>) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  /** Breakpoint per path absolut: baris 1-based. */
  private breakpoints = new Map<string, number[]>();
  /** ID breakpoint CDP yang sudah dipasang, per path. */
  private installedBp = new Map<string, string[]>();
  private topFrameId: string | null = null;
  /** scriptId CDP -> url skrip, dipakai saat call frame tidak membawa url. */
  private scripts = new Map<string, string>();
  private paused = false;
  private stopping = false;
  private disposed = false;
  private connectLatch: ((result: EditorOpResult) => void) | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private connectSettled = false;

  constructor(private readonly onEvent: (event: DebugEvent) => void) {}

  private emit(event: DebugEvent): void {
    if (this.disposed) return;
    try {
      this.onEvent(event);
    } catch {
      // kegagalan listener renderer tidak boleh menghentikan debugger
    }
  }

  private emitStatus(status: DebugStatus, error: string | null = null): void {
    this.emit({ type: 'status', status, error });
  }

  private settleConnect(result: EditorOpResult): void {
    if (this.connectSettled) return;
    this.connectSettled = true;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    const latch = this.connectLatch;
    this.connectLatch = null;
    latch?.(result);
  }

  private isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** RPC JSON ke inspector; resolve saat balasan dengan id yang sama tiba. */
  private call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Debugger belum tersambung.'));
    }
    this.seq += 1;
    const id = this.seq;
    return new Promise<Record<string, unknown>>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Debugger tidak merespons panggilan ${method}.`));
      }, RPC_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      try {
        socket.send(JSON.stringify({ id, method, params: params ?? {} }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectPromise(new Error(`Gagal mengirim perintah debugger: ${errMessage(err)}`));
      }
    });
  }

  private rejectPending(reason: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private handleMessage(raw: Buffer | ArrayBuffer | Buffer[]): void {
    const text = Buffer.isBuffer(raw)
      ? raw.toString('utf8')
      : Array.isArray(raw)
        ? Buffer.concat(raw).toString('utf8')
        : Buffer.from(raw).toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return;
    }
    const message = asRecord(parsed);
    if (!message) return;

    const id = asNumber(message.id);
    if (id !== null) {
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      const error = asRecord(message.error);
      if (error) {
        entry.reject(new Error(asString(error.message) ?? 'Perintah debugger ditolak.'));
        return;
      }
      entry.resolve(asRecord(message.result) ?? {});
      return;
    }

    const method = asString(message.method);
    if (!method) return;
    const params = asRecord(message.params) ?? {};
    switch (method) {
      case 'Debugger.scriptParsed': {
        const scriptId = asString(params.scriptId);
        const url = asString(params.url);
        if (scriptId && url) this.scripts.set(scriptId, url);
        break;
      }
      case 'Debugger.paused':
        this.handlePaused(params);
        break;
      case 'Debugger.resumed':
        this.paused = false;
        this.topFrameId = null;
        this.emit({ type: 'resumed' });
        this.emitStatus('running');
        break;
      case 'Runtime.executionContextCreated':
        // konteks baru dibuat (mis. setelah restart internal): pasang ulang breakpoint
        void this.applyBreakpoints().catch(() => undefined);
        break;
      case 'Runtime.consoleAPICalled':
        this.handleConsole(params);
        break;
      case 'NodeRuntime.waitingForDisconnect':
        // proses selesai tapi Node menunggu debugger lepas; tutup agar bisa exit
        this.closeSocket();
        break;
      default:
        break;
    }
  }

  private handlePaused(params: Record<string, unknown>): void {
    const callFrames = asArray(params.callFrames);
    const frames: DebugPausedFrame[] = callFrames.map((raw, index) => {
      const frame = asRecord(raw) ?? {};
      const location = asRecord(frame.location) ?? {};
      const scriptId = asString(location.scriptId);
      const url = asString(location.url) ?? (scriptId ? this.scripts.get(scriptId) ?? '' : '');
      return {
        id: index,
        name: asString(frame.functionName) ?? '(anonymous)',
        file: urlToPath(url),
        line: (asNumber(location.lineNumber) ?? 0) + 1,
      };
    });
    const top = asRecord(callFrames[0]);
    this.topFrameId = top ? asString(top.callFrameId) : null;
    this.paused = true;
    this.emit({
      type: 'paused',
      reason: asString(params.reason) ?? 'other',
      file: frames[0]?.file ?? null,
      line: frames[0]?.line ?? 0,
      frames,
    });
    this.emitStatus('paused');
  }

  private handleConsole(params: Record<string, unknown>): void {
    const level = consoleLevel(asString(params.type));
    const text = asArray(params.args).map(formatRemote).join(' ');
    this.emit({ type: 'console', level, text });
  }

  /** Pasang ulang seluruh breakpoint (dipanggil saat mulai & saat konteks baru). */
  private async applyBreakpoints(): Promise<void> {
    if (!this.isOpen()) return;
    for (const ids of this.installedBp.values()) {
      for (const breakpointId of ids) {
        await this.call('Debugger.removeBreakpoint', { breakpointId }).catch(() => undefined);
      }
    }
    this.installedBp.clear();
    for (const [path, lines] of this.breakpoints) {
      const url = pathToFileURL(path).href;
      const ids: string[] = [];
      for (const line of lines) {
        try {
          const result = await this.call('Debugger.setBreakpointByUrl', {
            url,
            lineNumber: Math.max(0, line - 1),
          });
          const breakpointId = asString(result.breakpointId);
          if (breakpointId) ids.push(breakpointId);
        } catch {
          // baris tidak bisa dipasangi breakpoint; lanjut ke baris lain
        }
      }
      if (ids.length > 0) this.installedBp.set(path, ids);
    }
  }

  private wireSocket(socket: WebSocket): void {
    socket.on('message', (data) => {
      this.handleMessage(data as Buffer);
    });
    socket.on('open', () => {
      this.settleConnect({ ok: true });
    });
    socket.on('error', (err) => {
      const message = `Koneksi debugger bermasalah: ${errMessage(err)}`;
      if (this.connectSettled) {
        this.emitStatus('error', message);
      } else {
        this.settleConnect({ ok: false, error: message });
      }
    });
    socket.on('close', () => {
      this.rejectPending('Koneksi debugger terputus.');
      if (this.ws === socket) this.ws = null;
      if (this.disposed || this.stopping) return;
      if (!this.connectSettled) {
        this.settleConnect({ ok: false, error: 'Koneksi ke debugger ditutup sebelum siap.' });
        return;
      }
      // Proses yang berakhir menutup socket lebih dulu daripada event 'exit';
      // beri jeda agar event exit sempat memancarkan {type:'exited'}.
      const timer = setTimeout(() => {
        if (this.disposed || this.stopping) return;
        if (!this.child) return; // proses sudah berakhir, exit event sudah dikirim
        this.emitStatus('error', 'Koneksi ke debugger terputus.');
        this.killChild();
      }, 400);
      timer.unref?.();
    });
  }

  private connectInspector(port: number, path: string): void {
    const url = `ws://127.0.0.1:${port}/${path}`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url, { handshakeTimeout: CONNECT_TIMEOUT_MS, perMessageDeflate: false });
    } catch (err) {
      this.settleConnect({ ok: false, error: `Tidak bisa membuka koneksi debugger: ${errMessage(err)}` });
      return;
    }
    this.ws = socket;
    this.wireSocket(socket);
  }

  private killChild(): void {
    const child = this.child;
    if (!child || child.killed) {
      this.child = null;
      return;
    }
    const pid = child.pid;
    this.child = null;
    if (process.platform === 'win32' && pid) {
      try {
        // anak proses node ikut dimatikan; kegagalan taskkill tidak fatal
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('error', () => undefined);
      } catch {
        // abaikan
      }
    }
    try {
      child.kill();
    } catch {
      // proses sudah mati
    }
  }

  private closeSocket(): void {
    const socket = this.ws;
    this.ws = null;
    if (!socket) return;
    socket.removeAllListeners();
    try {
      socket.close();
      socket.terminate();
    } catch {
      // abaikan
    }
  }

  private resetState(): void {
    this.rejectPending('Debugger dihentikan.');
    this.closeSocket();
    this.killChild();
    this.paused = false;
    this.topFrameId = null;
    this.installedBp.clear();
    this.scripts.clear();
  }

  /** Tunggu proses benar-benar keluar (Windows melepas handle sedikit lebih lambat). */
  private waitChildExit(child: ChildProcess | null, timeoutMs: number): Promise<void> {
    if (!child || child.exitCode !== null) return Promise.resolve();
    return new Promise<void>((resolvePromise) => {
      const finish = (): void => {
        clearTimeout(timer);
        child.removeListener('exit', finish);
        resolvePromise();
      };
      const timer = setTimeout(finish, timeoutMs);
      timer.unref?.();
      child.once('exit', finish);
    });
  }

  async start(entry: string): Promise<EditorOpResult> {
    if (this.disposed) return { ok: false, error: 'Debugger sudah ditutup.' };
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      return { ok: false, error: 'File yang akan di-debug tidak valid.' };
    }
    const abs = resolve(entry);
    const ext = extname(abs).toLowerCase();
    if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') {
      return {
        ok: false,
        error: 'Debugger Node hanya mendukung JavaScript. Kompilasi TypeScript dulu.',
      };
    }
    if (!SUPPORTED_EXT.has(ext)) {
      return { ok: false, error: 'Debugger hanya bisa menjalankan file .js, .mjs, atau .cjs.' };
    }
    if (!existsSync(abs)) {
      return { ok: false, error: 'File yang akan di-debug tidak ditemukan.' };
    }

    // hentikan sesi lama tanpa memancarkan status tambahan
    const previous = this.child;
    this.stopping = true;
    this.resetState();
    await this.waitChildExit(previous, 1000);
    this.stopping = false;

    this.stopConnectWait();
    this.connectSettled = false;
    const ready = new Promise<EditorOpResult>((resolvePromise) => {
      this.connectLatch = resolvePromise;
    });
    this.connectTimer = setTimeout(() => {
      this.settleConnect({
        ok: false,
        error: 'Debugger tidak tersambung dalam 10 detik. Pastikan Node.js terpasang dan port lokal tidak diblokir.',
      });
    }, CONNECT_TIMEOUT_MS);
    this.connectTimer.unref?.();

    this.emitStatus('starting');

    let child: ChildProcess;
    try {
      child = spawn(resolveNodeBinary(), ['--inspect-brk=127.0.0.1:0', abs], {
        cwd: dirname(abs),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.stopConnectWait();
      const message = `Gagal menjalankan Node.js: ${errMessage(err)}`;
      this.emitStatus('error', message);
      return { ok: false, error: message };
    }
    this.child = child;

    let inspectorSeen = false;
    let inspectorBuf = '';
    const forwardOutput = (text: string): void => {
      this.emit({ type: 'output', text });
      if (WAITING_RE.test(text)) this.closeSocket();
    };
    child.stdout?.on('data', (data: Buffer) => {
      forwardOutput(data.toString('utf8'));
    });
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf8');
      forwardOutput(text);
      if (inspectorSeen) return;
      // baris "Debugger listening on" bisa terpecah antar chunk; gabung dulu
      inspectorBuf = (inspectorBuf + text).slice(-4096);
      const match = INSPECTOR_RE.exec(inspectorBuf);
      if (!match) return;
      inspectorSeen = true;
      const port = Number(match[1]);
      if (!Number.isFinite(port) || port <= 0) {
        this.settleConnect({ ok: false, error: 'Debugger Node memberi port yang tidak valid.' });
        return;
      }
      this.connectInspector(port, match[2]);
    });

    child.on('error', (err) => {
      const message = `Gagal menjalankan Node.js: ${errMessage(err)}`;
      this.settleConnect({ ok: false, error: message });
      if (this.child === child) this.emitStatus('error', message);
      this.resetState();
    });

    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectPending('Proses debug berakhir.');
      this.closeSocket();
      this.paused = false;
      this.topFrameId = null;
      if (this.disposed) return;
      this.emit({ type: 'exited', code: typeof code === 'number' ? code : null });
      this.emitStatus('stopped');
    });

    const connected = await ready;
    if (!connected.ok) {
      this.resetState();
      this.emitStatus('error', connected.error ?? 'Debugger gagal dimulai.');
      return connected;
    }

    try {
      await this.call('Runtime.enable');
      await this.call('Debugger.enable');
      // Node menahan proses saat selesai sampai debugger lepas; minta notifikasinya
      await this.call('NodeRuntime.notifyWhenWaitingForDisconnect', { enabled: true }).catch(() => undefined);
      await this.applyBreakpoints();
      // --inspect-brk menahan eksekusi sampai perintah ini dikirim
      await this.call('Runtime.runIfWaitingForDebugger').catch(() => undefined);
      this.emitStatus('running');
      return { ok: true };
    } catch (err) {
      const message = `Debugger gagal disiapkan: ${errMessage(err)}`;
      this.resetState();
      this.emitStatus('error', message);
      return { ok: false, error: message };
    }
  }

  private stopConnectWait(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.connectLatch = null;
  }

  async stop(): Promise<void> {
    if (this.disposed) return;
    const child = this.child;
    this.stopping = true;
    this.settleConnect({ ok: false, error: 'Debugger dihentikan.' });
    this.stopConnectWait();
    this.resetState();
    await this.waitChildExit(child, 1000);
    this.stopping = false;
    this.emitStatus('stopped');
  }

  async setBreakpoints(points: Array<{ path: string; line: number }>): Promise<void> {
    const next = new Map<string, number[]>();
    for (const point of Array.isArray(points) ? points : []) {
      if (!point || typeof point.path !== 'string' || point.path.trim().length === 0) continue;
      const line = Math.floor(point.line);
      if (!Number.isFinite(line) || line < 1) continue;
      const abs = resolve(point.path);
      const lines = next.get(abs) ?? [];
      if (!lines.includes(line)) lines.push(line);
      next.set(abs, lines);
    }
    this.breakpoints = next;
    if (!this.isOpen()) return;
    try {
      await this.applyBreakpoints();
    } catch (err) {
      this.emitStatus('error', `Gagal memasang breakpoint: ${errMessage(err)}`);
    }
  }

  async resume(): Promise<void> {
    if (!this.isOpen()) return;
    try {
      await this.call('Debugger.resume');
    } catch (err) {
      this.emitStatus('error', `Gagal melanjutkan eksekusi: ${errMessage(err)}`);
    }
  }

  async pause(): Promise<void> {
    if (!this.isOpen()) return;
    try {
      await this.call('Debugger.pause');
    } catch (err) {
      this.emitStatus('error', `Gagal menjeda eksekusi: ${errMessage(err)}`);
    }
  }

  async step(kind: 'over' | 'into' | 'out'): Promise<void> {
    if (!this.isOpen() || !this.paused) return;
    const method = STATUS_METHODS[kind];
    if (!method) return;
    try {
      await this.call(method);
    } catch (err) {
      this.emitStatus('error', `Gagal melangkah: ${errMessage(err)}`);
    }
  }

  async evaluate(expression: string): Promise<DebugEvaluateResult> {
    if (!this.isOpen()) return { ok: false, error: 'Debugger belum berjalan.' };
    const expr = typeof expression === 'string' ? expression : '';
    if (expr.trim().length === 0) return { ok: false, error: 'Ekspresi kosong.' };
    const base: Record<string, unknown> = {
      expression: expr,
      returnByValue: true,
      silent: false,
      generatePreview: true,
    };
    try {
      const result =
        this.paused && this.topFrameId
          ? await this.call('Debugger.evaluateOnCallFrame', { ...base, callFrameId: this.topFrameId })
          : await this.call('Runtime.evaluate', base);
      const remote = asRecord(result.result);
      const text = remote ? formatRemote(remote) : '';
      const type = remote ? asString(remote.type) ?? undefined : undefined;
      if (asRecord(result.exceptionDetails)) {
        return { ok: false, error: text || 'Ekspresi gagal dievaluasi.', result: text, type };
      }
      return { ok: true, result: text, type };
    } catch (err) {
      return { ok: false, error: errMessage(err) };
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopping = true;
    this.settleConnect({ ok: false, error: 'Debugger ditutup.' });
    this.stopConnectWait();
    this.resetState();
  }
}

export function createDebugService(opts: { onEvent: (event: DebugEvent) => void }): DebugService {
  return new DebuggerController(opts.onEvent);
}
