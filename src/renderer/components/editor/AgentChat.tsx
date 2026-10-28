// Pane chat AI agent — mirip VS Code Copilot panel + Claude Code agent mode.
// Simple UI, bisa di-maximize ke fullsize / diminimize ke pojok kanan bawah.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEntry, ChatMessage, AgentEvent } from '../../../shared/agents';
import { IconSend, Spinner, IconChevronDown, IconChevronUp, IconCopy, IconX, IconTrash, IconCheck, IconMaximize, IconMinimize } from '../icons';

interface Props {
  wb: { root: string | null; activePath: string | null };
  visible: boolean;
  onToggle: () => void;
  onMaximize: () => void;
}

interface ChatSession {
  id: string;
  agent: AgentEntry;
  status: 'idle' | 'starting' | 'running' | 'stopped' | 'error';
}

const STORAGE_KEY = 'rk.ai.lastAgent';
const HISTORY_KEY = 'rk.ai.chatHistory';

function MessageBubble({ msg, onCopy, copied }: { msg: ChatMessage; onCopy: (content: string) => void; copied: boolean }) {
  const isUser = msg.role === 'user';
  if (msg.role === 'system') return null;
  return (
    <div className={`ai-msg ${isUser ? 'ai-msg-user' : 'ai-msg-assistant'}`}>
      <div className="ai-msg-content">{msg.content}</div>
      {!isUser ? (
        <button
          type="button"
          className="ai-msg-copy"
          title="Salin"
          onClick={() => onCopy(msg.content)}
        >
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
        </button>
      ) : null}
    </div>
  );
}

export function AgentChat({ wb, visible, onToggle, onMaximize }: Props) {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string>('poolside');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Map<string, ChatSession>>(new Map());
  const [minimized, setMinimized] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load agents on mount
  useEffect(() => {
    void window.rk.agentList().then((list) => {
      setAgents(list);
      // Restore last agent or default
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && list.some((a) => a.id === saved)) {
          setActiveAgentId(saved);
        }
      } catch { /* ignore */ }
    }).catch((err) => {
      setError('Gagal memuat daftar agent: ' + err.message);
    });
  }, []);

  // Save active agent
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, activeAgentId); } catch { /* ignore */ }
  }, [activeAgentId]);

  // Subscribe to agent events
  useEffect(() => {
    const unsub = window.rk.onAgentEvent(({ event }: { event: AgentEvent }) => {
      if (event.type === 'output') {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          return [...prev.slice(0, -1), { ...last, content: last.content + event.data }];
        });
      } else if (event.type === 'error') {
        setError(event.message);
      } else if (event.type === 'state') {
        setSessions((prev) => {
          const map = new Map(prev);
          for (const [id, sess] of map) {
            if (sess.status !== 'stopped') {
              map.set(id, { ...sess, status: event.state.status });
            }
          }
          return map;
        });
        if (event.state.status === 'running') setLoading(true);
        if (['stopped', 'error', 'idle'].includes(event.state.status)) setLoading(false);
      } else if (event.type === 'exit') {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const activeAgent = agents.find((a) => a.id === activeAgentId);

  const saveCopied = useCallback((content: string) => {
    setCopiedMsg(content);
    setTimeout(() => setCopiedMsg(null), 2000);
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !activeAgent) return;

    setError(null);

    // Add user message
    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: text,
      ts: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    // Add empty assistant message (for streaming)
    const assistantMsg: ChatMessage = {
      id: `a_${Date.now()}`,
      role: 'assistant',
      content: '',
      ts: Date.now(),
      streaming: true,
    };
    setMessages((prev) => [...prev, assistantMsg]);
    setLoading(true);

    try {
      const result = await window.rk.agentStartChat(activeAgent.id, [...messages, userMsg]);
      if (!result.ok) {
        setError(result.error ?? 'Gagal memulai agent.');
        // Update last message with error
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          return [...prev.slice(0, -1), { ...last, content: `❌ ${result.error ?? 'Gagal'}`, streaming: false }];
        });
      } else {
        // Session started; streaming output will come via onAgentEvent
        setSessions((prev) => new Map(prev).set(result.sessionId!, {
          id: result.sessionId!,
          agent: activeAgent,
          status: 'starting',
        }));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [input, loading, activeAgent, messages]);

  const clearChat = useCallback(() => {
    setMessages([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  }, []);

  const toggleMinimize = useCallback(() => setMinimized((m) => !m), []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  if (!visible) return null;

  return (
    <div className={`ai-panel ${minimized ? 'ai-panel-minimized' : ''}`}>
      <div className="ai-panel-header">
        <div className="ai-panel-title">
          <span className="ai-agent-icon">{activeAgent?.icon ?? '🌊'}</span>
          <span>{activeAgent?.name ?? 'AI Agent'}</span>
        </div>
        <div className="ai-panel-actions">
          <button type="button" className="ai-icon-btn" title="Perkecil" onClick={toggleMinimize}>
            {minimized ? <IconMaximize size={14} /> : <IconMinimize size={14} />}
          </button>
          <button type="button" className="ai-icon-btn" title="Tutup" onClick={onToggle}>
            <IconX size={14} />
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          <div className="ai-agent-switcher">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`ai-agent-btn ${activeAgentId === agent.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveAgentId(agent.id);
                  setMessages([]);
                  setError(null);
                }}
                title={agent.systemPrompt.slice(0, 100)}
              >
                <span className="ai-agent-icon">{agent.icon}</span>
                {agent.name}
              </button>
            ))}
          </div>

          <div className="ai-messages">
            {messages.filter((m) => m.role !== 'system').length === 0 && !loading ? (
              <div className="ai-empty">
                <span className="ai-empty-icon">{activeAgent?.icon ?? '🌊'}</span>
                <p className="ai-empty-title">{activeAgent?.name ?? 'AI Agent'}</p>
                <p className="ai-empty-sub">
                  Tanya soal kode, proyek ini, atau minta bantuan coding.
                  Tekan Enter untuk kirim, Shift+Enter untuk baris baru.
                </p>
              </div>
            ) : (
              messages.filter((m) => m.role !== 'system').map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  onCopy={saveCopied}
                  copied={copiedMsg === msg.content}
                />
              ))
            )}
            {loading && (
              <div className="ai-msg ai-msg-assistant">
                <div className="ai-msg-content">
                  <Spinner size={14} />
                  <span> Berpikir...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="ai-input-row">
            <textarea
              ref={inputRef}
              className="ai-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={loading ? 'Menunggu agent...' : `Tanya ke ${activeAgent?.name ?? 'agent'}...`}
              rows={2}
              disabled={loading || !activeAgent}
              aria-label="Pesan AI agent"
            />
            {error ? <span className="ai-error">{error}</span> : null}
            <button
              type="button"
              className="ai-send-btn"
              onClick={() => void sendMessage()}
              disabled={loading || !input.trim() || !activeAgent}
              title="Kirim (Enter)"
            >
              {loading ? <Spinner size={16} /> : <IconSend size={16} />}
            </button>
          </div>

          <div className="ai-panel-footer">
            <button type="button" className="ai-clear-btn" onClick={clearChat} disabled={messages.length === 0}>
              <IconTrash size={12} /> Hapus Chat
            </button>
            <button type="button" className="ai-icon-btn" title="Penuh" onClick={onMaximize}>
              <IconMaximize size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
