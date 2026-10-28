// Agent runtime untuk Ruang Kerja.
// Coding agent memakai OpenAI-compatible tool calling melalui 9router.
// File tools dikunci pada workspace; command terminal wajib disetujui pengguna.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { app } from 'electron';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import * as pty from '@lydell/node-pty';
import type { IPty } from '@lydell/node-pty';
import type { AgentEntry, AgentEvent, ChatMessage, RouterConfig } from '../../shared/agents';

type EmitAgentEvent = (event: AgentEvent, sessionId: string) => void;

export interface AgentService {
  listAgents(): AgentEntry[];
  getAgent(id: string): AgentEntry | null;
  startChat(agentId: string, projectPath: string | null, onEvent: EmitAgentEvent, messages?: ChatMessage[], activePath?: string | null): Promise<string>;
  startCli(agentId: string, projectPath: string, cols: number, rows: number, onEvent: EmitAgentEvent): Promise<string>;
  sendInput(sessionId: string, data: string): Promise<void>;
  resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void>;
  approveTool(sessionId: string, requestId: string, approved: boolean): Promise<void>;
  stopAgent(sessionId: string): Promise<void>;
  disposeAll(): void;
}

interface CliSession {
  id: string;
  agent: AgentEntry;
  pty: IPty;
  onEvent: EmitAgentEvent;
  killed: boolean;
}
interface LlmSession {
  id: string;
  agent: AgentEntry;
  controller: AbortController;
  onEvent: EmitAgentEvent;
  killed: boolean;
}
interface ToolCall { id: string; name: string; arguments: string }
interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
interface PendingApproval {
  resolve: (approved: boolean) => void;
  timeout: NodeJS.Timeout;
}

const DEFAULT_ENDPOINT = 'https://rbxludp.abc-tunnel.us/v1';
const DEFAULT_FALLBACK_ENDPOINT = 'http://localhost:20128/v1';
const DEFAULT_MODEL = 'ps/poolside/laguna-s-2.1(high)';
const MAX_AGENT_STEPS = 8;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_TOOL_OUTPUT = 18_000;
const COMMAND_TIMEOUT_MS = 120_000;
const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.turbo',
  '.cache', 'coverage', '.venv', 'venv', '__pycache__', '.idea',
  '.vscode', 'release', 'vendor', 'target',
]);
const SENSITIVE_NAME = /(?:^\.env(?:$|\.)|(?:^|[._-])(?:secret|secrets|credential|credentials|token|private[_-]?key)(?:[._-]|$)|(?:^|[\\/])id_rsa$|\.(?:pem|pfx|key)$)/i;

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_project_files',
      description: 'Daftar file dan folder dalam workspace project. Path relatif ke root project. Gunakan untuk memahami struktur proyek sebelum mengedit.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Folder relatif; default ".".' } }, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_project_file',
      description: 'Baca isi file teks dalam workspace. File sensitif seperti .env dan private key tidak bisa dibaca.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_project_file',
      description: 'Tulis atau ganti isi file dalam workspace project. Baca file terkait dahulu. Path harus relatif ke root proyek.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string', description: 'Isi lengkap file yang akan disimpan.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_project_files',
      description: 'Cari teks di dalam file project, dengan folder dependency/build dan file sensitif dikecualikan.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          path: { type: 'string', description: 'Folder awal relatif; default ".".' },
          case_sensitive: { type: 'boolean' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_terminal',
      description: 'Jalankan command dalam root proyek. Jelaskan alasan. Sistem akan menampilkan command dan meminta persetujuan pengguna terlebih dahulu.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command lengkap yang ingin dijalankan.' },
          reason: { type: 'string', description: 'Alasan mengapa command dibutuhkan.' },
        },
        required: ['command', 'reason'],
        additionalProperties: false,
      },
    },
  },
];

function emit(session: { id: string; onEvent: EmitAgentEvent }, event: AgentEvent): void {
  try { session.onEvent(event, session.id); } catch { /* renderer may have closed */ }
}

function buildAgentEnv(projectPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TERM: process.platform === 'win32' ? 'xterm' : 'xterm-256color',
    COLORTERM: 'truecolor',
    GITHUB_WORKSPACE: projectPath,
    EDITOR_PROJECT_PATH: projectPath,
  };
}

