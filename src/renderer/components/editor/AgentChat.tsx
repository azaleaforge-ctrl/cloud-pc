import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AgentEntry,
  AgentEvent,
  AgentQuestionOption,
  AgentFileChange,
  AgentRouterStatus,
  AgentRouterTestResult,
  AgentSkillSelection,
  AgentRunResult,
  AgentTodo,
  AgentToolActivity,
  AgentTerminalProcess,
  AgentAttachmentRef,
  AgentCheckpointSummary,
  AgentModelCatalogResult,
  AgentModelCapabilityReport,
  AgentSessionSummary,
  ChatMessage,
} from '../../../shared/agents';
import { IconSend, IconPlus, Spinner, IconCopy, IconX, IconTrash, IconCheck } from '../icons';
import {
  appendAgentTerminalOutput,
  formatAgentTerminalDiagnostics,
  formatAgentTerminalOutput,
  upsertAgentTerminalProcess,
  type AgentTerminalHistoryEntry,
} from '../../../shared/agentTerminalHistory';
import './agent-progress.css';

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

interface PendingAgentQuestion {
  sessionId: string;
  requestId: string;
  question: string;
  context: string;
  options: AgentQuestionOption[];
  recommendedOption: number;
  recommendationReason: string;
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

function sameWorkspacePath(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return normalize(left) === normalize(right);
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
  const pattern = /(\`[^\`]+\`|<\/think>|\*\*[\s\S]+?\*\*|__[\s\S]+?__|~~[\s\S]+?~~|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\))/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  for (const match of source.matchAll(pattern)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(source.slice(cursor, start));
    const key = keyPrefix + '-' + tokenIndex++;
    if (token === '</think>') {
      nodes.push(<span className="ai-think-end" key={key}>✓ Akhir proses berpikir</span>);
    } else if (token.startsWith('\`')) {
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
    /^\s*[-*+]\s+/.test(line) || /^\s*(?:\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]{2,})[.)]\s+/.test(line) ||
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
    const ordered = line.match(/^\s*(\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]{2,})[.)]\s+(.+)$/);
    const task = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (unordered || ordered || task) {
      const orderedList = !!ordered;
      const items: Array<{ text: string; checked?: boolean }> = [];
      const firstMarker = ordered?.[1] ?? '';
      while (index < lines.length) {
        const current = lines[index];
        const currentTask = current.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
        const currentOrdered = current.match(/^\s*(\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]{2,})[.)]\s+(.+)$/);
        const currentUnordered = current.match(/^\s*[-*+]\s+(.+)$/);
        if (task ? !currentTask : orderedList ? !currentOrdered : (!currentUnordered || !!currentTask)) break;
        if (currentTask) items.push({ text: currentTask[2], checked: /x/i.test(currentTask[1]) });
        else if (currentOrdered) items.push({ text: currentOrdered[2] });
        else if (currentUnordered) items.push({ text: currentUnordered[1] });
        index++;
      }
      const list = items.map((item, i) => <li key={i}>{item.checked !== undefined ? <><span className="ai-markdown-task-mark" aria-label={item.checked ? 'Selesai' : 'Belum selesai'}>{item.checked ? '☑' : '☐'}</span> {inlineMarkdown(item.text, 'list-' + key + '-' + i)}</> : inlineMarkdown(item.text, 'list-' + key + '-' + i)}</li>);
      const listKey = 'md-' + key++;
      if (orderedList) {
        const markerType = /^\d+$/.test(firstMarker) ? '1' : /^[A-Z]$/.test(firstMarker) ? 'A' : /^[a-z]$/.test(firstMarker) ? 'a' : /^[IVXLCDM]+$/.test(firstMarker) ? 'I' : 'i';
        blocks.push(<ol className="ai-markdown-ordered-list" type={markerType} start={/^\d+$/.test(firstMarker) ? Number(firstMarker) : undefined} key={listKey}>{list}</ol>);
      } else if (task) blocks.push(<ul className="ai-markdown-task-list" key={listKey}>{list}</ul>);
      else blocks.push(<ul className="ai-markdown-unordered-list" key={listKey}>{list}</ul>);
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
        {isUser && msg.attachments?.length ? (
          <div className="ai-message-attachments" aria-label="Lampiran pesan">
            {msg.attachments.map(item => (
              <span className="ai-attachment-chip" key={item.id} title={item.mimeType}>
                <span aria-hidden="true">▤</span><span>{item.name}</span>
                <small>{Math.max(1, Math.round(item.size / 1024))} KB</small>
              </span>
            ))}
          </div>
        ) : null}
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
  const added = changes.reduce((total, change) => total + change.addedLines, 0);
  const removed = changes.reduce((total, change) => total + change.removedLines, 0);
  return (
    <section className="ai-side-card ai-side-changes-card" aria-label="Perubahan workspace">
      <div className="ai-side-card-title">
        <strong>Perubahan workspace</strong>
        <span>{changes.length} file</span>
      </div>
      <div className="ai-change-summary">
        <span>{changes.length ? 'Perubahan sesi ini' : 'Belum ada perubahan'}</span>
        <span className="ai-diff-added">+{added}</span>
        <span className="ai-diff-removed">−{removed}</span>
      </div>
      <div className="ai-side-scroll ai-side-changes-scroll">
        {changes.length === 0 ? (
          <p className="ai-no-changes">File yang diubah agent akan muncul di sini. Pilih file untuk membuka perbandingan diff.</p>
        ) : (
          <div className="ai-side-changes">
            {changes.map((change) => (
              <button type="button" key={change.id} onClick={() => onSelect(change)} title={'Lihat diff ' + change.path}>
                <span className="ai-side-change-path">{change.path}</span>
                <span className="ai-diff-added">+{change.addedLines}</span>
                <span className="ai-diff-removed">−{change.removedLines}</span>
                <small className="ai-side-change-open">Detail diff →</small>
              </button>
            ))}
          </div>
        )}
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


function TodoPanel({ todos }: { todos: AgentTodo[] }) {
  if (todos.length === 0) return null;
  const completed = todos.filter((todo) => todo.status === 'completed').length;
  const statusLabel: Record<AgentTodo['status'], string> = {
    pending: 'Menunggu',
    in_progress: 'Dikerjakan',
    completed: 'Selesai',
    blocked: 'Terblokir',
  };
  const statusMark: Record<AgentTodo['status'], string> = {
    pending: '○',
    in_progress: '◌',
    completed: '✓',
    blocked: '!',
  };
  return (
    <section className="ai-todo-panel" aria-label="Todo List agent">
      <header className="ai-todo-header">
        <strong>Rencana pekerjaan</strong>
        <span>{completed}/{todos.length} selesai</span>
      </header>
      <ol className="ai-todo-list">
        {todos.map((todo) => (
          <li className={'ai-todo-item status-' + todo.status} key={todo.id}>
            <span className="ai-todo-mark" aria-hidden="true">{statusMark[todo.status]}</span>
            <div className="ai-todo-content">
              <strong>{todo.title}</strong>
              {todo.verification ? <small>Kriteria: {todo.verification}</small> : null}
              {todo.status === 'blocked' && todo.blockedReason ? <small className="ai-todo-blocked-reason">{todo.blockedReason}</small> : null}
              {todo.status === 'completed' && todo.completionEvidence ? <small className="ai-todo-evidence" title={todo.completionEvidence}>Bukti: {todo.completionEvidence}</small> : null}
            </div>
            <span className={'ai-todo-status status-' + todo.status}>{statusLabel[todo.status]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ToolActivityList({ activities }: { activities: AgentToolActivity[] }) {
  if (activities.length === 0) return null;
  return (
    <section className="ai-tool-activities" aria-label="Aktivitas tool agent" aria-live="polite">
      <header>Aktivitas agent</header>
      <div className="ai-tool-activity-list">
        {activities.slice(-6).map((activity) => (
          <div className={'ai-tool-activity status-' + activity.status} key={activity.id}>
            <span className="ai-tool-activity-mark" aria-hidden="true">
              {activity.status === 'running' ? '◌' : activity.status === 'completed' ? '✓' : '!'}
            </span>
            <span className="ai-tool-activity-name">{activity.name}</span>
            <span className="ai-tool-activity-detail">{activity.detail}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TerminalRunPanel({
  entry,
  copied,
  onCopy,
  outputOverride,
}: {
  entry: AgentTerminalHistoryEntry;
  copied: boolean;
  onCopy: (entry: AgentTerminalHistoryEntry) => void;
  outputOverride?: string;
}) {
  const process = entry.process;
  const statusLabel: Record<AgentTerminalProcess['status'], string> = {
    starting: 'Memulai',
    running: 'Berjalan',
    completed: 'Berhasil',
    failed: 'Gagal',
    timed_out: 'Timeout',
    cancelled: 'Dibatalkan',
  };
  const elapsed = Math.max(0, Math.round(((process.finishedAt ?? Date.now()) - process.startedAt) / 1000));
  const output = entry.outputs.length ? formatAgentTerminalOutput(entry.outputs) : (outputOverride ?? '');
  return (
    <section className={'ai-terminal-run status-' + process.status} aria-label="Detail proses terminal agent">
      <header className="ai-terminal-run-header">
        <div>
          <strong>Terminal agent</strong>
          <span className={'ai-terminal-status status-' + process.status}>{statusLabel[process.status]}</span>
        </div>
        <small>{process.exitCode === undefined ? 'Exit code menunggu' : 'Exit code: ' + (process.exitCode === null ? 'unknown' : process.exitCode)} · {elapsed} detik</small>
      </header>
      <div className="ai-terminal-meta">
        <span>{process.shell || 'Shell tidak tersedia'}</span>
        <code title={process.cwd || ''}>{process.cwd || 'Direktori kerja tidak tersedia'}</code>
      </div>
      <code className="ai-terminal-command">{process.command}</code>
      {process.message ? <p className="ai-terminal-message">{process.message}</p> : null}
      <div className="ai-terminal-actions">
        <small>{new Date(process.startedAt).toLocaleString()}{process.finishedAt ? ' · selesai ' + new Date(process.finishedAt).toLocaleTimeString() : ' · masih berjalan'}</small>
        <button type="button" onClick={() => onCopy(entry)}>{copied ? 'Detail tersalin' : 'Salin detail diagnostik'}</button>
      </div>
      <pre className="ai-terminal-output">{output || (process.status === 'running' ? 'Menunggu output dari command…' : '(tidak ada output)')}</pre>
    </section>
  );
}

function TerminalRunHistory({
  history,
  copiedId,
  onCopy,
  currentProcess,
  currentOutput,
}: {
  history: AgentTerminalHistoryEntry[];
  copiedId: string | null;
  onCopy: (entry: AgentTerminalHistoryEntry) => void;
  currentProcess: AgentTerminalProcess | null;
  currentOutput: string;
}) {
  if (history.length === 0) return null;
  const latest = history[history.length - 1];
  const previous = history.slice(0, -1).reverse();
  return (
    <>
      {previous.length > 0 ? (
        <details className="ai-terminal-history">
          <summary>Riwayat terminal sebelumnya ({previous.length})</summary>
          <div className="ai-terminal-history-list">
            {previous.map((entry) => (
              <TerminalRunPanel key={entry.process.commandId} entry={entry} copied={copiedId === entry.process.commandId} onCopy={onCopy} />
            ))}
          </div>
        </details>
      ) : null}
      <TerminalRunPanel
        key={latest.process.commandId}
        entry={latest}
        copied={copiedId === latest.process.commandId}
        onCopy={onCopy}
        outputOverride={currentProcess?.commandId === latest.process.commandId ? currentOutput : undefined}
      />
    </>
  );
}

function RunResultBanner({ result }: { result: AgentRunResult }) {
  const label: Record<AgentRunResult['outcome'], string> = {
    completed: 'Run selesai',
    blocked: 'Run terblokir',
    cancelled: 'Run dibatalkan',
    failed: 'Run gagal',
  };
  return (
    <section className={'ai-run-result status-' + result.outcome} role={result.outcome === 'failed' || result.outcome === 'blocked' ? 'alert' : 'status'}>
      <strong>{label[result.outcome]}</strong>
      <span>{result.message}</span>
      <small>{result.totalToolCalls} pemanggilan tool · {Math.max(0, Math.round(result.durationMs / 1000))} detik</small>
    </section>
  );
}

export function AgentChat({ wb, visible, onToggle }: Props) {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [activeAgentId, setActiveAgentId] = useState('poolside');
  const [messages, setMessages] = useState<ChatMessage[]>(loadSavedMessages);
  const [conversationId, setConversationId] = useState(makeConversationId);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionProjectPath, setSessionProjectPath] = useState<string | null>(null);
  const [conversationSummary, setConversationSummary] = useState('');
  const [summaryThroughTs, setSummaryThroughTs] = useState(0);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [checkpoints, setCheckpoints] = useState<AgentCheckpointSummary[]>([]);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [checkpointActionBusy, setCheckpointActionBusy] = useState<string | null>(null);
  const firstSessionLoadRef = useRef(true);
  const [activeSkills, setActiveSkills] = useState<AgentSkillSelection[]>([]);
  const [todos, setTodos] = useState<AgentTodo[]>([]);
  const [toolActivities, setToolActivities] = useState<AgentToolActivity[]>([]);
  const [lastRunResult, setLastRunResult] = useState<AgentRunResult | null>(null);
  const [terminalProcess, setTerminalProcess] = useState<AgentTerminalProcess | null>(null);
  const [terminalOutput, setTerminalOutput] = useState('');
  const [terminalHistory, setTerminalHistory] = useState<AgentTerminalHistoryEntry[]>([]);
  const [terminalCopiedId, setTerminalCopiedId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<AgentAttachmentRef[]>([]);
  const [selectingAttachments, setSelectingAttachments] = useState(false);
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
  const [modelCatalog, setModelCatalog] = useState<AgentModelCatalogResult | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [selectedModelDraft, setSelectedModelDraft] = useState('');
  const [savingModel, setSavingModel] = useState(false);
  const [modelReport, setModelReport] = useState<AgentModelCapabilityReport | null>(null);
  const [diagnosingModel, setDiagnosingModel] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [permission, setPermission] = useState<PendingPermission | null>(null);
  const [agentQuestion, setAgentQuestion] = useState<PendingAgentQuestion | null>(null);
  const [selectedQuestionOption, setSelectedQuestionOption] = useState<number | null>(null);
  const [customQuestionAnswer, setCustomQuestionAnswer] = useState('');
  const [submittingQuestion, setSubmittingQuestion] = useState(false);
  const [changes, setChanges] = useState<AgentFileChange[]>([]);
  const [selectedChange, setSelectedChange] = useState<AgentFileChange | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(true);
  const activeSessionRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);


  const refreshRouterStatus = useCallback(async () => {
    try {
      const status = await window.rk.agentGetConfig();
      setRouterStatus(status);
      setSelectedModelDraft(status.model);
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
    stickToBottomRef.current = true;
    forceScrollToBottomRef.current = true;
    setSessionReady(false);
    void (async () => {
      try {
        if (firstSessionLoadRef.current) {
          firstSessionLoadRef.current = false;
          setLoadingSessions(true);
          const available = await window.rk.agentListSessions();
          if (!alive) return;
          setSessions(available);
          setLoadingSessions(false);
          if (available.length > 0) {
            // Resume most recently used conversation at startup. Other sessions remain in History.
            setConversationId(available[0].id);
            return;
          }
        }
        const loaded = await window.rk.agentLoadSession(conversationId);
        if (!alive) return;
        if (loaded.ok && loaded.session) {
          const session = loaded.session;
          setMessages(session.messages.map(message => ({ ...message, streaming: false })));
          setActiveAgentId(session.activeAgentId || 'poolside');
          setSessionProjectPath(session.projectPath);
          setConversationSummary(session.summary || '');
          setSummaryThroughTs(session.summaryThroughTs || 0);
          setTodos(session.todos || []);
          setCheckpoints(session.checkpoints || []);
          setChanges([]);
          setSelectedChange(null);
          setActiveSkills([]);
          setSessionReady(true);
        } else {
          const created = await window.rk.agentBeginSession(conversationId);
          if (!alive) return;
          if (!created.ok) throw new Error(created.error || 'Gagal membuat sesi baru.');
          setMessages([]);
          setSessionProjectPath(wb.root);
          setConversationSummary('');
          setSummaryThroughTs(0);
          setTodos([]);
          setCheckpoints([]);
          setChanges([]);
          setSelectedChange(null);
          setSessionReady(true);
        }
        const refreshed = await window.rk.agentListSessions();
        if (alive) setSessions(refreshed);
      } catch (err) {
        if (alive) {
          setError('Gagal memuat atau membuat sesi AI: ' + ((err as Error).message || 'kesalahan tidak diketahui'));
          setSessionReady(false);
          setLoadingSessions(false);
        }
      }
    })();
    return () => { alive = false; };
  }, [conversationId]);

  useEffect(() => {
    if (!sessionReady) return;
    const timer = window.setTimeout(() => {
      void window.rk.agentSaveSession({
        id: conversationId,
        ...(sessionProjectPath ? { projectPath: sessionProjectPath } : (!messages.length && wb.root ? { projectPath: wb.root } : {})),
        activeAgentId,
        messages,
        summary: conversationSummary,
        summaryThroughTs,
        todos,
      }).then(async result => {
        if (!result.ok) {
          setError('Gagal menyimpan riwayat sesi: ' + (result.error || 'penyimpanan gagal'));
          return;
        }
        if (result.summary !== undefined) setConversationSummary(current => current === result.summary ? current : result.summary!);
        if (result.summaryThroughTs !== undefined) setSummaryThroughTs(current => current === result.summaryThroughTs ? current : result.summaryThroughTs!);
        const refreshed = await window.rk.agentListSessions();
        setSessions(refreshed);
      }).catch(err => setError('Gagal menyimpan riwayat sesi: ' + ((err as Error).message || 'penyimpanan gagal')));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [sessionReady, conversationId, wb.root, sessionProjectPath, activeAgentId, messages, conversationSummary, summaryThroughTs, todos]);

  useEffect(() => {
    const unsubscribe = window.rk.onAgentEvent(({ sessionId, event }: { sessionId: string; event: AgentEvent }) => {
      if (activeSessionRef.current && activeSessionRef.current !== sessionId) return;
      if (event.type === 'todo-update') {
        setTodos(event.todos);
      } else if (event.type === 'tool-status') {
        setToolActivities((previous) => {
          const index = previous.findIndex((item) => item.id === event.activity.id);
          if (index < 0) return [...previous, event.activity].slice(-8);
          const next = [...previous];
          next[index] = event.activity;
          return next;
        });
      } else if (event.type === 'run-result') {
        setLastRunResult(event.result);
        if (event.result.outcome === 'completed' || event.result.outcome === 'cancelled') setTodos([]);
      } else if (event.type === 'terminal-process') {
        setTerminalProcess(event.process);
        setTerminalHistory((previous) => upsertAgentTerminalProcess(previous, event.process));
        if (event.process.status === 'starting') setTerminalOutput('');
      } else if (event.type === 'terminal-output') {
        setTerminalOutput((previous) => (previous + event.output.data).slice(-12000));
        setTerminalHistory((previous) => appendAgentTerminalOutput(previous, event.output));
      } else if (event.type === 'skills') {
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
        if (event.change.checkpointId) {
          setCheckpoints(previous => {
            const existing = previous.find(item => item.id === event.change.checkpointId);
            if (existing) {
              return previous.map(item => item.id === event.change.checkpointId
                ? { ...item, paths: Array.from(new Set([...item.paths, event.change.path])) }
                : item);
            }
            return [{
              id: event.change.checkpointId!,
              runId: sessionId,
              createdAt: event.change.changedAt,
              projectPath: sessionProjectPath ?? wb.root ?? '',
              status: 'applied' as const,
              paths: [event.change.path],
            }, ...previous].slice(0, 50);
          });
        }
        if (event.change.checkpointError) {
          setError('File sudah ditulis, tetapi checkpoint tidak dapat disimpan: ' + event.change.checkpointError);
        }
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
      } else if (event.type === 'question-request') {
        setAgentQuestion({
          sessionId,
          requestId: event.requestId,
          question: event.question,
          context: event.context,
          options: event.options,
          recommendedOption: event.recommendedOption,
          recommendationReason: event.recommendationReason,
        });
        setSelectedQuestionOption(null);
        setCustomQuestionAnswer('');
        setActivity('Menunggu jawaban darimu…');
      } else if (event.type === 'question-result') {
        if (!event.answered) {
          setActivity('Pertanyaan berakhir tanpa jawaban.');
        }
        setAgentQuestion((current) => current?.requestId === event.requestId ? null : current);
        setSelectedQuestionOption(null);
        setCustomQuestionAnswer('');
        setSubmittingQuestion(false);
      } else if (event.type === 'state') {
        if (event.state.status === 'starting' || event.state.status === 'running') setLoading(true);
        if (event.state.status !== 'starting' && event.state.status !== 'running') {
          setLoading(false);
          setActivity('');
          setPermission((current) => current?.sessionId === sessionId ? null : current);
          setMessages((previous) => previous.map((item, index) =>
            index === previous.length - 1 && item.role === 'assistant' ? { ...item, streaming: false } : item,
          ));
          cancelRequestedRef.current = false;
          if (activeSessionRef.current === sessionId) activeSessionRef.current = null;
          setActiveSessionId((current) => current === sessionId ? null : current);
        }
      } else if (event.type === 'exit') {
        setLoading(false);
        setActivity('');
      }
    });
    return unsubscribe;
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    stickToBottomRef.current = distanceToBottom < 120;
  }, []);

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    if (!forceScrollToBottomRef.current && !stickToBottomRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
    forceScrollToBottomRef.current = false;
    stickToBottomRef.current = true;
  }, [messages]);

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

  const pickAttachments = useCallback(async () => {
    if (loading || selectingAttachments || !sessionReady || !wb.root) return;
    setSelectingAttachments(true);
    setError(null);
    try {
      const result = await window.rk.agentPickAttachments();
      if (!result.ok) throw new Error(result.error ?? 'Gagal memilih lampiran.');
      if (!result.attachments?.length) return;
      setPendingAttachments(current => {
        const next = [...current];
        for (const item of result.attachments ?? []) if (!next.some(existing => existing.id === item.id)) next.push(item);
        if (next.length > 10) { setError('Maksimal 10 lampiran per pesan.'); return next.slice(0, 10); }
        return next;
      });
    } catch (error) {
      setError((error as Error).message || 'Lampiran gagal diproses.');
    } finally {
      setSelectingAttachments(false);
    }
  }, [loading, selectingAttachments, sessionReady, wb.root]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if ((!text && pendingAttachments.length === 0) || loading || !sessionReady || !activeAgent) return;
    if (!routerStatus?.configured) {
      setSettingsOpen(true);
      setError('Hubungkan 9router terlebih dahulu. Masukkan API key baru yang aktif, lalu tekan Simpan & uji.');
      return;
    }
    if (!wb.root) {
      setError('Workspace proyek belum tersedia. Buka ruangan proyek terlebih dahulu.');
      return;
    }
    if (sessionProjectPath && !sameWorkspacePath(sessionProjectPath, wb.root)) {
      setError('Sesi ini terkait workspace ' + sessionProjectPath + '. Buka workspace tersebut untuk melanjutkan percakapan ini, atau pilih Chat Baru untuk workspace saat ini.');
      return;
    }
    if (!sessionProjectPath) setSessionProjectPath(wb.root);
    setError(null);
    setLastRunResult(null);
    setTodos([]);
    setChanges([]);
    setSelectedChange(null);
    setToolActivities([]);
    setTerminalProcess(null);
    setTerminalOutput('');
    setTerminalHistory([]);
    setTerminalCopiedId(null);
    setActivity('Mempersiapkan workspace…');
    const userMessage: ChatMessage = {
      id: 'user-' + Date.now(), role: 'user',
      content: text || 'Tolong analisis lampiran yang saya kirim dan rangkum informasi pentingnya.',
      ts: Date.now(),
      ...(pendingAttachments.length ? { attachments: pendingAttachments } : {}),
    };
    const assistantMessage: ChatMessage = { id: 'assistant-' + Date.now(), role: 'assistant', content: '', ts: Date.now(), streaming: true };
    stickToBottomRef.current = true;
    forceScrollToBottomRef.current = true;
    setMessages((previous) => [...previous, userMessage, assistantMessage]);
    setInput('');
    setLoading(true);
    setActiveSessionId(null);
    setPermission(null);
    cancelRequestedRef.current = false;
    // Ignore stale events until the new session ID is registered. Escape can
    // still mark cancellation requested and stop the session as soon as it exists.
    activeSessionRef.current = 'pending-session';
    try {
      const compactContext = [...messages.filter(message => !message.streaming), userMessage]
        .filter(message => message.role === 'user' || message.role === 'assistant')
        .slice(-12)
        .map(message => message.id === userMessage.id ? message : { ...message, attachments: undefined });
      const result = await window.rk.agentStartChat(activeAgent.id, compactContext, wb.activePath, conversationId);
      if (!result.ok || !result.sessionId) throw new Error(result.error ?? 'Agent gagal dimulai.');
      activeSessionRef.current = result.sessionId;
      setActiveSessionId(result.sessionId);
      setPendingAttachments([]);
      if (cancelRequestedRef.current) {
        setActivity('Membatalkan agent…');
        try {
          await window.rk.agentStop(result.sessionId);
        } catch (cancelError) {
          setError('Pembatalan agent gagal: ' + ((cancelError as Error).message || 'kesalahan tidak diketahui'));
        }
      }
    } catch (err) {
      cancelRequestedRef.current = false;
      activeSessionRef.current = null;
      setError((err as Error).message || 'Gagal memulai agent.');
      setLoading(false);
      setActivity('');
      setMessages((previous) => previous.map((item, index) =>
        index === previous.length - 1 && item.role === 'assistant' ? { ...item, streaming: false } : item,
      ));
    }
  }, [input, pendingAttachments, loading, sessionReady, activeAgent, messages, routerStatus?.configured, wb.root, wb.activePath, conversationId, sessionProjectPath]);

  const stopAgent = useCallback(async () => {
    cancelRequestedRef.current = true;
    if (!activeSessionId) {
      if (loading) setActivity('Pembatalan diminta… menunggu ID sesi agar proses bisa dihentikan.');
      return;
    }
    setActivity('Menghentikan agent dan proses turunannya…');
    try { await window.rk.agentStop(activeSessionId); }
    catch (err) {
      setError('Gagal menghentikan agent: ' + ((err as Error).message || 'kesalahan tidak diketahui'));
      cancelRequestedRef.current = false;
    }
  }, [activeSessionId, loading]);

  useEffect(() => {
    if (!visible || !loading) return;
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const isAgentQuestionInput = target?.id === 'ai-question-custom-answer';
      const isAgentComposerInput = target?.classList.contains('ai-input');
      if (!isAgentQuestionInput && !isAgentComposerInput && target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      event.preventDefault();
      event.stopPropagation();
      void stopAgent();
    };
    window.addEventListener('keydown', onGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', onGlobalKeyDown, true);
  }, [visible, loading, stopAgent]);

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

  const refreshModelCatalog = useCallback(async () => {
    setLoadingModels(true);
    setModelCatalog(null);
    try {
      const result = await window.rk.agentListModels();
      setModelCatalog(result);
    } catch (error) {
      setModelCatalog({ ok: false, message: (error as Error).message || 'Gagal memuat daftar model.', models: [] });
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const saveSelectedModel = useCallback(async () => {
    if (!selectedModelDraft.trim() || savingModel) return;
    setSavingModel(true);
    setModelReport(null);
    try {
      const result = await window.rk.agentSelectModel(selectedModelDraft.trim());
      if (!result.ok) throw new Error(result.error || 'Gagal menyimpan model.');
      await refreshRouterStatus();
      setActivity('Model AI berhasil disimpan.');
      setError(null);
    } catch (error) {
      setError((error as Error).message || 'Gagal menyimpan model.');
    } finally {
      setSavingModel(false);
    }
  }, [selectedModelDraft, savingModel, refreshRouterStatus]);

  const diagnoseSelectedModel = useCallback(async () => {
    if (diagnosingModel || !routerStatus?.configured || selectedModelDraft.trim() !== routerStatus.model) return;
    setDiagnosingModel(true);
    setModelReport(null);
    try {
      const result = await window.rk.agentDiagnoseModel();
      setModelReport(result);
    } catch (error) {
      setError((error as Error).message || 'Diagnostik model gagal dijalankan.');
    } finally {
      setDiagnosingModel(false);
    }
  }, [diagnosingModel, routerStatus?.configured, routerStatus?.model, selectedModelDraft]);

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

  const copyTerminalDiagnostics = useCallback(async (entry: AgentTerminalHistoryEntry) => {
    try {
      await navigator.clipboard.writeText(formatAgentTerminalDiagnostics(entry));
      setTerminalCopiedId(entry.process.commandId);
    } catch (err) {
      setError('Gagal menyalin detail terminal: ' + ((err as Error).message || 'clipboard tidak tersedia.'));
    }
  }, []);

  const resolvePermission = useCallback(async (approved: boolean) => {
    const current = permission;
    if (!current) return;
    setPermission(null);
    setActivity(approved ? 'Command disetujui; menjalankan terminal…' : 'Command ditolak.');
    try { await window.rk.agentApproveTool(current.sessionId, current.requestId, approved); }
    catch (err) { setError('Gagal mengirim keputusan terminal: ' + (err as Error).message); }
  }, [permission]);

  const answerAgentQuestion = useCallback(async () => {
    const current = agentQuestion;
    if (!current || submittingQuestion) return;
    const custom = customQuestionAnswer.trim();
    const selected = selectedQuestionOption === null ? null : current.options[selectedQuestionOption - 1];
    const answer = custom
      ? 'Jawaban custom: ' + custom
      : selected
        ? 'Pilihan ' + selectedQuestionOption + ': ' + selected.label + '\n' + selected.description
        : '';
    if (!answer) return;
    setSubmittingQuestion(true);
    setActivity('Mengirim jawaban ke agent…');
    try {
      await window.rk.agentAnswerQuestion(current.sessionId, current.requestId, answer);
      setAgentQuestion((active) => active?.requestId === current.requestId ? null : active);
      setSelectedQuestionOption(null);
      setCustomQuestionAnswer('');
      setActivity('Jawaban diterima; agent melanjutkan pekerjaan…');
    } catch (err) {
      setError('Gagal mengirim jawaban: ' + ((err as Error).message || 'kesalahan tidak diketahui'));
      setSubmittingQuestion(false);
    }
  }, [agentQuestion, customQuestionAnswer, selectedQuestionOption, submittingQuestion]);

  // Keyboard controls mirror a terminal-style agent question: arrows select, Enter confirms.
  useEffect(() => {
    if (!visible || !agentQuestion || submittingQuestion) return;
    const onQuestionKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const inCustomAnswer = target?.id === 'ai-question-custom-answer';
      if (inCustomAnswer && event.key !== 'Escape') {
        if (event.key === 'Enter') {
          event.preventDefault();
          void answerAgentQuestion();
        }
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setCustomQuestionAnswer('');
        setSelectedQuestionOption((current) => {
          const count = agentQuestion.options.length;
          if (count === 0) return null;
          if (current === null) return event.key === 'ArrowDown' ? 1 : count;
          return event.key === 'ArrowDown' ? (current % count) + 1 : ((current - 2 + count) % count) + 1;
        });
      } else if (event.key === 'Enter' && selectedQuestionOption !== null) {
        event.preventDefault();
        void answerAgentQuestion();
      }
    };
    window.addEventListener('keydown', onQuestionKeyDown);
    return () => window.removeEventListener('keydown', onQuestionKeyDown);
  }, [visible, agentQuestion, submittingQuestion, selectedQuestionOption, answerAgentQuestion]);


  const deleteStoredSession = useCallback(async (id: string) => {
    const entry = sessions.find(item => item.id === id);
    if (!window.confirm('Hapus riwayat percakapan "' + (entry?.title || id) + '" dari perangkat ini? Tindakan ini tidak dapat dibatalkan.')) return;
    try {
      const result = await window.rk.agentDeleteSession(id);
      if (!result.ok) throw new Error(result.error || 'Sesi gagal dihapus.');
      const refreshed = await window.rk.agentListSessions();
      setSessions(refreshed);
      if (id === conversationId) {
        setSessionReady(false);
        setMessages([]);
        setSessionProjectPath(wb.root);
        setConversationSummary('');
        setSummaryThroughTs(0);
        setTodos([]);
        setCheckpoints([]);
        setChanges([]);
        setSelectedChange(null);
        setActiveSkills([]);
        setConversationId(makeConversationId());
      }
    } catch (error) {
      setError((error as Error).message || 'Gagal menghapus sesi.');
    }
  }, [sessions, conversationId, wb.root]);

  const runCheckpointAction = useCallback(async (checkpointId: string, action: 'rewind' | 'redo') => {
    if (loading || checkpointActionBusy) return;
    setCheckpointActionBusy(checkpointId);
    setError(null);
    try {
      const result = action === 'rewind'
        ? await window.rk.agentRewindCheckpoint(conversationId, checkpointId)
        : await window.rk.agentRedoCheckpoint(conversationId, checkpointId);
      if (!result.ok) throw new Error(result.message);
      setActivity(result.message);
      const [nextCheckpoints, nextSessions] = await Promise.all([
        window.rk.agentListCheckpoints(conversationId),
        window.rk.agentListSessions(),
      ]);
      setCheckpoints(nextCheckpoints);
      setSessions(nextSessions);
    } catch (error) {
      setError((error as Error).message || 'Operasi checkpoint gagal.');
    } finally {
      setCheckpointActionBusy(null);
    }
  }, [loading, checkpointActionBusy, conversationId]);

  useEffect(() => {
    if (!historyOpen) return;
    let alive = true;
    setLoadingSessions(true);
    void window.rk.agentListSessions().then(list => {
      if (alive) setSessions(list);
    }).catch(error => {
      if (alive) setError((error as Error).message || 'Gagal memuat riwayat sesi.');
    }).finally(() => {
      if (alive) setLoadingSessions(false);
    });
    return () => { alive = false; };
  }, [historyOpen]);

  useEffect(() => {
    if (!checkpointsOpen) return;
    let alive = true;
    void window.rk.agentListCheckpoints(conversationId).then(items => {
      if (alive) setCheckpoints(items);
    }).catch(error => {
      if (alive) setError((error as Error).message || 'Gagal memuat checkpoint.');
    });
    return () => { alive = false; };
  }, [checkpointsOpen, conversationId]);

  const clearChat = useCallback(() => {
    if (activeSessionId) void window.rk.agentStop(activeSessionId);
    setSessionProjectPath(wb.root);
    activeSessionRef.current = 'pending-session';
    setActiveSessionId(null);
    setMessages([]);
    setConversationSummary('');
    setSummaryThroughTs(0);
    setCheckpoints([]);
    setTodos([]);
    setToolActivities([]);
    setLastRunResult(null);
    setTerminalProcess(null);
    setTerminalOutput('');
    setTerminalHistory([]);
    setTerminalCopiedId(null);
    setError(null);
    setActivity('');
    setPermission(null);
    setAgentQuestion(null);
    setSelectedQuestionOption(null);
    setCustomQuestionAnswer('');
    setSubmittingQuestion(false);
    setLoading(false);
    setChanges([]);
    setSelectedChange(null);
    setActiveSkills([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
    // A new ID creates a separate session; the prior chat and memory remain available in History.
    setConversationId(makeConversationId());
  }, [activeSessionId, wb.root]);

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
          <div className="ai-model-manager">
            <div className="ai-model-manager-head">
              <div>
                <strong>Model & kemampuan</strong>
                <p>Pilih model yang digunakan agent dan uji dukungan chat, function calling, serta input gambar.</p>
              </div>
              <button type="button" className="ai-settings-test" onClick={() => void refreshModelCatalog()} disabled={!routerStatus?.configured || loadingModels}>
                {loadingModels ? 'Memuat…' : 'Muat katalog'}
              </button>
            </div>
            <label className="ai-settings-label" htmlFor="rk-model-id">ID model aktif</label>
            <div className="ai-model-select-row">
              <input id="rk-model-id" className="ai-settings-key" type="text" value={selectedModelDraft}
                onChange={(event) => setSelectedModelDraft(event.target.value)} maxLength={200} spellCheck={false}
                placeholder="mis. provider/model-name" disabled={savingModel || loading} />
              <button type="button" className="ai-settings-save" onClick={() => void saveSelectedModel()}
                disabled={!selectedModelDraft.trim() || savingModel || loading || selectedModelDraft.trim() === routerStatus?.model}>
                {savingModel ? 'Menyimpan…' : selectedModelDraft.trim() === routerStatus?.model ? 'Model aktif' : 'Gunakan model'}
              </button>
            </div>
            {modelCatalog ? (
              <div className={'ai-model-catalog-result ' + (modelCatalog.ok ? 'success' : 'failure')} role={modelCatalog.ok ? 'status' : 'alert'}>
                <span>{modelCatalog.message}</span>
                {modelCatalog.ok ? <small>{modelCatalog.models.length} model · {modelCatalog.endpoint} · {modelCatalog.retrievedAt}</small> : null}
                {modelCatalog.ok && modelCatalog.models.length ? (
                  <label className="ai-model-catalog-select">
                    <span>Model dari provider</span>
                    <select value={selectedModelDraft} onChange={(event) => setSelectedModelDraft(event.target.value)} disabled={savingModel || loading}>
                      <option value="">Pilih model dari katalog…</option>
                      {modelCatalog.models.map((model) => <option key={model.id} value={model.id}>{model.id}{model.ownedBy ? ' · ' + model.ownedBy : ''}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
            ) : null}
            <div className="ai-model-diagnostic-actions">
              <button type="button" className="ai-settings-test" onClick={() => void diagnoseSelectedModel()}
                disabled={!routerStatus?.configured || loading || diagnosingModel || savingModel || selectedModelDraft.trim() !== routerStatus?.model}>
                {diagnosingModel ? 'Menguji kemampuan…' : 'Diagnostik kemampuan'}
              </button>
              {selectedModelDraft.trim() !== routerStatus?.model ? <small>Simpan pilihan model sebelum menjalankan diagnostik.</small> : null}
            </div>
            {modelReport ? (
              <div className="ai-model-report" role={modelReport.ok ? 'status' : 'alert'}>
                <div className="ai-model-report-head">
                  <strong>{modelReport.ok ? 'Hasil diagnostik' : 'Model belum siap'}</strong>
                  <small>{modelReport.model} · {modelReport.checkedAt}</small>
                </div>
                {modelReport.checks.map((check) => (
                  <div className="ai-model-check" key={check.id}>
                    <span className={'ai-model-check-state ' + check.status}>{check.status === 'supported' ? 'Lolos' : check.status === 'unsupported' ? 'Tidak didukung' : 'Belum pasti'}</span>
                    <div>
                      <strong>{check.label}</strong>
                      <p>{check.message}</p>
                      <small>{check.durationMs} ms</small>
                    </div>
                  </div>
                ))}
                <p className="ai-model-report-note">{modelReport.message}</p>
              </div>
            ) : null}
          </div>
          <p className="ai-settings-note">API key disimpan terenkripsi di perangkat ini dan tidak ditulis ke file proyek. Endpoint utama dicoba lebih dahulu, lalu endpoint cadangan bila perlu. Katalog dan diagnosa memakai API key yang sama dan tidak menampilkan key di UI.</p>
        </section>
      ) : null}

      {historyOpen ? (
        <section className="ai-session-history" aria-label="Riwayat percakapan tersimpan">
          <header className="ai-session-panel-head">
            <div>
              <strong>Riwayat percakapan</strong>
              <small>Tersimpan lokal di perangkat ini, terpisah dari folder project.</small>
            </div>
            <button type="button" className="ai-icon-btn" onClick={() => setHistoryOpen(false)} aria-label="Tutup riwayat"><IconX size={14} /></button>
          </header>
          {loadingSessions ? <p className="ai-session-empty">Memuat riwayat…</p> : sessions.length === 0 ? (
            <p className="ai-session-empty">Belum ada percakapan tersimpan.</p>
          ) : (
            <div className="ai-session-list">
              {sessions.map(session => (
                <div className={'ai-session-item' + (session.id === conversationId ? ' active' : '')} key={session.id}>
                  <button type="button" className="ai-session-open" disabled={loading}
                    onClick={() => { setHistoryOpen(false); if (session.id !== conversationId) setConversationId(session.id); }}>
                    <strong>{session.title || 'Percakapan baru'}</strong>
                    <span>{session.lastMessage || 'Belum ada pesan'}</span>
                    <small>{new Date(session.updatedAt).toLocaleString()} · {session.messageCount} pesan · {session.checkpointCount} checkpoint{session.projectPath ? ' · ' + pathName(session.projectPath) : ''}</small>
                  </button>
                  <button type="button" className="ai-icon-btn ai-session-delete" title="Hapus riwayat ini"
                    aria-label={'Hapus riwayat ' + (session.title || session.id)} disabled={loading}
                    onClick={() => void deleteStoredSession(session.id)}><IconTrash size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {checkpointsOpen ? (
        <section className="ai-session-history ai-checkpoint-panel" aria-label="Checkpoint perubahan file">
          <header className="ai-session-panel-head">
            <div>
              <strong>Checkpoint perubahan file</strong>
              <small>Rewind/redo hanya berjalan jika isi file masih cocok dengan checkpoint. Perubahan manual yang konflik tidak akan ditimpa.</small>
            </div>
            <button type="button" className="ai-icon-btn" onClick={() => setCheckpointsOpen(false)} aria-label="Tutup checkpoint"><IconX size={14} /></button>
          </header>
          {checkpoints.length === 0 ? <p className="ai-session-empty">Belum ada checkpoint untuk sesi ini. Checkpoint dibuat saat agent menulis file melalui tool-nya.</p> : (
            <div className="ai-checkpoint-list">
              {checkpoints.map(checkpoint => (
                <article className="ai-checkpoint-item" key={checkpoint.id}>
                  <div className="ai-checkpoint-info">
                    <strong>{new Date(checkpoint.createdAt).toLocaleString()}</strong>
                    <small>{checkpoint.paths.join(', ') || 'Perubahan file'}</small>
                    <span className={'ai-checkpoint-status ' + checkpoint.status}>{checkpoint.status === 'applied' ? 'Perubahan aktif' : 'Sudah di-rewind'}</span>
                  </div>
                  {checkpoint.status === 'applied' ? (
                    <button type="button" className="ai-checkpoint-action" disabled={loading || !wb.root || !sessionProjectPath || !sameWorkspacePath(sessionProjectPath, wb.root) || checkpointActionBusy === checkpoint.id}
                      onClick={() => void runCheckpointAction(checkpoint.id, 'rewind')}>
                      {checkpointActionBusy === checkpoint.id ? 'Memulihkan…' : 'Rewind'}
                    </button>
                  ) : (
                    <button type="button" className="ai-checkpoint-action" disabled={loading || !wb.root || !sessionProjectPath || !sameWorkspacePath(sessionProjectPath, wb.root) || checkpointActionBusy === checkpoint.id}
                      onClick={() => void runCheckpointAction(checkpoint.id, 'redo')}>
                      {checkpointActionBusy === checkpoint.id ? 'Menerapkan…' : 'Redo'}
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
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
        <button type="button" className="ai-clear-btn" onClick={() => setSettingsOpen((open) => !open)} title="Pengaturan AI">
          ⚙ Pengaturan AI
        </button>
        <button type="button" className={'ai-clear-btn' + (historyOpen ? ' active' : '')}
          onClick={() => { setHistoryOpen(open => !open); setCheckpointsOpen(false); }} title="Riwayat percakapan">
          ☷ Riwayat ({sessions.length})
        </button>
        <button type="button" className={'ai-clear-btn' + (checkpointsOpen ? ' active' : '')}
          onClick={() => { setCheckpointsOpen(open => !open); setHistoryOpen(false); }} title="Checkpoint dan rewind">
          ↶ Checkpoint ({checkpoints.length})
        </button>
        {loading ? (
          <button type="button" className="ai-clear-btn" onClick={() => void stopAgent()} title="Hentikan agent">
            ■ Hentikan
          </button>
        ) : null}
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

      <main className="ai-workspace-main">
        <div className="ai-chat-column">
          <div className="ai-messages" ref={messagesViewportRef} onScroll={handleMessagesScroll}>
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

            <div ref={bottomRef} />
          </div>

          <div
            className="ai-run-dock"
            data-active={Boolean(loading || activity || permission || agentQuestion || terminalProcess || toolActivities.length || lastRunResult || error)}
            data-awaiting-response={Boolean(permission || agentQuestion)}
          >
            {loading || activity ? (
              <div className="ai-run-status-row" role="status">
                {loading ? <Spinner size={15} /> : <span className="ai-run-status-dot" />}
                <div>
                  <strong>{activity || 'Agent sedang bekerja…'}</strong>
                  <small>{loading ? 'Agent berjalan · Escape untuk membatalkan' : 'Status terbaru agent'}</small>
                </div>
                {loading ? <button type="button" className="ai-dock-stop" onClick={() => void stopAgent()}>Hentikan</button> : null}
              </div>
            ) : null}

            {permission ? (
              <section className="ai-permission-card ai-dock-interaction" aria-label="Persetujuan command terminal" aria-live="polite">
                <div className="ai-permission-heading">
                  <strong>Persetujuan terminal diperlukan</strong><span>Belum dijalankan</span>
                </div>
                <p>{permission.reason}</p>
                <pre>{permission.command}</pre>
                <small className="ai-interaction-guidance">Periksa command dan alasannya. Command hanya berjalan setelah kamu menyetujuinya.</small>
                <div className="ai-permission-actions">
                  <button type="button" className="ai-permission-deny" onClick={() => void resolvePermission(false)}>Tolak command</button>
                  <button type="button" className="ai-permission-approve" onClick={() => void resolvePermission(true)}>Izinkan sekali</button>
                </div>
              </section>
            ) : null}

            {agentQuestion ? (
              <section className="ai-question-card ai-dock-interaction" aria-label="Pertanyaan dari AI Agent" aria-live="polite">
                <header className="ai-question-heading">
                  <div><span className="ai-question-eyebrow">BUTUH KEPUTUSANMU</span><strong>{agentQuestion.question}</strong></div>
                  <span className="ai-question-chip">Menunggu jawaban</span>
                </header>
                <p className="ai-question-context">{agentQuestion.context}</p>
                <div className="ai-question-recommendation">
                  <strong>Alasan rekomendasi</strong>
                  <p>{agentQuestion.recommendationReason}</p>
                </div>
                <div className="ai-question-options" role="group" aria-label="Pilihan jawaban">
                  {agentQuestion.options.map((option, index) => {
                    const optionNumber = index + 1;
                    const recommended = optionNumber === agentQuestion.recommendedOption;
                    return (
                      <button
                        type="button"
                        key={optionNumber}
                        className={'ai-question-option' + (selectedQuestionOption === optionNumber ? ' selected' : '') + (recommended ? ' recommended' : '')}
                        onClick={() => { setSelectedQuestionOption(optionNumber); setCustomQuestionAnswer(''); }}
                        disabled={submittingQuestion}
                        aria-pressed={selectedQuestionOption === optionNumber}
                      >
                        <span className="ai-question-option-top">
                          <strong>{option.label}</strong>
                          {recommended ? <span className="ai-recommended-label">Rekomendasi</span> : null}
                        </span>
                        <small>{option.description}</small>
                      </button>
                    );
                  })}
                </div>
                <div className="ai-question-custom">
                  <label htmlFor="ai-question-custom-answer">Atau tulis jawaban sendiri</label>
                  <input
                    id="ai-question-custom-answer"
                    value={customQuestionAnswer}
                    onChange={(event) => { setCustomQuestionAnswer(event.target.value); setSelectedQuestionOption(null); }}
                    maxLength={2000}
                    placeholder="Masukkan keputusan atau instruksi khusus…"
                    disabled={submittingQuestion}
                  />
                </div>
                <footer className="ai-question-actions">
                  <span>Rekomendasi tidak dipilih otomatis. Agent menunggu keputusanmu.</span>
                  <button
                    type="button"
                    className="ai-question-submit"
                    disabled={submittingQuestion || (!customQuestionAnswer.trim() && selectedQuestionOption === null)}
                    onClick={() => void answerAgentQuestion()}
                  >
                    {submittingQuestion ? <Spinner size={14} /> : null}
                    {submittingQuestion ? 'Mengirim…' : 'Kirim jawaban'}
                  </button>
                </footer>
              </section>
            ) : null}

            {error ? <div className="ai-error ai-run-dock-error" role="alert">{error}</div> : null}
            <div className="ai-run-details-scroll">
              <TerminalRunHistory
                history={terminalHistory}
                copiedId={terminalCopiedId}
                onCopy={(entry) => void copyTerminalDiagnostics(entry)}
                currentProcess={terminalProcess}
                currentOutput={terminalOutput}
              />
              <ToolActivityList activities={toolActivities} />
              {lastRunResult ? <RunResultBanner result={lastRunResult} /> : null}
            </div>
          </div>

          <div className={'ai-composer' + (permission || agentQuestion ? ' has-interaction' : '')}>
            <div className="ai-composer-context">
              <span>{permission ? 'Persetujuan command diperlukan' : agentQuestion ? 'Jawab pertanyaan agent di panel ini' : wb.activePath ? pathName(wb.activePath) : pathName(wb.root)}</span>
              <span>{permission || agentQuestion ? 'Agent menunggu keputusanmu' : 'Enter untuk kirim · Shift+Enter untuk baris baru'}</span>
            </div>
            {pendingAttachments.length ? (
              <div className="ai-pending-attachments" aria-label="Lampiran siap dikirim">
                {pendingAttachments.map(item => (
                  <span className="ai-attachment-chip" key={item.id} title={item.mimeType}>
                    <span aria-hidden="true">▤</span><span>{item.name}</span>
                    <button type="button" aria-label={'Hapus lampiran ' + item.name} disabled={loading}
                      onClick={() => setPendingAttachments(items => items.filter(x => x.id !== item.id))}><IconX size={12} /></button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="ai-input-row">
              <button type="button" className="ai-attach-btn" aria-label="Lampirkan file"
                title="Lampirkan foto, dokumen, atau file teks"
                disabled={loading || selectingAttachments || !sessionReady || !wb.root}
                onClick={() => void pickAttachments()}>
                {selectingAttachments ? <Spinner size={16} /> : <IconPlus size={17} />}
              </button>
              <textarea
                ref={inputRef}
                className="ai-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={permission ? 'Setujui atau tolak command di panel di atas…' : agentQuestion ? 'Pilih opsi atau tulis jawaban custom pada panel di atas…' : loading ? 'Agent sedang bekerja…' : !sessionReady ? 'Menyiapkan sesi AI baru…' : !routerStatus?.configured ? 'Atur API key 9router pada pengaturan…' : !wb.root ? 'Buka workspace proyek terlebih dahulu…' : 'Minta agent membaca, membuat, atau mengubah kode…'}
                rows={3}
                disabled={loading || !sessionReady || !activeAgent || !routerStatus?.configured || !wb.root}
                aria-label="Pesan AI coding agent"
              />
              <button
                type="button"
                className="ai-send-btn"
                onClick={() => void sendMessage()}
                disabled={loading || (!input.trim() && pendingAttachments.length === 0) || !activeAgent || !routerStatus?.configured || !wb.root}
                title="Kirim (Enter)"
              >
                {loading ? <Spinner size={17} /> : <IconSend size={17} />}
              </button>
            </div>
          </div>
        </div>
        <aside className="ai-agent-sidepanel" aria-label="Rincian kerja agent">
          <section className="ai-side-card ai-side-workspace-card">
            <div className="ai-side-card-title"><strong>Workspace aktif</strong><span className="ai-side-dot" /></div>
            <div className="ai-root-path">{wb.root ?? 'Belum ada folder project'}</div>
            {wb.activePath ? <div className="ai-active-file"><span>File terpilih di editor</span><code>{wb.activePath}</code></div> : null}
          </section>

          <section className="ai-side-card ai-side-todo-card">
            <div className="ai-side-card-title">
              <strong>Todo List</strong>
              <span>{todos.filter(todo => todo.status === 'completed').length}/{todos.length}</span>
            </div>
            <div className="ai-side-scroll ai-side-todo-scroll">
              {todos.length ? <TodoPanel todos={todos} /> : <p className="ai-side-empty">Rencana agent akan muncul di sini setelah Todo List dibuat.</p>}
            </div>
          </section>

          <ChangeList changes={changes} onSelect={setSelectedChange} />
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
