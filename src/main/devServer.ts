import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { getLanIp } from './discovery';
import { retargetPort } from './frameworkDetect';
import { checkServerRuntime } from './serverDoctor';
import type { FrameworkInfo, ServerState, ServerStatus } from '../shared/types';

export interface DevServerHandle {
  stop(): Promise<void>;
}

export interface DevServerOptions {
  framework: FrameworkInfo;
  cwd: string;
  onLog: (line: string) => void;
  onState: (state: ServerState) => void;
  /** Dipanggil sekali saat child exit/error supaya proses main bisa melepas handle. */
  onExit?: (code: number | null) => void;
  /** Batas waktu status "starting" sebelum dianggap gagal (default 90 detik). */
  startTimeoutMs?: number;
}

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d+))?/i;
const LOCAL_PORT_RE = /localhost:(\d+)/i;
const ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const PROBE_AFTER_MS = 2_500;
const PROBE_RETRY_MS = 1_000;
const PROBE_MAX_MS = 45_000;
const STOP_TIMEOUT_MS = 5_000;
const KILL_TIMEOUT_MS = 2_000;
const PROXY_CLOSE_TIMEOUT_MS = 1_000;
const PORT_SCAN_RANGE = 20;
const START_TIMEOUT_MS = 90_000;
const PHP_PROBE_ATTEMPTS = 20; // Laravel/PHP butuh lebih lama untuk boot
const PHP_PROBE_DELAY_MS = 1_000;

/**
 * Log yang menandakan proses dev server gagal total — bukan sekadar warning.
 * Hanya dianggap fatal selama status masih `starting`.
 */
const FATAL_PATTERNS: RegExp[] = [
  /EUNKNOWNCONFIG/i,
  /Unknown cli flags/i,
  /Cannot find module/i,
  /ERR_MODULE_NOT_FOUND/,
  /npm error/i,
  /npm ERR!/i,
  /is not recognized as an internal or external command/i,
  /command not found/i,
  /ModuleNotFoundError/,
  /Class .* not found/i,
  /No application encryption key/i,
  /EADDRINUSE/i,
  /address already in use/i,
  /could not open input file/i,
  /Fatal error/i,
  /SyntaxError/,
  /error TS\d+/,
];

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

function checkHttpResponse(port: number, host = '127.0.0.1', timeoutMs = 1_500): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = http.get({
      hostname: host,
      port,
      path: '/',
      timeout: timeoutMs,
      headers: { 'User-Agent': 'Ruang-Kerja-HealthCheck', Connection: 'close' },
    }, (response) => {
      // A real HTTP response (including 404/500 from the app) proves the server is reachable.
      response.resume();
      finish(typeof response.statusCode === 'number');
    });
    request.once('timeout', () => request.destroy(new Error('HTTP readiness probe timed out')));
    request.once('error', () => finish(false));
  });
}

async function waitForHttp(port: number, host = '127.0.0.1', attempts = 8): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await checkHttpResponse(port, host, 1_500)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** true bila port bisa di-bind pada host tertentu. */
function canBindPort(port: number, host: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    let settled = false;
    const settle = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    server.once('error', () => settle(false));
    server.once('listening', () => server.close(() => settle(true)));
    try {
      server.listen({ port, host, exclusive: true });
    } catch {
      settle(false);
    }
  });
}

/**
 * Cari port bebas mulai dari port pilihan (range +20), dicek pada 127.0.0.1 dan 0.0.0.0
 * supaya framework tidak diam-diam pindah port karena IPv4/IPv6 atau binding LAN.
 */
async function pickPort(preferred: number): Promise<number> {
  const start = Number.isFinite(preferred) && preferred > 0 ? Math.floor(preferred) : 3000;
  const end = Math.min(start + PORT_SCAN_RANGE, 65535);
  for (let port = start; port <= end; port++) {
    if (!(await canBindPort(port, '127.0.0.1'))) continue;
    if (!(await canBindPort(port, '0.0.0.0'))) continue;
    return port;
  }
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => reject(new Error('Tidak ada port bebas untuk dev server: ' + err.message)));
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      const port = address && typeof address !== 'string' ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function killTreeWindows(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, KILL_TIMEOUT_MS);
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', finish);
      killer.once('exit', finish);
    } catch {
      finish();
    }
  });
}

