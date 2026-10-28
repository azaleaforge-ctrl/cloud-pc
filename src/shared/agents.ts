// Kontrak sistem AI Agent — mirip Claude Code / OpenCode / KiloCode CLI + "oh my opencode slim" plugin system.
// Agent bisa berupa: (a) CLI agent (claude-code, opencode, kilocode) yang dijalankan di PTY,
// atau (b) built-in chat agent yang memakai 9router LLM endpoint.

export type AgentType = 'cli' | 'llm-chat';

export interface AgentConfig {
  /** ID unik agent (mis. 'claude', 'opencode', 'kilocode', 'poolside') */
  id: string;
  /** Nama tampilan di UI */
  name: string;
  /** Ikon/logo agent */
  icon: string;
  /** Tipe agent: CLI process vs LLM chat */
  type: AgentType;
  /** Provider API untuk tipe 'llm-chat' */
  provider?: 'openai-compatible';
  /** Model LLM (mis. 'ps/poolside/laguna-s-2.1(high)') */
  model?: string;
  /** Endpoint 9router */
  endpoint?: string;
  /** API key 9router */
  apiKey?: string;
  /** System prompt / instruksi default */
  systemPrompt: string;
  /** CLI command (untuk type 'cli'): ['claude', '--no-sandbox', '--output-format=stream-json'] */
  cliCommand?: string[];
  /** Working directory: project root */
  cwd?: boolean;
  /** Kapabilitas */
  capabilities: AgentCapability[];
}

export type AgentCapability =
  | 'chat'
  | 'file-edit'
  | 'terminal-run'
  | 'web-browse'
  | 'code-explain'
  | 'test-gen';

/** Agent entry yang terdaftar — built-in atau plugin */
export interface AgentEntry extends AgentConfig {
  /** 'builtin' | 'plugin' */
  source: 'builtin' | 'plugin';
  /** Versi plugin (untuk agent plugin) */
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

/** Event dari agent main process ke renderer */
export type AgentEvent =
  | { type: 'output'; data: string }
  | { type: 'error'; message: string }
  | { type: 'exit'; code: number }
  | { type: 'state'; state: AgentRunState };

/** State agent yang sedang berjalan */
export interface AgentRunState {
  /** 'idle' | 'starting' | 'running' | 'stopped' | 'error' */
  status: 'idle' | 'starting' | 'running' | 'stopped' | 'error';
  agentId: string;
  error?: string | null;
}

/** Konfigurasi 9router */
export interface RouterConfig {
  apiKey: string;
  endpoint: string;
  models: string[];
  fallbackEndpoint?: string;
}

/** Daftar agent built-in */
export const BUILTIN_AGENTS: AgentEntry[] = [
  {
    id: 'poolside',
    name: 'Poolside',
    icon: '🌊',
    type: 'llm-chat',
    provider: 'openai-compatible',
    model: 'ps/poolside/laguna-s-2.1(high)',
    endpoint: 'https://rbxludp.abc-tunnel.us/v1',
    apiKey: 'sk-2d3f91fca9150b32-oteucp-a7c362bf',
    systemPrompt:
      'Kamu adalah Poolside AI, asisten coding ahli. Bantu dengan menulis kode, menjelaskan, mengedit, dan menjalankan tes. Fokus pada produktivitas. Gunakan terminal ketika perlu.',
    capabilities: ['chat', 'file-edit', 'terminal-run', 'code-explain', 'test-gen'],
    source: 'builtin',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    icon: '🧠',
    type: 'cli',
    cliCommand: ['claude'],
    systemPrompt:
      'Kamu adalah Claude Code, AI coding assistant senior. Bantu dengan analisis kode, refactoring, penulisan tes, debugging, dan penjelasan kompleks.',
    capabilities: ['chat', 'file-edit', 'terminal-run', 'code-explain', 'test-gen'],
    source: 'builtin',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: '🤖',
    type: 'cli',
    cliCommand: ['opencode'],
    systemPrompt:
      'Kamu adalah OpenCode, asisten AI coding ekspert. Bantu dengan menulis, membaca, mengedit kode, menjalankan tes, dan debugging.',
    capabilities: ['chat', 'file-edit', 'terminal-run', 'code-explain'],
    source: 'builtin',
  },
  {
    id: 'kilocode',
    name: 'KiloCode',
    icon: '⚡',
    type: 'cli',
    cliCommand: ['kilocode'],
    systemPrompt:
      'Kamu adalah KiloCode, AI coding assistant yang cepat dan efisien. Fokus pada penyelesaian masalah cepat, refactor, dan debugging.',
    capabilities: ['chat', 'file-edit', 'terminal-run', 'code-explain'],
    source: 'builtin',
  },
];
