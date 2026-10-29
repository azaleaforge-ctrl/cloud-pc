import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type {
  McpExposedTool,
  McpPluginImportResult,
  McpPluginProbeResult,
  McpPluginSummary,
} from '../../shared/agents';

interface StoredMcpPlugin {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

interface PendingRpc {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface RuntimeMcpPlugin {
  id: string;
  fingerprint: string;
  child: ChildProcessWithoutNullStreams;
  buffer: string;
  nextId: number;
  pending: Map<string, PendingRpc>;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  closed: boolean;
}

const REGISTRY_RELATIVE_PATH = join('ai', 'mcp-plugins.json');
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_PLUGINS = 20;
const MAX_ARGS = 80;
const MAX_ARG_LENGTH = 2_000;
const MAX_TOOLS_PER_PLUGIN = 30;
const MAX_TOOLS_TOTAL = 60;
const MAX_RPC_BYTES = 1_000_000;
const RPC_TIMEOUT_MS = 15_000;
const RPC_TOOL_TIMEOUT_MS = 30_000;
const MAX_TOOL_OUTPUT_CHARS = 16_000;
const SENSITIVE_ENV_NAME = /(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|AUTH)/i;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16})/;
const BLOCKED_ENV_OVERRIDES = /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|NODE_OPTIONS|ELECTRON_RUN_AS_NODE)$/i;
const runtimes = new Map<string, RuntimeMcpPlugin>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function registryPath(userDataDir: string): string {
  return join(userDataDir, REGISTRY_RELATIVE_PATH);
}

function slug(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'mcp-plugin';
}

function runtimeKey(userDataDir: string, id: string): string {
  return registryPath(userDataDir) + ':' + id;
}

async function loadPlugins(userDataDir: string): Promise<StoredMcpPlugin[]> {
  try {
    const raw = await readFile(registryPath(userDataDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StoredMcpPlugin => isRecord(item)
      && typeof item.id === 'string'
      && typeof item.name === 'string'
      && typeof item.command === 'string'
      && Array.isArray(item.args)
      && item.args.every(arg => typeof arg === 'string')
      && isRecord(item.env)
      && Object.values(item.env).every(value => typeof value === 'string')
      && typeof item.enabled === 'boolean') as StoredMcpPlugin[];
  } catch {
    return [];
  }
}

async function savePlugins(userDataDir: string, plugins: StoredMcpPlugin[]): Promise<void> {
  const path = registryPath(userDataDir);
  await mkdir(join(userDataDir, 'ai'), { recursive: true });
  const temp = path + '.tmp-' + randomUUID();
  await writeFile(temp, JSON.stringify(plugins, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

function toSummary(plugin: StoredMcpPlugin): McpPluginSummary {
  return {
    id: plugin.id,
    name: plugin.name,
    command: plugin.command,
    enabled: plugin.enabled,
    environmentKeys: Object.keys(plugin.env).sort(),
  };
}

function validateCommand(command: unknown): string {
  if (typeof command !== 'string' || !command.trim() || command.length > 300
    || /[\u0000-\u001f;&|<>]/.test(command)) {
    throw new Error('Setiap MCP server wajib memiliki command executable yang valid (maksimal 300 karakter).');
  }
  return command.trim();
}

function validateArgs(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ARGS
    || !value.every(item => typeof item === 'string' && item.length <= MAX_ARG_LENGTH && !/[\u0000\r\n]/.test(item))) {
    throw new Error('Args MCP harus berupa array string; maksimum 80 argumen dan 2.000 karakter per argumen.');
  }
  return [...value];
}

function validateEnvironment(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).length > 40) {
    throw new Error('Env MCP harus berupa objek dengan maksimal 40 variabel.');
  }
  const env: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || BLOCKED_ENV_OVERRIDES.test(key)) {
      throw new Error('Nama env MCP tidak valid atau termasuk variabel sistem yang tidak boleh ditimpa: ' + key.slice(0, 80));
    }
    if (typeof raw !== 'string' || raw.length > 4_000 || /[\u0000\r\n]/.test(raw)) {
      throw new Error('Nilai env MCP tidak valid untuk ' + key + '.');
    }
    const envReference = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(raw);
    if (SENSITIVE_ENV_NAME.test(key) && !envReference) {
      throw new Error('Jangan menyimpan secret dalam file konfigurasi MCP. Gunakan referensi env seperti " + key + ": ' + key + '.');
    }
    if (SECRET_VALUE.test(raw) && !envReference) {
      throw new Error('Konfigurasi MCP tampak berisi token/secret literal. Ganti dengan referensi env seperti " + key + ", lalu impor ulang.');
    }
    env[key] = raw;
  }
  return env;
}