function findCliBinary(command: string): string | null {
  if (!command) return null;
  const exe = command.split(/[ \t]/)[0];
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    if (localAppData) {
      candidates.push(join(localAppData, 'Programs', exe, exe + '.exe'));
      candidates.push(join(localAppData, exe, exe + '.exe'));
      candidates.push(join(localAppData, 'Google', exe, exe + '.exe'));
    }
    const programFiles = process.env.ProgramFiles ?? '';
    if (programFiles) candidates.push(join(programFiles, exe, exe + '.exe'));
  } else {
    candidates.push('/usr/local/bin/' + exe, '/usr/bin/' + exe);
    candidates.push(join(homedir(), '.local', 'bin', exe), join(homedir(), '.cargo', 'bin', exe));
  }
  for (const candidate of candidates) {
    try { if (existsSync(candidate) && statSync(candidate).isFile()) return candidate; } catch { /* try next */ }
  }

  const checkCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = spawnSync(checkCmd, [exe], { windowsHide: true, encoding: 'utf8' });
    if (result.status === 0) {
      const found = result.stdout.trim().split(/\r?\n/)[0]?.trim();
      if (found && existsSync(found)) return found;
    }
  } catch { /* CLI mode is optional */ }
  return null;
}

function isSensitive(pathValue: string): boolean {
  return pathValue.split(/[\\/]/).some((part) => SENSITIVE_NAME.test(part));
}
function isIgnoredDir(name: string): boolean { return IGNORED_DIRS.has(name); }

function assertWithinRoot(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === '' || rel === '.') return;
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error('Path ditolak: tool AI hanya boleh bekerja di dalam folder proyek.');
  }
}

async function resolveWorkspacePath(rootPath: string, requestedPath: string, allowMissing = false): Promise<{ root: string; target: string; rel: string }> {
  const root = await realpath(rootPath);
  const raw = (requestedPath || '.').trim() || '.';
  const target = resolve(root, raw);
  assertWithinRoot(root, target);
  const rel = relative(root, target).split(sep).join('/');
  if (isSensitive(rel) && rel !== '.') {
    throw new Error('Akses ditolak untuk file yang berpotensi berisi secret atau kredensial.');
  }

  try {
    const actual = await realpath(target);
    assertWithinRoot(root, actual);
    return { root, target: actual, rel };
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    let parent = dirname(target);
    while (parent !== root && parent !== dirname(parent)) {
      try {
        const parentInfo = await lstat(parent);
        if (parentInfo.isSymbolicLink()) throw new Error('Path ditolak: folder induk menggunakan symbolic link.');
        parent = dirname(parent);
      } catch (parentError) {
        if ((parentError as NodeJS.ErrnoException).code !== 'ENOENT') throw parentError;
        parent = dirname(parent);
      }
      if (parent === '.' || parent === dirname(parent)) break;
    }
    return { root, target, rel };
  }
}

async function listProjectFiles(root: string, requestedPath: string): Promise<string> {
  const resolved = await resolveWorkspacePath(root, requestedPath || '.');
  const output: string[] = [];
  const maxEntries = 350;
  const maxDepth = 4;

  async function walk(directory: string, depth: number): Promise<void> {
    if (output.length >= maxEntries) return;
    const items = await readdir(directory, { withFileTypes: true });
    items.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const item of items) {
      if (output.length >= maxEntries) break;
      if (item.isSymbolicLink() || isSensitive(item.name)) continue;
      if (item.isDirectory() && isIgnoredDir(item.name)) continue;
      const absolute = join(directory, item.name);
      const rel = relative(resolved.root, absolute).split(sep).join('/');
      output.push('  '.repeat(depth) + (item.isDirectory() ? 'DIR  ' : 'FILE ') + rel);
      if (item.isDirectory() && depth < maxDepth) {
        try { await walk(absolute, depth + 1); } catch { /* inaccessible subfolder: continue the inventory */ }
      }
    }
  }

  await walk(resolved.target, 0);
  if (output.length >= maxEntries) output.push('... inventory dipotong pada ' + maxEntries + ' entri');
  return output.length > 0 ? output.join('\n') : '(folder kosong)';
}

