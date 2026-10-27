import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const target = process.argv[2];
const root = resolve(import.meta.dirname, '..');

mkdirSync(resolve(root, 'dist'), { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  target: 'node20',
  logLevel: 'info',
  // Native module (ConPTY) harus tetap di-resolve dari node_modules saat runtime.
  external: ['electron', '@lydell/node-pty'],
};

if (target === 'main') {
  await build({
    ...common,
    entryPoints: [resolve(root, 'src/main/index.ts')],
    outfile: resolve(root, 'dist/main/index.js'),
  });
} else if (target === 'preload') {
  await build({
    ...common,
    entryPoints: [resolve(root, 'src/preload/index.ts')],
    outfile: resolve(root, 'dist/preload/index.js'),
  });
} else {
  console.error('usage: node scripts/build.mjs <main|preload>');
  process.exit(1);
}