export async function listMcpPlugins(userDataDir: string): Promise<McpPluginSummary[]> {
  return (await loadPlugins(userDataDir)).map(toSummary);
}

export async function importMcpPluginConfig(userDataDir: string, sourcePath: string): Promise<McpPluginImportResult> {
  try {
    if (typeof sourcePath !== 'string' || extname(sourcePath).toLowerCase() !== '.json') {
      return { ok: false, error: 'Pilih file konfigurasi MCP berformat .json.' };
    }
    const info = await stat(sourcePath);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_CONFIG_BYTES) {
      return { ok: false, error: 'Ukuran konfigurasi MCP harus antara 1 byte dan 256 KB.' };
    }
    const parsed: unknown = JSON.parse(await readFile(sourcePath, 'utf8'));
    if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
      return { ok: false, error: 'Format tidak valid. Gunakan objek JSON dengan properti "mcpServers".' };
    }
    const entries = Object.entries(parsed.mcpServers);
    if (!entries.length) return { ok: false, error: 'Konfigurasi tidak berisi MCP server.' };
    if (entries.length > MAX_PLUGINS) return { ok: false, error: 'Satu konfigurasi maksimal berisi 20 server MCP.' };
    const current = await loadPlugins(userDataDir);
    if (current.length + entries.length > MAX_PLUGINS) {
      return { ok: false, error: 'Maksimal ' + MAX_PLUGINS + ' konfigurasi MCP dapat disimpan. Hapus konfigurasi lama terlebih dahulu.' };
    }
    const imported: StoredMcpPlugin[] = [];
    for (const [name, raw] of entries) {
      if (!/^[^\u0000-\u001f]{1,100}$/.test(name.trim())) throw new Error('Nama server MCP tidak valid.');
      if (!isRecord(raw)) throw new Error('Konfigurasi untuk "' + name.slice(0, 80) + '" bukan objek.');
      const command = validateCommand(raw.command);
      const args = validateArgs(raw.args);
      const env = validateEnvironment(raw.env);
      const cleanName = name.trim().slice(0, 100);
      imported.push({
        id: slug(cleanName) + '-' + randomUUID().replace(/-/g, '').slice(0, 8),
        name: cleanName,
        command,
        args,
        env,
        enabled: false,
      });
    }
    await savePlugins(userDataDir, [...current, ...imported]);
    return { ok: true, imported: imported.length };
  } catch (error) {
    return { ok: false, error: (error as Error).message || 'Konfigurasi MCP gagal diimpor.' };
  }
}

