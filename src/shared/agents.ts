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

export interface AgentSkillSelection {
  id: string;
  name: string;
  reason: string;
}

export type AgentTodoStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';
export type AgentTodoPriority = 'low' | 'normal' | 'high';

export interface AgentTodo {
  id: string;
  title: string;
  status: AgentTodoStatus;
  priority: AgentTodoPriority;
  blockedBy: string[];
  verification: string;
  blockedReason?: string;
  completionEvidence?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentToolActivity {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'failed';
  detail: string;
  ts: number;
}

export interface AgentRunResult {
  outcome: 'completed' | 'blocked' | 'cancelled' | 'failed';
  message: string;
  totalToolCalls: number;
  durationMs: number;
}

export interface AgentRunState {
  status: 'idle' | 'starting' | 'running' | 'completed' | 'stopped' | 'cancelled' | 'blocked' | 'error';
  agentId: string;
  error?: string | null;
}

export interface AgentFileChange {
  id: string;
  path: string;
  operation: 'create' | 'modify';
  oldContent: string;
  newContent: string;
  addedLines: number;
  removedLines: number;
  changedAt: number;
}

export type AgentEvent =
  | { type: 'output'; data: string }
  | { type: 'error'; message: string }
  | { type: 'exit'; code: number }
  | { type: 'state'; state: AgentRunState }
  | { type: 'activity'; message: string }
  | { type: 'file-change'; change: AgentFileChange }
  | { type: 'permission-request'; requestId: string; command: string; reason: string }
  | { type: 'permission-result'; requestId: string; approved: boolean }
  | { type: 'skills'; skills: AgentSkillSelection[] }
  | { type: 'todo-update'; todos: AgentTodo[] }
  | { type: 'tool-status'; activity: AgentToolActivity }
  | { type: 'run-result'; result: AgentRunResult };

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
      'Kamu adalah coding agent otonom bergaya Codex/Claude Code. Untuk permintaan coding, wajib memeriksa file workspace melalui tools, membaca file yang relevan, lalu mengubah/ membuat file secara nyata dengan write_project_file. Jangan hanya memberi contoh kode atau instruksi manual saat pengguna meminta implementasi. Setelah perubahan, jelaskan file yang diubah dan rangkum diff. Jangan mengaku menjalankan tes jika belum dijalankan. Terminal wajib meminta persetujuan pengguna.',
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
