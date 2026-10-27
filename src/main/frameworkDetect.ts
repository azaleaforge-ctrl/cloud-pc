import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameworkInfo } from '../shared/types';

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const IS_WINDOWS = process.platform === 'win32';

interface JsFramework {
  id: string;
  name: string;
  port: number;
  deps: string[];
  requires?: string[];
  /** Biner di node_modules/.bin; string kosong = hanya lewat script package.json. */
  bin: string;
  /** Argumen penuh yang diteruskan ke biner, termasuk subcommand dev. */
  binArgs: (port: number, dir: string) => string[];
  /** Argumen host/port saja, untuk perintah `npm run <script> -- <args>`. */
  scriptArgs: (port: number, dir: string) => string[];
  /** Perintah cadangan bila biner dan script tidak tersedia. */
  fallback?: (port: number) => string;
}

const lanFlags = (port: number): string[] => ['--host', '0.0.0.0', '--port', String(port)];
const nextFlags = (port: number): string[] => ['--hostname', '0.0.0.0', '--port', String(port)];
const noFlags = (): string[] => [];

function parcelEntry(dir: string): string {
  if (existsSync(join(dir, 'index.html'))) return 'index.html';
  if (existsSync(join(dir, 'src', 'index.html'))) return 'src/index.html';
  return '';
}

/** Urutan penting: framework paling spesifik lebih dulu. */
const JS_FRAMEWORKS: JsFramework[] = [
  {
    id: 'next', name: 'Next.js', port: 3000, deps: ['next'], bin: 'next',
    binArgs: (port) => ['dev', ...nextFlags(port)],
    scriptArgs: (port) => nextFlags(port),
  },
  {
    id: 'nuxt', name: 'Nuxt', port: 3000, deps: ['nuxt'], bin: 'nuxt',
    binArgs: (port) => ['dev', ...lanFlags(port)],
    scriptArgs: (port) => lanFlags(port),
  },
  {
    id: 'sveltekit', name: 'SvelteKit', port: 5173, deps: ['@sveltejs/kit'], bin: 'vite',
    binArgs: (port) => lanFlags(port),
    scriptArgs: (port) => lanFlags(port),
  },
  {
    id: 'remix', name: 'Remix', port: 5173, deps: ['@remix-run/dev'], bin: 'remix',
    binArgs: (port) => ['vite:dev', ...lanFlags(port)],
    scriptArgs: (port) => lanFlags(port),
  },
  {
    id: 'astro', name: 'Astro', port: 4321, deps: ['astro'], bin: 'astro',
    binArgs: (port) => ['dev', ...lanFlags(port)],
    scriptArgs: (port) => lanFlags(port),
  },
  {
    id: 'angular', name: 'Angular', port: 4200, deps: ['@angular/cli'], bin: 'ng',
    binArgs: (port) => ['serve', ...lanFlags(port)],
    scriptArgs: (port) => lanFlags(port),
  },
  {
    id: 'gatsby', name: 'Gatsby', port: 8000, deps: ['gatsby'], bin: 'gatsby',
    binArgs: (port) => ['develop', ...lanFlags(port)],
    scriptArgs: (port) => lanFlags(port),
  },
  {
    id: 'cra', name: 'Create React App', port: 3000, deps: ['react-scripts'], bin: 'react-scripts',
    // CRA tidak menerima --host/--port; port diatur lewat env PORT.
    binArgs: () => ['start'],
    scriptArgs: noFlags,
  },
  {
    id: 'vue-cli', name: 'Vue CLI', port: 8080, deps: ['@vue/cli-service'], requires: ['vue'], bin: 'vue-cli-service',
    binArgs: (port) => ['serve', ...lanFlags(port)],
    scriptArgs: (port) => lanFlags(port),
  },
  {
    id: 'parcel', name: 'Parcel', port: 1234, deps: ['parcel', 'parcel-bundler'], bin: 'parcel',
    binArgs: (port, dir) => {
      const entry = parcelEntry(dir);
      return entry ? ['serve', entry, ...lanFlags(port)] : ['serve', ...lanFlags(port)];
    },
    scriptArgs: (port) => lanFlags(port),
  },
  {
    id: 'expo', name: 'Expo', port: 8081, deps: ['expo'], bin: 'expo',
    binArgs: (port) => ['start', '--host', 'lan', '--port', String(port)],
    scriptArgs: (port) => ['--host', 'lan', '--port', String(port)],
  },
  {
    id: 'docusaurus', name: 'Docusaurus', port: 3000, deps: ['@docusaurus/core'], bin: 'docusaurus',
    binArgs: (port) => ['start', ...lanFlags(port)],
    scriptArgs: (port) => lanFlags(port),
  },
  {
    id: 'eleventy', name: 'Eleventy', port: 8080, deps: ['@11ty/eleventy', 'eleventy'], bin: 'eleventy',
    binArgs: (port) => ['--serve', ...lanFlags(port)],
    scriptArgs: (port) => lanFlags(port),
  },
  {
    id: 'nestjs', name: 'NestJS', port: 3000, deps: ['@nestjs/core'], bin: 'nest',
    // `nest start` tidak punya flag host/port; port diatur aplikasi lewat env PORT.
    binArgs: () => ['start', '--watch'],
    scriptArgs: noFlags,
  },
  {
    id: 'strapi', name: 'Strapi', port: 1337, deps: ['@strapi/strapi'], bin: 'strapi',
    binArgs: () => ['develop'],
    scriptArgs: noFlags,
  },
  {
    id: 'adonis', name: 'AdonisJS', port: 3333, deps: ['@adonisjs/core'], bin: '',
    binArgs: noFlags,
    scriptArgs: noFlags,
    fallback: () => 'node ace serve --hmr',
  },
  {
    id: 'redwood', name: 'RedwoodJS', port: 8910, deps: ['@redwoodjs/core'], bin: 'rw',
    binArgs: () => ['dev'],
    scriptArgs: noFlags,
  },
  {
    id: 'qwik', name: 'Qwik', port: 5173, deps: ['@builder.io/qwik'], requires: ['vite'], bin: 'vite',
    binArgs: (port) => lanFlags(port),
    scriptArgs: (port) => lanFlags(port),
  },
  {
    id: 'solid', name: 'SolidStart', port: 3000, deps: ['solid-start', '@solidjs/start'], requires: ['vite'], bin: 'vite',
    binArgs: (port) => lanFlags(port),
    scriptArgs: (port) => lanFlags(port),
  },
  {
    id: 'vite', name: 'Vite', port: 5173, deps: ['vite'], bin: 'vite',
    binArgs: (port) => lanFlags(port),
    scriptArgs: (port) => lanFlags(port),
  },
  {
    // Hono tidak punya CLI dev; selalu lewat script project.
    id: 'hono', name: 'Hono', port: 3000, deps: ['hono'], bin: '',
    binArgs: noFlags,
    scriptArgs: noFlags,
  },
];