async function readProjectFile(root: string, requestedPath: string): Promise<string> {
  const resolved = await resolveWorkspacePath(root, requestedPath);
  const info = await stat(resolved.target);
  if (!info.isFile()) throw new Error('Path bukan file.');
  if (info.size > MAX_READ_BYTES) throw new Error('File terlalu besar untuk dibaca langsung (maksimum 1 MB).');
  return (await readFile(resolved.target, 'utf8')).slice(0, MAX_READ_BYTES);
}

function lineChangeCounts(oldContent: string, newContent: string): { addedLines: number; removedLines: number } {
  const oldLines = oldContent.replace(/\r\n/g, '\n').split('\n');
  const newLines = newContent.replace(/\r\n/g, '\n').split('\n');
  if (oldContent.length === 0) return { addedLines: newContent.length === 0 ? 0 : newLines.filter((line, i) => i < newLines.length - 1 || line !== '').length, removedLines: 0 };
  if (newContent.length === 0) return { addedLines: 0, removedLines: oldLines.filter((line, i) => i < oldLines.length - 1 || line !== '').length };

  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;

  const a = oldLines.slice(prefix, oldLines.length - suffix);
  const b = newLines.slice(prefix, newLines.length - suffix);
  if (a.length * b.length > 1_000_000) return { addedLines: b.length, removedLines: a.length };

  let previous = new Uint32Array(b.length + 1);
  for (let i = a.length - 1; i >= 0; i--) {
    const current = new Uint32Array(b.length + 1);
    for (let j = b.length - 1; j >= 0; j--) {
      current[j] = a[i] === b[j] ? previous[j + 1] + 1 : Math.max(previous[j], current[j + 1]);
    }
    previous = current;
  }
  const unchanged = previous[0];
  return { addedLines: b.length - unchanged, removedLines: a.length - unchanged };
}

interface WrittenFileChange {
  message: string;
  change: {
    path: string;
    operation: 'create' | 'modify';
    oldContent: string;
    newContent: string;
    addedLines: number;
    removedLines: number;
  } | null;
}

async function writeProjectFile(root: string, requestedPath: string, content: string): Promise<WrittenFileChange> {
  const resolved = await resolveWorkspacePath(root, requestedPath, true);
  if (resolved.rel === '.') throw new Error('Path harus menunjuk ke file, bukan root folder.');
  if (isSensitive(resolved.rel)) throw new Error('Menulis file sensitif diblokir untuk mencegah pengubahan kredensial oleh agent.');
  if (content.length > 1_000_000) throw new Error('Isi file terlalu besar; batas tulis adalah 1 MB.');
  await mkdir(dirname(resolved.target), { recursive: true });
  const actualParent = await realpath(dirname(resolved.target));
  assertWithinRoot(resolved.root, actualParent);
  const existing = await lstat(resolved.target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing?.isSymbolicLink()) throw new Error('Menulis melalui symbolic link ditolak.');
  if (existing && !existing.isFile()) throw new Error('Path target bukan file biasa.');

  const oldContent = existing ? await readFile(resolved.target, 'utf8') : '';
  if (oldContent === content) {
    return { message: 'Tidak ada perubahan: ' + resolved.rel + ' sudah memiliki isi yang sama.', change: null };
  }
  await writeFile(resolved.target, content, 'utf8');
  const counts = lineChangeCounts(oldContent, content);
  return {
    message: (existing ? 'File diperbarui: ' : 'File dibuat: ') + resolved.rel +
      ' (+' + counts.addedLines + ' / -' + counts.removedLines + ' baris).',
    change: {
      path: resolved.rel,
      operation: existing ? 'modify' : 'create',
      oldContent,
      newContent: content,
      ...counts,
    },
  };
}

