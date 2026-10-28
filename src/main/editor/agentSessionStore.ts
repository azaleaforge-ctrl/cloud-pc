import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { AgentCheckpointSummary, AgentFileChange, AgentTodo, ChatMessage } from '../../shared/agents';

const mutationLocks = new Map<string, Promise<void>>();
async function withSessionLock<T>(userDataDir: string, id: string, action: () => Promise<T>): Promise<T> {
  const key = sessionPath(userDataDir, id);
  const prior = mutationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const current = prior.catch(() => undefined).then(() => gate);
  mutationLocks.set(key, current);
  await prior.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (mutationLocks.get(key) === current) mutationLocks.delete(key);
  }
}

const SCHEMA_VERSION = 1;
const MAX_MESSAGES = 1000;
const MAX_MESSAGE_CHARS = 80_000;
const MAX_SESSION_BYTES = 20 * 1024 * 1024;
const MAX_CHECKPOINTS = 50;
const MAX_CHECKPOINT_FILES = 50;
const MAX_CHECKPOINT_BYTES = 8 * 1024 * 1024;
const MAX_SUMMARY_CHARS = 12_000;
const SENSITIVE_PATH = /(?:^|[\\/])\.env(?:$|\.)|(?:^|[._-])(?:secret|secrets|credential|credentials|token|private[_-]?key)(?:[._-]|$)|(?:^|[\\/])id_rsa$|\.(?:pem|pfx|key)$/i;

export interface AgentCheckpointFile {
  path: string;
  oldExists: boolean;
  oldContent: string;
  newContent: string;
  oldHash: string;
  newHash: string;
}
export interface AgentCheckpoint {
  id: string;
  runId: string;
  createdAt: number;
  projectPath: string;
  status: 'applied' | 'rewound';
  files: AgentCheckpointFile[];
}
export interface AgentSessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  projectPath: string | null;
  activeAgentId: string;
  messageCount: number;
  lastMessage?: string;
  hasSummary: boolean;
  checkpointCount: number;
}
export interface AgentSessionRecord extends AgentSessionSummary {
  schemaVersion: number;
  messages: ChatMessage[];
  summary: string;
  summaryThroughTs: number;
  todos: AgentTodo[];
  checkpoints: AgentCheckpoint[];
}
export interface AgentSessionSnapshot {
  id: string;
  title?: string;
  projectPath?: string | null;
  activeAgentId?: string;
  messages: ChatMessage[];
  summary?: string;
  summaryThroughTs?: number;
  todos?: AgentTodo[];
}
export interface CheckpointActionResult {
  ok: boolean;
  message: string;
  checkpoint?: AgentCheckpoint;
}