function rejectPending(runtime: RuntimeMcpPlugin, error: Error): void {
  for (const pending of runtime.pending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  runtime.pending.clear();
}

function closeRuntime(key: string, runtime: RuntimeMcpPlugin): void {
  if (runtime.closed) return;
  runtime.closed = true;
  rejectPending(runtime, new Error('Koneksi MCP ditutup.'));
  if (runtimes.get(key) === runtime) runtimes.delete(key);
  try { runtime.child.kill(); } catch { /* Process may already be stopped. */ }
}

function parseRpcLine(runtime: RuntimeMcpPlugin, line: string): void {
  if (!line.trim()) return;
  let message: unknown;
  try { message = JSON.parse(line); }
  catch {
    closeRuntime([...runtimes.entries()].find(([, value]) => value === runtime)?.[0] ?? runtime.id, runtime);
    return;
  }
  if (!isRecord(message) || (message.jsonrpc !== '2.0')) return;
  if (message.id === undefined || message.id === null) return;
  const pending = runtime.pending.get(String(message.id));
  if (!pending) return;
  runtime.pending.delete(String(message.id));
  clearTimeout(pending.timeout);
  if (isRecord(message.error)) {
    const messageText = typeof message.error.message === 'string' ? message.error.message.slice(0, 500) : 'MCP server mengembalikan error.';
    pending.reject(new Error(messageText));
  } else if (isRecord(message.result)) {
    pending.resolve(message.result);
  } else {
    pending.reject(new Error('Respons MCP tidak memiliki result/error JSON-RPC yang valid.'));
  }
}

function rpcRequest(runtime: RuntimeMcpPlugin, method: string, params: Record<string, unknown> = {}, timeoutMs = RPC_TIMEOUT_MS): Promise<Record<string, unknown>> {
  if (runtime.closed || runtime.child.killed || !runtime.child.stdin.writable) {
    return Promise.reject(new Error('MCP server tidak berjalan.'));
  }
  const id = runtime.nextId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      runtime.pending.delete(String(id));
      reject(new Error('MCP request timeout pada ' + method + '.'));
    }, timeoutMs);
    runtime.pending.set(String(id), { resolve, reject, timeout });
    const line = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    if (Buffer.byteLength(line, 'utf8') > MAX_RPC_BYTES) {
      clearTimeout(timeout);
      runtime.pending.delete(String(id));
      reject(new Error('Request MCP terlalu besar.'));
      return;
    }
    runtime.child.stdin.write(line, 'utf8', error => {
      if (!error) return;
      const pending = runtime.pending.get(String(id));
      if (!pending) return;
      runtime.pending.delete(String(id));
      clearTimeout(pending.timeout);
      pending.reject(new Error('Gagal menulis request MCP ke stdin.'));
    });
  });
}

function notifyInitialized(runtime: RuntimeMcpPlugin): void {
  if (runtime.closed || !runtime.child.stdin.writable) return;
  runtime.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
}