const SCRIPT_ORDER = ['dev', 'develop', 'start', 'serve'] as const;

interface ServerFramework {
  id: string;
  name: string;
  port: number;
  check: (dir: string) => boolean;
  command: (dir: string, port: number) => string;
  packageManager: string;
}

/** Framework server non-JS: dideteksi lebih dulu, karena project-nya sering punya package.json juga. */
const SERVER_FRAMEWORKS: ServerFramework[] = [
  {
    id: 'laravel',
    name: 'Laravel',
    port: 8000,
    check: (dir) => {
      const composer = readJsonObject(join(dir, 'composer.json'));
      if (!composer) return false;
      const reqs = { ...asRecord(composer.require), ...asRecord(composer['require-dev']) };
      return Object.keys(reqs).some((key) => key.toLowerCase() === 'laravel/framework');
    },
    command: (_dir, port) => `php artisan serve --host=0.0.0.0 --port=${port}`,
    packageManager: 'composer',
  },
  {
    id: 'symfony',
    name: 'Symfony',
    port: 8000,
    check: (dir) => {
      const composer = readJsonObject(join(dir, 'composer.json'));
      const reqs = { ...asRecord(composer?.require), ...asRecord(composer?.['require-dev']) };
      return Object.keys(reqs).some((key) => key.toLowerCase() === 'symfony/framework-bundle')
        && existsSync(join(dir, 'public'));
    },
    command: (_dir, port) => `php -S 0.0.0.0:${port} -t public`,
    packageManager: 'composer',
  },
  {
    id: 'django',
    name: 'Django',
    port: 8000,
    check: (dir) => existsSync(join(dir, 'manage.py')),
    command: (dir, port) => `${pythonExecutable(dir)} manage.py runserver 0.0.0.0:${port}`,
    packageManager: 'python',
  },
  {
    id: 'fastapi',
    name: 'FastAPI',
    port: 8000,
    check: (dir) => hasPythonPackage(dir, /\bfastapi\b/i) && existsSync(join(dir, 'main.py')),
    command: (dir, port) => `${pythonExecutable(dir)} -m uvicorn main:app --host 0.0.0.0 --port ${port}`,
    packageManager: 'python',
  },
  {
    id: 'flask',
    name: 'Flask',
    port: 5000,
    check: (dir) => hasPythonPackage(dir, /\bflask\b/i)
      && (existsSync(join(dir, 'app.py')) || existsSync(join(dir, 'wsgi.py'))),
    command: (dir, port) => `${pythonExecutable(dir)} -m flask --app app run --host 0.0.0.0 --port ${port}`,
    packageManager: 'python',
  },
  {
    id: 'rails',
    name: 'Ruby on Rails',
    port: 3000,
    check: (dir) => existsSync(join(dir, 'Gemfile')) && existsSync(join(dir, 'config', 'application.rb')),
    command: (_dir, port) => `bundle exec rails server -b 0.0.0.0 -p ${port}`,
    packageManager: 'bundler',
  },
  {
    id: 'dotnet',
    name: '.NET / ASP.NET Core',
    port: 5000,
    check: (dir) => hasRootCsproj(dir),
    command: (_dir, port) => `dotnet run --urls http://0.0.0.0:${port}`,
    packageManager: 'dotnet',
  },
];

