import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const notes = await readFile(join(root, 'RELEASE_NOTES.md'), 'utf8');
const escapedVersion = pkg.version.replaceAll('.', '\\.');
const expectedHeading = '# Ruang Kerja v' + pkg.version;

assert.match(
  notes,
  new RegExp('^# Ruang Kerja v?' + escapedVersion + '\\s', 'm'),
  'release notes must start with the current package version',
);
assert.equal(lock.version, pkg.version, 'package-lock top-level version must match package.json');
assert.equal(lock.packages?.['']?.version, pkg.version, 'package-lock root package version must match package.json');
assert.match(notes, /### Detail Version di dalam aplikasi/, 'release notes must document in-app Detail Version');
assert.match(notes, /deskripsi perubahan\/fitur\/perbaikan/i, 'release notes must require a description per version');
assert.match(notes, /maksimal tiga rilis terbaru/i, 'release notes must document the three-release history limit');
assert.match(notes, /Muat Ulang Versi/, 'release notes must document manual version refresh');

const headings = [...notes.matchAll(/^# Ruang Kerja v?\d+\.\d+\.\d+\s*$/gm)].map((m) => m[0]);
assert.equal(headings[0].trim(), expectedHeading, 'current release notes must be the first version entry');
assert.ok(headings.length >= 3, 'historical version descriptions must be preserved');

const separatorMatch = notes.match(/^---[ \t]*$/m);
assert.ok(separatorMatch, 'release notes must separate current notes from release history');
const separatorIndex = separatorMatch.index ?? -1;
const currentNotes = notes.slice(0, separatorIndex);
assert.match(currentNotes, /^## .{8,}$/m, 'current release must have a descriptive subtitle');
const detailedBullets = currentNotes.match(/^\\s*[-*]\\s+\\S.{20,}$/gm) ?? [];
assert.ok(detailedBullets.length >= 5, 'current release must contain at least five descriptive change bullets');
assert.match(currentNotes, /### Detail Version di dalam aplikasi/, 'current release must describe the in-app version history');
assert.match(currentNotes, /Muat Ulang Versi/, 'current release must explain how to refresh version details');
const currentReleaseHeadings = notes.slice(0, separatorIndex).match(/^# Ruang Kerja v?\d+\.\d+\.\d+\s*$/gm) || [];
assert.equal(currentReleaseHeadings.length, 1, 'the release description before the first separator must contain only the current version');

console.log('Release metadata tests: all assertions passed.');
