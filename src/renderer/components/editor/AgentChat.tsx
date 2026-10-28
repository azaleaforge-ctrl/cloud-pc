import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEntry, AgentEvent, AgentRouterStatus, AgentRouterTestResult, ChatMessage } from '../../../shared/agents';
import {
  IconSend, Spinner, IconCopy, IconX, IconTrash, IconCheck, IconMaximize, IconMinimize,
} from '../icons';

interface Props {
  wb: { root: string | null; activePath: string | null };
  visible: boolean;
  onToggle: () => void;
  onMaximize: () => void;
}

interface PendingPermission {
  sessionId: string;
  requestId: string;
  command: string;
  reason: string;
}

const STORAGE_KEY = 'rk.ai.lastAgent';
const HISTORY_KEY = 'rk.ai.chatHistory';

function loadSavedMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item) =>
      item && typeof item.id === 'string' &&
      (item.role === 'user' || item.role === 'assistant') &&
      typeof item.content === 'string',
    ).slice(-80);
  } catch {
    return [];
  }
}

function MessageBubble({ msg, onCopy, copied }: { msg: ChatMessage; onCopy: (content: string) => void; copied: boolean }) {
  const isUser = msg.role === 'user';
  if (msg.role === 'system' || !msg.content) return null;
  return (
    <div className={'ai-msg ' + (isUser ? 'ai-msg-user' : 'ai-msg-assistant')}>
      <div className="ai-msg-content">{msg.content}</div>
      {!isUser ? (
        <button type="button" className="ai-msg-copy" title="Salin" onClick={() => onCopy(msg.content)}>
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
        </button>
      ) : null}
    </div>
  );
}

