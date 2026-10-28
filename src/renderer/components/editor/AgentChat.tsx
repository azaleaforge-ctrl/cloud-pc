import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AgentEntry,
  AgentEvent,
  AgentFileChange,
  AgentRouterStatus,
  AgentRouterTestResult,
  AgentSkillSelection,
  ChatMessage,
} from '../../../shared/agents';
import { IconSend, Spinner, IconCopy, IconX, IconTrash, IconCheck } from '../icons';

interface Props {
  wb: { root: string | null; activePath: string | null };
  visible: boolean;
  onToggle: () => void;
}

interface PendingPermission {
  sessionId: string;
  requestId: string;
  command: string;
  reason: string;
}

interface DiffRow {
  kind: 'same' | 'change' | 'add' | 'remove';
  oldLine: number | null;
  newLine: number | null;
  oldText: string;
  newText: string;
}

const STORAGE_KEY = 'rk.ai.lastAgent';
const HISTORY_KEY = 'rk.ai.chatHistory';

function pathName(path: string | null): string {
  if (!path) return 'Workspace belum dipilih';
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

function loadSavedMessages(): ChatMessage[] {
  // Chat history is intentionally ephemeral and does not persist across app/chat sessions.
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* storage can be unavailable */ }
  return [];
}

function makeConversationId(): string {
  return 'chat-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function inlineMarkdown(source: string, keyPrefix: string): ReactNode[] {
  const pattern = /(\`[^\`]+\`|\*\*[\s\S]+?\*\*|__[\s\S]+?__|~~[\s\S]+?~~|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\))/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  for (const match of source.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(source.slice(cursor, start));
    const key = keyPrefix + '-' + tokenIndex++;
    if (token.startsWith('\`')) {
      nodes.push(<code className="ai-inline-code" key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<s key={key}>{token.slice(2, -2)}</s>);
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+|mailto:[^)]+)\)$/);
      if (link) nodes.push(<a key={key} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>);
      else nodes.push(token);
    }
    cursor = start + token.length;
  }
  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes;
}

function isTableSeparator(line: string): boolean {
  const clean = line.trim();
  return clean.includes('|') && /^\|?[\s:|-]+\|?$/.test(clean) && clean.includes('-');
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  return /^\s*\`\`\`/.test(line) || /^#{1,6}\s+/.test(line) ||
    /^\s*(?:[-*_]\s*){3,}$/.test(line) || /^\s*\/{3,}\s*$/.test(line) || /^\s*>/.test(line) ||
    /^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line) ||
    (line.trim().startsWith('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1]));
}

/** Safe Markdown renderer for model output. It renders markup instead of displaying literal **, list markers, or HTML. */
function MarkdownContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }

    const fence = line.match(/^\s*\`\`\`\s*([\w.+#-]*)\s*$/);
    if (fence) {
      const language = fence[1] || 'code';
      index++;
      const code: string[] = [];
      while (index < lines.length && !/^\s*\`\`\`\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(
        <div className="ai-code-block" key={'md-' + key++}>
          <div className="ai-code-language">{language}</div>
          <pre><code>{code.join('\n')}</code></pre>
        </div>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const depth = heading[1].length;
      const children = inlineMarkdown(heading[2], 'heading-' + key);
      const headingKey = 'md-' + key++;
      if (depth === 1) blocks.push(<h2 key={headingKey}>{children}</h2>);
      else if (depth === 2) blocks.push(<h3 key={headingKey}>{children}</h3>);
      else blocks.push(<h4 key={headingKey}>{children}</h4>);
      index++;
      continue;
    }

    if (/^\s*(?:[-*_]\s*){3,}$/.test(line) || /^\s*\/{3,}\s*$/.test(line)) {
      blocks.push(<hr key={'md-' + key++} />);
      index++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index++].replace(/^\s*>\s?/, ''));
      }
      blocks.push(<blockquote key={'md-' + key++}>{quote.map((item, i) => <p key={i}>{inlineMarkdown(item, 'quote-' + key + '-' + i)}</p>)}</blockquote>);
      continue;
    }

    if (line.trim().startsWith('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const header = line.split('|').slice(1, -1).map((cell) => cell.trim());
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(lines[index++].split('|').slice(1, -1).map((cell) => cell.trim()));
      }
      blocks.push(
        <div className="ai-markdown-table-wrap" key={'md-' + key++}>
          <table className="ai-markdown-table">
            <thead><tr>{header.map((cell, i) => <th key={i}>{inlineMarkdown(cell, 'table-h-' + i)}</th>)}</tr></thead>
            <tbody>{rows.map((row, i) => <tr key={i}>{header.map((_cell, col) => <td key={col}>{inlineMarkdown(row[col] ?? '', 'table-' + i + '-' + col)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const orderedList = !!ordered;
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const match = orderedList ? current.match(/^\s*\d+[.)]\s+(.+)$/) : current.match(/^\s*[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index++;
      }
      const list = items.map((item, i) => <li key={i}>{inlineMarkdown(item, 'list-' + key + '-' + i)}</li>);
      blocks.push(orderedList ? <ol key={'md-' + key++}>{list}</ol> : <ul key={'md-' + key++}>{list}</ul>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index++]);
    }
    if (paragraph.length === 0) {
      paragraph.push(lines[index]);
      index++;
    }
    blocks.push(<p key={'md-' + key++}>{inlineMarkdown(paragraph.join(' '), 'p-' + key)}</p>);
  }

  return <div className="ai-rich-content">{blocks}</div>;
}

function MessageBubble({
  msg,
  onCopy,
  copied,
}: {
  msg: ChatMessage;
  onCopy: (content: string) => void;
  copied: boolean;
}) {
  const isUser = msg.role === 'user';
  if (msg.role === 'system' || !msg.content) return null;
  return (
    <article className={'ai-message ' + (isUser ? 'ai-message-user' : 'ai-message-assistant')}>
      <div className="ai-message-author">{isUser ? 'Kamu' : 'Poolside Coding Agent'}</div>
      <div className="ai-message-body">
        {isUser ? <div className="ai-user-text">{msg.content}</div> : <MarkdownContent content={msg.content} />}
        {!isUser ? (
          <button type="button" className="ai-msg-copy" title="Salin jawaban" onClick={() => onCopy(msg.content)}>
            {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
          </button>
        ) : null}
      </div>
      {msg.streaming ? <span className="ai-streaming-dot" aria-label="Jawaban sedang ditulis" /> : null}
    </article>
  );
}

function buildDiffRows(change: AgentFileChange): DiffRow[] {
  const oldLines = change.oldContent.replace(/\r\n/g, '\n').split('\n');
  const newLines = change.newContent.replace(/\r\n/g, '\n').split('\n');
  if (change.oldContent === '') return newLines.filter((line, i) => i < newLines.length - 1 || line !== '').map((text, i) => ({
    kind: 'add', oldLine: null, newLine: i + 1, oldText: '', newText: text,
  }));
  if (change.newContent === '') return oldLines.filter((line, i) => i < oldLines.length - 1 || line !== '').map((text, i) => ({
    kind: 'remove', oldLine: i + 1, newLine: null, oldText: text, newText: '',
  }));

  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;

  const middleOld = oldLines.slice(prefix, oldLines.length - suffix);
  const middleNew = newLines.slice(prefix, newLines.length - suffix);
  type Op = { kind: 'same' | 'add' | 'remove'; oldLine: number | null; newLine: number | null; oldText: string; newText: string };
  const ops: Op[] = [];
  for (let i = 0; i < prefix; i++) ops.push({ kind: 'same', oldLine: i + 1, newLine: i + 1, oldText: oldLines[i], newText: newLines[i] });

  if (middleOld.length * middleNew.length > 250_000) {
    middleOld.forEach((text, i) => ops.push({ kind: 'remove', oldLine: prefix + i + 1, newLine: null, oldText: text, newText: '' }));
    middleNew.forEach((text, i) => ops.push({ kind: 'add', oldLine: null, newLine: prefix + i + 1, oldText: '', newText: text }));
  } else {
    const cols = middleNew.length + 1;
    const dp = new Uint32Array((middleOld.length + 1) * cols);
    for (let i = middleOld.length - 1; i >= 0; i--) {
      for (let j = middleNew.length - 1; j >= 0; j--) {
        const index = i * cols + j;
        dp[index] = middleOld[i] === middleNew[j]
          ? dp[(i + 1) * cols + j + 1] + 1
          : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < middleOld.length || j < middleNew.length) {
      if (i < middleOld.length && j < middleNew.length && middleOld[i] === middleNew[j]) {
        ops.push({ kind: 'same', oldLine: prefix + i + 1, newLine: prefix + j + 1, oldText: middleOld[i], newText: middleNew[j] });
        i++; j++;
      } else if (i < middleOld.length && (j >= middleNew.length || dp[(i + 1) * cols + j] >= dp[i * cols + j + 1])) {
        ops.push({ kind: 'remove', oldLine: prefix + i + 1, newLine: null, oldText: middleOld[i], newText: '' });
        i++;
      } else {
        ops.push({ kind: 'add', oldLine: null, newLine: prefix + j + 1, oldText: '', newText: middleNew[j] });
        j++;
      }
    }
  }

  for (let i = 0; i < suffix; i++) {
    const oldIndex = oldLines.length - suffix + i;
    const newIndex = newLines.length - suffix + i;
    ops.push({ kind: 'same', oldLine: oldIndex + 1, newLine: newIndex + 1, oldText: oldLines[oldIndex], newText: newLines[newIndex] });
  }

  const rows: DiffRow[] = [];
  for (let i = 0; i < ops.length;) {
    if (ops[i].kind === 'same') {
      rows.push({ ...ops[i], kind: 'same' });
      i++;
      continue;
    }
    const removals: typeof ops = [];
    const additions: typeof ops = [];
    while (i < ops.length && ops[i].kind !== 'same') {
      if (ops[i].kind === 'remove') removals.push(ops[i]);
      else additions.push(ops[i]);
      i++;
    }
    const paired = Math.min(removals.length, additions.length);
    for (let j = 0; j < paired; j++) {
      rows.push({
        kind: 'change',
        oldLine: removals[j].oldLine,
        newLine: additions[j].newLine,
        oldText: removals[j].oldText,
        newText: additions[j].newText,
      });
    }
    for (let j = paired; j < removals.length; j++) rows.push({ ...removals[j], kind: 'remove' });
    for (let j = paired; j < additions.length; j++) rows.push({ ...additions[j], kind: 'add' });
  }
  return rows;
}

function ChangeList({ changes, onSelect }: { changes: AgentFileChange[]; onSelect: (change: AgentFileChange) => void }) {
  if (changes.length === 0) return null;
  const added = changes.reduce((total, change) => total + change.addedLines, 0);
  const removed = changes.reduce((total, change) => total + change.removedLines, 0);
  return (
    <section className="ai-change-list" aria-label="Perubahan kode dari agent">
      <div className="ai-change-list-heading">
        <strong>Perubahan workspace</strong>
        <span>{changes.length} file</span>
        <span className="ai-diff-added">+{added}</span>
        <span className="ai-diff-removed">−{removed}</span>
      </div>
      <div className="ai-change-list-items">
        {changes.slice().reverse().map((change) => (
          <button type="button" className="ai-change-item" key={change.id} onClick={() => onSelect(change)}>
            <span className="ai-change-file-icon">{change.operation === 'create' ? '+' : '≡'}</span>
            <span className="ai-change-path" title={change.path}>{change.path}</span>
            <span className="ai-diff-added">+{change.addedLines}</span>
            <span className="ai-diff-removed">−{change.removedLines}</span>
            <span className="ai-change-view">Detail diff →</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function DiffViewer({ change, onClose }: { change: AgentFileChange; onClose: () => void }) {
  const rows = buildDiffRows(change);
  return (
    <div className="ai-diff-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="ai-diff-viewer" role="dialog" aria-modal="true" aria-label={'Perbandingan kode ' + change.path}>
        <header className="ai-diff-header">
          <div className="ai-diff-title">
            <strong>{change.path}</strong>
            <span>{change.operation === 'create' ? 'File baru' : 'Perubahan file'}</span>
          </div>
          <div className="ai-diff-total">
            <span className="ai-diff-added">+{change.addedLines} baris</span>
            <span className="ai-diff-removed">−{change.removedLines} baris</span>
            <button type="button" className="ai-icon-btn" title="Tutup perbandingan" onClick={onClose}><IconX size={16} /></button>
          </div>
        </header>
        <div className="ai-diff-column-head">
          <div><strong>Versi lama</strong><span>{change.oldContent.split(/\r?\n/).length} baris</span></div>
          <div><strong>Versi baru</strong><span>{change.newContent.split(/\r?\n/).length} baris</span></div>
        </div>
        <div className="ai-diff-rows">
          {rows.map((row, index) => (
            <div className={'ai-diff-row ' + row.kind} key={change.id + '-' + index}>
              <div className={'ai-diff-side old ' + (row.kind === 'remove' || row.kind === 'change' ? 'changed' : '')}>
                <span className="ai-diff-line-number">{row.oldLine ?? ''}</span>
                <code>{row.oldText || (row.kind === 'add' ? ' ' : '')}</code>
              </div>
              <div className={'ai-diff-side new ' + (row.kind === 'add' || row.kind === 'change' ? 'changed' : '')}>
                <span className="ai-diff-line-number">{row.newLine ?? ''}</span>
                <code>{row.newText || (row.kind === 'remove' ? ' ' : '')}</code>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function AgentChat({ wb, visible, onToggle }: Props) {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [activeAgentId, setActiveAgentId] = useState('poolside');
  const [messages, setMessages] = useState<ChatMessage[]>(loadSavedMessages);
  const [conversationId, setConversationId] = useState(makeConversationId);
  const [sessionReady, setSessionReady] = useState(false);
  const [activeSkills, setActiveSkills] = useState<AgentSkillSelection[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState('');
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);
  const [routerStatus, setRouterStatus] = useState<AgentRouterStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<AgentRouterTestResult | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const [changes, setChanges] = useState<AgentFileChange[]>([]);
  const [selectedChange, setSelectedChange] = useState<AgentFileChange | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeSessionRef = useRef<string | null>(null);

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
    let alive = true;
    setSessionReady(false);
    void window.rk.agentBeginSession(conversationId).then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setError(result.error ?? 'Gagal membuat sesi AI baru.');
        setSessionReady(false);
        return;
      }
      setSessionReady(true);
    }).catch((err) => {
      if (alive) {
        setError('Gagal menginisialisasi memory sesi: ' + ((err as Error).message || 'error tidak diketahui'));
        setSessionReady(false);
      }
    });
    return () => { alive = false; };
  }, [conversationId]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    const unsubscribe = window.rk.onAgentEvent(({ sessionId, event }: { sessionId: string; event: AgentEvent }) => {
      if (activeSessionRef.current && activeSessionRef.current !== sessionId) return;
      if (event.type === 'skills') {
        setActiveSkills(event.skills);
      } else if (event.type === 'output') {
        setMessages((previous) => {
          const index = previous.map((item) => item.role).lastIndexOf('assistant');
          if (index < 0) return previous;
          const next = [...previous];
          const last = next[index];
          next[index] = { ...last, content: last.content + event.data, streaming: true };
          return next;
        });
      } else if (event.type === 'file-change') {
        setChanges((previous) => [event.change, ...previous.filter((item) => item.id !== event.change.id)].slice(0, 30));
        setActivity('Perubahan file tersimpan: ' + event.change.path);
      } else if (event.type === 'error') {
        setError(event.message);
        setLoading(false);
        setActivity('');
        setMessages((previous) => previous.map((item, index) =>
          index === previous.length - 1 && item.role === 'assistant' ? { ...item, streaming: false } : item,
        ));
      } else if (event.type === 'activity') {
        setActivity(event.message);
      } else if (event.type === 'permission-request') {
        setPermission({ sessionId, requestId: event.requestId, command: event.command, reason: event.reason });
        setActivity('Menunggu persetujuan command terminal');
      } else if (event.type === 'permission-result') {
        setPermission((current) => current?.requestId === event.requestId ? null : current);
      } else if (event.type === 'state') {
        if (event.state.status === 'starting' || event.state.status === 'running') setLoading(true);
        if (event.state.status === 'stopped' || event.state.status === 'error' || event.state.status === 'idle') {
          setLoading(false);
          setActivity('');
          setPermission((current) => current?.sessionId === sessionId ? null : current);
          setMessages((previous) => previous.map((item, index) =>
            index === previous.length - 1 && item.role === 'assistant' ? { ...item, streaming: false } : item,
          ));
          setActiveSessionId((current) => current === sessionId ? null : current);
        }
      } else if (event.type === 'exit') {
        setLoading(false);
        setActivity('');
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, activity, permission, changes]);

  const activeAgent = agents.find((agent) => agent.id === activeAgentId);

  useEffect(() => {
    if (!testResult || testResult.ok) return;
    const timer = window.setTimeout(() => setTestResult(null), 5000);
    return () => window.clearTimeout(timer);
  }, [testResult]);

  const saveCopied = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopiedMsg(text);
    window.setTimeout(() => setCopiedMsg(null), 1800);
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !sessionReady || !activeAgent) return;
    if (!routerStatus?.configured) {
      setSettingsOpen(true);
      setError('Hubungkan 9router terlebih dahulu. Masukkan API key baru yang aktif, lalu tekan Simpan & uji.');
      return;
    }
    if (!wb.root) {
      setError('Workspace proyek belum tersedia. Buka ruangan proyek terlebih dahulu.');
      return;
    }
    setError(null);
    setActivity('Mempersiapkan workspace…');
    const userMessage: ChatMessage = { id: 'user-' + Date.now(), role: 'user', content: text, ts: Date.now() };
    const assistantMessage: ChatMessage = { id: 'assistant-' + Date.now(), role: 'assistant', content: '', ts: Date.now(), streaming: true };
    setMessages((previous) => [...previous, userMessage, assistantMessage]);
    setInput('');
    setLoading(true);
    setActiveSessionId(null);
    setPermission(null);
    activeSessionRef.current = 'pending-session';
    try {
      const compactContext = [...messages.filter((message) => !message.streaming), userMessage]
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .slice(-12);
      const result = await window.rk.agentStartChat(activeAgent.id, compactContext, wb.activePath, conversationId);
      if (!result.ok || !result.sessionId) throw new Error(result.error ?? 'Agent gagal dimulai.');
      activeSessionRef.current = result.sessionId;
      setActiveSessionId(result.sessionId);
    } catch (err) {
      setError((err as Error).message || 'Gagal memulai agent.');
      setLoading(false);
      setActivity('');
      setMessages((previous) => previous.map((item, index) =>
        index === previous.length - 1 && item.role === 'assistant' ? { ...item, streaming: false } : item,
      ));
    }
  }, [input, loading, sessionReady, activeAgent, messages, routerStatus?.configured, wb.root, wb.activePath, conversationId]);

  const stopAgent = useCallback(async () => {
    if (!activeSessionId) return;
    try { await window.rk.agentStop(activeSessionId); }
    catch (err) { setError('Gagal menghentikan agent: ' + (err as Error).message); }
  }, [activeSessionId]);

  const testRouterConnection = useCallback(async (): Promise<AgentRouterTestResult | null> => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const result = await window.rk.agentTestConfig();
      setTestResult(result);
      setActivity(result.ok ? 'Koneksi model berhasil diverifikasi.' : '');
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
      setTestResult({ ok: false, message: (err as Error).message || 'Gagal menyimpan API key.' });
    } finally {
      setSavingKey(false);
    }
  }, [apiKey, savingKey, refreshRouterStatus]);

  const resolvePermission = useCallback(async (approved: boolean) => {
    const current = permission;
    if (!current) return;
    setPermission(null);
    setActivity(approved ? 'Command disetujui; menjalankan terminal…' : 'Command ditolak.');
    try { await window.rk.agentApproveTool(current.sessionId, current.requestId, approved); }
    catch (err) { setError('Gagal mengirim keputusan terminal: ' + (err as Error).message); }
  }, [permission]);

  const clearChat = useCallback(() => {
    if (activeSessionId) void window.rk.agentStop(activeSessionId);
    activeSessionRef.current = 'pending-session';
    setActiveSessionId(null);
    setMessages([]);
    setError(null);
    setActivity('');
    setPermission(null);
    setLoading(false);
    setChanges([]);
    setSelectedChange(null);
    setActiveSkills([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
    // A new ID erases the prior session-memory directory in the main process.
    setConversationId(makeConversationId());
  }, [activeSessionId]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  if (!visible) return null;

  return (
    <section className="ai-panel fullsize" aria-label="AI Coding Agent">
      <header className="ai-panel-header">
        <button type="button" className="ai-back-to-editor" onClick={onToggle}>← Kembali ke Editor</button>
        <div className="ai-panel-title">
          <span className="ai-agent-icon">{activeAgent?.icon ?? '🌊'}</span>
          <strong>{activeAgent?.name ?? 'AI Coding Agent'}</strong>
          <span className={'ai-router-dot ' + (routerStatus?.configured ? 'ready' : 'missing')} title={routerStatus?.configured ? '9router siap' : 'API key 9router belum disetel'} />
        </div>
        <div className="ai-workspace-pill" title={wb.root ?? ''}>
          <span className="ai-workspace-dot" />
          <span>{pathName(wb.root)}</span>
          {wb.activePath ? <small>· {pathName(wb.activePath)}</small> : null}
        </div>
        <div className="ai-panel-actions">
          <button type="button" className="ai-icon-btn" title="Pengaturan 9router" aria-label="Pengaturan 9router" onClick={() => setSettingsOpen((open) => !open)}>⚙</button>
          {loading ? <button type="button" className="ai-icon-btn ai-stop-btn" title="Hentikan agent" aria-label="Hentikan agent" onClick={() => void stopAgent()}>■</button> : null}
          <button type="button" className="ai-icon-btn" title="Kembali ke editor" aria-label="Kembali ke editor" onClick={onToggle}><IconX size={16} /></button>
        </div>
      </header>

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
              onKeyDown={(event) => { if (event.key === 'Enter') void saveRouterKey(); }}
              placeholder={routerStatus?.configured ? 'API key tersimpan; isi untuk mengganti' : 'Tempel API key 9router yang baru'}
            />
            <button type="button" className="ai-settings-save" onClick={() => void saveRouterKey()} disabled={!apiKey.trim() || savingKey}>
              {savingKey ? 'Menyimpan…' : 'Simpan & uji'}
            </button>
          </div>
          <div className="ai-settings-connection-row">
            <span className={'ai-settings-state ' + (routerStatus?.configured ? 'configured' : 'missing')}>
              {routerStatus?.configured ? 'API key tersimpan' : 'API key belum diatur'}
            </span>
            <button type="button" className="ai-settings-test" onClick={() => void testRouterConnection()} disabled={!routerStatus?.configured || testingConnection || savingKey}>
              {testingConnection ? 'Menguji model…' : 'Uji koneksi model'}
            </button>
          </div>
          {testResult ? (
            <div className={'ai-test-result ' + (testResult.ok ? 'success' : 'failure')} role={testResult.ok ? 'status' : 'alert'}>
              <strong>{testResult.ok ? 'Koneksi berhasil' : 'Koneksi gagal'}</strong>
              <span>{testResult.message}</span>
              {testResult.ok ? <small>{testResult.endpoint} · {testResult.model}</small> : null}
            </div>
          ) : null}
          <div className="ai-settings-meta">
            <div><span>Model</span><code>{routerStatus?.model ?? 'ps/poolside/laguna-s-2.1(high)'}</code></div>
            <div><span>Utama</span><code>{routerStatus?.endpoint ?? 'https://rbxludp.abc-tunnel.us/v1'}</code></div>
            <div><span>Cadangan</span><code>{routerStatus?.fallbackEndpoint ?? 'http://localhost:20128/v1'}</code></div>
          </div>
          <p className="ai-settings-note">API key disimpan terenkripsi di perangkat ini dan tidak ditulis ke file proyek. Koneksi utama dicoba lebih dahulu, lalu endpoint cadangan bila perlu.</p>
        </section>
      ) : null}

      <div className="ai-agent-toolbar">
        <div className="ai-agent-switcher">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={'ai-agent-btn' + (activeAgentId === agent.id ? ' active' : '')}
              disabled={loading}
              onClick={() => { setActiveAgentId(agent.id); setError(null); }}
              title={agent.systemPrompt.slice(0, 140)}
            >
              <span className="ai-agent-icon">{agent.icon}</span>{agent.name}
            </button>
          ))}
        </div>
        <div className="ai-workspace-status">
          <span className={wb.root ? 'ready' : 'missing'} />
          {wb.root ? 'Agent bekerja di folder project aktif' : 'Belum ada workspace'}
        </div>
        <button type="button" className="ai-clear-btn" onClick={clearChat} disabled={messages.length === 0 && !loading}>
          <IconTrash size={13} /> Chat baru
        </button>
      </div>

      {activeSkills.length > 0 ? (
        <div className="ai-active-skills" aria-label="Skills aktif untuk tugas ini">
          <span className="ai-active-skills-label">Skills aktif</span>
          {activeSkills.map((skill) => (
            <span className="ai-active-skill" key={skill.id} title={skill.reason}>{skill.name}</span>
          ))}
        </div>
      ) : null}

      {!routerStatus?.configured ? (
        <section className="ai-setup-needed">
          <div className="ai-setup-icon">⚙</div>
          <strong>Hubungkan 9router sebelum mulai chat</strong>
          <p>Masukkan API key 9router yang masih aktif. API key yang pernah dipublikasikan harus dicabut dan diganti.</p>
          <button type="button" onClick={() => setSettingsOpen(true)}>Buka pengaturan AI</button>
        </section>
      ) : null}

      <ChangeList changes={changes} onSelect={setSelectedChange} />

      <main className="ai-workspace-main">
        <div className="ai-chat-column">
          <div className="ai-messages">
            {messages.filter((message) => message.role !== 'system' && message.content).length === 0 && !loading ? (
              <div className="ai-empty">
                <span className="ai-empty-icon">{activeAgent?.icon ?? '🌊'}</span>
                <p className="ai-empty-title">Mulai coding bersama AI</p>
                <p className="ai-empty-sub">
                  Agent dapat membaca file, mencari simbol, membuat file, dan menulis perubahan ke workspace aktif. Saat kode berubah, periksa detail diff untuk melihat baris yang ditambahkan, diubah, atau dihapus.
                </p>
                <div className="ai-starter-prompts">
                  <button type="button" onClick={() => setInput('Periksa struktur project ini dan jelaskan file penting yang ditemukan.')}>Jelaskan struktur project</button>
                  <button type="button" onClick={() => setInput('Periksa file yang sedang terbuka, cari masalah, dan perbaiki langsung di workspace.') } disabled={!wb.activePath}>Periksa file terbuka</button>
                  <button type="button" onClick={() => setInput('Tinjau project ini, jalankan analisis kode, dan sarankan perbaikan yang bisa diimplementasikan.')}>Tinjau kualitas kode</button>
                </div>
              </div>
            ) : (
              messages.filter((message) => message.role !== 'system' && message.content).map((message) => (
                <MessageBubble key={message.id} msg={message} onCopy={saveCopied} copied={copiedMsg === message.content} />
              ))
            )}

            {loading ? (
              <div className="ai-agent-activity">
                <Spinner size={15} />
                <div><strong>{activity || 'Agent sedang bekerja…'}</strong><small>Memeriksa workspace dan menjalankan tool bila diperlukan</small></div>
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
            {error ? <div className="ai-error" role="alert">{error}</div> : null}
            <div ref={bottomRef} />
          </div>

          <div className="ai-composer">
            <div className="ai-composer-context">
              <span>{wb.activePath ? pathName(wb.activePath) : pathName(wb.root)}</span>
              <span>Enter untuk kirim · Shift+Enter untuk baris baru</span>
            </div>
            <div className="ai-input-row">
              <textarea
                ref={inputRef}
                className="ai-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={loading ? 'Agent sedang bekerja…' : !sessionReady ? 'Menyiapkan sesi AI baru…' : !routerStatus?.configured ? 'Atur API key 9router pada pengaturan…' : !wb.root ? 'Buka workspace proyek terlebih dahulu…' : 'Minta agent membaca, membuat, atau mengubah kode…'}
                rows={3}
                disabled={loading || !sessionReady || !activeAgent || !routerStatus?.configured || !wb.root}
                aria-label="Pesan AI coding agent"
              />
              <button
                type="button"
                className="ai-send-btn"
                onClick={() => void sendMessage()}
                disabled={loading || !input.trim() || !activeAgent || !routerStatus?.configured || !wb.root}
                title="Kirim (Enter)"
              >
                {loading ? <Spinner size={17} /> : <IconSend size={17} />}
              </button>
            </div>
          </div>
        </div>
        <aside className="ai-agent-sidepanel">
          <section className="ai-side-card">
            <div className="ai-side-card-title"><strong>Workspace aktif</strong><span className="ai-side-dot" /></div>
            <div className="ai-root-path">{wb.root ?? 'Belum ada folder project'}</div>
            <p>Agent membaca dan menulis file dalam folder ini. Path absolute maupun relatif diterima selama masih berada di dalam workspace.</p>
            {wb.activePath ? <div className="ai-active-file"><span>File terpilih di editor</span><code>{wb.activePath}</code></div> : null}
          </section>
          <section className="ai-side-card">
            <div className="ai-side-card-title"><strong>Perubahan sesi ini</strong><span>{changes.length}</span></div>
            {changes.length === 0 ? (
              <p className="ai-no-changes">Perubahan file yang dibuat agent akan muncul di sini beserta rincian barisnya.</p>
            ) : (
              <div className="ai-side-changes">
                {changes.slice(0, 12).map((change) => (
                  <button type="button" key={change.id} onClick={() => setSelectedChange(change)}>
                    <span className="ai-side-change-path">{change.path}</span>
                    <span className="ai-diff-added">+{change.addedLines}</span>
                    <span className="ai-diff-removed">−{change.removedLines}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="ai-side-card ai-agent-rules">
            <strong>Alur agent</strong>
            <ol>
              <li>Periksa struktur dan file terkait.</li>
              <li>Rencanakan perubahan berdasarkan kode yang dibaca.</li>
              <li>Tulis atau buat file di workspace.</li>
              <li>Tinjau diff lama dan baru.</li>
              <li>Jalankan test/build hanya setelah izin terminal diberikan.</li>
            </ol>
          </section>
        </aside>
      </main>

      <footer className="ai-panel-footer">
        <span className="ai-footer-workspace">{wb.root ? 'Workspace siap' : 'Workspace belum aktif'}</span>
        <span className="ai-footer-model">{routerStatus?.model ?? 'ps/poolside/laguna-s-2.1(high)'}</span>
        <span className="ai-footer-shortcut">Ruang Kerja AI Agent · v{window.rk.version}</span>
      </footer>

      {selectedChange ? <DiffViewer change={selectedChange} onClose={() => setSelectedChange(null)} /> : null}
    </section>
  );
}
