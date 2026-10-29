import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { AgentSkillInstallResult, InstalledAgentSkill } from '../../shared/agents';

const MAX_SKILL_BYTES = 48 * 1024;
const MAX_INSTALLED_SKILLS = 10;
const MAX_ACTIVE_SKILL_BYTES = 18 * 1024;
const IMPORTED_DIR = join('ai', 'skills', 'imported');

function skillDirectory(userDataDir: string): string {
  return join(userDataDir, IMPORTED_DIR);
}

function titleFromMarkdown(contents: string, fallback: string): string {
  const frontmatter = contents.match(/^---\s*\n([\s\S]*?)\n---/);
  const frontmatterName = frontmatter?.[1].match(/^name:\s*["']?([^\n"']+)/m)?.[1]?.trim();
  if (frontmatterName) return frontmatterName.slice(0, 100);
  const heading = contents.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (heading || fallback).replace(/\s+/g, ' ').slice(0, 100);
}

function safeSlug(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'skill';
}

function metadataFromFile(fileName: string, contents: string): InstalledAgentSkill {
  const id = fileName.slice(0, -3);
  return { id, name: titleFromMarkdown(contents, id.replace(/-[a-f0-9]{8}$/, '').replace(/-/g, ' ')), fileName, size: Buffer.byteLength(contents, 'utf8') };
}

export async function listInstalledAgentSkills(userDataDir: string): Promise<InstalledAgentSkill[]> {
  const directory = skillDirectory(userDataDir);
  let names: string[];
  try { names = await readdir(directory); } catch { return []; }
  const skills: InstalledAgentSkill[] = [];
  for (const fileName of names.filter(name => /^[a-z0-9-]+-[a-f0-9]{8}\.md$/.test(name)).sort()) {
    try {
      const contents = await readFile(join(directory, fileName), 'utf8');
      skills.push(metadataFromFile(fileName, contents));
    } catch { /* Ignore unreadable files; never expose raw paths or contents to the renderer. */ }
  }
  return skills;
}

export async function importAgentSkill(userDataDir: string, sourcePath: string): Promise<AgentSkillInstallResult> {
  try {
    if (typeof sourcePath !== 'string' || !sourcePath.trim() || !['.md', '.markdown'].includes(extname(sourcePath).toLowerCase())) {
      return { ok: false, error: 'Pilih file Markdown (.md atau .markdown).' };
    }
    const info = await stat(sourcePath);
    if (!info.isFile()) return { ok: false, error: 'Sumber skill harus berupa file.' };
    if (info.size <= 0 || info.size > MAX_SKILL_BYTES) return { ok: false, error: 'Ukuran skill harus antara 1 byte dan 48 KB.' };
    const contents = (await readFile(sourcePath, 'utf8')).replace(/^\uFEFF/, '').trim();
    if (!contents || !(/^#\s+\S/m.test(contents) || /^---\s*\n[\s\S]*?\n---/m.test(contents))) {
      return { ok: false, error: 'Format skill tidak valid: tambahkan heading Markdown atau frontmatter.' };
    }
    if (contents.includes('\u0000')) return { ok: false, error: 'File skill mengandung karakter yang tidak valid.' };
    const installed = await listInstalledAgentSkills(userDataDir);
    if (installed.length >= MAX_INSTALLED_SKILLS) return { ok: false, error: 'Maksimal 10 skill impor dapat dipasang.' };
    const name = titleFromMarkdown(contents, basename(sourcePath, extname(sourcePath)));
    const id = safeSlug(name) + '-' + randomUUID().replace(/-/g, '').slice(0, 8);
    const directory = skillDirectory(userDataDir);
    await mkdir(directory, { recursive: true });
    const fileName = id + '.md';
    await writeFile(join(directory, fileName), contents + '\n', { encoding: 'utf8', flag: 'wx' });
    return { ok: true, skill: { id, name, fileName, size: Buffer.byteLength(contents, 'utf8') } };
  } catch (error) {
    return { ok: false, error: (error as Error).message || 'Skill gagal diimpor.' };
  }
}

export async function uninstallAgentSkill(userDataDir: string, id: string): Promise<{ ok: boolean; error?: string }> {
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{8}$/.test(id)) {
    return { ok: false, error: 'ID skill impor tidak valid.' };
  }
  const directory = skillDirectory(userDataDir);
  const filePath = join(directory, id + '.md');
  try {
    await unlink(filePath);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Skill tidak ditemukan atau sudah dihapus.' };
  }
}

export async function loadInstalledSkillInstructions(userDataDir: string): Promise<string> {
  const installed = await listInstalledAgentSkills(userDataDir);
  const sections: string[] = [];
  let remaining = MAX_ACTIVE_SKILL_BYTES;
  for (const skill of installed) {
    if (remaining <= 0) break;
    try {
      const contents = await readFile(join(skillDirectory(userDataDir), skill.fileName), 'utf8');
      const section = '## Skill impor: ' + skill.name + '\n' + contents.slice(0, Math.min(MAX_SKILL_BYTES, remaining));
      sections.push(section);
      remaining -= Buffer.byteLength(section, 'utf8');
    } catch { /* Skip files removed between listing and reading. */ }
  }
  return sections.join('\n\n');
}