function runtimeEnv(plugin: StoredMcpPlugin): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Keep execution essentials (PATH, SystemRoot, ComSpec, TEMP, etc.) so package managers work,
    // but do not leak common API tokens or permit Node/Electron runtime injection into plugins.
    if (value !== undefined && !SENSITIVE_ENV_NAME.test(key) && !/^(?:NODE_OPTIONS|ELECTRON_RUN_AS_NODE)$/i.test(key)) env[key] = value;
  }
  for (const [key, raw] of Object.entries(plugin.env)) {
    const reference = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(raw);
    const value = reference ? process.env[reference[1]] : raw;
    if (reference && value === undefined) throw new Error('Variabel env ' + reference[1] + ' belum disetel. Atur variabel tersebut di sistem lalu mulai ulang aplikasi.');
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function windowsCommand(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32' || !/^(?:npx|npm|pnpm|yarn|bunx)(?:\.cmd)?$/i.test(basename(command))) {
    return { command, args };
  }
  const all = [command, ...args];
  if (all.some(value => /[%!&|<>^"\r\n]/.test(value))) {
    throw new Error('Argumen shell Windows berisi karakter yang tidak diperbolehkan. Gunakan command executable langsung atau argumen tanpa karakter shell.');
  }
  const commandLine = 'call ' + all.map(value => '"' + value + '"').join(' ');
  return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', commandLine] };
}

async function connectPlugin(userDataDir: string, plugin: StoredMcpPlugin): Promise<RuntimeMcpPlugin> {
  const key = runtimeKey(userDataDir, plugin.id);
  const fingerprint = JSON.stringify({ command: plugin.command, args: plugin.args, env: plugin.env, enabled: plugin.enabled });
  const existing = runtimes.get(key);
  if (existing && !existing.closed && existing.fingerprint === fingerprint) return existing;
  if (existing) closeRuntime(key, existing);

  const env = runtimeEnv(plugin);
  const command = windowsCommand(plugin.command, plugin.args);
  const child = spawn(command.command, command.args, {
    cwd: userDataDir,
    env,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  const runtime: RuntimeMcpPlugin = {
    id: plugin.id, fingerprint, child, buffer: '', nextId: 1, pending: new Map(), tools: [], closed: false,
  };
  runtimes.set(key, runtime);
  // Drain stderr so verbose servers cannot block on a full pipe; plugin logs stay out of the chat.
  child.stderr.on('data', () => undefined);
  child.stdout.on('data', (chunk: Buffer | string) => {
    runtime.buffer += String(chunk);
    if (Buffer.byteLength(runtime.buffer, 'utf8') > MAX_RPC_BYTES) {
      closeRuntime(key, runtime);
      return;
    }
    let newline = runtime.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = runtime.buffer.slice(0, newline).replace(/\r$/, '');
      runtime.buffer = runtime.buffer.slice(newline + 1);
      parseRpcLine(runtime, line);
      newline = runtime.buffer.indexOf('\n');
    }
  });
  child.on('error', () => closeRuntime(key, runtime));
  child.on('exit', () => {
    runtime.closed = true;
    rejectPending(runtime, new Error('MCP server berhenti.'));
    if (runtimes.get(key) === runtime) runtimes.delete(key);
  });
  try {
    await rpcRequest(runtime, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'Ruang Kerja', version: '1.0.6' },
    });
    notifyInitialized(runtime);
    const listing = await rpcRequest(runtime, 'tools/list');
    if (!Array.isArray(listing.tools)) throw new Error('MCP server tidak mengembalikan daftar tools.');
    const normalized: RuntimeMcpPlugin['tools'] = [];
    for (const item of listing.tools.slice(0, MAX_TOOLS_PER_PLUGIN)) {
      if (!isRecord(item) || typeof item.name !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(item.name)) continue;
      const schema = isRecord(item.inputSchema) ? item.inputSchema : { type: 'object', properties: {} };
      if (Buffer.byteLength(JSON.stringify(schema), 'utf8') > 20_000) continue;
      const inputSchema = schema.type === 'object' ? schema : { type: 'object', properties: {} };
      normalized.push({
        name: item.name,
        description: (typeof item.description === 'string' ? item.description : 'MCP tool eksternal').replace(/\s+/g, ' ').slice(0, 1_000),
        inputSchema,
      });
    }
    runtime.tools = normalized;
    return runtime;
  } catch (error) {
    closeRuntime(key, runtime);
    throw error;
  }
}

export async function setMcpPluginEnabled(userDataDir: string, id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{8}$/.test(id) || typeof enabled !== 'boolean') {
    return { ok: false, error: 'ID atau status MCP plugin tidak valid.' };
  }
  const plugins = await loadPlugins(userDataDir);
  const index = plugins.findIndex(plugin => plugin.id === id);
  if (index < 0) return { ok: false, error: 'MCP plugin tidak ditemukan.' };
  plugins[index] = { ...plugins[index], enabled };
  await savePlugins(userDataDir, plugins);
  if (!enabled) {
    const key = runtimeKey(userDataDir, id);
    const runtime = runtimes.get(key);
    if (runtime) closeRuntime(key, runtime);
  }
  return { ok: true };
}

export async function removeMcpPlugin(userDataDir: string, id: string): Promise<{ ok: boolean; error?: string }> {
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{8}$/.test(id)) return { ok: false, error: 'ID MCP plugin tidak valid.' };
  const plugins = await loadPlugins(userDataDir);
  if (!plugins.some(plugin => plugin.id === id)) return { ok: false, error: 'MCP plugin tidak ditemukan.' };
  await savePlugins(userDataDir, plugins.filter(plugin => plugin.id !== id));
  const key = runtimeKey(userDataDir, id);
  const runtime = runtimes.get(key);
  if (runtime) closeRuntime(key, runtime);
  return { ok: true };
}