async function searchProjectFiles(root: string, query: string, requestedPath: string, caseSensitive: boolean): Promise<string> {
  const needle = query.trim();
  if (!needle) throw new Error('Query pencarian tidak boleh kosong.');
  const start = await resolveWorkspacePath(root, requestedPath || '.');
  const matchNeedle = caseSensitive ? needle : needle.toLowerCase();
  const results: string[] = [];
  let visited = 0;
  const MAX_FILES = 1800;
  const MAX_HITS = 50;

  async function walk(directory: string): Promise<void> {
    if (visited >= MAX_FILES || results.length >= MAX_HITS) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (visited >= MAX_FILES || results.length >= MAX_HITS) break;
      if (entry.isSymbolicLink() || isSensitive(entry.name)) continue;
      if (entry.isDirectory()) {
        if (!isIgnoredDir(entry.name)) await walk(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      visited += 1;
      const fullPath = join(directory, entry.name);
      try {
        const info = await stat(fullPath);
        if (info.size > 300_000) continue;
        const content = await readFile(fullPath, 'utf8');
        const lines = content.split(/\r?\n/);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = caseSensitive ? lines[lineIndex] : lines[lineIndex].toLowerCase();
          if (line.includes(matchNeedle)) {
            const rel = relative(start.root, fullPath).split(sep).join('/');
            results.push(rel + ':' + (lineIndex + 1) + ': ' + lines[lineIndex].slice(0, 300));
            if (results.length >= MAX_HITS) break;
          }
        }
      } catch { /* skip unreadable or binary files */ }
    }
  }

  await walk(start.target);
  if (results.length === 0) return 'Tidak ditemukan. File diperiksa: ' + visited + '.';
  if (visited >= MAX_FILES) results.push('Pencarian dibatasi pada ' + MAX_FILES + ' file.');
  if (results.length >= MAX_HITS) results.push('Hasil dibatasi pada ' + MAX_HITS + ' kecocokan.');
  return results.join('\n');
}

function askForCommandApproval(session: LlmSession, command: string, reason: string, approvals: Map<string, PendingApproval>): Promise<boolean> {
  const requestId = randomUUID();
  const key = session.id + ':' + requestId;
  return new Promise<boolean>((resolveApproval) => {
    const timeout = setTimeout(() => {
      const pending = approvals.get(key);
      if (!pending) return;
      approvals.delete(key);
      pending.resolve(false);
    }, 120_000);
    approvals.set(key, { resolve: resolveApproval, timeout });
    emit(session, { type: 'permission-request', requestId, command, reason });
  });
}

async function executeTerminalCommand(root: string, command: string): Promise<string> {
  const cleanCommand = command.trim();
  if (!cleanCommand) throw new Error('Command kosong.');
  if (cleanCommand.length > 2000) throw new Error('Command terlalu panjang (maksimum 2000 karakter).');

  return await new Promise<string>((resolveOutput, rejectOutput) => {
    const isWindows = process.platform === 'win32';
    const executable = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
    const args = isWindows ? ['/d', '/s', '/c', cleanCommand] : ['-lc', cleanCommand];
    let output = '';
    let settled = false;
    const append = (value: unknown) => { output = (output + String(value ?? '')).slice(-MAX_TOOL_OUTPUT); };
    const child = spawn(executable, args, {
      cwd: root, env: buildAgentEnv(root), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolveOutput('Command dihentikan karena melewati batas 120 detik.\n' + output);
    }, COMMAND_TIMEOUT_MS);
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectOutput(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveOutput('Exit code: ' + (code ?? 'unknown') + '\n' + (output || '(tidak ada output)'));
    });
  });
}

async function executeTool(
  session: LlmSession,
  root: string | null,
  call: ToolCall,
  approvals: Map<string, PendingApproval>,
): Promise<string> {
  if (!root) return 'Tool gagal: belum ada folder proyek yang terbuka.';
  let args: Record<string, unknown>;
  try { args = JSON.parse(call.arguments || '{}') as Record<string, unknown>; }
  catch { return 'Tool gagal: argumen dari model bukan JSON valid.'; }

  const stringArg = (name: string, fallback = ''): string => typeof args[name] === 'string' ? String(args[name]) : fallback;
  switch (call.name) {
    case 'list_project_files': {
      const path = stringArg('path', '.');
      emit(session, { type: 'activity', message: 'Memindai file: ' + path });
      return await listProjectFiles(root, path);
    }
    case 'read_project_file': {
      const path = stringArg('path');
      emit(session, { type: 'activity', message: 'Membaca file: ' + path });
      return await readProjectFile(root, path);
    }
    case 'write_project_file': {
      const path = stringArg('path');
      if (typeof args.content !== 'string') throw new Error('Isi file tidak diberikan.');
      emit(session, { type: 'activity', message: 'Menulis perubahan ke workspace: ' + path });
      const result = await writeProjectFile(root, path, args.content);
      if (result.change) {
        emit(session, {
          type: 'file-change',
          change: {
            id: randomUUID(),
            ...result.change,
            changedAt: Date.now(),
          },
        });
      }
      return result.message;
    }
    case 'search_project_files': {
      const query = stringArg('query');
      emit(session, { type: 'activity', message: 'Mencari: ' + query });
      return await searchProjectFiles(root, query, stringArg('path', '.'), args.case_sensitive === true);
    }
    case 'run_terminal': {
      const command = stringArg('command').trim();
      const reason = stringArg('reason', 'Agent meminta menjalankan command.');
      if (!command) return 'Command kosong; tidak dijalankan.';
      emit(session, { type: 'activity', message: 'Menunggu persetujuan command terminal…' });
      const approved = await askForCommandApproval(session, command, reason, approvals);
      if (!approved) {
        emit(session, { type: 'activity', message: 'Command ditolak atau waktu persetujuan habis.' });
        return 'Pengguna menolak atau tidak menyetujui command dalam 2 menit. Jangan ulangi tanpa meminta persetujuan baru.';
      }
      emit(session, { type: 'activity', message: 'Menjalankan command: ' + command });
      return await executeTerminalCommand(root, command);
    }
    default:
      return 'Tool tidak dikenal: ' + call.name;
  }
}

