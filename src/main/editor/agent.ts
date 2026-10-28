// Agent Runner Service — mengelola AI agent CLI (claude code, opencode, kilocode)
// dan LLM chat agent (dilalui 9router). Mirip arsitektur Claude Code / OpenCode.
//
// Untuk CLI agent: spawn process di PTY, alirkan data ke renderer.
// Untuk LLM agent: streaming SSE ke endpoint 9router, kirim tool calls ke renderer.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import * as pty from '@lydell/node-pty';
import type { IPty } from '@lydell/node-pty';
import type {
  AgentConfig,
  AgentEntry,
  AgentEvent,
  ChatMessage,
  RouterConfig,
} from '../../shared/agents';

export interface AgentService {
  listAgents(): AgentEntry[];
  getAgent(id: string): AgentEntry | null;
  startChat(agentId: string, projectPath: string | null, onEvent: (ev: AgentEvent) => void, messages?: ChatMessage[]): Promise<string>;
  startCli(agentId: string, projectPath: string, cols: number, rows: number, onEvent: (ev: AgentEvent) => void): Promise<string>;
  sendInput(sessionId: string, data: string): Promise<void>;
  resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void>;
  stopAgent(sessionId: string): Promise<void>;
  disposeAll(): void;
}

interface CliSession {
  id: string;
  agent: AgentEntry;
  pty: IPty;
  onEvent: (ev: AgentEvent) => void;
  killed: boolean;
}

interface LlmSession {
  id: string;
  agent: AgentEntry;
  controller: AbortController | null;
  onEvent: (ev: AgentEvent) => void;
  killed: boolean;
}

const DEFAULT_TIMEOUT = 30_000;

/** Cari executable di PATH atau folder umum. */
function findCliBinary(command: string): string | null {
  if (command == null || command.length === 0) return null;
  const exe = command.split(/[ \t]/)[0];
  const candidates: string[] = [];

  // Cek di folder umum (diurutkan mirip cara OpenCode/Claude Code install)
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    if (localAppData) {
      candidates.push(join(localAppData, 'Programs', exe, `${exe}.exe`));
      candidates.push(join(localAppData, exe, `${exe}.exe`));
      candidates.push(join(localAppData, 'Google', exe, `${exe}.exe`));
    }
    const programFiles = process.env.ProgramFiles ?? '';
    if (programFiles) {
      candidates.push(join(programFiles, exe, `${exe}.exe`));
    }
  } else {
    // Unix: cek /usr/local/bin, /usr/bin, ~/.local/bin, ~/.cargo/bin
    candidates.push(`/usr/local/bin/${exe}`);
    candidates.push(`/usr/bin/${exe}`);
    const home = homedir();
    candidates.push(join(home, '.local', 'bin', exe));
    candidates.push(join(home, '.cargo', 'bin', exe));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }

  // Cek di PATH via which/where
  const checkCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(checkCmd, [exe], { windowsHide: true, stdio: 'pipe' });
    if (result.status === 0) {
      const path = result.stdout.toString().trim().split(/\r?\n/)[0]?.trim();
      if (path && existsSync(path)) return path;
    }
  } catch { /* ignore */ }

  return null;
}

/** Bangun env untuk process agent: sertakan PATH yang sudah diperluas. */
function buildAgentEnv(projectPath: string): Record<string, string> {
  return {
    ...process.env,
    TERM: process.platform === 'win32' ? 'cygwin' : 'xterm-256color',
    COLORTERM: 'truecolor',
    // Beri tahu agent di mana project berada
    GITHUB_WORKSPACE: projectPath,
    EDITOR_PROJECT_PATH: projectPath,
  };
}