/** Hanya dipakai bila project jelas bukan project JS. */
const PLATFORM_FRAMEWORKS: ServerFramework[] = [
  {
    id: 'go',
    name: 'Go',
    port: 8080,
    check: (dir) => existsSync(join(dir, 'go.mod')),
    command: () => 'go run .',
    packageManager: 'go',
  },
  {
    id: 'rust',
    name: 'Rust',
    port: 3000,
    check: (dir) => existsSync(join(dir, 'Cargo.toml')),
    command: () => 'cargo run',
    packageManager: 'cargo',
  },
  {
    id: 'php',
    name: 'PHP (Built-in)',
    port: 8000,
    check: (dir) => existsSync(join(dir, 'index.php')) && !existsSync(join(dir, 'composer.json')),
    command: (_dir, port) => `php -S 0.0.0.0:${port}`,
    packageManager: 'php',
  },
];

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file)) return null;
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readProjectText(file: string): string {
  try { return existsSync(file) ? readFileSync(file, 'utf8') : ''; } catch { return ''; }
}

function hasPythonPackage(dir: string, pattern: RegExp): boolean {
  const manifests = [
    readProjectText(join(dir, 'requirements.txt')),
    readProjectText(join(dir, 'pyproject.toml')),
    readProjectText(join(dir, 'Pipfile')),
  ].join('\n');
  return pattern.test(manifests);
}

function hasRootCsproj(dir: string): boolean {
  try { return readdirSync(dir).some((name) => name.toLowerCase().endsWith('.csproj')); } catch { return false; }
}

/** Python dari virtualenv project lebih dulu, lalu `python` biasa. */
function pythonExecutable(dir: string): string {
  const venv = IS_WINDOWS
    ? join(dir, '.venv', 'Scripts', 'python.exe')
    : join(dir, '.venv', 'bin', 'python');
  if (existsSync(venv)) return /\s/.test(venv) ? `"${venv}"` : venv;
  return 'python';
}

