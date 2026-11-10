import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'rk-agent-permissions-'));
const require = createRequire(import.meta.url);
try {
  const bundlePath = join(temp, 'agentPermissions.cjs');
  await build({
    entryPoints: [join(ROOT, 'src', 'main', 'editor', 'agentPermissions.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  const { createRememberedPermissionKey, RememberedPermissionStore } = require(bundlePath);

  const root = join(temp, 'workspace-a');
  const command = 'npm run build';
  const first = createRememberedPermissionKey('terminal', root, { command });
  assert.equal(first, createRememberedPermissionKey('terminal', root, { command }));
  assert.notEqual(first, createRememberedPermissionKey('terminal', join(temp, 'workspace-b'), { command }));
  assert.notEqual(first, createRememberedPermissionKey('terminal', root, { command: 'npm test' }));
  assert.notEqual(first, createRememberedPermissionKey('mcp', root, { command }));
  assert.doesNotMatch(first, /npm|build|workspace/i);
  console.log('PASS permission grants are exact-action and workspace scoped');

  const filePath = join(temp, 'app-data', 'agent-permissions.json');
  const store = new RememberedPermissionStore(filePath);
  await store.load();
  assert.equal(store.has(first), false);
  await store.remember(first);
  assert.equal(store.has(first), true);
  const saved = await readFile(filePath, 'utf8');
  assert.match(saved, /"version": 1/);
  assert.match(saved, new RegExp(first));
  assert.doesNotMatch(saved, /npm run build/);

  const restored = new RememberedPermissionStore(filePath);
  await restored.load();
  assert.equal(restored.has(first), true);
  console.log('PASS persistent permission grants survive store reload without storing command text');

  const empty = new RememberedPermissionStore(join(temp, 'missing', 'permissions.json'));
  await empty.load();
  assert.equal(empty.has(first), false);
  console.log('PASS missing permission store safely starts with no remembered grants');
} finally {
  await rm(temp, { recursive: true, force: true });
}
