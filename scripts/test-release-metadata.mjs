import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const notes = await readFile(join(root, 'RELEASE_NOTES.md'), 'utf8');

assert.equal(pkg.version, '1.0.5', 'package.json must match the v1.0.5 release');
assert.equal(lock.version, pkg.version, 'package-lock top-level version must match package.json');
assert.equal(lock.packages?.['']?.version, pkg.version, 'package-lock root package version must match package.json');
assert.match(notes, /^# Ruang Kerja v1\.0\.5\s/m, 'release notes must start with the current version');
assert.match(notes, /### Detail Version di dalam aplikasi/, 'release notes must document in-app Detail Version');
assert.match(notes, /deskripsi perubahan\/fitur\/perbaikan/i, 'release notes must require a description per version');
assert.match(notes, /maksimal tiga rilis terbaru/i, 'release notes must document the three-release history limit');
assert.match(notes, /Muat Ulang Versi/, 'release notes must document manual version refresh');

const headings = [...notes.matchAll(/^# Ruang Kerja v?\d+\.\d+\.\d+\s*$/gm)].map((m) => m[0]);
assert.equal(headings[0].trim(), '# Ruang Kerja v1.0.5', 'current release notes must be the first version entry');
assert.ok(headings.length >= 3, 'historical version descriptions must be preserved');

console.log('Release metadata tests: 7 assertions passed.');