function detectPackageManager(dir: string): PackageManager {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

function quotePath(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

function quoteArg(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

function joinCommand(head: string, args: string[]): string {
  return [head, ...args.filter(Boolean)].join(' ').trim();
}

function localBin(dir: string, bin: string): string | null {
  if (!bin) return null;
  const base = join(dir, 'node_modules', '.bin', bin);
  const candidates = IS_WINDOWS ? [base + '.cmd', base + '.exe', base] : [base];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function expectedBinPath(dir: string, bin: string): string {
  return join(dir, 'node_modules', '.bin', bin + (IS_WINDOWS ? '.cmd' : ''));
}

/**
 * Perintah script yang benar:
 * - npm/pnpm/bun butuh `--` sebelum argumen tambahan.
 * - yarn menerima argumen langsung setelah nama script.
 * Bug lama menghasilkan `npm run dev ---host ...` (tiga strip) → EUNKNOWNCONFIG.
 */
function scriptCommand(pm: PackageManager, script: string, forwardedArgs: string[] = []): string {
  const tail = forwardedArgs.filter(Boolean).map(quoteArg).join(' ');
  switch (pm) {
    case 'pnpm':
      return tail ? `pnpm run ${script} -- ${tail}` : `pnpm run ${script}`;
    case 'yarn':
      return tail ? `yarn ${script} ${tail}` : `yarn ${script}`;
    case 'bun':
      return tail ? `bun run ${script} -- ${tail}` : `bun run ${script}`;
    default:
      return tail ? `npm run ${script} -- ${tail}` : `npm run ${script}`;
  }
}

/**
 * Script dianggap "polos" bila isinya hanya memanggil biner framework tanpa flag
 * khusus; kalau ada flag tambahan (mis. `next dev --turbopack`), script dipakai apa
 * adanya supaya perilakunya tidak hilang.
 */
function scriptIsPlain(scriptText: string, bin: string): boolean {
  if (!bin) return false;
  const tokens = scriptText.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const head = tokens[0].replace(/^.*[\\/]/, '').replace(/\.(cmd|exe|bat)$/i, '');
  if (head !== bin) return false;
  return tokens.slice(1).every((token) => (
    /^[a-z][a-z:._-]*$/i.test(token) && !token.startsWith('-')
  ) || /^-{1,2}(host|port|hostname)(=|$)/.test(token)
    || /^\d+$/.test(token)
    || token === '0.0.0.0');
}

function pickScript(scripts: Record<string, unknown>): string | null {
  for (const name of SCRIPT_ORDER) {
    if (typeof scripts[name] === 'string' && scripts[name].trim()) return name;
  }
  return null;
}

function buildJsCommand(
  fw: JsFramework,
  dir: string,
  pm: PackageManager,
  script: string | null,
  scriptText: string,
  port: number,
): { command: string; via: string } | null {
  const found = localBin(dir, fw.bin);
  const useScriptFirst = script !== null && !scriptIsPlain(scriptText, fw.bin);

  if (useScriptFirst && script) {
    return { command: scriptCommand(pm, script, fw.scriptArgs(port, dir)), via: `script "${script}" (${pm})` };
  }
  if (found) {
    return { command: joinCommand(quotePath(found), fw.binArgs(port, dir).map(quoteArg)), via: `biner lokal ${fw.bin}` };
  }
  if (script) {
    return { command: scriptCommand(pm, script, fw.scriptArgs(port, dir)), via: `script "${script}" (${pm})` };
  }
  if (fw.bin) {
    return { command: joinCommand(quotePath(expectedBinPath(dir, fw.bin)), fw.binArgs(port, dir).map(quoteArg)), via: `biner lokal ${fw.bin} (belum terpasang)` };
  }
  if (fw.fallback) {
    return { command: fw.fallback(port), via: 'perintah bawaan framework' };
  }
  return null;
}

/**
 * Ganti nomor port di dalam perintah agar sesuai port yang benar-benar dipakai.
 * honey: pola terbatas (flag port, host:port, listen(...)); perintah dev selalu pendek.
 */
export function retargetPort(command: string, from: number, to: number): string {
  if (!command || from === to || !Number.isFinite(from) || from <= 0) return command;
  const needle = String(from);
  const patterns = [
    new RegExp(`(--port[=\\s]+)${needle}\\b`, 'g'),
    new RegExp(`(-p[=\\s]+)${needle}\\b`, 'g'),
    new RegExp(`(:)${needle}\\b`, 'g'),
    new RegExp(`(listen\\(\\s*)${needle}\\b`, 'g'),
  ];
  let next = command;
  for (const pattern of patterns) next = next.replace(pattern, `$1${to}`);
  if (next !== command) return next;
  return command.replace(new RegExp(`\\b${needle}\\b`), String(to));
}

/** Project JS nyata (bukan sekadar folder berisi go.mod). */
function looksLikeJsProject(pkg: Record<string, unknown> | null): boolean {
  if (!pkg) return false;
  const deps = { ...asRecord(pkg.dependencies), ...asRecord(pkg.devDependencies) };
  const markers = [
    'react', 'react-dom', 'vue', 'svelte', 'vite', 'webpack', 'next', 'nuxt',
    '@angular/core', 'express', 'fastify', 'koa', 'hono', 'solid-js', '@builder.io/qwik',
  ];
  if (markers.some((dep) => dep in deps)) return true;
  const scripts = asRecord(pkg.scripts);
  return SCRIPT_ORDER.some((name) => typeof scripts[name] === 'string');
}

export function detectFramework(dir: string): FrameworkInfo | null {
  try {
    const pkg = readJsonObject(join(dir, 'package.json'));
    const pm = detectPackageManager(dir);
    const scripts = pkg ? asRecord(pkg.scripts) : {};
    const script = pkg ? pickScript(scripts) : null;
    const scriptText = script && typeof scripts[script] === 'string' ? String(scripts[script]) : '';

    // 1. Framework server non-JS (Laravel/Symfony/Django/FastAPI/Flask/Rails/.NET).
    for (const fw of SERVER_FRAMEWORKS) {
      if (!fw.check(dir)) continue;
      const command = fw.command(dir, fw.port);
      return {
        id: fw.id,
        name: fw.name,
        command,
        args: [],
        cwd: dir,
        packageManager: fw.packageManager,
        detectedPort: fw.port,
        notes: `Perintah: ${command} · port ${fw.port} · dikelola ${fw.packageManager}.`,
      };
    }

    // 2. Framework JS dari package.json.
    if (pkg) {
      const deps = { ...asRecord(pkg.dependencies), ...asRecord(pkg.devDependencies) };
      for (const fw of JS_FRAMEWORKS) {
        if (!fw.deps.some((dep) => dep in deps)) continue;
        if (fw.requires && !fw.requires.every((dep) => dep in deps)) continue;
        const built = buildJsCommand(fw, dir, pm, script, scriptText, fw.port);
        if (!built) continue;
        return {
          id: fw.id,
          name: fw.name,
          command: built.command,
          args: [],
          cwd: dir,
          packageManager: pm,
          detectedPort: fw.port,
          notes: `Perintah: ${built.command} · port ${fw.port} · ${built.via}.`,
        };
      }
    }

    // 3. Node web generik: hanya bila ada script dev/start dan dependensi web.
    if (pkg) {
      const deps = { ...asRecord(pkg.dependencies), ...asRecord(pkg.devDependencies) };
      const webDependencies = [
        'express', 'fastify', 'koa', 'hono', 'h3', 'http-server', 'serve',
        'webpack', 'react', 'vue', 'svelte', '@nestjs/core', '@strapi/strapi',
      ].some((dep) => dep in deps);
      if (script && webDependencies) {
        const command = scriptCommand(pm, script);
        return {
          id: 'node-generic',
          name: `Node.js Web Server (${script})`,
          command,
          args: [],
          cwd: dir,
          packageManager: pm,
          detectedPort: 3000,
          notes: `Perintah: ${command} · port 3000 (env PORT/HOST disetel otomatis).`,
        };
      }
    }

    // 4. Go/Rust/PHP hanya bila project ini bukan project JS.
    if (!looksLikeJsProject(pkg)) {
      for (const fw of PLATFORM_FRAMEWORKS) {
        if (!fw.check(dir)) continue;
        const command = fw.command(dir, fw.port);
        return {
          id: fw.id,
          name: fw.name,
          command,
          args: [],
          cwd: dir,
          packageManager: fw.packageManager,
          detectedPort: fw.port,
          notes: `Perintah: ${command} · port ${fw.port} · dikelola ${fw.packageManager}.`,
        };
      }
    }

    // 5. Situs statis.
    if (existsSync(join(dir, 'index.html'))) {
      const command = pkg && script
        ? scriptCommand(pm, script)
        : existsSync(join(dir, 'node_modules', '.bin', IS_WINDOWS ? 'vite.cmd' : 'vite'))
          ? joinCommand(quotePath(expectedBinPath(dir, 'vite')), ['--host', '0.0.0.0', '--port', '5173'])
          : 'npx --yes serve -l 0.0.0.0:5173 .';
      return {
        id: 'static',
        name: 'Situs Statis',
        command,
        args: [],
        cwd: dir,
        packageManager: pkg ? pm : 'system',
        detectedPort: 5173,
        notes: `Perintah: ${command} · port 5173 · disajikan sebagai situs statis.`,
      };
    }

    return null;
  } catch {
    return null;
  }
}
