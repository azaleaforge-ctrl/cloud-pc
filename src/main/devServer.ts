import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { getLanIp } from './discovery';
import type { FrameworkInfo, ServerState, ServerStatus } from '../shared/types';

export interface DevServerHandle {
  stop(): Promise<void>;
}

export interface DevServerOptions {
  framework: FrameworkInfo;
  cwd: string;
  onLog: (line: string) => void;
  onState: (state: ServerState) => void;
}

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d+))?/i;
const LOCAL_PORT_RE = /localhost:(\d+)/i;
const ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const PROBE_AFTER_MS = 25_000;
const STOP_TIMEOUT_MS = 3_000;

function stripAnsi(line: string): string {
  return line.replace(ANSI_RE, '').replace(/\u001B\][^\u0007]*\u0007/g, '');
}

function urlFromLine(line: string): number | null {
  const match = URL_RE.exec(line);
  if (match) {
    if (match[1]) {
      const port = Number(match[1]);
      return Number.isFinite(port) ? port : null;
    }
    return 0; // ada URL tanpa port eksplisit
  }
  const local = LOCAL_PORT_RE.exec(line);
  if (local) {
    const port = Number(local[1]);
    return Number.isFinite(port) ? port : null;
  }
  return null;
}

function checkPortOpen(port: number, host = '127.0.0.1', timeoutMs = 800): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function startLanProxy(targetPort: number): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: '127.0.0.1:' + targetPort },
    }, (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    });
    request.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502);
      res.end('Dev server proxy error: ' + err.message);
    });
    req.pipe(request);
  });

  server.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(targetPort, '127.0.0.1', () => {
      const headers = [];
      headers.push(req.method + ' ' + (req.url ?? '/') + ' HTTP/' + req.httpVersion);
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        headers.push(req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1]);
      }
      upstream.write(headers.join('\r\n') + '\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    const close = () => {
      socket.destroy();
      upstream.destroy();
    };
    socket.once('error', close);
    upstream.once('error', close);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
    server.listen(0, '0.0.0.0');
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Gagal mendapatkan port LAN proxy.');
  }
  return { server, port: address.port };
}

export async function startDevServer(opts: DevServerOptions): Promise<DevServerHandle> {
  const { framework, cwd, onLog, onState } = opts;
  let status: ServerStatus = 'starting';
  let child: ChildProcess | null = null;
  let stopped = false;
  let exited = false;
  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  let buffer = '';
  let proxyServer: http.Server | null = null;
  let exposing = false;

  const urlFor = (port: number): string => `http://localhost:${port}`;

  const emit = (next: ServerStatus, port: number | null, error?: string): void => {
    status = next;
    onState({
      status: next,
      url: next === 'running' && port ? urlFor(port) : null,
      port: next === 'running' ? port : null,
      logs: [],
      error: error ?? null,
    });
  };

  const clearProbe = (): void => {
    if (probeTimer) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
  };

  const markRunning = (port: number): void => {
    if (status === 'running' || stopped || exposing) return;
    exposing = true;
    clearProbe();
    void (async () => {
      try {
        const lanIp = getLanIp();
        const directLan = lanIp ? await checkPortOpen(port, lanIp, 900) : false;
        const publicPort = directLan
          ? port
          : (proxyServer = (await startLanProxy(port)).server, proxyServer.address() && typeof proxyServer.address() !== 'string'
              ? proxyServer.address()!.port
              : port);
        emit('running', publicPort);
      } catch (err) {
        emit('error', null, 'Server hidup tetapi tidak dapat diekspos ke LAN: ' + (err as Error).message);
      } finally {
        exposing = false;
      }
    })();
  };

  const handleLine = (rawLine: string): void => {
    const line = stripAnsi(rawLine).replace(/\r$/, '').trim();
    if (!line) return;
    onLog(line);
    if (status === 'starting' || status === 'idle') {
      const port = urlFromLine(line);
      if (port === null) return;
      if (port > 0) markRunning(port);
      else if (framework.detectedPort) markRunning(framework.detectedPort);
    }
  };

  const handleChunk = (chunk: string): void => {
    buffer += chunk;
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? '';
    for (const part of parts) handleLine(part);
    if (buffer.length > 8192) {
      handleLine(buffer);
      buffer = '';
    }
  };

  emit('starting', null);

  try {
    const env = {
      ...process.env,
      FORCE_COLOR: '0',
      BROWSER: 'none',
      CI: '1',
      HOST: '0.0.0.0',
      HOSTNAME: '0.0.0.0',
      N_HOST: '0.0.0.0',
      NEXT_TELEMETRY_DISABLED: '1',
    };
    const args = framework.args ?? [];
    child = args.length
      ? spawn(framework.command, args, { cwd, shell: true, env, windowsHide: true })
      : spawn(framework.command, { cwd, shell: true, env, windowsHide: true });

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => handleChunk(chunk));
    child.stderr?.on('data', (chunk: string) => handleChunk(chunk));

    child.on('error', (err) => {
      exited = true;
      clearProbe();
      if (stopped) return;
      emit('error', null, err.message);
    });

    child.on('exit', (code) => {
      exited = true;
      clearProbe();
      if (stopped) return;
      if (typeof code === 'number' && code !== 0) {
        emit('error', null, `Server berhenti dengan kode ${code}.`);
      } else {
        emit('stopped', null);
      }
    });

    if (framework.detectedPort) {
      const port = framework.detectedPort;
      probeTimer = setTimeout(() => {
        probeTimer = null;
        if (stopped || exited || status !== 'starting') return;
        void checkPortOpen(port).then((open) => {
          if (open && !stopped && !exited) markRunning(port);
        });
      }, PROBE_AFTER_MS);
      probeTimer.unref?.();
    }
  } catch (err) {
    emit('error', null, (err as Error).message);
  }

  const waitExit = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (!child || exited) {
        resolve();
        return;
      }
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        try {
          child?.kill('SIGKILL');
        } catch {
          // proses sudah mati
        }
        finish();
      }, STOP_TIMEOUT_MS);
      child.once('exit', finish);
    });

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearProbe();
    if (proxyServer) {
      await new Promise<void>((resolve) => proxyServer?.close(() => resolve()));
      proxyServer = null;
    }
    const pid = child?.pid;
    if (pid && process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          resolve();
        };
        try {
          const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
          killer.on('error', finish);
          killer.on('exit', finish);
        } catch {
          finish();
        }
      });
    } else {
      try {
        child?.kill();
      } catch {
        // abaikan
      }
    }
    await waitExit();
    emit('stopped', null);
  };

  return { stop };
}
