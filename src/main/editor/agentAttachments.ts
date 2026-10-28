// User-selected AI attachments stay in main-process memory and outside the workspace.
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { AgentAttachmentRef } from '../../shared/agents';

interface ZipEntry { entryName: string; header?: { size?: number }; getData(): Buffer; }
interface ZipArchive { getEntry(name: string): ZipEntry | null; getEntries(): ZipEntry[]; }
interface Stored extends AgentAttachmentRef { text?: string; dataUrl?: string; expiresAt: number; }
export interface ResolvedAgentAttachment extends AgentAttachmentRef { text?: string; dataUrl?: string; }

const AdmZip = require('adm-zip') as new (data: Buffer) => ZipArchive;
const FILE_MAX = 25 * 1024 * 1024;
const IMAGE_MAX = 12 * 1024 * 1024;
const BATCH_MAX = 50 * 1024 * 1024;
const PART_MAX = 30 * 1024 * 1024;
const TEXT_MAX = 24_000;
const TTL = 60 * 60 * 1000;
const STORE_MAX = 100 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif',
  '.pdf':'application/pdf', '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt':'text/plain', '.md':'text/markdown', '.markdown':'text/markdown', '.csv':'text/csv', '.tsv':'text/tab-separated-values',
  '.json':'application/json', '.jsonl':'application/jsonl', '.xml':'application/xml', '.html':'text/html', '.htm':'text/html',
  '.css':'text/css', '.js':'text/javascript', '.jsx':'text/javascript', '.ts':'text/typescript', '.tsx':'text/typescript',
  '.mjs':'text/javascript', '.cjs':'text/javascript', '.py':'text/x-python', '.php':'text/x-php', '.sql':'application/sql',
  '.yaml':'text/yaml', '.yml':'text/yaml', '.log':'text/plain', '.ini':'text/plain', '.toml':'text/plain', '.sh':'text/plain', '.ps1':'text/plain',
};
const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const officeExts = new Set(['.docx', '.xlsx', '.pptx']);
const textExts = new Set(Object.keys(MIME).filter((ext) => !imageExts.has(ext) && ext !== '.pdf' && !officeExts.has(ext)));
const records = new Map<string, Stored>();

