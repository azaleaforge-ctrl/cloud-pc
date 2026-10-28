// Pane chat AI agent — mirip VS Code Copilot panel.
// Simple UI, bisa di-resize ke fullsize / dikecilkan.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEntry, ChatMessage } from '../../../shared/agents';
import { BUILTIN_AGENTS } from '../../../shared/agents';
import { IconSend, IconX, Spinner, IconChevronDown, IconChevronUp, IconCopy, IconCheck, IconTrash } from '../icons';

const STORAGE_KEY = 'rk.ai.lastAgent';
const CHAT_HISTORY_KEY = 'rk.ai.chatHistory';

interface MessageBubbleProps {
  msg: ChatMessage;
  onCopy: (content: string) => void;
  copied: boolean;
}

function MessageBubble({ msg, onCopy, copied }: MessageBubbleProps) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  if (isSystem) return null;
  return (
    <div className={`ai-msg ${isUser ? 'ai-msg-user' : 'ai-msg-assistant'}`}>
      <div className="ai-msg-content">{msg.content}</div>
      {!isUser && (
        <button
          type="button"
          className="ai-msg-copy"
          title="Salin"
          onClick={() => onCopy(msg.content)}
        >
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
        </button>
      )}
    </div>
  );
}

interface Props {
  wb: { root: string | null; activePath: string | null };
  visible: boolean;
  onToggle: () => void;
  onMaximize: () => void;
}

export function AgentChat({ wb, visible, onToggle, onMaximize }: Props) {
  const [agents] = useState<AgentEntry[]>(BUILTIN_AGENTS);
  const [activeAgentId, setActiveAgentId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && BUILTIN_AGENTS.some((a) => a.id === saved)) return saved;
    } catch { /* ignore */ }
    return 'claudecode';
  });
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(CHAT_HISTORY_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Persist active agent
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, activeAgentId); } catch { /* ignore */ }
  }, [activeAgentId]);

  // Persist chat history (trim to last 100 messages)
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages.slice(-100)));
    } catch { /* ignore */ }
  }, [messages]);

  // Auto-scroll ke bawah
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const activeAgent = agents.find((a) => a.id === activeAgentId) ?? agents[0];

  const saveCopied = useCallback((content: string) => {
    setCopiedMsg(content);
    setTimeout(() => setCopiedMsg(null), 2000);
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !activeAgent) return;
    setError(null);

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: text,
      ts: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    const assistantMsg: ChatMessage = {
      id: `a_${Date.now()}`,
      role: 'assistant',
      content: '',
      ts: Date.now(),
      streaming: true,
    };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: activeAgent.id,
          model: activeAgent.model,
          provider: activeAgent.provider,
          endpoint: activeAgent.endpoint,
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          projectPath: wb.root,
          activeFile: wb.activePath,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(err || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Streaming tidak didukung');

      let accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          return [...prev.slice(0, -1), { ...last, content: accumulated }];
        });
      }
      // Final flush
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        return [...prev.slice(0, -1), { ...last, content: accumulated, streaming: false }];
      });
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      // Update last message with error
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        return [...prev.slice(0, -1), { ...last, content: `❌ ${msg}`, streaming: false }];
      });
    } finally {
      setLoading(false);
    }
  }, [input, loading, activeAgent, messages, wb.root, wb.activePath]);

  const clearChat = useCallback(() => {
    setMessages([]);
    try { localStorage.removeItem(CHAT_HISTORY_KEY); } catch { /* ignore */ }
  }, []);

  const switchAgent = useCallback((id: string) => {
    setActiveAgentId(id);
    // Start new conversation on agent switch
    setMessages([{
      id: `s_${Date.now()}`,
      role: 'system',
      content: `Switched to ${agents.find((a) => a.id === id)?.name ?? id}. Ask me anything!`,
      ts: Date.now(),
    }]);
  }, [agents]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const toggleCollapse = useCallback(() => setPanelCollapsed((v) => !v), []);

  if (!visible) return null;

  return (
    <div className="ai-panel">
      <div className="ai-panel-header">
        <div className="ai-panel-title">
          <span className="ai-agent-icon">{activeAgent?.icon ?? '🤖'}</span>
          <span>{activeAgent?.name ?? 'AI Agent'}</span>
        </div>
        <div className="ai-panel-actions">
          <button type="button" className="ai-icon-btn" title="Pilih Agent" onClick={() => setPanelCollapsed(false)}>
            <IconChevronDown size={14} />
          </button>
          <button type="button" className="ai-icon-btn" title={panelCollapsed ? 'Perbesar' : 'Perkecil'} onClick={toggleCollapse}>
            {panelCollapsed ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
          </button>
          <button type="button" className="ai-icon-btn" title="Tutup" onClick={onToggle}>
            <IconX size={14} />
          </button>
        </div>
      </div>

      {!panelCollapsed && (
        <>
          {!activeAgent ? null : (
            <div className="ai-agent-switcher">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={`ai-agent-btn ${activeAgentId === agent.id ? 'active' : ''}`}
                  onClick={() => switchAgent(agent.id)}
                  title={agent.systemPrompt.slice(0, 80)}
                >
                  <span className="ai-agent-icon">{agent.icon}</span>
                  {agent.name}
                </button>
              ))}
            </div>
          )}

          <div className="ai-messages">
            {messages.filter((m) => m.role !== 'system').length === 0 ? (
              <div className="ai-empty">
                <span className="ai-empty-icon">{activeAgent?.icon ?? '🤖'}</span>
                <p className="ai-empty-title">{activeAgent?.name ?? 'AI Agent'}</p>
                <p className="ai-empty-sub">
                  Tanya soal kode, proyek ini, atau minta bantuan coding.
                  Tekan Ctrl+Shift+L untuk fokus.
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
            <div ref={bottomRef} />
          </div>

          <div className="ai-input-row">
            <textarea
              ref={inputRef}
              className="ai-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Tanya ke ${activeAgent?.name ?? 'agent'}...`}
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
            <button type="button" className="ai-clear-btn" onClick={clearChat}>
              <IconTrash size={12} /> Hapus Chat
            </button>
            <button type="button" className="ai-icon-btn" title="Pengaturan API" onClick={onMaximize}>
              <IconChevronUp size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
