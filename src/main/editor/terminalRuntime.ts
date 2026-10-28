import { spawn, type ChildProcess } from 'node:child_process';
import { buildTerminalCommandInvocation } from './terminalShell';

export type TerminalStream = 'stdout' | 'stderr';
export type TerminalProcessStatus = 'starting' | 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled';

export interface TerminalOutputEvent {
  commandId: string;
  stream: TerminalStream;
  data: string;
  ts: number;
}

export interface TerminalProcessEvent {
  commandId: string;
  command: string;
  cwd: string;
  shell: string;
  status: TerminalProcessStatus;
  startedAt: number;
  finishedAt?: number;
  timeoutMs: number;
  exitCode?: number | null;
  message?: string;
}

export interface TerminalCommandResult {
  commandId: string;
  command: string;
  status: Exclude<TerminalProcessStatus, 'starting' | 'running'>;
  exitCode: number | null;
  output: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  timeoutMs: number;
  message?: string;
}

export interface StartTerminalCommandOptions {
  commandId: string;
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputChars: number;
  onOutput?: (event: TerminalOutputEvent) => void;
  onState?: (event: TerminalProcessEvent) => void;
}

export interface TerminalCommandHandle {
  promise: Promise<TerminalCommandResult>;
  cancel: () => void;
}

function safelyEmit(callback: (() => void) | undefined): void {
  if (!callback) return;
  try { callback(); } catch { /* renderer can detach while a process is finishing */ }
}

function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    try { child.kill(); } catch { /* process might not have spawned */ }
    return;
  }

  if (process.platform === 'win32') {
    let fallback = true;
    try {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      fallback = false;
      killer.once('error', () => {
        try { child.kill(); } catch { /* already exited */ }
      });
    } catch {
      fallback = true;
    }
    if (fallback) {
      try { child.kill(); } catch { /* already exited */ }
    }
    return;
  }

  try {
    // detached:true creates a process group, so nested npm/composer/test children can be stopped too.
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
  }
}

export function startTerminalCommand(options: StartTerminalCommandOptions): TerminalCommandHandle {
  const command = options.command.trim();
  if (!command) throw new Error('Command kosong.');
  if (command.length > 2000) throw new Error('Command terlalu panjang (maksimum 2000 karakter).');
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 60 * 60 * 1000) {
    throw new Error('Timeout terminal harus berada pada rentang 0,1 hingga 60 menit.');
  }
  if (!Number.isSafeInteger(options.maxOutputChars) || options.maxOutputChars < 100) {
    throw new Error('Batas output terminal tidak valid.');
  }

  const commandId = options.commandId;
  const invocation = buildTerminalCommandInvocation(command);
  const startedAt = Date.now();
  let output = '';
  let settled = false;
  let stopReason: 'timed_out' | 'cancelled' | null = null;
  let child: ChildProcess | null = null;
  let timeout: NodeJS.Timeout | undefined;
  let hardKillTimeout: NodeJS.Timeout | undefined;

  const append = (stream: TerminalStream, raw: unknown): void => {
    const data = String(raw ?? '');
    if (!data) return;
    output = (output + data).slice(-options.maxOutputChars);
    for (let offset = 0; offset < data.length; offset += 3500) {
      const chunk = data.slice(offset, offset + 3500);
      safelyEmit(() => options.onOutput?.({ commandId, stream, data: chunk, ts: Date.now() }));
    }
  };

  const emitState = (event: TerminalProcessEvent): void => {
    safelyEmit(() => options.onState?.(event));
  };

  const promise = new Promise<TerminalCommandResult>((resolveResult) => {
    const finish = (status: TerminalCommandResult['status'], exitCode: number | null, message?: string): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (hardKillTimeout) clearTimeout(hardKillTimeout);
      const finishedAt = Date.now();
      const result: TerminalCommandResult = {
        commandId,
        command,
        status,
        exitCode,
        output,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        timeoutMs: options.timeoutMs,
        ...(message ? { message } : {}),
      };
      emitState({
        commandId,
        command,
        cwd: options.cwd,
        shell: invocation.shellName,
        status,
        startedAt,
        finishedAt,
        timeoutMs: options.timeoutMs,
        exitCode,
        ...(message ? { message } : {}),
      });
      resolveResult(result);
    };

    emitState({ commandId, command, cwd: options.cwd, shell: invocation.shellName, status: 'starting', startedAt, timeoutMs: options.timeoutMs });
    const isWindows = process.platform === 'win32';

    try {
      child = spawn(invocation.file, invocation.args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !isWindows,
      });
    } catch (error) {
      finish('failed', null, 'Gagal memulai command: ' + ((error as Error).message || String(error)));
      return;
    }

    child.stdout?.on('data', (data: unknown) => append('stdout', data));
    child.stderr?.on('data', (data: unknown) => append('stderr', data));
    child.once('error', (error) => {
      finish(stopReason ?? 'failed', null, 'Gagal menjalankan command: ' + ((error as Error).message || String(error)));
    });
    child.once('spawn', () => {
      emitState({ commandId, command, cwd: options.cwd, shell: invocation.shellName, status: 'running', startedAt, timeoutMs: options.timeoutMs });
    });
    child.once('close', (code) => {
      if (stopReason === 'timed_out') {
        finish('timed_out', typeof code === 'number' ? code : null, 'Command dihentikan karena melewati batas ' + Math.ceil(options.timeoutMs / 1000) + ' detik.');
        return;
      }
      if (stopReason === 'cancelled') {
        finish('cancelled', typeof code === 'number' ? code : null, 'Command dibatalkan.');
        return;
      }
      if (typeof code === 'number' && code === 0) {
        finish('completed', 0);
      } else {
        finish('failed', typeof code === 'number' ? code : null, 'Command berakhir dengan exit code ' + (typeof code === 'number' ? code : 'tidak diketahui') + '.');
      }
    });

    timeout = setTimeout(() => {
      if (settled || !child) return;
      stopReason = 'timed_out';
      terminateProcessTree(child);
      hardKillTimeout = setTimeout(() => {
        if (settled || !child?.pid) return;
        if (process.platform !== 'win32') {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* exited */ } }
        } else {
          try { child.kill(); } catch { /* taskkill is already stopping the process tree */ }
        }
      }, 1500);
      hardKillTimeout.unref?.();
    }, options.timeoutMs);
    timeout.unref?.();
  });

  const cancel = (): void => {
    if (settled || !child || stopReason) return;
    stopReason = 'cancelled';
    terminateProcessTree(child);
    hardKillTimeout = setTimeout(() => {
      if (settled || !child?.pid) return;
      if (process.platform !== 'win32') {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* exited */ } }
      } else {
        try { child.kill(); } catch { /* taskkill is already stopping the process tree */ }
      }
    }, 1500);
    hardKillTimeout.unref?.();
  };

  return { promise, cancel };
}
