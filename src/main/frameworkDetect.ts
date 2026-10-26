import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameworkInfo } from '../shared/types';

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

interface JsFramework {
  id: string;
  name: string;
  port: number;
  deps: string[];
  requires?: string[];
}

/** Urutan penting: framework paling spesifik lebih dulu. */
const JS_FRAMEWORKS: JsFramework[] = [
  { id: 'next', name: 'Next.js', port: 3000, deps: ['next'] },
  { id: 'nuxt', name: 'Nuxt', port: 3000, deps: ['nuxt'] },
  { id: 'astro', name: 'Astro', port: 4321, deps: ['astro'] },
  { id: 'remix', name: 'Remix', port: 5173, deps: ['@remix-run/dev'] },
  { id: 'sveltekit', name: 'SvelteKit', port: 5173, deps: ['@sveltejs/kit'] },
  { id: 'angular', name: 'Angular', port: 4200, deps: ['@angular/cli'] },
  { id: 'gatsby', name: 'Gatsby', port: 8000, deps: ['gatsby'] },
  { id: 'cra', name: 'Create React App', port: 3000, deps: ['react-scripts'] },
  { id: 'vite', name: 'Vite', port: 5173, deps: ['vite'] },
  { id: 'vue-cli', name: 'Vue CLI', port: 8080, deps: ['@vue/cli-service'], requires: ['vue'] },
  { id: 'parcel', name: 'Parcel', port: 1234, deps: ['parcel', 'parcel-bundler'] },
  { id: 'expo', name: 'Expo', port: 8081, deps: ['expo'] },
  { id: 'docusaurus', name: 'Docusaurus', port: 3000, deps: ['@docusaurus/core'] },
  { id: 'eleventy', name: 'Eleventy', port: 8080, deps: ['@11ty/eleventy', 'eleventy'] },
];

const SCRIPT_ORDER = ['dev', 'start', 'serve'] as const;

interface NonJsFramework {
  id: string;
  name: string;
  port: number;
  check: (dir: string) => boolean;
  command: string;
  packageManager: string;
}

const NON_JS_FRAMEWORKS: NonJsFramework[] = [
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
    command: 'php artisan serve --host=0.0.0.0 --port=8000',
    packageManager: 'composer',
  },
  {
    id: 'django',
    name: 'Django',
    port: 8000,
    check: (dir) => existsSync(join(dir, 'manage.py')),
    command: 'python manage.py runserver 0.0.0.0:8000',
    packageManager: 'python',
  },
  {
    id: 'go',
    name: 'Go',
    port: 8080,
    check: (dir) => existsSync(join(dir, 'go.mod')),
    command: 'go run .',
    packageManager: 'go',
  },
  {
    id: 'rust',
    name: 'Rust',
    port: 3000,
    check: (dir) => existsSync(join(dir, 'Cargo.toml')),
    command: 'cargo run',
    packageManager: 'cargo',
  },
  {
    id: 'php',
    name: 'PHP (Built-in)',
    port: 8000,
    check: (dir) => existsSync(join(dir, 'index.php')) && !existsSync(join(dir, 'composer.json')),
    command: 'php -S 0.0.0.0:8000',
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

function detectPackageManager(dir: string): PackageManager {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'bun.lockb')) || existsSync(join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

function buildCommand(pm: PackageManager, script: string, forwardedArgs: string[] = []): string {
  const suffix = forwardedArgs.length ? ` ${forwardedArgs.join(' ')}` : '';
  switch (pm) {
    case 'pnpm':
      return `pnpm ${script}${suffix}`;
    case 'yarn':
      return `yarn ${script}${suffix}`;
    case 'bun':
      return `bun run ${script}${suffix}`;
    default:
      return script === 'start'
        ? `npm start${suffix ? ` --${suffix}` : ''}`
        : `npm run ${script}${suffix ? ` --${suffix}` : ''}`;
  }
}

function lanArgsFor(id: string, port: number): string[] {
  if (id === 'next') return ['--hostname', '0.0.0.0', '--port', String(port)];
  if (id === 'expo') return ['--host', 'lan', '--port', String(port)];
  // Vite/Astro/Nuxt/Angular/CRA and common CLI dev servers.
  return ['--host', '0.0.0.0', '--port', String(port)];
}

function pickScript(scripts: Record<string, unknown>): string {
  for (const name of SCRIPT_ORDER) {
    if (typeof scripts[name] === 'string') return name;
  }
  return 'dev';
}

export function detectFramework(dir: string): FrameworkInfo | null {
  try {
    // Cek framework non-JS (composer.json, manage.py, go.mod, Cargo.toml)
    // DULUAN, karena Laravel/Vue/Vite biasanya punya package.json juga.
    for (const fw of NON_JS_FRAMEWORKS) {
      if (fw.check(dir)) {
        return {
          id: fw.id,
          name: fw.name,
          command: fw.command,
          args: [],
          cwd: dir,
          packageManager: fw.packageManager,
          detectedPort: fw.port,
        };
      }
    }

    const pkg = readJsonObject(join(dir, 'package.json'));
    if (pkg) {
      const deps = { ...asRecord(pkg.dependencies), ...asRecord(pkg.devDependencies) };
      for (const fw of JS_FRAMEWORKS) {
        const hit = fw.deps.some((dep) => dep in deps);
        if (!hit) continue;
        if (fw.requires && !fw.requires.every((dep) => dep in deps)) continue;
        const pm = detectPackageManager(dir);
        const script = pickScript(asRecord(pkg.scripts));
        return {
          id: fw.id,
          name: fw.name,
          command: buildCommand(pm, script, lanArgsFor(fw.id, fw.port)),
          args: [],
          cwd: dir,
          packageManager: pm,
          detectedPort: fw.port,
        };
      }
    }

    // Static site fallback (tidak peduli package.json)
    if (existsSync(join(dir, 'index.html'))) {
      const pm = pkg ? detectPackageManager(dir) : 'system' as PackageManager | 'system';
      const script = pkg ? pickScript(asRecord(pkg.scripts)) : 'dev';
      const command =
        pm === 'system' ? 'npx serve -l 5173 .' : buildCommand(pm, script);
      return {
        id: 'static',
        name: 'Situs Statis',
        command,
        args: [],
        cwd: dir,
        packageManager: pm ?? 'system',
        detectedPort: 5173,
        notes: 'Disajikan dengan server statis.',
      };
    }

    return null;
  } catch {
    return null;
  }
}