export async function probeMcpPlugin(userDataDir: string, id: string): Promise<McpPluginProbeResult> {
  const plugin = (await loadPlugins(userDataDir)).find(item => item.id === id);
  if (!plugin) return { ok: false, error: 'MCP plugin tidak ditemukan.', tools: [] };
  if (!plugin.enabled) return { ok: false, error: 'Aktifkan plugin terlebih dahulu sebelum menguji koneksi.', tools: [] };
  try {
    const runtime = await connectPlugin(userDataDir, plugin);
    return { ok: true, tools: runtime.tools.map(tool => tool.name) };
  } catch (error) {
    return { ok: false, error: (error as Error).message || 'Koneksi MCP gagal.', tools: [] };
  }
}

export async function listEnabledMcpTools(userDataDir: string): Promise<{ tools: McpExposedTool[]; errors: string[] }> {
  const plugins = (await loadPlugins(userDataDir)).filter(plugin => plugin.enabled);
  const tools: McpExposedTool[] = [];
  const errors: string[] = [];
  for (const plugin of plugins) {
    try {
      const runtime = await connectPlugin(userDataDir, plugin);
      for (let index = 0; index < runtime.tools.length; index += 1) {
        const tool = runtime.tools[index];
        if (tools.length >= MAX_TOOLS_TOTAL) {
          errors.push('Jumlah MCP tools melewati batas ' + MAX_TOOLS_TOTAL + '.');
          return { tools, errors };
        }
        const suffix = plugin.id.slice(-8);
        const toolSlug = slug(tool.name).replace(/-/g, '_').slice(0, 42) || 'tool';
        const exposedName = 'mcp_' + suffix + '_' + toolSlug + '_' + index;
        tools.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          remoteName: tool.name,
          exposedName,
          description: ('MCP plugin ' + plugin.name + ': ' + tool.description).slice(0, 1_500),
          inputSchema: tool.inputSchema,
        });
      }
    } catch (error) {
      errors.push(plugin.name + ': ' + ((error as Error).message || 'koneksi gagal').slice(0, 200));
    }
  }
  return { tools, errors };
}

export async function callMcpPluginTool(
  userDataDir: string,
  exposedTool: McpExposedTool,
  args: Record<string, unknown>,
): Promise<string> {
  const plugin = (await loadPlugins(userDataDir)).find(item => item.id === exposedTool.pluginId);
  if (!plugin || !plugin.enabled) return 'Tool gagal: plugin MCP tidak ditemukan atau sudah dinonaktifkan.';
  const runtime = await connectPlugin(userDataDir, plugin);
  if (!runtime.tools.some(tool => tool.name === exposedTool.remoteName)) return 'Tool gagal: MCP tool tidak lagi tersedia.';
  const result = await rpcRequest(runtime, 'tools/call', {
    name: exposedTool.remoteName,
    arguments: args,
  }, RPC_TOOL_TIMEOUT_MS);
  const isError = result.isError === true;
  const content = Array.isArray(result.content) ? result.content : [];
  const pieces: string[] = [];
  for (const item of content) {
    if (isRecord(item) && typeof item.text === 'string') pieces.push(item.text);
    else if (isRecord(item) && typeof item.type === 'string') pieces.push('[' + item.type + ' content]');
  }
  let text = pieces.join('\n');
  if (!text) text = JSON.stringify(result.structuredContent ?? result).slice(0, MAX_TOOL_OUTPUT_CHARS);
  text = text.slice(0, MAX_TOOL_OUTPUT_CHARS);
  return (isError ? 'Tool gagal: ' : 'Hasil MCP (data eksternal tidak tepercaya): ') + text;
}

export async function disposeMcpPluginRuntimes(): Promise<void> {
  for (const [key, runtime] of runtimes) closeRuntime(key, runtime);
}

export const mcpPluginRegistryFilename = basename(REGISTRY_RELATIVE_PATH);