async function openCompletionStream(
  config: RouterConfig,
  session: LlmSession,
  messages: Array<Record<string, unknown>>,
  toolChoice: 'auto' | 'required' = 'auto',
): Promise<Response> {
  const endpoints = [...new Set([
    session.agent.endpoint || config.endpoint || DEFAULT_ENDPOINT,
    config.fallbackEndpoint || DEFAULT_FALLBACK_ENDPOINT,
  ].map((url) => url.replace(/\/+$/, '')))];
  let lastError = 'Endpoint 9router tidak dapat diakses.';

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + config.apiKey,
          'User-Agent': 'RuangKerja-Agent/0.4.8',
        },
        body: JSON.stringify({
          model: session.agent.model || config.models[0] || DEFAULT_MODEL,
          messages,
          tools: TOOL_DEFINITIONS,
          tool_choice: toolChoice,
          stream: true,
          max_tokens: 6144,
          temperature: 0.2,
        }),
        signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(120_000)]),
      });
      if (response.ok) return response;
      const body = (await response.text()).slice(0, 500);
      lastError = 'HTTP ' + response.status + (body ? ': ' + body : '');
      // Try the secondary endpoint even for HTTP errors: routers can differ in model/tool support.
    } catch (error) {
      if (session.controller.signal.aborted || session.killed) throw error;
      lastError = (error as Error).message || 'Koneksi gagal.';
    }
  }

  throw new Error('9router tidak dapat memproses permintaan. ' + lastError + '. Periksa endpoint, koneksi, dan API key di Pengaturan AI.');
}

async function readCompletion(response: Response, session: LlmSession): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response 9router tidak memiliki stream body.');
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let doneSignal = false;
  const calls = new Map<number, ToolCall>();

  const processSseLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') { doneSignal = true; return; }

    let payload: {
      choices?: Array<{
        delta?: {
          content?: string | Array<{ type?: string; text?: string }>;
          tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    try { payload = JSON.parse(data) as typeof payload; } catch { return; }

    const delta = payload.choices?.[0]?.delta;
    const deltaContent = delta?.content;
    if (typeof deltaContent === 'string' && deltaContent) {
      content += deltaContent;
      emit(session, { type: 'output', data: deltaContent });
    } else if (Array.isArray(deltaContent)) {
      for (const part of deltaContent) {
        if (part?.type === 'text' && part.text) {
          content += part.text;
          emit(session, { type: 'output', data: part.text });
        }
      }
    }

    for (const item of delta?.tool_calls ?? []) {
      const index = Number.isInteger(item.index) ? Number(item.index) : calls.size;
      const call = calls.get(index) ?? { id: '', name: '', arguments: '' };
      if (item.id) call.id = item.id;
      if (item.function?.name) call.name += item.function.name;
      if (item.function?.arguments) call.arguments += item.function.arguments;
      calls.set(index, call);
    }
  };

  try {
    while (!doneSignal && !session.killed) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        processSseLine(buffer.slice(0, newline).replace(/\r$/, ''));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }
    if (buffer.trim()) processSseLine(buffer);
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
    reader.releaseLock();
  }

  return {
    content,
    toolCalls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map((entry) => ({
      id: entry[1].id || ('tool_' + randomUUID()),
      name: entry[1].name,
      arguments: entry[1].arguments,
    })),
  };
}