async function startLanProxy(targetPort: number): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: '127.0.0.1:' + targetPort,
        'x-forwarded-host': req.headers['x-forwarded-host'] ?? req.headers.host ?? '',
        'x-forwarded-proto': 'http',
        'x-forwarded-port': String(req.socket.localPort ?? ''),
      },
    }, (upstream) => {
      const headers: http.OutgoingHttpHeaders = { ...upstream.headers };
      const location = headers.location;
      const forwardedHost = req.headers['x-forwarded-host'] ?? req.headers.host;
      if (typeof location === 'string' && typeof forwardedHost === 'string') {
        try {
          const redirected = new URL(location, 'http://127.0.0.1:' + targetPort);
          const isLocalTarget = ['localhost', '127.0.0.1', '0.0.0.0'].includes(redirected.hostname)
            && (!redirected.port || Number(redirected.port) === targetPort);
          if (isLocalTarget) {
            headers.location = 'http://' + forwardedHost + redirected.pathname + redirected.search + redirected.hash;
          }
        } catch {
          // Leave non-URL or application-specific Location headers untouched.
        }
      }
      res.writeHead(upstream.statusCode ?? 502, headers);
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
  const startTimeoutMs = opts.startTimeoutMs && opts.startTimeoutMs > 0 ? opts.startTimeoutMs : START_TIMEOUT_MS;
  let status: ServerStatus = 'starting';
  let child: ChildProcess | null = null;
  let stopped = false;
  let exited = false;
  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let buffer = '';
  let proxyServer: http.Server | null = null;
  let exposing = false;
  let exitNotified = false;
  let actualTargetPort: number | null = null;

  const urlFor = (port: number): string => 'http://localhost:' + port;

  const emit = (next: ServerStatus, port: number | null, error?: string, targetPort: number | null = actualTargetPort, proxied = false): void => {
    status = next;
    onState({
      status: next,
      url: next === 'running' && port ? urlFor(port) : null,
      port: next === 'running' ? port : null,
      targetPort: next === 'running' ? targetPort : null,
      proxied: next === 'running' ? proxied : false,
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

  const clearWatchdog = (): void => {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  };

  const notifyExit = (code: number | null): void => {
    if (exitNotified) return;
    exitNotified = true;
    try {
      opts.onExit?.(code);
    } catch {
      // callback pemanggil tidak boleh menjatuhkan dev server
    }
  };

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

  const closeProxy = async (): Promise<void> => {
    const server = proxyServer;
    proxyServer = null;
    if (!server) return;
    try {
      server.closeAllConnections?.();
    } catch {
      // tidak semua versi Node punya closeAllConnections
    }
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, PROXY_CLOSE_TIMEOUT_MS);
      server.close(() => finish());
    });
  };

  const terminateChild = async (): Promise<void> => {
    const target = child;
    if (!target || exited) return;
    const waiting = waitExit();
    const pid = target.pid;
    if (process.platform === 'win32' && pid) {
      await killTreeWindows(pid);
    } else {
      try {
        target.kill('SIGTERM');
      } catch {
        // sudah mati
      }
    }
    await waiting;
  };

  const killChild = (): void => {
    const pid = child?.pid;
    if (!pid) return;
    if (process.platform === 'win32') {
      void killTreeWindows(pid);
      return;
    }
    try {
      child?.kill('SIGTERM');
    } catch {
      // sudah mati
    }
    const escalate = setTimeout(() => {
      try {
        child?.kill('SIGKILL');
      } catch {
        // sudah mati
      }
    }, KILL_TIMEOUT_MS);
    escalate.unref?.();
  };

  /** Tandai gagal lalu matikan child supaya tidak ada proses zombie. */
  const failAndKill = (message: string): void => {
    if (stopped || status === 'error') return;
    emit('error', null, message);
    clearProbe();
    clearWatchdog();
    killChild();
  };

  /** Status sudah tidak layak dipromosikan ke `running`. */
  const isAborted = (): boolean => stopped || status === 'error';

  const markRunning = (port: number): void => {
    if (status === 'running' || stopped || exposing) return;
    exposing = true;
    clearProbe();
    void (async () => {
      try {
        // Never probe a TCP socket and close it without HTTP bytes: PHP's built-in
        // server logs that as "Invalid request". Use a valid GET / readiness probe.
        // PHP/Laravel butuh lebih lama untuk boot, gunakan lebih banyak attempts.
        const isPhp = framework.id === 'laravel' || framework.id === 'symfony' || framework.packageManager === 'composer';
        const probeAttempts = isPhp ? PHP_PROBE_ATTEMPTS : 8;
        const ready = await waitForHttp(port, '127.0.0.1', probeAttempts);
        if (!ready) {
          failAndKill('Server mencetak alamat, tetapi belum memberi respons HTTP. Periksa dependensi dan log framework.');
          return;
        }
        if (stopped || status === 'error') return;
        actualTargetPort = port;
        const lanIp = getLanIp();
        const directLan = lanIp ? await checkHttpResponse(port, lanIp, 1200) : false;
        let publicPort = port;
        if (!directLan) {
          const proxy = await startLanProxy(port);
          proxyServer = proxy.server;
          publicPort = proxy.port;
        }
        if (isAborted()) return;
        emit('running', publicPort, undefined, port, publicPort !== port);
      } catch (err) {
        failAndKill('Server hidup tetapi tidak dapat diekspos ke LAN: ' + (err as Error).message);
      } finally {
        exposing = false;
      }
    })();
  };

  const handleLine = (rawLine: string): void => {
    const line = stripAnsi(rawLine).replace(/\r$/, '').trim();
    if (!line) return;
    onLog(line);
    if (status !== 'starting' && status !== 'idle') return;
    // Hanya pola kegagalan eksplisit; warning ("npm warn", "✓ Ready", "ready in") tidak fatal.
    if (FATAL_PATTERNS.some((pattern) => pattern.test(line))) {
      failAndKill(line);
      return;
    }
    const port = urlFromLine(line);
    if (port === null) return;
    if (port > 0) markRunning(port);
    else if (framework.detectedPort) markRunning(framework.detectedPort);
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

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearProbe();
    clearWatchdog();
    await closeProxy();
    await terminateChild();
    emit('stopped', null);
  };

  // Preflight: periksa runtime & dependensi sebelum spawn.
  const doctor = await checkServerRuntime(framework, cwd);
  if (!doctor.ok) {
    const message = doctor.hint ? `${doctor.error} ${doctor.hint}` : (doctor.error ?? 'Runtime project belum siap.');
    emit('error', null, message);
    return { stop };
  }

  const requestedPort = framework.detectedPort && framework.detectedPort > 0 ? framework.detectedPort : 3000;
  let port = requestedPort;
  try {
    port = await pickPort(requestedPort);
  } catch (err) {
    emit('error', null, (err as Error).message);
    return { stop };
  }
  framework.detectedPort = port;
  if (port !== requestedPort) {
    // Framework tetap diarahkan ke port yang benar-benar dipakai, bukan port bentrok.
    framework.command = retargetPort(framework.command, requestedPort, port);
  }

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
      PORT: String(port),
      FLASK_RUN_HOST: '0.0.0.0',
      FLASK_RUN_PORT: String(port),
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
      clearWatchdog();
      if (!stopped && status !== 'error') emit('error', null, err.message);
      notifyExit(null);
    });

    child.on('exit', (code) => {
      exited = true;
      clearProbe();
      clearWatchdog();
      if (!stopped && status !== 'error') {
        if (typeof code === 'number' && code !== 0) {
          emit('error', null, `Server berhenti dengan kode ${code}.`);
        } else {
          emit('stopped', null);
        }
      }
      notifyExit(code);
    });

    // Watchdog: jangan biarkan status `starting` menggantung selamanya.
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null;
      if (stopped || exited || status !== 'starting') return;
      failAndKill(`Server tidak siap dalam ${Math.round(startTimeoutMs / 1000)} detik. Periksa log di bawah.`);
    }, startTimeoutMs);
    watchdogTimer.unref?.();

    // Probe port yang sudah dipilih, untuk framework yang tidak mencetak URL.
    const isPhp = framework.id === 'laravel' || framework.id === 'symfony' || framework.packageManager === 'composer';
    const probeDelayMs = isPhp ? PHP_PROBE_DELAY_MS : PROBE_RETRY_MS;
    const probingStartedAt = Date.now();
    const probe = async (): Promise<void> => {
      probeTimer = null;
      if (stopped || exited || status !== 'starting') return;
      if (await checkHttpResponse(port) && !stopped && !exited && status === 'starting') {
        markRunning(port);
        return;
      }
      if (Date.now() - probingStartedAt < PROBE_MAX_MS && !stopped && !exited && status === 'starting') {
        probeTimer = setTimeout(() => { void probe(); }, probeDelayMs);
        probeTimer.unref?.();
      }
    };
    probeTimer = setTimeout(() => { void probe(); }, PROBE_AFTER_MS);
    probeTimer.unref?.();
  } catch (err) {
    failAndKill((err as Error).message);
  }

  return { stop };
}
