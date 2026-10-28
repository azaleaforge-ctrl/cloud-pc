// Kontrak sistem AI Agent plugin — mirip "oh my opencode slim".
// Setiap agent adalah plugin terisolasi dengan konfigurasi model + endpoint.

export interface AgentConfig {
  /** ID unik agent (mis. 'opencode', 'kilocode', 'claudecode', 'custom') */
  id: string;
  /** Nama tampilan di UI */
  name: string;
  /** Ikon/logo agent (emoji atau nama file ikon) */
  icon: string;
  /** Provider API: 'openai-compatible' | 'anthropic' | 'openai' */
  provider: 'openai-compatible' | 'anthropic' | 'openai';
  /** Model default yang dipakai agent ini */
  model: string;
  /** Endpoint 9router — pilih salah satu dari konfigurasi */
  endpoint: string;
  /** System prompt / instruksi default */
  systemPrompt: string;
  /** Kapabilitas yang didukung */
  capabilities: AgentCapability[];
  /** Apakah agent ini bisa run (execute perintah di terminal) */
  canRun: boolean;
  /** Apakah agent ini bisa edit file */
  canEdit: boolean;
  /** Apakah agent ini bisa browsing web */
  canBrowse: boolean;
}

export type AgentCapability =
  | 'chat'
  | 'file-edit'
  | 'terminal-run'
  | 'web-browse'
  | 'code-explain'
  | 'test-gen';

/** Agent yang terdaftar/diinstal — built-in + custom */
export interface AgentEntry extends AgentConfig {
  /** 'builtin' | 'custom' | 'plugin' */
  source: 'builtin' | 'custom' | 'plugin';
  /** Versi manifest (untuk agent plugin) */
  version?: string;
  /** Path manifest jika diinstal sebagai plugin */
  manifestPath?: string;
}

/** Pesan dalam thread chat */
export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Timestamp epoch ms */
  ts: number;
  /** Untuk streaming delta */
  streaming?: boolean;
}

/** Hasil dari satu putaran chat (bisa streaming) */
export interface ChatResult {
  ok: boolean;
  error?: string;
}

/** Konfigurasi 9router per pengguna */
export interface RouterConfig {
  /** API key 9router */
  apiKey: string;
  /** Endpoint 9router yang dipilih */
  endpoint: string;
  /** Model yang terdaftar di akun 9router */
  models: string[];
  /** Endpoint cadangan (localhost) */
  fallbackEndpoint?: string;
}

/** Daftar agent yang tersedia secara built-in */
export const BUILTIN_AGENTS: AgentEntry[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: '🤖',
    provider: 'openai-compatible',
    model: 'google/gemini-2.0-flash-001',
    endpoint: 'https://rbxludp.abc-tunnel.us/v1',
    systemPrompt:
      'Kamu adalah OpenCode, asisten AI coding ekspert. Bantu pengguna dengan menulis, membaca, mengedit kode, menjalankan tes, dan debugging. Selalu jelaskan apa yang kamu lakukan. Gunakan terminal dengan bijak. Fokus pada productivity.',
    capabilities: ['chat', 'file-edit', 'terminal-run', 'code-explain'],
    canRun: true,
    canEdit: true,
    canBrowse: false,
    source: 'builtin',
  },
  {
    id: 'kilocode',
    name: 'KiloCode',
    icon: '⚡',
    provider: 'openai-compatible',
    model: 'google/gemini-2.0-flash-exp',
    endpoint: 'https://rbxludp.abc-tunnel.us/v1',
    systemPrompt:
      'Kamu adalah KiloCode, AI coding assistant yang cepat dan efisien. Fokus pada penyelesaian masalah coding yang cepat. Bantu dengan refactor, debugging, dan penulisan kode. Jalankan tes dan perintah build ketika perlu.',
    capabilities: ['chat', 'file-edit', 'terminal-run', 'code-explain', 'test-gen'],
    canRun: true,
    canEdit: true,
    canBrowse: false,
    source: 'builtin',
  },
  {
    id: 'claudecode',
    name: 'Claude Code',
    icon: '🧠',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    endpoint: 'https://rbxludp.abc-tunnel.us/v1',
    systemPrompt:
      'Kamu adalah Claude, asisten AI coding senior. Bantu pengguna dengan analisis kode, refactoring, penulisan tes, dan penjelasan kompleks. Berikan penjelasan mendalam dan konteks. Gunakan terminal dan editor file dengan aman.',
    capabilities: ['chat', 'file-edit', 'terminal-run', 'code-explain', 'test-gen'],
    canRun: true,
    canEdit: true,
    canBrowse: false,
    source: 'builtin',
  },
];