export function createAgentService(getRouterConfig: () => RouterConfig | null): AgentService {
  const { BUILTIN_AGENTS } = require('../../shared/agents') as typeof import('../../shared/agents');
  const agents = new Map<string, AgentEntry>(BUILTIN_AGENTS.map((agent) => [agent.id, { ...agent }]));
  const cliSessions = new Map<string, CliSession>();
  const llmSessions = new Map<string, LlmSession>();
  const pendingApprovals = new Map<string, PendingApproval>();
  let tearingDown = false;

  const settlePending = (sessionId: string, approved: boolean): void => {
    for (const [key, item] of pendingApprovals) {
      if (!key.startsWith(sessionId + ':')) continue;
      clearTimeout(item.timeout);
      pendingApprovals.delete(key);
      item.resolve(approved);
    }
  };

  async function runLlmAgent(session: LlmSession, projectPath: string | null, inputMessages: ChatMessage[], activePath: string | null): Promise<void> {
    const config = getRouterConfig();
    try {
      if (!config?.apiKey) throw new Error('API key 9router belum disetel. Buka Pengaturan AI dan masukkan API key yang valid.');
      if (session.agent.type !== 'llm-chat') throw new Error(session.agent.name + ' adalah CLI eksternal. Pilih Poolside untuk chat coding bawaan.');
      if (!projectPath) throw new Error('Belum ada folder proyek. Buka atau buat ruangan terlebih dahulu.');
      const root = await realpath(projectPath);
      const inventory = await listProjectFiles(root, '.');
      let activeFileContext = '';
      if (activePath) {
        try {
          const active = await resolveWorkspacePath(root, activePath);
          if (!isSensitive(active.rel)) {
            const text = await readProjectFile(root, activePath);
            activeFileContext = '\n\nFile yang sedang dipilih di editor (' + active.rel + '):\n' +
              '```\n' + text.slice(0, 16_000) + (text.length > 16_000 ? '\n[isi dipotong pada 16 KB]' : '') + '\n```';
          }
        } catch (error) {
          activeFileContext = '\n\nCatatan: file yang sedang dipilih tidak dapat dibaca langsung: ' + ((error as Error).message || 'unknown error');
        }
      }
      const systemPrompt = [
        session.agent.systemPrompt,
        'Workspace aktif: ' + root,
        'Kamu adalah agent coding tool-using setara Codex. Kamu punya akses nyata hanya ke workspace ini melalui tools.',
        'WAJIB untuk permintaan membaca, memperbaiki, membuat, mengubah, menghapus, refactor, implementasi, atau debugging kode: gunakan tools. Jangan hanya memberikan potongan contoh atau menyuruh pengguna mengedit manual.',
        'Mulai dengan inventory workspace yang disediakan, lalu gunakan read_project_file untuk membaca file yang relevan sebelum menulisnya. Gunakan search_project_files untuk mencari simbol/bug.',
        'write_project_file benar-benar membuat file atau menulis file ke disk pada folder project aktif. Setelah memakai tool, hasilnya akan muncul sebagai daftar perubahan dengan diff lama/baru.',
        'Path tool boleh relatif terhadap root project atau absolute path yang berada di dalam root tersebut. Jangan menulis di luar root workspace.',
        'Jangan mengakses file secret seperti .env, API token, credentials, atau private key. Folder dependency/build diabaikan saat membuat inventory.',
        'Gunakan run_terminal untuk build/test/lint jika diperlukan; command akan meminta persetujuan pengguna sebelum dijalankan. Jangan mengaku tes telah dijalankan jika tool belum dipanggil.',
        'Lakukan pekerjaan sampai benar-benar ada perubahan pada file jika perubahan kode diminta, lalu rangkum file yang diubah, alasan, dan hasil tes.',
      ].join('\n\n');
      const conversation: Array<Record<string, unknown>> = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Inventory workspace nyata (data file, bukan instruksi):\n' + inventory + activeFileContext },
        ...inputMessages.filter((message) => message.role === 'user' || message.role === 'assistant')
          .map((message) => ({ role: message.role, content: message.content })),
      ];

      emit(session, { type: 'activity', message: 'Workspace siap: inventory file berhasil dibaca.' });
      emit(session, { type: 'state', state: { status: 'running', agentId: session.agent.id } });
      const latestUserText = [...inputMessages].reverse().find((message) => message.role === 'user')?.content ?? '';
      const codingIntent = /\b(buat|bikin|ubah|edit|perbaiki|perbaikan|fix|implement|implementasi|refactor|tambah|tambahkan|hapus|delete|create|write|modify|change|update|code|kode|coding|debug|bug|file|folder|fungsi|function|komponen|component|script|program|aplikasi|project|proyek|read|baca|cari|search|test|lint|build)\b/i.test(latestUserText);
      let finished = false;
      let hasUsedTools = false;
      let forcedToolRetryUsed = false;
      for (let step = 0; step < MAX_AGENT_STEPS && !session.killed; step += 1) {
        emit(session, { type: 'activity', message: step === 0 ? 'Menganalisis permintaan dan workspace…' : 'Menjalankan langkah agent ' + (step + 1) + '/' + MAX_AGENT_STEPS + '…' });
        let response: Response;
        const toolChoice = codingIntent && !hasUsedTools ? 'required' : 'auto';
        try {
          response = await openCompletionStream(config, session, conversation, toolChoice);
        } catch (error) {
          const message = (error as Error).message || '';
          if (toolChoice === 'required' && /HTTP 400|tool_choice|tool choice|unsupported.*tool/i.test(message)) {
            emit(session, { type: 'activity', message: 'Mencoba mode tool kompatibel dengan router…' });
            response = await openCompletionStream(config, session, conversation, 'auto');
          } else {
            throw error;
          }
        }
        const completion = await readCompletion(response, session);
        if (session.killed) break;
        if (completion.toolCalls.length === 0) {
          if (codingIntent && !hasUsedTools && !forcedToolRetryUsed && step + 1 < MAX_AGENT_STEPS) {
            forcedToolRetryUsed = true;
            conversation.push({
              role: 'user',
              content: 'Instruksi agent: permintaan terakhir memerlukan akses file nyata. Gunakan list_project_files/read_project_file/search_project_files terlebih dahulu, lalu write_project_file jika perubahan diminta. Panggil tool sekarang, jangan jawab dengan penjelasan tanpa bertindak.',
            });
            continue;
          }
          if (codingIntent && !hasUsedTools) {
            emit(session, { type: 'error', message: 'Model tidak memanggil tool workspace, jadi file belum diubah. Periksa dukungan tool-calling pada endpoint/model 9router atau gunakan endpoint cadangan.' });
          }
          finished = true;
          break;
        }

        hasUsedTools = true;
        conversation.push({
          role: 'assistant',
          content: completion.content || null,
          tool_calls: completion.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments || '{}' },
          })),
        });

        for (const call of completion.toolCalls) {
          if (session.killed) break;
          let result: string;
          try { result = await executeTool(session, root, call, pendingApprovals); }
          catch (error) { result = 'Tool gagal: ' + ((error as Error).message || 'kesalahan tidak diketahui'); }
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: result.slice(0, MAX_TOOL_OUTPUT),
          });
        }
      }

      if (!session.killed && !finished) {
        emit(session, { type: 'output', data: '\n\nBatas langkah agent tercapai. Periksa perubahan dan kirim instruksi lanjutan untuk meneruskan pekerjaan.' });
      }
      if (!session.killed) emit(session, { type: 'state', state: { status: 'stopped', agentId: session.agent.id } });
    } catch (error) {
      if (!session.killed && !session.controller.signal.aborted) {
        const message = (error as Error).message || 'Agent gagal dijalankan.';
        emit(session, { type: 'error', message });
        emit(session, { type: 'state', state: { status: 'error', agentId: session.agent.id, error: message } });
      }
    } finally {
      llmSessions.delete(session.id);
      settlePending(session.id, false);
    }
  }

  return {
    listAgents(): AgentEntry[] { return [...agents.values()].map((agent) => ({ ...agent })); },
    getAgent(id: string): AgentEntry | null { return agents.get(id) ?? null; },

    async startChat(agentId, projectPath, onEvent, messages = [], activePath = null): Promise<string> {
      const agent = agents.get(agentId);
      if (!agent) throw new Error('Agent tidak ditemukan: ' + agentId);
      const session: LlmSession = {
        id: 'llm_' + randomUUID(),
        agent,
        controller: new AbortController(),
        onEvent,
        killed: false,
      };
      llmSessions.set(session.id, session);
      emit(session, { type: 'state', state: { status: 'starting', agentId: agent.id } });
      setImmediate(() => { void runLlmAgent(session, projectPath, messages, activePath); });
      return session.id;
    },

    async startCli(agentId, projectPath, cols, rows, onEvent): Promise<string> {
      const agent = agents.get(agentId);
      if (!agent) throw new Error('Agent tidak ditemukan: ' + agentId);
      if (agent.type !== 'cli' || !agent.cliCommand?.length) {
        throw new Error(agent.name + ' tidak mendukung mode CLI.');
      }
      const cliPath = findCliBinary(agent.cliCommand[0]);
      if (!cliPath) throw new Error('CLI ' + agent.cliCommand[0] + ' tidak ditemukan di PATH. Pasang ' + agent.name + ' terlebih dahulu.');
      const sessionId = 'cli_' + randomUUID();
      let handle: IPty;
      try {
        handle = pty.spawn(cliPath, agent.cliCommand.slice(1), {
          name: 'xterm-256color',
          cols: Math.max(1, cols),
          rows: Math.max(1, rows),
          cwd: projectPath,
          env: buildAgentEnv(projectPath) as Record<string, string>,
        });
      } catch (error) {
        throw new Error('Gagal memulai ' + agent.name + ': ' + (error as Error).message);
      }
      const cliSession: CliSession = { id: sessionId, agent, pty: handle, onEvent, killed: false };
      cliSessions.set(sessionId, cliSession);
      emit(cliSession, { type: 'state', state: { status: 'running', agentId: agent.id } });
      handle.onData((data: string) => {
        if (!cliSession.killed && !tearingDown && cliSessions.get(sessionId) === cliSession) emit(cliSession, { type: 'output', data });
      });
      handle.onExit(({ exitCode }) => {
        if (cliSession.killed) return;
        cliSession.killed = true;
        cliSessions.delete(sessionId);
        emit(cliSession, { type: 'exit', code: typeof exitCode === 'number' ? exitCode : 0 });
        emit(cliSession, { type: 'state', state: { status: 'stopped', agentId: agent.id } });
      });
      return sessionId;
    },

    async sendInput(sessionId, data): Promise<void> {
      const cli = cliSessions.get(sessionId);
      if (cli && !cli.killed) cli.pty.write(data);
    },
    async resizeTerminal(sessionId, cols, rows): Promise<void> {
      const cli = cliSessions.get(sessionId);
      if (cli && !cli.killed) {
        try { cli.pty.resize(Math.max(1, cols), Math.max(1, rows)); } catch { /* terminal may be closing */ }
      }
    },
    async approveTool(sessionId, requestId, approved): Promise<void> {
      const key = sessionId + ':' + requestId;
      const pending = pendingApprovals.get(key);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingApprovals.delete(key);
      pending.resolve(approved);
    },
    async stopAgent(sessionId): Promise<void> {
      const llm = llmSessions.get(sessionId);
      if (llm) {
        llm.killed = true;
        llm.controller.abort();
        settlePending(sessionId, false);
        emit(llm, { type: 'state', state: { status: 'stopped', agentId: llm.agent.id } });
        return;
      }
      const cli = cliSessions.get(sessionId);
      if (!cli) return;
      cli.killed = true;
      cliSessions.delete(sessionId);
      try { cli.pty.kill(); } catch { /* process may have exited */ }
      if (process.platform === 'win32') {
        try {
          const killer = spawn('taskkill', ['/PID', String(cli.pty.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => undefined);
        } catch { /* best effort */ }
      }
    },
    disposeAll(): void {
      tearingDown = true;
      for (const session of cliSessions.values()) {
        session.killed = true;
        try { session.pty.kill(); } catch { /* ignore */ }
      }
      cliSessions.clear();
      for (const session of llmSessions.values()) {
        session.killed = true;
        session.controller.abort();
        settlePending(session.id, false);
      }
      llmSessions.clear();
      for (const pending of pendingApprovals.values()) clearTimeout(pending.timeout);
      pendingApprovals.clear();
      tearingDown = false;
    },
  };
}