function sessionDirectory(userDataDir: string): string {
  return join(userDataDir, 'ai-sessions');
}
function sessionPath(userDataDir: string, id: string): string {
  validateSessionId(id);
  return join(sessionDirectory(userDataDir), id + '.json');
}
export function validateSessionId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
    throw new Error('ID sesi tidak valid.');
  }
}
function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
function summarySnippet(text: string, max = 420): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}
export function buildConversationSummary(
  previousSummary: string,
  messages: ChatMessage[],
  previousThroughTs = 0,
  keepRecent = 40,
): { summary: string; throughTs: number } {
  const eligible = messages.filter(message =>
    message.role !== 'system' && !message.streaming && message.ts > previousThroughTs,
  );
  const totalChars = eligible.reduce((sum, message) => sum + message.content.length, 0);
  const shouldCompact = eligible.length > keepRecent || totalChars > 80_000;
  if (!shouldCompact) return { summary: previousSummary, throughTs: previousThroughTs };
  const requestedKeepCount = totalChars > 80_000 ? Math.min(keepRecent, 12) : keepRecent;
  const keepCount = Math.min(requestedKeepCount, Math.max(1, eligible.length - 1));
  const older = eligible.slice(0, Math.max(0, eligible.length - keepCount));
  if (!older.length) return { summary: previousSummary, throughTs: previousThroughTs };
  const lines = older.map(message => {
    const role = message.role === 'user' ? 'User' : 'Assistant';
    const attachmentNames = message.attachments?.map(item => item.name).join(', ');
    return '- ' + role + ': ' + summarySnippet(message.content, 420) +
      (attachmentNames ? ' [lampiran: ' + summarySnippet(attachmentNames, 180) + ']' : '');
  });
  const batch = lines.join('\n');
  const combined = [previousSummary.trim(), 'Ringkasan percakapan terdahulu:\n' + batch].filter(Boolean).join('\n\n');
  return {
    summary: combined.length > MAX_SUMMARY_CHARS ? combined.slice(-MAX_SUMMARY_CHARS) : combined,
    throughTs: older[older.length - 1].ts,
  };
}
function compactStoredMessage(message: ChatMessage): ChatMessage {
  if (!message || typeof message !== 'object' ||
      !['system', 'user', 'assistant'].includes(message.role) ||
      typeof message.id !== 'string' || typeof message.content !== 'string' ||
      !Number.isFinite(message.ts)) {
    throw new Error('Format pesan sesi tidak valid.');
  }
  if (message.id.length > 200 || message.content.length > MAX_MESSAGE_CHARS) {
    throw new Error('Sebuah pesan melebihi batas ukuran penyimpanan sesi.');
  }
  const attachments = Array.isArray(message.attachments)
    ? message.attachments.slice(0, 10).map(item => ({
      id: String(item.id).slice(0, 200),
      name: String(item.name).slice(0, 260),
      mimeType: String(item.mimeType).slice(0, 160),
      size: Math.max(0, Math.min(Number(item.size) || 0, Number.MAX_SAFE_INTEGER)),
    }))
    : undefined;
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ts: message.ts,
    ...(attachments?.length ? { attachments } : {}),
  };
}
function summaryFor(record: AgentSessionRecord): AgentSessionSummary {
  const last = [...record.messages].reverse().find(message => message.role !== 'system');
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    projectPath: record.projectPath,
    activeAgentId: record.activeAgentId,
    messageCount: record.messages.length,
    ...(last?.content ? { lastMessage: summarySnippet(last.content, 160) } : {}),
    hasSummary: !!record.summary,
    checkpointCount: record.checkpoints.length,
  };
}
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(tempPath, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' });
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}
async function readRecord(userDataDir: string, id: string): Promise<AgentSessionRecord | null> {
  let raw: string;
  try { raw = await readFile(sessionPath(userDataDir, id), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_SESSION_BYTES) throw new Error('File sesi melebihi batas aman.');
  const record = JSON.parse(raw) as AgentSessionRecord;
  if (record.schemaVersion !== SCHEMA_VERSION || record.id !== id || !Array.isArray(record.messages) || !Array.isArray(record.checkpoints)) {
    throw new Error('Format file sesi tidak dikenal atau rusak.');
  }
  return record;
}
async function writeRecord(userDataDir: string, record: AgentSessionRecord): Promise<void> {
  const raw = JSON.stringify(record);
  if (Buffer.byteLength(raw, 'utf8') > MAX_SESSION_BYTES) {
    throw new Error('Riwayat sesi sudah mencapai batas penyimpanan 20 MB. Hapus sesi lama atau mulai sesi baru.');
  }
  await writeJsonAtomic(sessionPath(userDataDir, record.id), record);
}
function validateProjectPath(path: string | null | undefined): string | null {
  if (path == null || path === '') return null;
  if (typeof path !== 'string' || path.length > 4000 || path.includes('\0')) {
    throw new Error('Path workspace tidak valid.');
  }
  return path;
}

export async function listAgentSessions(userDataDir: string): Promise<AgentSessionSummary[]> {
  const dir = sessionDirectory(userDataDir);
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });
  const sessions: AgentSessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-zA-Z0-9_-]{1,100}\.json$/.test(entry.name)) continue;
    const id = entry.name.slice(0, -5);
    try {
      const record = await readRecord(userDataDir, id);
      if (record) sessions.push(summaryFor(record));
    } catch { /* Skip a damaged session index entry rather than blocking all history. */ }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function loadAgentSession(userDataDir: string, id: string): Promise<AgentSessionRecord | null> {
  validateSessionId(id);
  return readRecord(userDataDir, id);
}

