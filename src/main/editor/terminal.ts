import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import * as pty from '@lydell/node-pty';
import type { IPty } from '@lydell/node-pty';
import type {
  TerminalCreateOptions,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionInfo,
} from '../../shared/editor';

export interface TerminalService {
  create(opts?: TerminalCreateOptions): Promise<TerminalSessionInfo>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  kill(id: string): Promise<void>;
  list(): Promise<TerminalSessionInfo[]>;
  disposeAll(): void;
}

interface Session {
  info: TerminalSessionInfo;
  pty: IPty;
  killed: boolean;
  exitSent: boolean;
}

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const MAX_DIMENSION = 2000;

let cachedShell: { file: string; args: string[] } | null = null;

function isOnPath(exe: string): boolean {
  try {
    const result = spawnSync('where.exe', [exe], { windowsHide: true, stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/** Tentukan shell sekali saja; hasilnya di-cache seumur proses. */
function resolveShell(): { file: string; args: string[] } {
  if (cachedShell) return cachedShell;
  if (process.platform !== 'win32') {
    cachedShell = { file: process.env.SHELL ?? '/bin/bash', args: [] };
    return cachedShell;
  }
  if (isOnPath('pwsh.exe')) {
    cachedShell = { file: 'pwsh.exe', args: ['-NoLogo'] };
  } else if (isOnPath('powershell.exe')) {
    cachedShell = { file: 'powershell.exe', args: ['-NoLogo'] };
  } else {
    const comspec = process.env.ComSpec?.trim();
    cachedShell = { file: comspec && comspec.length > 0 ? comspec : 'cmd.exe', args: [] };
  }
  return cachedShell;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function clampDimension(value: number | undefined, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(MAX_DIMENSION, Math.max(1, n));
}

export function createTerminalService(opts: {
  getRoot: () => string | null;
  onData: (event: TerminalDataEvent) => void;
  onExit: (event: TerminalExitEvent) => void;
}): TerminalService {
  const sessions = new Map<string, Session>();
  let counter = 0;
  // hanya aktif selama disposeAll agar event sisa tidak bocor ke renderer
  let tearingDown = false;

  const resolveCwd = (requested?: string): string => {
    const root = opts.getRoot();
    const rootAbs = root ? resolve(root) : null;
    if (requested && isAbsolute(requested)) {
      const abs = resolve(requested);
      // hanya terima cwd di dalam project; di luar itu pakai root
      if (rootAbs && isInside(rootAbs, abs)) return abs;
      if (!rootAbs) return abs;
    }
    return rootAbs ?? homedir();
  };

  const emitExit = (session: Session, code: number): void => {
    if (session.exitSent) return;
    session.exitSent = true;
    if (tearingDown) return;
    opts.onExit({ id: session.info.id, code });
  };

  /** Bunuh proses pty beserta anak-anaknya (Windows butuh taskkill /T). */
  const killProcessTree = (session: Session): void => {
    try {
      session.pty.kill();
    } catch {
      // proses mungkin sudah mati
    }
    if (process.platform !== 'win32') return;
    try {
      const child = spawn('taskkill', ['/PID', String(session.pty.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      // taskkill gagal (mis. PID sudah hilang) tidak boleh menjatuhkan app
      child.on('error', () => undefined);
    } catch {
      // abaikan
    }
  };

  const teardown = (session: Session, code: number, quiet: boolean): void => {
    if (session.killed) return;
    session.killed = true;
    sessions.delete(session.info.id);
    killProcessTree(session);
    if (!quiet) emitExit(session, code);
  };

  return {
    async create(createOpts?: TerminalCreateOptions): Promise<TerminalSessionInfo> {
      if (tearingDown) throw new Error('Terminal sedang ditutup. Coba lagi.');
      const shell = resolveShell();
      const cols = clampDimension(createOpts?.cols, DEFAULT_COLS);
      const rows = clampDimension(createOpts?.rows, DEFAULT_ROWS);
      const cwd = resolveCwd(createOpts?.cwd);
      counter += 1;
      const info: TerminalSessionInfo = {
        id: randomUUID(),
        title: `Terminal ${counter}`,
        shell: basename(shell.file),
      };

      let handle: IPty;
      try {
        handle = pty.spawn(shell.file, shell.args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd,
          env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
        });
      } catch (err) {
        throw new Error(`Gagal membuka terminal (${info.shell}): ${errMessage(err)}`);
      }

      const session: Session = { info, pty: handle, killed: false, exitSent: false };
      sessions.set(info.id, session);

      handle.onData((data: string) => {
        // data yang datang setelah sesi dibunuh diabaikan
        if (session.killed || tearingDown) return;
        if (sessions.get(info.id) !== session) return;
        opts.onData({ id: info.id, data });
      });

      handle.onExit(({ exitCode }: { exitCode: number }) => {
        if (session.killed) return;
        session.killed = true;
        sessions.delete(info.id);
        emitExit(session, typeof exitCode === 'number' ? exitCode : 0);
      });

      return info;
    },

    async write(id: string, data: string): Promise<void> {
      const session = sessions.get(id);
      if (!session || session.killed) return;
      try {
        session.pty.write(typeof data === 'string' ? data : String(data ?? ''));
      } catch {
        // terminal sudah mati di sisi OS; biarkan exit event yang membersihkan
      }
    },

    async resize(id: string, cols: number, rows: number): Promise<void> {
      const session = sessions.get(id);
      if (!session || session.killed) return;
      try {
        session.pty.resize(clampDimension(cols, DEFAULT_COLS), clampDimension(rows, DEFAULT_ROWS));
      } catch {
        // resize gagal pada terminal yang sedang mati; abaikan
      }
    },

    async kill(id: string): Promise<void> {
      const session = sessions.get(id);
      if (!session) return;
      teardown(session, 0, false);
    },

    async list(): Promise<TerminalSessionInfo[]> {
      return Array.from(sessions.values()).map((session) => ({ ...session.info }));
    },

    disposeAll(): void {
      tearingDown = true;
      for (const session of Array.from(sessions.values())) {
        teardown(session, 0, true);
      }
      sessions.clear();
      tearingDown = false;
      // probe shell diulang pada sesi berikutnya (mis. setelah pwsh dipasang)
      cachedShell = null;
    },
  };
}