export function createAgentService(getRouterConfig: () => RouterConfig | null): AgentService {
  const cliSessions = new Map<string, CliSession>();
  const llmSessions = new Map<string, LlmSession>();
  let tearingDown = false;

  const agents = new Map<string, AgentEntry>(
    (globalThis as any).__RUANG_KERJA_AGENTS_CACHE || undefined,
  );

  function ensureAgents(): void {
    if (agents.size > 0) return;
    // Registrasi agent built-in
    const { BUILTIN_AGENTS } = require('../../shared/agents');
    for (const agent of BUILTIN_AGENTS) {
      agents.set(agent.id, { ...agent });
    }
  }

  ensureAgents();

  return {
    listAgents(): AgentEntry[] {
      ensureAgents();
      return Array.from(agents.values());
    },

    getAgent(id: string): AgentEntry | null {
      return agents.get(id) ?? null;
    },

    async startChat(
      agentId: string,
      projectPath: string | null,
      onEvent: (ev: AgentEvent) => void,
      messages: ChatMessage[] = [],
    ): Promise<string> {
      const agent = agents.get(agentId);
      if (!agent) throw new Error(`Agent '${agentId}' tidak ditemukan.`);

      const sessionId = `llm_${randomUUID()}`;
      const config = getRouterConfig();
      const endpoint = agent.endpoint ?? config?.endpoint ?? '';
      const apiKey = agent.apiKey ?? config?.apiKey ?? '';

      if (!endpoint || !apiKey) {
        throw new Error('Konfigurasi 9router (endpoint + API key) tidak lengkap.');
      }

      const llmSession: LlmSession = {
        id: sessionId,
        agent,
        controller: null,
        onEvent,
        killed: false,
      };
      llmSessions.set(sessionId, llmSession);

      onEvent({ type: 'state', state: { status: 'starting', agentId: agent.id } });

      // Bangun system prompt + history
      const systemPrompt = agent.systemPrompt;
      const conversation: Array<{ role: string; content: string }> = [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      const controller = new AbortController();
      llmSession.controller = controller;

      try {
        const response = await fetch(`${endpoint}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'RuangKerja-Agent/v0.4.4',
          },
          body: JSON.stringify({
            model: agent.model,
            messages: conversation,
            stream: true,
            max_tokens: 4096,
            temperature: 0.7,
            // Sertakan konteks project jika tersedia
            ...(projectPath ? { metadata: { project_path: projectPath } } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = response.statusText;
          onEvent({ type: 'error', message: `API error ${response.status}: ${text}` });
          onEvent({ type: 'state', state: { status: 'error', agentId: agent.id, error: text } });
          return sessionId;
        }

        onEvent({ type: 'state', state: { status: 'running', agentId: agent.id } });

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Stream reader tidak tersedia.');
        }

        const decoder = new TextDecoder();

        while (true && !llmSession.killed) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });

          // Parse SSE chunks dari OpenAI-compatible endpoint
          const lines = chunk.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const data = trimmed.slice(6);
              if (data === '[DONE]') {
                // Stream selesai
                break;
              }
              try {
                const parsed = JSON.parse(data) as {
                  choices?: Array<{
                    delta?: { content?: string };
                    finish_reason?: string | null;
                  }>;
                };
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  onEvent({ type: 'output', data: content });
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }

        onEvent({ type: 'state', state: { status: 'stopped', agentId: agent.id } });
      } catch (err) {
        if (controller.signal.aborted) return sessionId;
        const msg = (err as Error).message;
        onEvent({ type: 'error', message: msg });
        onEvent({ type: 'state', state: { status: 'error', agentId: agent.id, error: msg } });
      }

      return sessionId;
    },

    async startCli(
      agentId: string,
      projectPath: string,
      cols: number,
      rows: number,
      onEvent: (ev: AgentEvent) => void,
    ): Promise<string> {
      const agent = agents.get(agentId);
      if (!agent) throw new Error(`Agent '${agentId}' tidak ditemukan.`);
      if (!agent.cliCommand || agent.cliCommand.length === 0) {
        throw new Error(`Agent '${agent.name}' tidak mendukung mode CLI.`);
      }

      // Cari binary
      const cliPath = findCliBinary(agent.cliCommand[0]);
      if (!cliPath) {
        throw new Error(`Binary '${agent.cliCommand[0]}' tidak ditemukan di PATH. Install dulu ${agent.name} CLI.`);
      }

      const sessionId = `cli_${randomUUID()}`;
      const args = agent.cliCommand.slice(1);
      const env = buildAgentEnv(projectPath);

      let handle: IPty;
      try {
        handle = pty.spawn(cliPath, args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: projectPath,
          env,
        });
      } catch (err) {
        throw new Error(`Gagal memulai ${agent.name}: ${(err as Error).message}`);
      }

      const cliSession: CliSession = {
        id: sessionId,
        agent,
        pty: handle,
        onEvent,
        killed: false,
      };
      cliSessions.set(sessionId, cliSession);

      onEvent({ type: 'state', state: { status: 'starting', agentId: agent.id } });

      handle.onData((data: string) => {
        if (cliSession.killed || tearingDown) return;
        if (cliSessions.get(sessionId) !== cliSession) return;
        onEvent({ type: 'output', data });
      });

      handle.onExit(({ exitCode }: { exitCode: number }) => {
        if (cliSession.killed) return;
        cliSession.killed = true;
        cliSessions.delete(sessionId);
        onEvent({ type: 'exit', code: typeof exitCode === 'number' ? exitCode : 0 });
        onEvent({ type: 'state', state: { status: 'stopped', agentId: agent.id } });
      });

      onEvent({ type: 'state', state: { status: 'running', agentId: agent.id } });

      return sessionId;
    },

    async sendInput(sessionId: string, data: string): Promise<void> {
      const cli = cliSessions.get(sessionId);
      if (cli && !cli.killed) {
        try {
          cli.pty.write(data);
          return;
        } catch { /* ignore */ }
      }
      // LLM sessions don't accept input
    },

    async resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
      const cli = cliSessions.get(sessionId);
      if (cli && !cli.killed) {
        try {
          cli.pty.resize(Math.max(1, cols), Math.max(1, rows));
        } catch { /* ignore */ }
      }
    },

    async stopAgent(sessionId: string): Promise<void> {
      const cli = cliSessions.get(sessionId);
      if (cli) {
        cli.killed = true;
        cliSessions.delete(sessionId);
        try {
          cli.pty.kill();
        } catch { /* ignore */ }
        // Kill child process tree on Windows
        if (process.platform === 'win32') {
          try {
            spawn('taskkill', ['/PID', String(cli.pty.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            }).on('error', () => undefined);
          } catch { /* ignore */ }
        }
        return;
      }

      const llm = llmSessions.get(sessionId);
      if (llm) {
        llm.killed = true;
        llmSessions.delete(sessionId);
        if (llm.controller) {
          llm.controller.abort();
        }
      }
    },

    disposeAll(): void {
      tearingDown = true;
      for (const session of Array.from(cliSessions.values())) {
        session.killed = true;
        try { session.pty.kill(); } catch { /* ignore */ }
      }
      cliSessions.clear();

      for (const session of Array.from(llmSessions.values())) {
        session.killed = true;
        if (session.controller) {
          session.controller.abort();
        }
      }
      llmSessions.clear();
      tearingDown = false;
    },
  };
}