function checkpointSummary(checkpoint: AgentCheckpoint): AgentCheckpointSummary {
  return {
    id: checkpoint.id,
    runId: checkpoint.runId,
    createdAt: checkpoint.createdAt,
    projectPath: checkpoint.projectPath,
    status: checkpoint.status,
    paths: checkpoint.files.map(item => item.path),
  };
}
export async function listAgentCheckpoints(userDataDir: string, id: string): Promise<AgentCheckpointSummary[]> {
  const record = await readRecord(userDataDir, id);
  return record ? [...record.checkpoints].sort((a, b) => b.createdAt - a.createdAt).map(checkpointSummary) : [];
}
export async function saveAgentSession(userDataDir: string, input: AgentSessionSnapshot): Promise<AgentSessionSummary> {
  return withSessionLock(userDataDir, input.id, async () => {
  validateSessionId(input.id);
  if (!Array.isArray(input.messages) || input.messages.length > MAX_MESSAGES) {
    throw new Error('Jumlah pesan sesi tidak valid (maksimal 1.000 pesan).');
  }
  const current = await readRecord(userDataDir, input.id);
  const now = Date.now();
  const messages = input.messages.map(compactStoredMessage);
  const compaction = buildConversationSummary(
    typeof input.summary === 'string' ? input.summary : current?.summary ?? '',
    messages,
    Number.isFinite(input.summaryThroughTs) ? Number(input.summaryThroughTs) : current?.summaryThroughTs ?? 0,
  );
  const firstUser = messages.find(message => message.role === 'user' && message.content.trim());
  const inferredTitle = firstUser ? summarySnippet(firstUser.content, 80) : 'Percakapan baru';
  const record: AgentSessionRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    title: typeof input.title === 'string' && input.title.trim()
      ? summarySnippet(input.title, 120)
      : current?.title && current.title !== 'Percakapan baru' ? current.title : inferredTitle,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    projectPath: validateProjectPath(input.projectPath !== undefined ? input.projectPath : current?.projectPath),
    activeAgentId: typeof input.activeAgentId === 'string' && input.activeAgentId.length <= 100
      ? input.activeAgentId : current?.activeAgentId ?? 'poolside',
    messages,
    summary: compaction.summary,
    summaryThroughTs: compaction.throughTs,
    todos: Array.isArray(input.todos) ? input.todos.slice(0, 200) : current?.todos ?? [],
    checkpoints: current?.checkpoints ?? [],
  };
  await writeRecord(userDataDir, record);
  return summaryFor(record);
  });
}
export async function deleteAgentSession(userDataDir: string, id: string): Promise<boolean> {
  return withSessionLock(userDataDir, id, async () => {
  await rm(sessionPath(userDataDir, id), { force: true });
  await rm(join(userDataDir, 'ai-memory', 'sessions', id + '.md'), { force: true }).catch(() => undefined);
  return true;
  });
}
function validateCheckpointRelativePath(path: string): string {
  if (!path || path.length > 2000 || isAbsolute(path) || path.includes('\0')) throw new Error('Path checkpoint tidak valid.');
  const normalized = path.replace(/[\\/]+/g, sep);
  const segments = normalized.split(sep);
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) throw new Error('Path checkpoint keluar dari workspace.');
  if (SENSITIVE_PATH.test(normalized)) throw new Error('Checkpoint file sensitif ditolak.');
  return normalized;
}
async function resolveSafeTarget(rootReal: string, relativePath: string, allowMissingParent = false): Promise<string> {
  const rel = validateCheckpointRelativePath(relativePath);
  const target = resolve(rootReal, rel);
  const fromRoot = relative(rootReal, target);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith('..' + sep) || isAbsolute(fromRoot)) {
    throw new Error('Path checkpoint keluar dari workspace.');
  }
  let parent = dirname(target);
  for (;;) {
    try {
      const parentReal = await realpath(parent);
      const parentRelative = relative(rootReal, parentReal);
      if (parentRelative === '..' || parentRelative.startsWith('..' + sep) || isAbsolute(parentRelative)) {
        throw new Error('Path checkpoint parent keluar dari workspace.');
      }
      break;
    } catch (error) {
      if (!allowMissingParent || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const nextParent = dirname(parent);
      if (nextParent === parent) throw new Error('Parent checkpoint tidak dapat divalidasi.');
      parent = nextParent;
    }
  }
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error('Checkpoint melalui symbolic link ditolak.');
    if (!info.isFile()) throw new Error('Checkpoint hanya dapat mengubah file biasa.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return target;
}
export async function recordAgentFileCheckpoint(
  userDataDir: string,
  sessionId: string,
  runId: string,
  projectPath: string,
  change: AgentFileChange,
): Promise<AgentCheckpoint> {
  return withSessionLock(userDataDir, sessionId, async () => {
  validateSessionId(sessionId);
  const record = await readRecord(userDataDir, sessionId);
  if (!record) throw new Error('Sesi untuk checkpoint tidak ditemukan.');
  const rootReal = await realpath(projectPath);
  const rel = validateCheckpointRelativePath(change.path);
  if (Buffer.byteLength(change.oldContent, 'utf8') > 1_000_000 || Buffer.byteLength(change.newContent, 'utf8') > 1_000_000) {
    throw new Error('File terlalu besar untuk checkpoint yang dapat dipulihkan (maksimal 1 MB).');
  }
  let checkpoint = record.checkpoints.find(item => item.runId === runId);
  if (!checkpoint) {
    checkpoint = {
      id: 'cp-' + randomUUID(),
      runId,
      createdAt: Date.now(),
      projectPath: rootReal,
      status: 'applied',
      files: [],
    };
    record.checkpoints.push(checkpoint);
  }
  const oldExists = change.operation !== 'create';
  const index = checkpoint.files.findIndex(item => item.path === rel);
  const previous = index >= 0 ? checkpoint.files[index] : null;
  const file: AgentCheckpointFile = {
    path: rel,
    // Multiple writes to the same file in one run retain the original pre-run state.
    oldExists: previous ? previous.oldExists : oldExists,
    oldContent: previous ? previous.oldContent : change.oldContent,
    newContent: change.newContent,
    oldHash: previous ? previous.oldHash : (oldExists ? hashText(change.oldContent) : 'absent'),
    newHash: hashText(change.newContent),
  };
  if (index >= 0) checkpoint.files[index] = file;
  else checkpoint.files.push(file);
  const checkpointBytes = checkpoint.files.reduce((total, item) =>
    total + Buffer.byteLength(item.oldContent, 'utf8') + Buffer.byteLength(item.newContent, 'utf8'), 0);
  if (checkpoint.files.length > MAX_CHECKPOINT_FILES || checkpointBytes > MAX_CHECKPOINT_BYTES) {
    checkpoint.files.pop();
    record.checkpoints = record.checkpoints.filter(item => item.id !== checkpoint!.id);
    throw new Error('Checkpoint melebihi batas ukuran. Perubahan file tetap tersimpan, tetapi tidak dapat di-rewind otomatis.');
  }
  record.checkpoints = record.checkpoints.slice(-MAX_CHECKPOINTS);
  record.updatedAt = Date.now();
  await writeRecord(userDataDir, record);
  return checkpoint;
  });
}
async function applyCheckpoint(
  userDataDir: string,
  sessionId: string,
  projectPath: string,
  checkpointId: string,
  direction: 'rewind' | 'redo',
): Promise<CheckpointActionResult> {
  return withSessionLock(userDataDir, sessionId, async () => {
  validateSessionId(sessionId);
  const record = await readRecord(userDataDir, sessionId);
  if (!record) return { ok: false, message: 'Sesi tidak ditemukan.' };
  const checkpoint = record.checkpoints.find(item => item.id === checkpointId);
  if (!checkpoint) return { ok: false, message: 'Checkpoint tidak ditemukan.' };
  if (checkpoint.status !== (direction === 'rewind' ? 'applied' : 'rewound')) {
    return { ok: false, message: direction === 'rewind' ? 'Checkpoint ini sudah di-rewind.' : 'Checkpoint ini belum di-rewind.' };
  }
  let rootReal: string;
  try { rootReal = await realpath(projectPath); }
  catch { return { ok: false, message: 'Workspace tidak dapat diakses.' }; }
  if (rootReal !== checkpoint.projectPath) {
    return { ok: false, message: 'Workspace berbeda dari workspace saat checkpoint dibuat. Pemulihan dibatalkan.' };
  }
  const pending: Array<{ target: string; file: AgentCheckpointFile; currentExists: boolean; currentContent: string }> = [];
  try {
    for (const file of checkpoint.files) {
      const target = await resolveSafeTarget(rootReal, file.path, true);
      const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (info?.isSymbolicLink() || (info && !info.isFile())) throw new Error('Target bukan file biasa: ' + file.path);
      const currentExists = !!info;
      const currentContent = currentExists ? await readFile(target, 'utf8') : '';
      const expectedExists = direction === 'rewind' ? true : file.oldExists;
      const expectedHash = direction === 'rewind' ? file.newHash : file.oldHash;
      if (currentExists !== expectedExists || (currentExists && hashText(currentContent) !== expectedHash)) {
        throw new Error('Isi file berubah setelah checkpoint: ' + file.path + '. Pemulihan dibatalkan agar perubahan manual tidak tertimpa.');
      }
      pending.push({ target, file, currentExists, currentContent });
    }
  } catch (error) {
    return { ok: false, message: (error as Error).message || 'Validasi checkpoint gagal.' };
  }

  const staged: Array<{ temp: string; target: string; file: AgentCheckpointFile }> = [];
  try {
    for (const item of pending) {
      const destinationContent = direction === 'rewind' ? item.file.oldContent : item.file.newContent;
      const destinationExists = direction === 'rewind' ? item.file.oldExists : true;
      if (!destinationExists) continue;
      await mkdir(dirname(item.target), { recursive: true });
      const temp = item.target + '.' + randomUUID() + '.rk-checkpoint.tmp';
      await writeFile(temp, destinationContent, { encoding: 'utf8', flag: 'wx' });
      staged.push({ temp, target: item.target, file: item.file });
    }
    for (const item of pending) {
      const destinationExists = direction === 'rewind' ? item.file.oldExists : true;
      const temp = staged.find(candidate => candidate.target === item.target)?.temp;
      if (destinationExists && temp) await rename(temp, item.target);
      else if (!destinationExists) await rm(item.target, { force: true });
    }
    checkpoint.status = direction === 'rewind' ? 'rewound' : 'applied';
    record.updatedAt = Date.now();
    await writeRecord(userDataDir, record);
    return { ok: true, message: direction === 'rewind'
      ? 'Checkpoint dipulihkan. File dikembalikan ke keadaan sebelum perubahan agent.'
      : 'Perubahan checkpoint diterapkan kembali.',
      checkpoint };
  } catch (error) {
    return { ok: false, message: 'Pemulihan tidak selesai sepenuhnya: ' + ((error as Error).message || 'kesalahan file system') };
  } finally {
    for (const item of staged) await rm(item.temp, { force: true }).catch(() => undefined);
  }
  });
}
export async function rewindAgentCheckpoint(
  userDataDir: string, sessionId: string, projectPath: string, checkpointId: string,
): Promise<CheckpointActionResult> {
  return applyCheckpoint(userDataDir, sessionId, projectPath, checkpointId, 'rewind');
}
export async function redoAgentCheckpoint(
  userDataDir: string, sessionId: string, projectPath: string, checkpointId: string,
): Promise<CheckpointActionResult> {
  return applyCheckpoint(userDataDir, sessionId, projectPath, checkpointId, 'redo');
}