function prune(): void {
  const now = Date.now();
  for (const [id, item] of records) if (item.expiresAt <= now) records.delete(id);
}
function memoryUse(): number {
  let total = 0;
  for (const item of records.values()) total += item.dataUrl ? Math.floor(item.dataUrl.length * 0.75) : (item.text?.length ?? 0) * 2;
  return total;
}
function boundedText(source: string): string {
  const clean = source.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  return clean.length <= TEXT_MAX ? clean : clean.slice(0, TEXT_MAX) + '\n\n[Konten dipotong untuk membatasi konteks AI.]';
}
function decodeXml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}
function xmlText(xml: string): string {
  return [...xml.matchAll(/<(?:w:|a:)?t\b[^>]*>([\s\S]*?)<\/(?:w:|a:)?t>/g)].map((m) => decodeXml(m[1])).join('');
}
function zipPart(zip: ZipArchive, name: string): string | null {
  const entry = zip.getEntry(name);
  if (!entry) return null;
  if ((entry.header?.size ?? 0) > PART_MAX) throw new Error('Bagian dokumen terlalu besar: ' + name);
  return entry.getData().toString('utf8');
}
function extractDocx(buffer: Buffer): string {
  const xml = zipPart(new AdmZip(buffer), 'word/document.xml');
  if (!xml) throw new Error('DOCX tidak memiliki word/document.xml.');
  return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n').replace(/<[^>]+>/g, ' ')
    .split('\n').map((line) => decodeXml(line.replace(/[ \t]+/g, ' ').trim())).filter(Boolean).join('\n');
}
function extractXlsx(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const sharedRaw = zipPart(zip, 'xl/sharedStrings.xml') ?? '';
  const shared = [...sharedRaw.matchAll(/<si\b[\s\S]*?<\/si>/g)].map((m) => xmlText(m[0]));
  const sheets = zip.getEntries().filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
  const rows: string[] = [];
  for (const sheet of sheets) {
    if ((sheet.header?.size ?? 0) > PART_MAX) throw new Error('Lembar XLSX terlalu besar.');
    const xml = sheet.getData().toString('utf8');
    for (const row of xml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
      const cells = [...row[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map((cell) => {
        const address = /\br="([^"]+)"/.exec(cell[1])?.[1] ?? '';
        const value = /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1];
        const inline = /<is\b[\s\S]*?<\/is>/.exec(cell[2])?.[0];
        const resolved = /\bt="s"/.test(cell[1]) && value != null ? (shared[Number(value)] ?? value) : inline ? xmlText(inline) : value ?? '';
        return (address ? address + '=' : '') + decodeXml(resolved);
      }).filter((value) => value.trim() !== '');
      if (cells.length) rows.push(cells.join(' | '));
      if (rows.join('\n').length > TEXT_MAX) break;
    }
    if (rows.join('\n').length > TEXT_MAX) break;
  }
  return rows.join('\n') || shared.join('\n');
}
function extractPptx(buffer: Buffer): string {
  const slides = new AdmZip(buffer).getEntries()
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
  return slides.map((entry) => {
    if ((entry.header?.size ?? 0) > PART_MAX) throw new Error('Slide PPTX terlalu besar.');
    const text = xmlText(entry.getData().toString('utf8'));
    return text ? '[' + entry.entryName + ']\n' + text : '';
  }).filter(Boolean).join('\n\n');
}
function decodePdfLiteral(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\') { out += raw[i]; continue; }
    const next = raw[++i];
    if (next === undefined) break;
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (/[0-7]/.test(next)) {
      let octal = next;
      while (octal.length < 3 && /[0-7]/.test(raw[i + 1] ?? '')) octal += raw[++i];
      out += String.fromCharCode(parseInt(octal, 8));
    } else out += next;
  }
  return out;
}
function pdfOperators(source: string): string {
  const chunks: string[] = [];
  for (const match of source.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj\b/g)) chunks.push(decodePdfLiteral(match[1]));
  for (const match of source.matchAll(/\[((?:.|\r|\n)*?)\]\s*TJ\b/g)) {
    for (const literal of match[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) chunks.push(decodePdfLiteral(literal[1]));
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}
function extractPdf(buffer: Buffer): string {
  const source = buffer.toString('latin1');
  const results: string[] = [];
  for (const match of source.matchAll(/<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let data = Buffer.from(match[2], 'latin1');
    if (/\/FlateDecode\b/.test(match[1])) {
      try { data = inflateSync(data); } catch { continue; }
    } else if (/\/Filter\b/.test(match[1])) continue;
    const text = pdfOperators(data.toString('latin1'));
    if (text) results.push(text);
  }
  if (!results.length) {
    const fallback = pdfOperators(source);
    if (fallback) results.push(fallback);
  }
  return results.join('\n');
}
function parseFile(ext: string, mime: string, buffer: Buffer): { text?: string; dataUrl?: string } {
  if (imageExts.has(ext)) {
    if (buffer.length > IMAGE_MAX) throw new Error('Ukuran foto maksimal 12 MiB.');
    const valid = (ext === '.png' && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
      || (['.jpg','.jpeg'].includes(ext) && buffer[0] === 255 && buffer[1] === 216)
      || (ext === '.gif' && buffer.subarray(0, 3).toString() === 'GIF')
      || (ext === '.webp' && buffer.subarray(8, 12).toString() === 'WEBP');
    if (!valid) throw new Error('Signature file gambar tidak valid: ' + ext);
    return { dataUrl: 'data:' + mime + ';base64,' + buffer.toString('base64') };
  }
  if (textExts.has(ext)) {
    if (buffer.length > PART_MAX) throw new Error('File teks terlalu besar.');
    if (buffer.includes(0)) throw new Error('File tampak biner, bukan teks biasa.');
    return { text: boundedText(buffer.toString('utf8')) };
  }
  if (ext === '.pdf') {
    const text = boundedText(extractPdf(buffer));
    return { text: text || '[Teks PDF tidak dapat diekstrak. Jika PDF hasil scan, OCR belum tersedia; kirim screenshot halaman terkait.]' };
  }
  if (ext === '.docx') return { text: boundedText(extractDocx(buffer)) };
  if (ext === '.xlsx') return { text: boundedText(extractXlsx(buffer)) };
  if (ext === '.pptx') return { text: boundedText(extractPptx(buffer)) };
  throw new Error('Format file belum didukung: ' + ext);
}
export async function prepareAgentAttachments(filePaths: string[]): Promise<AgentAttachmentRef[]> {
  prune();
  if (filePaths.length > 10) throw new Error('Maksimal 10 lampiran per pesan.');
  const files = await Promise.all(filePaths.map(async (path) => ({ path, info: await stat(path) })));
  if (files.some((file) => !file.info.isFile())) throw new Error('Hanya file biasa yang dapat dilampirkan.');
  if (files.some((file) => file.info.size > FILE_MAX)) throw new Error('Ukuran setiap lampiran maksimal 25 MiB.');
  if (files.reduce((total, file) => total + file.info.size, 0) > BATCH_MAX) throw new Error('Total lampiran maksimal 50 MiB.');
  const parsed: Stored[] = [];
  for (const { path, info } of files) {
    const ext = extname(path).toLowerCase();
    const mime = MIME[ext];
    if (!mime) throw new Error('Format "' + basename(path) + '" belum didukung.');
    parsed.push({ id: 'att-' + randomUUID(), name: basename(path), mimeType: mime, size: info.size, ...parseFile(ext, mime, await readFile(path)), expiresAt: Date.now() + TTL });
  }
  const adding = parsed.reduce((total, item) => total + (item.dataUrl ? Math.floor(item.dataUrl.length * 0.75) : (item.text?.length ?? 0) * 2), 0);
  if (memoryUse() + adding > STORE_MAX) throw new Error('Memori lampiran mencapai batas 100 MiB. Mulai sesi AI baru sebelum melampirkan lagi.');
  for (const item of parsed) records.set(item.id, item);
  return parsed.map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size }));
}
export function resolveAgentAttachments(refs: AgentAttachmentRef[]): ResolvedAgentAttachment[] {
  prune();
  return refs.flatMap((ref) => {
    const item = records.get(ref.id);
    if (!item || item.name !== ref.name || item.size !== ref.size) return [];
    return [{ id: item.id, name: item.name, mimeType: item.mimeType, size: item.size, text: item.text, dataUrl: item.dataUrl }];
  });
}
