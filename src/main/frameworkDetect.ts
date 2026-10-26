import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameworkInfo } from '../shared/types';

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

interface JsFramework {
  id: string;
  name: string;
  port: number;
  deps: string[];
  requires?: string[];
  hostArgs?: boolean;
}

/** Urutan penting: framework paling spesifik lebih dulu. */
const JS_FRAMEWORKS: JsFramework[] = [
  { id: 'next', name: 'Next.js', port: 3000, deps: ['next'], hostArgs: true },
  { id: 'nuxt', name: 'Nuxt', port: 3000, deps: ['nuxt'], hostArgs: true },
  { id: 'astro', name: 'Astro', port: 4321, deps: ['astro'], hostArgs: true },
  { id: 'remix', name: 'Remix', port: 5173, deps: ['@remix-run/dev'], hostArgs: true },
  { id: 'sveltekit', name: 'SvelteKit', port: 5173, deps: ['@sveltejs/kit'], hostArgs: true },
  { id: 'angular', name: 'Angular', port: 4200, deps: ['@angular/cli'], hostArgs: true },
  { id: 'gatsby', name: 'Gatsby', port: 8000, deps: ['gatsby'], hostArgs: true },
  { id: 'cra', name: 'Create React App', port: 3000, deps: ['react-scripts'], hostArgs: false },
  { id: 'vite', name: 'Vite', port: 5173, deps: ['vite'], hostArgs: true },
  { id: 'vue-cli', name: 'Vue CLI', port: 8080, deps: ['@vue/cli-service'], requires: ['vue'], hostArgs: true },
  { id: 'parcel', name: 'Parcel', port: 1234, deps: ['parcel', 'parcel-bundler'], hostArgs: true },
  { id: 'expo', name: 'Expo', port: 8081, deps: ['expo'], hostArgs: true },
  { id: 'docusaurus', name: 'Docusaurus', port: 3000, deps: ['@docusaurus/core'], hostArgs: true },
  { id: 'eleventy', name: 'Eleventy', port: 8080, deps: ['@11ty/eleventy', 'eleventy'], hostArgs: true },
];

const SCRIPT_ORDER = ['dev', 'develop', 'start', 'serve'] as const;

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
    id: 'fastapi',
    name: 'FastAPI',
    port: 8000,
    check: (dir) => hasPythonPackage(dir, /\\bfastapi\\b/i) && existsSync(join(dir, 'main.py')),
    command: 'python -m uvicorn main:app --host 0.0.0.0 --port 8000',
    packageManager: 'python',
  },
  {
    id: 'flask',
    name: 'Flask',
    port: 5000,
    check: (dir) => hasPythonPackage(dir, /\\bflask\\b/i) && (existsSync(join(dir, 'app.py')) || existsSync(join(dir, 'wsgi.py'))),
    command: 'python -m flask --app app run --host 0.0.0.0 --port 5000',
    packageManager: 'python',
  },
  {
    id: 'rails',
    name: 'Ruby on Rails',
    port: 3000,
    check: (dir) => existsSync(join(dir, 'Gemfile')) && existsSync(join(dir, 'config', 'application.rb')),
    command: 'bundle exec rails server -b 0.0.0.0 -p 3000',
    packageManager: 'bundler',
  },
  {
    id: 'symfony',
    name: 'Symfony',
    port: 8000,
    check: (dir) => {
      const composer = readJsonObject(join(dir, 'composer.json'));
      const reqs = { ...asRecord(composer?.require), ...asRecord(composer?.['require-dev']) };
      return Object.keys(reqs).some((key) => key.toLowerCase() === 'symfony/framework-bundle') && existsSync(join(dir, 'public'));
    },
    command: 'php -S 0.0.0.0:8000 -t public',
    packageManager: 'composer',
  },
  {
    id: 'dotnet',
    name: '.NET / ASP.NET Core',
    port: 5000,
    check: (dir) => hasRootCsproj(dir),
    command: 'dotnet run --urls http://0.0.0.0:5000',
    packageManager: 'dotnet',
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
  // Keep common JavaScript dev servers reachable from the LAN; the host also has a proxy fallback.
  return ['--host', '0.0.0.0', '--port', String(port)];
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

function defaultJsCommand(id: string, pm: PackageManager, port: number): string {
  const commands: Record<string, string> = {
    next: 'next dev --hostname 0.0.0.0 --port ' + port,
    nuxt: 'nuxt dev --host 0.0.0.0 --port ' + port,
    astro: 'astro dev --host 0.0.0.0 --port ' + port,
    remix: 'remix vite:dev --host 0.0.0.0 --port ' + port,
    sveltekit: 'vite --host 0.0.0.0 --port ' + port,
    angular: 'ng serve --host 0.0.0.0 --port ' + port,
    gatsby: 'gatsby develop --host 0.0.0.0 --port ' + port,
    cra: 'react-scripts start',
    vite: 'vite --host 0.0.0.0 --port ' + port,
    'vue-cli': 'vue-cli-service serve --host 0.0.0.0 --port ' + port,
    parcel: 'parcel serve index.html --host 0.0.0.0 --port ' + port,
    expo: 'expo start --host lan --port ' + port,
    docusaurus: 'docusaurus start --host 0.0.0.0 --port ' + port,
    eleventy: 'eleventy --serve --host 0.0.0.0 --port ' + port,
    nestjs: 'nest start --watch',
    express: 'node index.js',
    fastify: 'node index.js',
    strapi: 'strapi develop',
  };
  const command = commands[id];
  if (!command) return '';
  if (pm === 'pnpm') return 'pnpm exec ' + command;
  if (pm === 'yarn') return 'yarn ' + command;
  if (pm === 'bun') return 'bunx ' + command;
  return 'npx --no-install ' + command;
}

function pickScript(scripts: Record<string, unknown>): string | null {
  for (const name of SCRIPT_ORDER) {
    if (typeof scripts[name] === 'string' && scripts[name].trim()) return name;
  }
  return null;
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
        const forwardedArgs = fw.hostArgs === false ? [] : lanArgsFor(fw.id, fw.port);
        const command = script
          ? buildCommand(pm, script, forwardedArgs)
          : defaultJsCommand(fw.id, pm, fw.port);
        if (!command) continue;
        return {
          id: fw.id,
          name: fw.name,
          command,
          args: [],
          cwd: dir,
          packageManager: pm,
          detectedPort: fw.port,
          notes: script
            ? 'Script package.json dipilih otomatis; host/port diteruskan bila framework mendukungnya.'
            : 'Perintah dev dibuat otomatis dari framework yang terdeteksi.',
        };
      }
    }

    // Generic Node web projects: use their existing dev/start script only when web dependencies are present.
    if (pkg) {
      const deps = { ...asRecord(pkg.dependencies), ...asRecord(pkg.devDependencies) };
      const scripts = asRecord(pkg.scripts);
      const script = pickScript(scripts);
      const webDependencies = ['express', 'fastify', 'koa', 'hono', 'h3', 'http-server', 'serve', 'vite', 'webpack', 'react', 'vue', 'svelte', '@nestjs/core', '@strapi/strapi']
        .some((dep) => dep in deps);
      if (script && webDependencies) {
        const pm = detectPackageManager(dir);
        return {
          id: 'node-generic',
          name: 'Node.js Web Server (' + script + ')',
          command: buildCommand(pm, script),
          args: [],
          cwd: dir,
          packageManager: pm,
          detectedPort: 3000,
          notes: 'Menggunakan script "' + script + '" di package.json; HOST/PORT disetel otomatis jika framework mendukung.',
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