export function AgentChat({ wb, visible, onToggle, onMaximize }: Props) {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [activeAgentId, setActiveAgentId] = useState('poolside');
  const [messages, setMessages] = useState<ChatMessage[]>(loadSavedMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState('');
  const [minimized, setMinimized] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);
  const [routerStatus, setRouterStatus] = useState<AgentRouterStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<AgentRouterTestResult | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshRouterStatus = useCallback(async () => {
    try {
      const status = await window.rk.agentGetConfig();
      setRouterStatus(status);
      if (!status.configured) setSettingsOpen(true);
    } catch (err) {
      setError('Gagal membaca konfigurasi 9router: ' + (err as Error).message);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void window.rk.agentList().then((list) => {
      if (!alive) return;
      const chatAgents = list.filter((agent) => agent.type === 'llm-chat');
      setAgents(chatAgents);
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && chatAgents.some((agent) => agent.id === saved)) setActiveAgentId(saved);
      } catch { /* localStorage can be unavailable */ }
    }).catch((err) => {
      if (alive) setError('Gagal memuat agent: ' + (err as Error).message);
    });
    void refreshRouterStatus();
    return () => { alive = false; };
  }, [refreshRouterStatus]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, activeAgentId); } catch { /* ignore */ }
  }, [activeAgentId]);

  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-80))); } catch { /* ignore */ }
  }, [messages]);

  // Error message is deliberately transient. Long-running work uses a separate status indicator.
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    const unsub = window.rk.onAgentEvent(({ sessionId, event }: { sessionId: string; event: AgentEvent }) => {
      if (event.type === 'output') {
        setMessages((previous) => {
          const index = previous.map((item) => item.role).lastIndexOf('assistant');
          if (index < 0) return previous;
          const next = [...previous];
          const last = next[index];
          next[index] = { ...last, content: last.content + event.data, streaming: true };
          return next;
        });
      } else if (event.type === 'error') {
        setError(event.message);
        setLoading(false);
        setActivity('');
        setMessages((previous) => previous.map((item, index) =>
          index === previous.length - 1 && item.role === 'assistant'
            ? { ...item, streaming: false }
            : item,
        ));
      } else if (event.type === 'activity') {
        setActivity(event.message);
      } else if (event.type === 'permission-request') {
        setPermission({
          sessionId,
          requestId: event.requestId,
          command: event.command,
          reason: event.reason,
        });
        setActivity('Menunggu persetujuan command terminal');
      } else if (event.type === 'permission-result') {
        setPermission((current) => current?.requestId === event.requestId ? null : current);
      } else if (event.type === 'state') {
        if (event.state.status === 'starting' || event.state.status === 'running') {
          setLoading(true);
        }
        if (event.state.status === 'stopped' || event.state.status === 'error' || event.state.status === 'idle') {
          setLoading(false);
          setActivity('');
          setPermission((current) => current?.sessionId === sessionId ? null : current);
          setMessages((previous) => previous.map((item, index) =>
            index === previous.length - 1 && item.role === 'assistant'
              ? { ...item, streaming: false }
              : item,
          ));
          setActiveSessionId((current) => current === sessionId ? null : current);
        }
      } else if (event.type === 'exit') {
        setLoading(false);
        setActivity('');
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, activity, permission]);

  const activeAgent = agents.find((agent) => agent.id === activeAgentId);

  useEffect(() => {
    if (!testResult || testResult.ok) return;
    const timer = window.setTimeout(() => setTestResult(null), 5000);
    return () => window.clearTimeout(timer);
  }, [testResult]);

  const saveCopied = useCallback((content: string) => {
    void navigator.clipboard?.writeText(content).catch(() => undefined);
    setCopiedMsg(content);
    window.setTimeout(() => setCopiedMsg(null), 1800);
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !activeAgent) return;
    setError(null);
    setActivity('Menghubungkan ke agent…');
    const userMsg: ChatMessage = { id: 'u_' + Date.now(), role: 'user', content: text, ts: Date.now() };
    const assistantMsg: ChatMessage = { id: 'a_' + Date.now(), role: 'assistant', content: '', ts: Date.now(), streaming: true };
    setMessages((previous) => [...previous, userMsg, assistantMsg]);
    setInput('');
    setLoading(true);
    setActiveSessionId(null);
    setPermission(null);

    try {
      const result = await window.rk.agentStartChat(activeAgent.id, [...messages, userMsg]);
      if (!result.ok || !result.sessionId) {
        throw new Error(result.error ?? 'Agent gagal dimulai.');
      }
      setActiveSessionId(result.sessionId);
    } catch (err) {
      setError((err as Error).message || 'Gagal memulai agent.');
      setLoading(false);
      setActivity('');
      setMessages((previous) => previous.map((item, index) =>
        index === previous.length - 1 && item.role === 'assistant'
          ? { ...item, streaming: false }
          : item,
      ));
    }
  }, [input, loading, activeAgent, messages]);

  const stopAgent = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      await window.rk.agentStop(activeSessionId);
    } catch (err) {
      setError('Gagal menghentikan agent: ' + (err as Error).message);
    }
  }, [activeSessionId]);

  const testRouterConnection = useCallback(async (): Promise<AgentRouterTestResult | null> => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const result = await window.rk.agentTestConfig();
      setTestResult(result);
      if (result.ok) setActivity('Koneksi model berhasil diverifikasi.');
      else setActivity('');
      return result;
    } catch (err) {
      const result: AgentRouterTestResult = {
        ok: false,
        message: 'Gagal menguji koneksi: ' + ((err as Error).message || 'kesalahan tidak diketahui'),
      };
      setTestResult(result);
      setActivity('');
      return result;
    } finally {
      setTestingConnection(false);
    }
  }, []);

  const saveRouterKey = useCallback(async () => {
    if (!apiKey.trim() || savingKey) return;
    setSavingKey(true);
    setTestResult(null);
    try {
      const result = await window.rk.agentSaveConfig(apiKey);
      if (!result.ok) throw new Error(result.error ?? 'Gagal menyimpan API key.');
      setApiKey('');
      await refreshRouterStatus();
      setError(null);
      setActivity('');
      const connectivity = await window.rk.agentTestConfig();
      setTestResult(connectivity);
      if (connectivity.ok) {
        setActivity('Koneksi 9router dan model berhasil diuji.');
        setSettingsOpen(false);
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: (err as Error).message || 'Gagal menyimpan API key.',
      });
    } finally {
      setSavingKey(false);
    }
  }, [apiKey, savingKey, refreshRouterStatus]);

  const resolvePermission = useCallback(async (approved: boolean) => {
    const current = permission;
    if (!current) return;
    setPermission(null);
    setActivity(approved ? 'Command disetujui; menjalankan terminal…' : 'Command ditolak.');
    try {
      await window.rk.agentApproveTool(current.sessionId, current.requestId, approved);
    } catch (err) {
      setError('Gagal mengirim keputusan terminal: ' + (err as Error).message);
    }
  }, [permission]);

  const clearChat = useCallback(() => {
    if (activeSessionId) void window.rk.agentStop(activeSessionId);
    setMessages([]);
    setError(null);
    setActivity('');
    setPermission(null);
    setLoading(false);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  }, [activeSessionId]);

  const toggleMinimize = useCallback(() => setMinimized((value) => !value), []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  if (!visible) return null;

  return (
    <div className={'ai-panel' + (minimized ? ' minimized' : '')}>
      <div className="ai-panel-header">
        <div className="ai-panel-title">
          <span className="ai-agent-icon">{activeAgent?.icon ?? '🌊'}</span>
          <span>{activeAgent?.name ?? 'AI Coding Agent'}</span>
          <span className={'ai-router-dot ' + (routerStatus?.configured ? 'ready' : 'missing')} title={routerStatus?.configured ? '9router siap' : 'API key 9router belum disetel'} />
        </div>
        <div className="ai-panel-actions">
          <button type="button" className="ai-icon-btn" title="Pengaturan 9router" onClick={() => setSettingsOpen((open) => !open)}>⚙</button>
          {loading ? <button type="button" className="ai-icon-btn ai-stop-btn" title="Hentikan agent" onClick={() => void stopAgent()}>■</button> : null}
          <button type="button" className="ai-icon-btn" title={minimized ? 'Perbesar panel' : 'Perkecil panel'} onClick={toggleMinimize}>
            {minimized ? <IconMaximize size={14} /> : <IconMinimize size={14} />}
          </button>
          <button type="button" className="ai-icon-btn" title="Tutup" onClick={onToggle}><IconX size={14} /></button>
        </div>
      </div>

      {!minimized && (
        <>
          {settingsOpen ? (
            <section className="ai-settings">
              <div className="ai-settings-title">Koneksi 9router</div>
              <label className="ai-settings-label" htmlFor="rk-router-key">API key</label>
              <div className="ai-settings-key-row">
                <input
                  id="rk-router-key"
                  className="ai-settings-key"
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={routerStatus?.configured ? 'API key sudah tersimpan; isi untuk mengganti' : 'Masukkan API key 9router'}
                />
                <button type="button" className="ai-settings-save" onClick={() => void saveRouterKey()} disabled={!apiKey.trim() || savingKey}>
                  {savingKey ? 'Menyimpan…' : 'Simpan'}
                </button>
              </div>
              <div className="ai-settings-meta">
                <div><span>Model</span><code>{routerStatus?.model ?? 'ps/poolside/laguna-s-2.1(high)'}</code></div>
                <div><span>Utama</span><code>{routerStatus?.endpoint ?? 'https://rbxludp.abc-tunnel.us/v1'}</code></div>
                <div><span>Cadangan</span><code>{routerStatus?.fallbackEndpoint ?? 'http://localhost:20128/v1'}</code></div>
              </div>
              <p className="ai-settings-note">API key disimpan terenkripsi di perangkat ini dan tidak ditulis ke file proyek. Koneksi utama dicoba lebih dahulu, lalu endpoint lokal jika diperlukan.</p>
            </section>
          ) : null}

          <div className="ai-agent-switcher">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={'ai-agent-btn' + (activeAgentId === agent.id ? ' active' : '')}
                onClick={() => {
                  if (loading) return;
                  setActiveAgentId(agent.id);
                  setError(null);
                }}
                title={agent.systemPrompt.slice(0, 120)}
              >
                <span className="ai-agent-icon">{agent.icon}</span>
                {agent.name}
              </button>
            ))}
            <span className="ai-agent-mode">Agentic tools</span>
          </div>

          <div className="ai-messages">
            {messages.filter((message) => message.role !== 'system' && message.content).length === 0 && !loading ? (
              <div className="ai-empty">
                <span className="ai-empty-icon">{activeAgent?.icon ?? '🌊'}</span>
                <p className="ai-empty-title">AI Coding Agent</p>
                <p className="ai-empty-sub">
                  Agent dapat membaca dan mengubah file proyek. Perintah terminal selalu meminta persetujuanmu.
                  Tekan Enter untuk kirim, Shift+Enter untuk baris baru.
                </p>
              </div>
            ) : (
              messages.filter((message) => message.role !== 'system' && message.content).map((message) => (
                <MessageBubble key={message.id} msg={message} onCopy={saveCopied} copied={copiedMsg === message.content} />
              ))
            )}

            {loading ? (
              <div className="ai-agent-activity">
                <Spinner size={13} />
                <span>{activity || 'Agent sedang bekerja…'}</span>
              </div>
            ) : null}

            {permission ? (
              <div className="ai-permission-card">
                <div className="ai-permission-heading"><strong>Persetujuan terminal diperlukan</strong><span>Command belum dijalankan</span></div>
                <p>{permission.reason}</p>
                <pre>{permission.command}</pre>
                <div className="ai-permission-actions">
                  <button type="button" className="ai-permission-deny" onClick={() => void resolvePermission(false)}>Tolak</button>
                  <button type="button" className="ai-permission-approve" onClick={() => void resolvePermission(true)}>Izinkan sekali</button>
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <div className="ai-input-row">
            <textarea
              ref={inputRef}
              className="ai-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={loading ? 'Agent sedang bekerja…' : 'Minta agent memeriksa atau mengubah kode…'}
              rows={2}
              disabled={loading || !activeAgent}
              aria-label="Pesan AI coding agent"
            />
            <button
              type="button"
              className="ai-send-btn"
              onClick={() => void sendMessage()}
              disabled={loading || !input.trim() || !activeAgent}
              title="Kirim (Enter)"
            >
              {loading ? <Spinner size={16} /> : <IconSend size={16} />}
            </button>
            {error ? <span className="ai-error" role="alert">{error}</span> : null}
          </div>

          <div className="ai-panel-footer">
            <button type="button" className="ai-clear-btn" onClick={clearChat} disabled={messages.length === 0 && !loading}>
              <IconTrash size={12} /> Hapus Chat
            </button>
            <span className="ai-footer-workspace">{wb.root ? 'Workspace aktif' : 'Belum ada workspace'}</span>
            <button type="button" className="ai-icon-btn" title="Buka penuh" onClick={onMaximize}><IconMaximize size={14} /></button>
          </div>
        </>
      )}
    </div>
  );
}
