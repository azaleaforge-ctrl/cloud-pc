import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'rk-workspace-security-'));
const project = join(temp, 'project');
const outside = join(temp, 'outside');
const require = createRequire(import.meta.url);
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('PASS ' + name);
  } catch (error) {
    failed += 1;
    console.error('FAIL ' + name + ' — ' + (error instanceof Error ? error.stack : String(error)));
  }
}

async function createDirectoryLink(target, linkPath) {
  await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

try {
  await mkdir(join(project, 'src'), { recursive: true });
  await mkdir(join(project, '.private-data'), { recursive: true });
  await mkdir(join(project, 'private-key'), { recursive: true });
  await mkdir(join(project, 'docs'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(project, '.private-data', '.env'), 'SECRET=must-not-leak', 'utf8');
  await writeFile(join(project, 'private-key', 'payload.txt'), 'PRIVATE_KEY_MATERIAL', 'utf8');
  await writeFile(join(project, 'docs', 'safe.txt'), 'safe workspace content', 'utf8');
  await writeFile(join(outside, 'outside.txt'), 'outside-root-secret-marker', 'utf8');

  await createDirectoryLink(join(project, 'private-key'), join(project, 'src', 'config-alias'));
  await createDirectoryLink(join(project, 'docs'), join(project, 'src', 'docs-alias'));
  await createDirectoryLink(outside, join(project, 'escape'));
  const canonicalProject = await realpath(project);

  const securityBundle = join(temp, 'workspacePathSecurity.cjs');
  await build({
    entryPoints: [join(ROOT, 'src/main/editor/workspacePathSecurity.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: securityBundle,
    logLevel: 'silent',
  });
  const { resolveWorkspacePath } = require(securityBundle);

  await test('blocks a direct .env path for Agentic Coding AI', async () => {
    await assert.rejects(
      () => resolveWorkspacePath(project, '.private-data/.env', { blockSensitive: true }),
      /secret atau kredensial/i,
    );
  });

  await test('blocks an ordinary-looking symlink alias whose canonical directory is sensitive', async () => {
    await assert.rejects(
      () => resolveWorkspacePath(project, 'src/config-alias/payload.txt', { blockSensitive: true }),
      /secret atau kredensial/i,
    );
  });

  await test('rejects path traversal outside the canonical project root', async () => {
    await assert.rejects(
      () => resolveWorkspacePath(project, '../outside/outside.txt'),
      /di dalam folder proyek/i,
    );
  });

  await test('rejects an internal symlink for mutations, even when its target is not sensitive', async () => {
    await assert.rejects(
      () => resolveWorkspacePath(project, 'src/docs-alias/new.txt', { allowMissing: true, rejectSymlinks: true }),
      /symbolic link/i,
    );
  });

  await test('allows a safe missing file after validating existing parent directories', async () => {
    const resolved = await resolveWorkspacePath(project, 'src/new-folder/new-file.ts', {
      allowMissing: true,
      rejectSymlinks: true,
      blockSensitive: true,
    });
    assert.equal(resolved.rel, 'src/new-folder/new-file.ts');
    assert.equal(resolved.target, join(canonicalProject, 'src', 'new-folder', 'new-file.ts'));
  });

  await test('rejects canonical targets that resolve outside the project', async () => {
    await assert.rejects(
      () => resolveWorkspacePath(project, 'escape/outside.txt'),
      /di dalam folder proyek/i,
    );
  });

  const workspaceBundle = join(temp, 'workspace.cjs');
  await build({
    entryPoints: [join(ROOT, 'src/main/editor/workspace.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: workspaceBundle,
    logLevel: 'silent',
    plugins: [{
      name: 'electron-test-stub',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'electron-test' }));
        buildApi.onLoad({ filter: /.*/, namespace: 'electron-test' }, () => ({
          contents: 'export const shell = { trashItem: async () => {} };',
          loader: 'js',
        }));
      },
    }],
  });
  const { createWorkspaceService } = require(workspaceBundle);
  const service = createWorkspaceService(() => project);

  await test('directory listing omits symbolic links whose targets escape the workspace', async () => {
    const entries = await service.listDir(project);
    assert.equal(entries.some((entry) => entry.name === 'escape'), false);
  });

  await test('IDE reads reject paths that traverse an external directory link', async () => {
    await assert.rejects(() => service.readFile(join(project, 'escape', 'outside.txt')), /di dalam folder proyek/i);
  });

  await test('IDE can read an internal link after canonical containment validation', async () => {
    const result = await service.readFile(join(project, 'src', 'docs-alias', 'safe.txt'));
    assert.equal(result.content, 'safe workspace content');
    assert.equal(result.path, join(canonicalProject, 'docs', 'safe.txt'));
  });

  await test('IDE writes reject internal symbolic-link traversal without changing the target', async () => {
    const result = await service.writeFile(join(project, 'src', 'docs-alias', 'safe.txt'), 'tampered');
    assert.equal(result.ok, false);
    assert.equal(await readFile(join(project, 'docs', 'safe.txt'), 'utf8'), 'safe workspace content');
  });

  await test('IDE file creation and folder creation reject external symbolic-link traversal', async () => {
    const fileResult = await service.createFile(join(project, 'escape', 'created.txt'));
    const folderResult = await service.createFolder(join(project, 'escape', 'created-folder'));
    assert.equal(fileResult.ok, false);
    assert.equal(folderResult.ok, false);
    await assert.rejects(() => stat(join(outside, 'created.txt')));
    await assert.rejects(() => stat(join(outside, 'created-folder')));
  });

  await test('IDE rename and delete reject paths that traverse external symbolic links', async () => {
    const renameResult = await service.renamePath(join(project, 'escape', 'outside.txt'), join(project, 'renamed.txt'));
    const deleteResult = await service.deletePath(join(project, 'escape', 'outside.txt'));
    assert.equal(renameResult.ok, false);
    assert.equal(deleteResult.ok, false);
    assert.equal(await readFile(join(outside, 'outside.txt'), 'utf8'), 'outside-root-secret-marker');
  });

  await test('IDE search does not follow symbolic links outside the project', async () => {
    const hits = await service.search('outside-root-secret-marker');
    assert.equal(hits.length, 0);
  });

  console.log('\nWorkspace security tests: ' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
