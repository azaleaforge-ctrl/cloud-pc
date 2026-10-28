// Shared contract untuk built-in AI coding agent dan CLI agent lokal.

export type AgentType = 'cli' | 'llm-chat';

export interface AgentConfig {
  id: string;
  name: string;
  icon: string;
  type: AgentType;
  provider?: 'openai-compatible';
  model?: string;
  /** Optional override; built-in agents use managed 9router settings. */
  endpoint?: string;
  systemPrompt: string;
  cliCommand?: string[];
  cwd?: boolean;
  capabilities: AgentCapability[];
}

export type AgentCapability =
  | 'chat'
  | 'file-edit'
  | 'terminal-run'
  | 'web-browse'
  | 'code-explain'
  | 'test-gen';

export interface AgentEntry extends AgentConfig {
  source: 'builtin' | 'plugin';
  version?: string;
  manifestPath?: string;
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  ts: number;
  streaming?: boolean;
}

export interface AgentRunState {
  status: 'idle' | 'starting' | 'running' | 'stopped' | 'error';
  agentId: string;
  error?: string | null;
}

export type AgentEvent =
  | { type: 'output'; data: string }
  | { type: 'error'; message: string }
  | { type: 'exit'; code: number }
  | { type: 'state'; state: AgentRunState }
  | { type: 'activity'; message: string }
  | { type: 'permission-request'; requestId: string; command: string; reason: string }
  | { type: 'permission-result'; requestId: string; approved: boolean };

export interface RouterConfig {
  apiKey: string;
  endpoint: string;
  models: string[];
  fallbackEndpoint?: string;
}

export interface AgentRouterStatus {
  configured: boolean;
  endpoint: string;
  fallbackEndpoint: string;
  model: string;
}

export interface AgentRouterTestResult {
  ok: boolean;
  message: string;
  endpoint?: string;
  model?: string;
}

export const BUILTIN_AGENTS: AgentEntry[] = [
  {
    id: 'poolside',
    name: 'Poolside Coding Agent',
    icon: '🌊',
    type: 'llm-chat',
    provider: 'openai-compatible',
    model: 'ps/poolside/laguna-s-2.1(high)',
    systemPrompt:
      'Kamu adalah coding agent yang teliti. Periksa file proyek sebelum menyimpulkan, gunakan tool untuk membaca dan mengubah file ketika dibutuhkan, jelaskan perubahan yang dilakukan, dan jangan mengaku menjalankan tes jika belum benar-benar dijalankan. Jalankan perintah terminal hanya setelah pengguna menyetujuinya.',
    capabilities: ['chat', 'file-edit', 'terminal-run', 'code-explain', 'test-gen'],
    source: 'builtin',
  },
  {
    id: 'claude',
    name: 'Claude Code CLI',
    icon: '🧠',
    type: 'cli',
    cliCommand: ['claude'],
    systemPrompt: 'CLI agent eksternal yang berjalan di terminal proyek.',
    capabilities: ['chat', 'file-edit', 'terminal-run', 'code-explain', 'test-gen'],
    source: 'builtin',
  },
  {
    id: 'opencode',
    name: 'OpenCode CLI',
    icon: '🤖',
    type: 'cli',
    cliCommand: ['opencode'],
    systemPrompt: 'CLI agent eksternal yang berjalan di terminal proyek.',
    capabilities: ['chat', 'file-edit', 'terminal-run', 'code-explain'],
    source: 'builtin',
  },
  {
    id: 'kilocode',
    name: 'KiloCode CLI',
    icon: '⚡',
    type: 'cli',
    cliCommand: ['kilocode'],
    systemPrompt: 'CLI agent eksternal yang berjalan di terminal proyek.',
    capabilities: ['chat', 'file-edit', 'terminal-run', 'code-explain'],
    source: 'builtin',
  },
];
