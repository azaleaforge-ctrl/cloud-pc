import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { FrameworkInfo } from '../shared/types';

export interface RuntimeCheck {
  ok: boolean;
  error?: string;
  hint?: string;
}

const IS_WINDOWS = process.platform === 'win32';
const JS_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];
const KNOWN_CLI = [
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'php', 'python', 'python3', 'py',
  'composer', 'bundle', 'dotnet', 'go', 'cargo', 'serve',
];
const PYTHON_IDS = ['django', 'fastapi', 'flask'];

/** Cek apakah sebuah executable ada di PATH (where.exe di Windows, which di POSIX). */
export function hasBinary(bin: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const finder = IS_WINDOWS ? 'where.exe' : 'which';
    execFile(finder, [bin], { windowsHide: true, timeout: 4_000 }, (err, stdout) => {
      if (err) {
        resolve(false);
        return;
      }
      resolve(String(stdout ?? '').trim().length > 0);
    });
  });
}

/** Ambil token pertama perintah, memahami tanda kutip. */
function commandHead(command: string): string {
  const match = /^\s*(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(command ?? '');
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

/** Nama biner tanpa folder dan tanpa ekstensi Windows. */
function binName(token: string): string {
  return basename(token).replace(/\.(cmd|exe|bat|ps1)$/i, '').toLowerCase();
}

function quoteIfNeeded(path: string): string {
  return /[\s']/.test(path) ? `"${path}"` : path;
}

/** Ganti interpreter di awal perintah (mis. `python` → path venv). */
function replaceInterpreter(command: string, executable: string): string {
  return command.replace(/^\s*(?:"[^"]+"|'[^']+'|\S+)/, executable);
}

function venvPython(cwd: string): string | null {
  const candidate = IS_WINDOWS
    ? join(cwd, '.venv', 'Scripts', 'python.exe')
    : join(cwd, '.venv', 'bin', 'python');
  return existsSync(candidate) ? candidate : null;
}

function missingNode(): RuntimeCheck {
  return {
    ok: false,
    error: 'Node.js tidak ditemukan di PATH.',
    hint: 'Pasang Node.js dari https://nodejs.org lalu buka ulang Ruang Kerja.',
  };
}

function missingManager(manager: string): RuntimeCheck {
  const hint = manager === 'npm'
    ? 'Pasang Node.js dari https://nodejs.org (npm ikut terpasang).'
    : `Pasang ${manager} lalu pastikan perintahnya ada di PATH.`;
  return { ok: false, error: `Perintah "${manager}" tidak ditemukan di PATH.`, hint };
}

function missingVendor(): RuntimeCheck {
  return {
    ok: false,
    error: 'Dependensi Composer belum terpasang (vendor/autoload.php tidak ada).',
    hint: 'Jalankan `composer install` di folder project.',
  };
}

/**
 * Periksa prasyarat runtime sebelum dev server dijalankan.
 * Boleh menulis ulang `framework.command` (mis. memakai python dari .venv).
 */
export async function checkServerRuntime(framework: FrameworkInfo, cwd: string): Promise<RuntimeCheck> {
  try {
    const manager = (framework.packageManager || '').toLowerCase();
    const head = commandHead(framework.command);
    const bin = binName(head);
    const hasPackageJson = existsSync(join(cwd, 'package.json'));

    const isJsProject = JS_MANAGERS.includes(manager)
      || (hasPackageJson && (bin === 'node' || bin === 'npx' || JS_MANAGERS.includes(bin)));

    if (isJsProject) {
      if (!(await hasBinary('node'))) return missingNode();
      if (JS_MANAGERS.includes(bin) && !(await hasBinary(bin))) return missingManager(bin);
      if (hasPackageJson && !existsSync(join(cwd, 'node_modules'))) {
        return {
          ok: false,
          error: 'Folder node_modules belum ada: dependensi project belum terpasang.',
          hint: 'Jalankan `npm install` di folder project.',
        };
      }
      // Perintah yang menunjuk biner lokal: pastikan binernya benar-benar ada.
      if (head.includes('node_modules') && !existsSync(head)) {
        return {
          ok: false,
          error: `Biner framework tidak ditemukan: ${head}`,
          hint: 'Jalankan `npm install` di folder project.',
        };
      }
      return { ok: true };
    }

    if (manager === 'composer' || framework.id === 'laravel' || framework.id === 'symfony' || bin === 'php') {
      if (!(await hasBinary('php'))) {
        return {
          ok: false,
          error: 'PHP tidak ditemukan di PATH.',
          hint: 'Pasang PHP 8+ lalu pastikan perintah `php` bisa dijalankan di terminal.',
        };
      }
      if (framework.id === 'laravel') {
        if (!existsSync(join(cwd, 'artisan'))) {
          return {
            ok: false,
            error: 'File artisan tidak ditemukan di folder project.',
            hint: 'Pastikan folder project adalah root Laravel (berisi artisan dan app/).',
          };
        }
        if (!existsSync(join(cwd, 'vendor', 'autoload.php'))) return missingVendor();
      } else if (existsSync(join(cwd, 'composer.json')) && !existsSync(join(cwd, 'vendor', 'autoload.php'))) {
        return missingVendor();
      }
      return { ok: true };
    }

    if (manager === 'python' || PYTHON_IDS.includes(framework.id)) {
      const venv = venvPython(cwd);
      if (venv) {
        framework.command = replaceInterpreter(framework.command, quoteIfNeeded(venv));
        return { ok: true };
      }
      if (await hasBinary('python')) return { ok: true };
      if (await hasBinary('py')) {
        framework.command = replaceInterpreter(framework.command, 'py -3');
        return { ok: true };
      }
      return {
        ok: false,
        error: 'Python tidak ditemukan (perintah `python` maupun `py -3` tidak ada di PATH).',
        hint: 'Pasang Python 3, lalu buat virtualenv: `python -m venv .venv`.',
      };
    }

    if (manager === 'bundler' || framework.id === 'rails') {
      if (!(await hasBinary('bundle'))) {
        return {
          ok: false,
          error: 'Bundler tidak ditemukan di PATH.',
          hint: 'Pasang Ruby lalu jalankan `bundle install` di folder project.',
        };
      }
      return { ok: true };
    }

    if (manager === 'dotnet' || framework.id === 'dotnet') {
      if (!(await hasBinary('dotnet'))) {
        return {
          ok: false,
          error: 'dotnet tidak ditemukan di PATH.',
          hint: 'Pasang .NET SDK lalu pastikan perintah `dotnet` bisa dijalankan.',
        };
      }
      return { ok: true };
    }

    if (manager === 'go' || framework.id === 'go') {
      if (!(await hasBinary('go'))) {
        return {
          ok: false,
          error: 'Go tidak ditemukan di PATH.',
          hint: 'Pasang Go lalu pastikan perintah `go` bisa dijalankan.',
        };
      }
      return { ok: true };
    }

    if (manager === 'cargo' || framework.id === 'rust') {
      if (!(await hasBinary('cargo'))) {
        return {
          ok: false,
          error: 'cargo tidak ditemukan di PATH.',
          hint: 'Pasang Rust (rustup) lalu pastikan perintah `cargo` bisa dijalankan.',
        };
      }
      return { ok: true };
    }

    // Framework lain: cukup pastikan perintah utamanya ada.
    if (KNOWN_CLI.includes(bin) && !(await hasBinary(bin))) return missingManager(bin);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Gagal memeriksa runtime project: ' + (err as Error).message };
  }
}
