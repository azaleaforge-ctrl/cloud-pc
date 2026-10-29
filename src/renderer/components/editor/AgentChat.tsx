import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createAgentReforkPlan, findCheckpointForMessage } from '../../../shared/agentMessageActions';
import type {
  AgentEntry,
  AgentEvent,
  AgentQuestionOption,
  AgentFileChange,
  AgentProviderId,
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
  AgentModelInfo,
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

type ModelCostFilter = 'all' | 'free' | 'premium' | 'unknown';

type AgentSlashCommandName = '/sessions' | '/connect' | '/model';
const AGENT_SLASH_COMMANDS: Array<{
  command: AgentSlashCommandName;
  title: string;
  description: string;
  icon: string;
}> = [
  { command: '/sessions', title: 'Riwayat sesi', description: 'Buka, pilih, atau lanjutkan percakapan yang tersimpan.', icon: '☷' },
  { command: '/connect', title: 'Hubungkan provider', description: 'Buka pengaturan koneksi AI dan API key.', icon: '↔' },
  { command: '/model', title: 'Pilih model', description: 'Buka katalog dan pengaturan model yang tersedia saat ini.', icon: '◇' },
];

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
  checkpoint,
  onRefork,
  onRewind,
  actionsDisabled,
}: {
  msg: ChatMessage;
  onCopy: (content: string) => void;
  copied: boolean;
  checkpoint?: AgentCheckpointSummary;
  onRefork: (message: ChatMessage) => void;
  onRewind: (message: ChatMessage) => void;
  actionsDisabled: boolean;
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
      {isUser ? (
        <details className="ai-message-actions" data-message-id={msg.id}>
          <summary aria-label="Buka aksi pesan" title="Aksi pesan">•••</summary>
          <div className="ai-message-actions-menu" role="group" aria-label="Aksi pesan pengguna">
            <button type="button" onClick={() => onCopy(msg.content)}>
              {copied ? <IconCheck size={13} /> : <IconCopy size={13} />} {copied ? 'Prompt tersalin' : 'Salin prompt'}
            </button>
            <button type="button" disabled={actionsDisabled} onClick={() => onRefork(msg)}>
              Revert / Refork
            </button>
            {checkpoint?.status === 'applied' ? (
              <button type="button" disabled={actionsDisabled} onClick={() => onRewind(msg)}>
                Rewind perubahan
              </button>
            ) : null}
            {checkpoint?.status === 'rewound' ? (
              <span className="ai-message-actions-note">Checkpoint sudah di-rewind. Gunakan Ctrl+R untuk memulihkan.</span>
            ) : null}
          </div>
        </details>
      ) : null}
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

const AGENT_TOOL_DISPLAY_NAMES: Record<string, string> = {
  todo_read: 'Todo List',
  todo_write: 'Todo List',
  list_project_files: 'Jelajahi struktur proyek',
  read_project_file: 'Baca file',
  write_project_file: 'Tulis kode',
  search_project_files: 'Cari dalam proyek',
  read_session_memory: 'Baca konteks sesi',
  write_session_memory: 'Simpan konteks sesi',
  run_terminal: 'Terminal',
  search_web: 'Cari di web',
  read_web_page: 'Baca halaman web',
  check_package_version: 'Periksa versi package',
  get_current_time: 'Periksa waktu',
};

function ToolActivityList({ activity }: { activity: AgentToolActivity }) {
  const statusLabel: Record<AgentToolActivity['status'], string> = {
    running: 'Berjalan',
    completed: 'Selesai',
    failed: 'Gagal',
  };
  const mark = activity.status === 'running' ? '◌' : activity.status === 'completed' ? '✓' : '×';
  return (
    <section
      className={'ai-tool-activities status-' + activity.status}
      aria-label={AGENT_TOOL_DISPLAY_NAMES[activity.name] || activity.name}
      aria-live={activity.status === 'running' ? 'polite' : undefined}
      role={activity.status === 'failed' ? 'alert' : 'status'}
      key={activity.id}
    >
      <header>
        <span className="ai-tool-activity-mark" aria-hidden="true">{mark}</span>
        <strong className="ai-tool-activity-name">{AGENT_TOOL_DISPLAY_NAMES[activity.name] || activity.name}</strong>
        <span className={'ai-tool-activity-status status-' + activity.status}>{statusLabel[activity.status]}</span>
      </header>
      <p className="ai-tool-activity-detail">{activity.detail}</p>
      <small className="ai-tool-activity-time">{new Date(activity.ts).toLocaleTimeString()}</small>
    </section>
  );
}

function TerminalRunPanel({
  entry,
  copied,
  onCopy,
}: {
  entry: AgentTerminalHistoryEntry;
  copied: boolean;
  onCopy: (entry: AgentTerminalHistoryEntry) => void;
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
  const statusMark = process.status === 'completed'
    ? '✓'
    : process.status === 'failed' || process.status === 'timed_out'
      ? '×'
      : process.status === 'cancelled' ? '!' : '◌';
  const elapsed = Math.max(0, Math.round(((process.finishedAt ?? Date.now()) - process.startedAt) / 1000));
  const output = entry.outputs.length ? formatAgentTerminalOutput(entry.outputs) : '';
  return (
    <section className={'ai-terminal-run status-' + process.status} aria-label={'Hasil terminal: ' + statusLabel[process.status]}>
      <header className="ai-terminal-run-header">
        <div>
          <span className={'ai-terminal-status-mark status-' + process.status} aria-hidden="true">{statusMark}</span>
          <strong>Terminal</strong>
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
      <pre className="ai-terminal-output">{output || (process.status === 'running' || process.status === 'starting' ? 'Menunggu output dari command…' : '(tidak ada output)')}</pre>
    </section>
  );
}



type AgentWorkTimelineItem =
  | { kind: 'message'; key: string; ts: number; message: ChatMessage }
  | { kind: 'tool'; key: string; ts: number; activity: AgentToolActivity }
  | { kind: 'terminal'; key: string; ts: number; entry: AgentTerminalHistoryEntry };

function AgentWorkTimeline({
  messages,
  activities,
  terminalHistory,
  lastRunResult,
  copiedMessage,
  copiedTerminalId,
  checkpoints,
  onMessageCopy,
  onMessageRefork,
  onMessageRewind,
  messageActionsDisabled,
  onTerminalCopy,
}: {
  messages: ChatMessage[];
  activities: AgentToolActivity[];
  terminalHistory: AgentTerminalHistoryEntry[];
  lastRunResult: AgentRunResult | null;
  copiedMessage: string | null;
  copiedTerminalId: string | null;
  checkpoints: AgentCheckpointSummary[];
  onMessageCopy: (text: string) => void;
  onMessageRefork: (message: ChatMessage) => void;
  onMessageRewind: (message: ChatMessage) => void;
  messageActionsDisabled: boolean;
  onTerminalCopy: (entry: AgentTerminalHistoryEntry) => void;
}) {
  // A terminal tool call and its terminal-process event describe the same job.
  // Match them so the chat shows one complete terminal card, not two duplicates.
  const terminalToolIds = new Set<string>();
  const terminalActivities = activities
    .filter((activity) => activity.name === 'run_terminal')
    .slice()
    .sort((left, right) => left.ts - right.ts);
  for (const entry of terminalHistory) {
    const processStart = entry.process.startedAt;
    const candidate = terminalActivities
      .filter((activity) => !terminalToolIds.has(activity.id) && activity.ts <= processStart && processStart - activity.ts <= 120_000)
      .sort((left, right) => right.ts - left.ts)[0];
    if (candidate) terminalToolIds.add(candidate.id);
  }

  const items: AgentWorkTimelineItem[] = [
    ...messages
      .filter((message) => message.role !== 'system' && Boolean(message.content))
      .map((message) => ({ kind: 'message' as const, key: 'message-' + message.id, ts: message.ts, message })),
    ...activities
      .filter((activity) => activity.name !== 'run_terminal' || !terminalToolIds.has(activity.id))
      .map((activity) => ({ kind: 'tool' as const, key: 'tool-' + activity.id, ts: activity.ts, activity })),
    ...terminalHistory.map((entry) => ({
      kind: 'terminal' as const,
      key: 'terminal-' + entry.process.commandId,
      ts: entry.process.startedAt,
      entry,
    })),
  ].sort((left, right) => left.ts - right.ts);

  return (
    <>
      {items.map((item) => {
        if (item.kind === 'message') {
          const checkpoint = findCheckpointForMessage(item.message, messages, checkpoints);
          return <MessageBubble
            key={item.key}
            msg={item.message}
            onCopy={onMessageCopy}
            copied={copiedMessage === item.message.content}
            checkpoint={checkpoint}
            onRefork={onMessageRefork}
            onRewind={onMessageRewind}
            actionsDisabled={messageActionsDisabled}
          />;
        }
        if (item.kind === 'tool') {
          return <ToolActivityList key={item.key} activity={item.activity} />;
        }
        return <TerminalRunPanel
          key={item.key}
          entry={item.entry}
          copied={copiedTerminalId === item.entry.process.commandId}
          onCopy={onTerminalCopy}
        />;
      })}
      {lastRunResult ? <RunResultBanner result={lastRunResult} /> : null}
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

const CUSTOM_QUESTION_OPTION = 4;

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
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [activeSlashCommandIndex, setActiveSlashCommandIndex] = useState(0);
  const [checkpoints, setCheckpoints] = useState<AgentCheckpointSummary[]>([]);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [checkpointActionBusy, setCheckpointActionBusy] = useState<string | null>(null);
  const checkpointActionInFlightRef = useRef<string | null>(null);
  const firstSessionLoadRef = useRef(true);
  const [activeSkills, setActiveSkills] = useState<AgentSkillSelection[]>([]);
  const [todos, setTodos] = useState<AgentTodo[]>([]);
  const [toolActivities, setToolActivities] = useState<AgentToolActivity[]>([]);
  const [lastRunResult, setLastRunResult] = useState<AgentRunResult | null>(null);
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
  const [selectedProviderDraft, setSelectedProviderDraft] = useState<AgentProviderId>('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocusTarget, setSettingsFocusTarget] = useState<'connect' | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [modelCostFilter, setModelCostFilter] = useState<ModelCostFilter>('all');
  const [modelVisionOnly, setModelVisionOnly] = useState(false);
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
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(true);
  const activeSessionRef = useRef<string | null>(null);
  const sessionWorkspaceRef = useRef<string | null>(wb.root);
  const cancelRequestedRef = useRef(false);

  const openModelPicker = useCallback(() => {
    setSettingsOpen(false);
    setSettingsFocusTarget(null);
    setHistoryOpen(false);
    setCheckpointsOpen(false);
    setModelSearchQuery('');
    setModelCostFilter('all');
    setSelectedModelDraft(routerStatus?.model ?? '');
    setModelReport(null);
    setError(null);
    setModelPickerOpen(true);
  }, [routerStatus?.model]);

  const refreshRouterStatus = useCallback(async () => {
    try {
      const status = await window.rk.agentGetConfig();
      setRouterStatus(status);
      setSelectedProviderDraft(status.provider);
      setSelectedModelDraft(status.model);
      if (!status.configured) setSettingsOpen(true);
    } catch (err) {
      setError('Gagal membaca konfigurasi provider AI: ' + (err as Error).message);
    }
  }, []);

  const selectProviderDraft = useCallback(async (provider: AgentProviderId) => {
    if (provider === selectedProviderDraft) return;
    setSelectedProviderDraft(provider);
    setApiKey('');
    setTestResult(null);
    setModelCatalog(null);
    setModelReport(null);
    setError(null);
    try {
      const result = await window.rk.agentSelectProvider(provider);
      if (!result.ok) throw new Error(result.error || 'Gagal memilih provider.');
      await refreshRouterStatus();
    } catch (err) {
      setError('Gagal memilih provider: ' + ((err as Error).message || 'kesalahan tidak diketahui'));
    }
  }, [selectedProviderDraft, refreshRouterStatus]);

  const openProviderKeyPage = useCallback(async () => {
    const provider = selectedProviderDraft;
    const selectedInfo = routerStatus?.providers.find(item => item.id === provider);
    if (!selectedInfo?.keyUrl) {
      setError('Halaman pembuatan API key belum tersedia untuk provider lama ini.');
      return;
    }
    try {
      const result = await window.rk.agentOpenProviderKeyPage(provider);
      if (!result.ok) throw new Error(result.error || 'Gagal membuka halaman API key.');
      setError(null);
    } catch (err) {
      setError((err as Error).message || 'Gagal membuka halaman API key.');
    }
  }, [selectedProviderDraft, routerStatus?.providers]);

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
    // Activity is run-scoped and is not persisted with a restored chat session.
    setToolActivities([]);
    setTerminalHistory([]);
    setTerminalCopiedId(null);
    setLastRunResult(null);
    setActiveSkills([]);
    setPermission(null);
    setAgentQuestion(null);
    setSelectedQuestionOption(null);
    setCustomQuestionAnswer('');
    setSubmittingQuestion(false);
    void (async () => {
      try {
        if (firstSessionLoadRef.current) {
          firstSessionLoadRef.current = false;
          setLoadingSessions(true);
          const available = await window.rk.agentListSessions();
          if (!alive) return;
          setSessions(available);
          setLoadingSessions(false);
          const workspaceSessions = available.filter((session) => sameWorkspacePath(session.projectPath, wb.root));
          if (workspaceSessions.length > 0) {
            // Resume the latest session for this exact project folder, never a different workspace.
            setConversationId(workspaceSessions[0].id);
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
    const previousRoot = sessionWorkspaceRef.current;
    if (sameWorkspacePath(previousRoot, wb.root)) return;
    sessionWorkspaceRef.current = wb.root;

    // A folder switch starts a clean visible conversation, while the old folder's session is saved.
    setSessionReady(false);
    setMessages([]);
    setConversationSummary('');
    setSummaryThroughTs(0);
    setTodos([]);
    setCheckpoints([]);
    setChanges([]);
    setSelectedChange(null);
    setActiveSkills([]);
    setToolActivities([]);
    setTerminalHistory([]);
    setLastRunResult(null);
    setError(null);

    void (async () => {
      try {
        if (conversationId && sessionReady) {
          await window.rk.agentSaveSession({
            id: conversationId,
            ...(sessionProjectPath ? { projectPath: sessionProjectPath } : previousRoot ? { projectPath: previousRoot } : {}),
            activeAgentId,
            messages,
            summary: conversationSummary,
            summaryThroughTs,
            todos,
          });
        }
        const available = await window.rk.agentListSessions();
        setSessions(available);
        const workspaceSessions = available.filter((session) => sameWorkspacePath(session.projectPath, wb.root));
        setConversationId(workspaceSessions.length > 0 ? workspaceSessions[0].id : makeConversationId());
      } catch (err) {
        setError('Gagal memulihkan sesi proyek: ' + ((err as Error).message || 'kesalahan tidak diketahui'));
      }
    })();
  }, [wb.root]);

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
        if (event.activity.status === 'running') {
          // Finish the current assistant text segment before showing this tool card.
          // New model text after the tool result will start a fresh bubble.
          setMessages((previous) => {
            const index = previous.map((item) => item.role).lastIndexOf('assistant');
            if (index < 0 || !previous[index].streaming) return previous;
            // If a model immediately calls a tool without explanatory text, do not
            // persist an empty assistant bubble.
            if (!previous[index].content.trim()) return previous.filter((_, currentIndex) => currentIndex !== index);
            const next = [...previous];
            next[index] = { ...next[index], streaming: false };
            return next;
          });
        }
        setToolActivities((previous) => {
          const index = previous.findIndex((item) => item.id === event.activity.id);
          if (index < 0) return [...previous, event.activity];
          const next = [...previous];
          // Keep the original start time so updates do not move a job to the end
          // of the timeline when it finishes.
          next[index] = { ...event.activity, ts: previous[index].ts };
          return next;
        });
      } else if (event.type === 'run-result') {
        setLastRunResult(event.result);
        if (event.result.outcome === 'completed' || event.result.outcome === 'cancelled') setTodos([]);
      } else if (event.type === 'terminal-process') {
        setTerminalHistory((previous) => upsertAgentTerminalProcess(previous, event.process, 100));
      } else if (event.type === 'terminal-output') {
        setTerminalHistory((previous) => appendAgentTerminalOutput(previous, event.output));
      } else if (event.type === 'skills') {
        setActiveSkills(event.skills);
      } else if (event.type === 'output') {
        setMessages((previous) => {
          const index = previous.map((item) => item.role).lastIndexOf('assistant');
          if (index >= 0 && previous[index].streaming) {
            const next = [...previous];
            const last = next[index];
            next[index] = { ...last, content: last.content + event.data, streaming: true };
            return next;
          }

          // The previous assistant segment ended when a tool started. Keep
          // post-tool commentary in its own chat bubble instead of merging it
          // into text shown before that tool ran.
          const ts = Date.now();
          const nextMessage: ChatMessage = {
            id: 'assistant-' + ts.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
            role: 'assistant',
            content: event.data,
            ts,
            runId: sessionId,
            streaming: true,
          };
          return [...previous, nextMessage];
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
  }, [messages, toolActivities, terminalHistory, lastRunResult]);

  const activeAgent = agents.find((agent) => agent.id === activeAgentId);
  const workspaceSessions = sessions.filter((session) => sameWorkspacePath(session.projectPath, wb.root));
  const slashCommandQuery = input.trimStart().split(/\s/, 1)[0].toLowerCase();
  const filteredSlashCommands = AGENT_SLASH_COMMANDS.filter(item => item.command.startsWith(slashCommandQuery || '/'));

  useEffect(() => {
    if (!settingsOpen || settingsFocusTarget !== 'connect') return;
    apiKeyInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    apiKeyInputRef.current?.focus({ preventScroll: true });
    setSettingsFocusTarget(null);
  }, [settingsOpen, settingsFocusTarget]);

  useEffect(() => {
    if (!testResult || testResult.ok) return;
    const timer = window.setTimeout(() => setTestResult(null), 5000);
    return () => window.clearTimeout(timer);
  }, [testResult]);

  const saveCopied = useCallback(async (text: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard browser tidak tersedia.');
      await navigator.clipboard.writeText(text);
      setCopiedMsg(text);
      setError(null);
      window.setTimeout(() => setCopiedMsg(current => current === text ? null : current), 1800);
    } catch {
      setError('Tidak dapat menyalin pesan. Periksa izin clipboard aplikasi lalu coba lagi.');
    }
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
      setError('Hubungkan provider AI terlebih dahulu. Pilih provider, masukkan API key aktif, lalu tekan Simpan & uji.');
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
    setActiveSkills([]);
    setTerminalHistory([]);
    setTerminalCopiedId(null);
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
      // The returned ID is also the checkpoint runId recorded by write_project_file.
      // Persist it on both sides of this user turn so actions stay available after reload.
      setMessages(previous => previous.map(message =>
        message.id === userMessage.id || message.id === assistantMessage.id
          ? { ...message, runId: result.sessionId }
          : message,
      ));
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
        message: 'Gagal menguji koneksi provider: ' + ((err as Error).message || 'kesalahan tidak diketahui'),
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

  useEffect(() => {
    if (!modelPickerOpen) return;
    if (!routerStatus?.configured) {
      setModelCatalog(null);
      return;
    }
    void refreshModelCatalog();
  }, [modelPickerOpen, routerStatus?.configured, routerStatus?.provider, refreshModelCatalog]);

  const modelCatalogOptions = useMemo(() => {
    const models = modelCatalog?.ok ? modelCatalog.models : [];
    const query = modelSearchQuery.trim().toLowerCase();
    return models
      .filter(model => modelCostFilter === 'all' || model.costTier === modelCostFilter)
      .filter(model => !modelVisionOnly || (model.inputModalities ?? []).some(modality => /^(image|images|vision)$/i.test(modality)))
      .filter(model => !query || [model.id, model.name, model.ownedBy, ...(model.inputModalities ?? []), ...(model.outputModalities ?? [])]
        .some(value => (value ?? '').toLowerCase().includes(query)))
      .sort((a, b) => {
        const activeA = a.id === routerStatus?.model ? 0 : 1;
        const activeB = b.id === routerStatus?.model ? 0 : 1;
        return activeA - activeB || a.id.localeCompare(b.id);
      });
  }, [modelCatalog, modelSearchQuery, modelCostFilter, modelVisionOnly, routerStatus?.model]);

  const modelCostCounts = useMemo(() => {
    const models = modelCatalog?.ok ? modelCatalog.models : [];
    return {
      all: models.length,
      free: models.filter(model => model.costTier === 'free').length,
      premium: models.filter(model => model.costTier === 'premium').length,
      unknown: models.filter(model => model.costTier === 'unknown').length,
    };
  }, [modelCatalog]);

  const saveSelectedModel = useCallback(async () => {
    if (!selectedModelDraft.trim() || savingModel) return;
    setSavingModel(true);
    setModelReport(null);
    try {
      const result = await window.rk.agentSelectModel(selectedModelDraft.trim());
      if (!result.ok) throw new Error(result.error || 'Gagal menyimpan model.');
      setModelPickerOpen(false);
      await refreshRouterStatus();
      setActivity('Model AI berhasil disimpan.');
      setError(null);
      inputRef.current?.focus();
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
      const result = await window.rk.agentSaveConfig({ provider: selectedProviderDraft, apiKey });
      if (!result.ok) throw new Error(result.error ?? 'Gagal menyimpan API key.');
      setApiKey('');
      await refreshRouterStatus();
      setError(null);
      setActivity('');
      const connectivity = await window.rk.agentTestConfig();
      setTestResult(connectivity);
      if (connectivity.ok) {
        setActivity('Koneksi ' + (routerStatus?.providers.find(item => item.id === selectedProviderDraft)?.name ?? selectedProviderDraft) + ' berhasil diuji.');
        setSettingsOpen(false);
      }
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message || 'Gagal menyimpan API key.' });
    } finally {
      setSavingKey(false);
    }
  }, [apiKey, savingKey, refreshRouterStatus, selectedProviderDraft, routerStatus?.providers]);

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
    const isCustomOptionSelected = selectedQuestionOption === CUSTOM_QUESTION_OPTION;
    const custom = isCustomOptionSelected ? customQuestionAnswer.trim() : '';
    const selected = selectedQuestionOption !== null &&
      selectedQuestionOption >= 1 &&
      selectedQuestionOption <= current.options.length
      ? current.options[selectedQuestionOption - 1]
      : null;
    const answer = isCustomOptionSelected
      ? (custom ? 'Jawaban custom: ' + custom : '')
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
          const count = agentQuestion.options.length + 1;
          if (count === 1) return null;
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
    if (loading || checkpointActionInFlightRef.current !== null) return;
    checkpointActionInFlightRef.current = checkpointId;
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
      if (checkpointActionInFlightRef.current === checkpointId) checkpointActionInFlightRef.current = null;
      setCheckpointActionBusy(null);
    }
  }, [loading, conversationId]);

  const reforkFromMessage = useCallback(async (message: ChatMessage) => {
    if (loading || !sessionReady || !wb.root) return;
    if (pendingAttachments.length) {
      setError('Kirim atau hapus lampiran yang masih ada di composer sebelum membuat cabang percakapan.');
      return;
    }
    if (sessionProjectPath && !sameWorkspacePath(sessionProjectPath, wb.root)) {
      setError('Workspace sesi tidak cocok dengan workspace aktif; cabang tidak dibuat.');
      return;
    }
    const plan = createAgentReforkPlan(messages, message.id);
    if (!plan) {
      setError('Prompt pengguna yang dipilih tidak ditemukan pada sesi aktif.');
      return;
    }
    const prefix = plan.messages;
    const branchId = makeConversationId();
    setError(null);
    try {
      const saved = await window.rk.agentSaveSession({
        id: branchId,
        projectPath: wb.root,
        activeAgentId,
        messages: prefix,
        summary: '',
        summaryThroughTs: 0,
        todos: [],
      });
      if (!saved.ok) throw new Error(saved.error || 'Gagal menyimpan cabang sesi.');
      setConversationId(branchId);
      setMessages(prefix);
      setSessionProjectPath(wb.root);
      setConversationSummary('');
      setSummaryThroughTs(0);
      setTodos([]);
      setCheckpoints([]);
      setChanges([]);
      setSelectedChange(null);
      setToolActivities([]);
      setTerminalHistory([]);
      setLastRunResult(null);
      setInput(plan.prompt);
      setHistoryOpen(false);
      setCheckpointsOpen(false);
      setActivity('Cabang percakapan dibuat sebelum prompt terpilih. Prompt siap diedit atau dikirim ulang.');
      if (plan.requiresAttachmentReselect) {
        setError('Prompt berhasil disalin ke composer, tetapi lampiran lama tidak disalin ke cabang. Lampirkan ulang media sebelum mengirim.');
      }
      setSessions(await window.rk.agentListSessions());
    } catch (error) {
      setError((error as Error).message || 'Gagal membuat cabang percakapan.');
    }
  }, [loading, sessionReady, wb.root, sessionProjectPath, pendingAttachments.length, messages, activeAgentId]);

  const rewindFromMessage = useCallback((message: ChatMessage) => {
    if (!message.runId) {
      setError('Checkpoint tidak tertaut ke pesan ini. Pesan dari versi lama mungkin belum menyimpan ID run.');
      return;
    }
    const checkpoint = checkpoints.find(item => item.runId === message.runId && item.status === 'applied');
    if (!checkpoint) {
      setError('Tidak ada checkpoint aktif untuk perubahan yang terkait dengan prompt ini.');
      return;
    }
    void runCheckpointAction(checkpoint.id, 'rewind');
  }, [checkpoints, runCheckpointAction]);

  useEffect(() => {
    if (!visible) return;
    const onRestoreShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key.toLowerCase() !== 'r') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      // Reserve Ctrl+R while the Agentic Coding panel is visible so it cannot
      // accidentally reload the app. File mutations require a focused prompt menu.
      if (settingsOpen || modelPickerOpen || historyOpen || checkpointsOpen) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        setActivity('Ctrl+R tidak mengubah checkpoint saat fokus berada di kolom teks.');
        return;
      }
      const actionMenu = target?.closest('.ai-message-actions[data-message-id]') as HTMLElement | null;
      const selectedMessage = actionMenu?.dataset.messageId
        ? messages.find(message => message.id === actionMenu.dataset.messageId)
        : undefined;
      if (!selectedMessage) {
        setActivity('Fokuskan menu aksi pada prompt terlebih dahulu untuk undo/redo checkpoint dengan Ctrl+R.');
        return;
      }
      if (loading || checkpointActionInFlightRef.current !== null) {
        setActivity('Tunggu agent atau operasi checkpoint selesai sebelum undo/redo.');
        return;
      }
      const checkpoint = findCheckpointForMessage(selectedMessage, messages, checkpoints);
      if (!checkpoint) {
        setActivity('Prompt ini tidak memiliki checkpoint yang dapat di-undo/redo.');
        return;
      }
      void runCheckpointAction(checkpoint.id, checkpoint.status === 'rewound' ? 'redo' : 'rewind');
    };
    window.addEventListener('keydown', onRestoreShortcut, true);
    return () => window.removeEventListener('keydown', onRestoreShortcut, true);
  }, [visible, settingsOpen, modelPickerOpen, historyOpen, checkpointsOpen, loading, checkpointActionBusy, checkpoints, runCheckpointAction]);

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

  const executeSlashCommand = useCallback((command: AgentSlashCommandName) => {
    setInput('');
    setSlashMenuOpen(false);
    setActiveSlashCommandIndex(0);
    setError(null);

    if (command === '/sessions') {
      setCheckpointsOpen(false);
      setSettingsOpen(false);
      setHistoryOpen(true);
      return;
    }

    setHistoryOpen(false);
    setCheckpointsOpen(false);
    if (command === '/model') {
      openModelPicker();
      return;
    }
    setSettingsFocusTarget('connect');
    setSettingsOpen(true);
  }, [openModelPicker]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const trimmedInput = input.trim();

    if (event.key === 'Escape' && slashMenuOpen) {
      event.preventDefault();
      setSlashMenuOpen(false);
      return;
    }

    if (slashMenuOpen && filteredSlashCommands.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setActiveSlashCommandIndex(current => {
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        return (current + direction + filteredSlashCommands.length) % filteredSlashCommands.length;
      });
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (trimmedInput.startsWith('/')) {
        const exactCommand = AGENT_SLASH_COMMANDS.find(item => item.command === trimmedInput.toLowerCase());
        if (exactCommand) {
          executeSlashCommand(exactCommand.command);
          return;
        }
        const selectedCommand = slashMenuOpen ? filteredSlashCommands[activeSlashCommandIndex] : undefined;
        if (selectedCommand) {
          executeSlashCommand(selectedCommand.command);
          return;
        }
        const typedCommand = trimmedInput.split(/\s/, 1)[0];
        setSlashMenuOpen(false);
        setError('Perintah "' + typedCommand + '" tidak dikenal. Ketik / untuk melihat perintah yang tersedia.');
        return;
      }
      setSlashMenuOpen(false);
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
          <span className={'ai-router-dot ' + (routerStatus?.configured ? 'ready' : 'missing')} title={routerStatus?.configured ? (routerStatus.providerName + ' siap') : ((routerStatus?.providerName ?? 'Provider AI') + ' belum dikonfigurasi')} />
        </div>
        <div className="ai-workspace-pill" title={wb.root ?? ''}>
          <span className="ai-workspace-dot" />
          <span>{pathName(wb.root)}</span>
          {wb.activePath ? <small>· {pathName(wb.activePath)}</small> : null}
        </div>
        <div className="ai-panel-actions">
          <button type="button" className="ai-icon-btn" title="Koneksi provider AI" aria-label="Koneksi provider AI" onClick={() => setSettingsOpen((open) => !open)}>⚙</button>
          {loading ? <button type="button" className="ai-icon-btn ai-stop-btn" title="Hentikan agent" aria-label="Hentikan agent" onClick={() => void stopAgent()}>■</button> : null}
          <button type="button" className="ai-icon-btn" title="Kembali ke editor" aria-label="Kembali ke editor" onClick={onToggle}><IconX size={16} /></button>
        </div>
      </header>

      {settingsOpen ? (
        <section className="ai-settings">
          <div className="ai-settings-title">Koneksi provider AI</div>
          <label className="ai-settings-label" htmlFor="rk-provider-select">Provider</label>
          <div className="ai-provider-choice-row">
            <select id="rk-provider-select" className="ai-provider-select" value={selectedProviderDraft}
              onChange={(event) => void selectProviderDraft(event.target.value as AgentProviderId)} disabled={savingKey}>
              <option value="openrouter">OpenRouter{routerStatus?.providers.find(item => item.id === 'openrouter')?.configured ? ' · key tersimpan' : ''}</option>
              <option value="gemini">Google Gemini API{routerStatus?.providers.find(item => item.id === 'gemini')?.configured ? ' · key tersimpan' : ''}</option>
              {(routerStatus?.providers.find(item => item.id === 'legacy')?.configured || selectedProviderDraft === 'legacy') ? (
                <option value="legacy">9router / OpenAI-compatible (Legacy)</option>
              ) : null}
            </select>
            {routerStatus?.providers.find(item => item.id === selectedProviderDraft)?.keyUrl ? (
              <button type="button" className="ai-settings-test ai-provider-key-page" onClick={() => void openProviderKeyPage()}>
                Buka halaman resmi API key
              </button>
            ) : null}
          </div>
          <p className="ai-settings-note ai-provider-help">
            {selectedProviderDraft === 'openrouter'
              ? 'Satu API key OpenRouter memberi akses ke model-model yang tersedia pada akunmu.'
              : selectedProviderDraft === 'gemini'
                ? 'Gunakan API key Gemini dari Google AI Studio. Nama dan akses model mengikuti katalog akun Google-mu.'
                : 'Mode kompatibilitas untuk instalasi 9router lama; opsi ini hanya ditampilkan saat konfigurasi lama terdeteksi.'}
          </p>
          <label className="ai-settings-label" htmlFor="rk-router-key">API key {routerStatus?.providers.find(item => item.id === selectedProviderDraft)?.configured ? '(tersimpan; isi untuk mengganti)' : ''}</label>
          <div className="ai-settings-key-row">
            <input
              id="rk-router-key"
              ref={apiKeyInputRef}
              className="ai-settings-key"
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void saveRouterKey(); }}
              placeholder={routerStatus?.configured ? 'API key tersimpan; isi untuk mengganti' : selectedProviderDraft === 'gemini' ? 'Tempel API key Gemini' : selectedProviderDraft === 'openrouter' ? 'Tempel API key OpenRouter' : 'Tempel API key 9router'}
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
            <div><span>Provider aktif</span><code>{routerStatus?.providerName ?? 'OpenRouter'}</code></div>
            <div><span>Model</span><code>{routerStatus?.model ?? 'openai/gpt-4o-mini'}</code></div>
            <div><span>Endpoint</span><code>{routerStatus?.endpoint ?? 'https://openrouter.ai/api/v1'}</code></div>
            {routerStatus?.fallbackEndpoint ? <div><span>Endpoint cadangan</span><code>{routerStatus.fallbackEndpoint}</code></div> : null}
          </div>
          <div className="ai-settings-model-shortcut">
            <div>
              <span>Model aktif</span>
              <strong>{routerStatus?.model ?? 'Belum dipilih'}</strong>
              <small>{routerStatus?.providerName ?? 'Provider AI'}</small>
            </div>
            <button type="button" className="ai-settings-save" onClick={openModelPicker}>
              Pilih model
            </button>
          </div>
          <p className="ai-settings-note">API key disimpan terenkripsi di perangkat ini dan tidak ditulis ke file proyek atau dibagikan ke anggota LAN. Setiap provider memakai adapter request, autentikasi, katalog model, dan format streaming yang sesuai. Katalog serta diagnostik tidak menampilkan nilai API key.</p>
        </section>
      ) : null}

      {modelPickerOpen ? (
        <div className="ai-model-overlay" role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) { setModelPickerOpen(false); inputRef.current?.focus(); } }}>
          <section className="ai-model-dialog" role="dialog" aria-modal="true"
            aria-label="Pilih model AI" tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setModelPickerOpen(false);
                inputRef.current?.focus();
              }
            }}>
            <header className="ai-model-dialog-head">
              <div>
                <span className="ai-model-eyebrow">MODEL PROVIDER</span>
                <h2>Pilih model AI</h2>
                <p>Katalog berasal dari provider yang sedang aktif. Informasi biaya dan kemampuan hanya ditampilkan jika disediakan metadata.</p>
              </div>
              <button type="button" className="ai-icon-btn" aria-label="Tutup pemilih model"
                onClick={() => { setModelPickerOpen(false); inputRef.current?.focus(); }}><IconX size={16} /></button>
            </header>

            <div className="ai-model-active-card">
              <div className="ai-model-active-mark"><span>✓</span></div>
              <div className="ai-model-active-copy">
                <small>MODEL AKTIF · {routerStatus?.providerName ?? 'Provider belum dipilih'}</small>
                <strong>{routerStatus?.model ?? 'Belum ada model aktif'}</strong>
                <code>{routerStatus?.endpoint ?? ''}</code>
              </div>
              <button type="button" className="ai-settings-test ai-model-diagnostic-button"
                onClick={() => void diagnoseSelectedModel()}
                disabled={!routerStatus?.configured || loading || diagnosingModel || savingModel || selectedModelDraft.trim() !== routerStatus?.model}>
                {diagnosingModel ? 'Menguji…' : 'Uji kemampuan'}
              </button>
            </div>

            {!routerStatus?.configured ? (
              <div className="ai-model-empty-state" role="status">
                <strong>Hubungkan provider terlebih dahulu</strong>
                <p>Daftar model belum bisa dimuat karena API key provider belum dikonfigurasi.</p>
                <button type="button" className="ai-settings-save" onClick={() => {
                  setModelPickerOpen(false);
                  setSettingsFocusTarget('connect');
                  setSettingsOpen(true);
                }}>Buka /connect</button>
              </div>
            ) : (
              <>
                <div className="ai-model-catalog-toolbar">
                  <label className="ai-model-search-wrap" htmlFor="rk-model-search">
                    <span aria-hidden="true">⌕</span>
                    <input id="rk-model-search" type="search" autoFocus value={modelSearchQuery}
                      onChange={(event) => setModelSearchQuery(event.target.value)}
                      placeholder="Cari nama model, ID, provider, modalitas…"
                      autoComplete="off" spellCheck={false} />
                    {modelSearchQuery ? <button type="button" aria-label="Hapus pencarian"
                      onClick={() => setModelSearchQuery('')}>×</button> : null}
                  </label>
                  <button type="button" className="ai-settings-test ai-model-refresh"
                    onClick={() => void refreshModelCatalog()} disabled={loadingModels}>
                    {loadingModels ? 'Memuat…' : 'Muat ulang'}
                  </button>
                </div>

                <div className="ai-model-price-filters" role="group" aria-label="Filter biaya model">
                  {([
                    ['all', 'Semua', modelCostCounts.all],
                    ['free', 'Gratis', modelCostCounts.free],
                    ['premium', 'Premium', modelCostCounts.premium],
                    ['unknown', 'Harga belum diketahui', modelCostCounts.unknown],
                  ] as Array<[ModelCostFilter, string, number]>).map(([value, label, count]) => (
                    <button key={value} type="button" className={modelCostFilter === value ? 'active' : ''}
                      aria-pressed={modelCostFilter === value}
                      onClick={() => setModelCostFilter(value)}>
                      {label}<span>{count}</span>
                    </button>
                  ))}
                </div>

                <div className="ai-model-price-filters" role="group" aria-label="Filter model dengan input gambar">
                  <button type="button" className={!modelVisionOnly ? 'active' : ''}
                    aria-pressed={!modelVisionOnly} onClick={() => setModelVisionOnly(false)}>
                    Semua kemampuan
                  </button>
                  <button type="button" className={modelVisionOnly ? 'active' : ''}
                    aria-pressed={modelVisionOnly} onClick={() => setModelVisionOnly(true)}>
                    Input gambar (vision)
                  </button>
                </div>
                <p className="ai-settings-note">
                  Filter vision hanya memakai metadata input dari katalog provider. Metadata yang tidak tersedia tidak dianggap mendukung gambar; gunakan “Uji kemampuan” untuk menguji endpoint/model aktif.
                </p>

                <div className="ai-model-catalog-state" aria-live="polite">
                  {loadingModels ? <span><Spinner size={12} /> Mengambil katalog dari {routerStatus.providerName}…</span>
                    : modelCatalog?.ok
                      ? <span>{modelCatalogOptions.length} model cocok · diperbarui {modelCatalog.retrievedAt ? new Date(modelCatalog.retrievedAt).toLocaleTimeString() : 'baru saja'}</span>
                      : modelCatalog?.message
                        ? <span className="ai-model-catalog-error">{modelCatalog.message}</span>
                        : <span>Katalog model belum dimuat.</span>}
                </div>

                <div className="ai-model-options" role="list" aria-label="Daftar model tersedia">
                  {loadingModels && !modelCatalog ? (
                    <div className="ai-model-empty-state"><Spinner size={18} /><strong>Memuat katalog model…</strong></div>
                  ) : !modelCatalog?.ok ? (
                    <div className="ai-model-empty-state">
                      <strong>Katalog belum tersedia</strong>
                      <p>Pastikan API key memiliki akses ke endpoint model, lalu coba muat ulang.</p>
                    </div>
                  ) : modelCatalogOptions.length === 0 ? (
                    <div className="ai-model-empty-state">
                      <strong>Tidak ada model yang cocok</strong>
                      <p>Coba ubah kata pencarian, filter biaya, atau filter input gambar.</p>
                    </div>
                  ) : modelCatalogOptions.map((model: AgentModelInfo) => {
                    const isActive = model.id === routerStatus.model;
                    const isDraft = model.id === selectedModelDraft.trim();
                    const toolMetadata = model.supportedParameters?.some(parameter => /tools?|tool_choice|function/.test(parameter)) ?? false;
                    const modalityTags = [
                      ...(model.inputModalities ?? []).map(modality => ({ label: 'Input ' + modality, key: 'in-' + modality })),
                      ...(model.outputModalities ?? []).map(modality => ({ label: 'Output ' + modality, key: 'out-' + modality })),
                    ];
                    return (
                      <div key={model.id} role="listitem">
                        <button type="button"
                          className={'ai-model-option' + (isActive ? ' is-active' : '') + (isDraft ? ' is-selected' : '')}
                          aria-pressed={isDraft}
                          onClick={() => setSelectedModelDraft(model.id)}>
                        <div className="ai-model-option-heading">
                          <div>
                            <strong>{model.name || model.id}</strong>
                            <code>{model.id}</code>
                          </div>
                          <div className="ai-model-option-flags">
                            {isActive ? <span className="ai-model-tag active">Aktif</span> : null}
                            {isDraft && !isActive ? <span className="ai-model-tag selected">Dipilih</span> : null}
                            <span className={'ai-model-tag cost-' + model.costTier}>
                              {model.costTier === 'free' ? 'Gratis'
                                : model.costTier === 'premium' ? 'Premium'
                                  : 'Harga belum diketahui'}
                            </span>
                          </div>
                        </div>
                        <div className="ai-model-option-meta">
                          {model.ownedBy ? <span>{model.ownedBy}</span> : null}
                          {model.contextLength !== undefined ? <span>{model.contextLength.toLocaleString()} token konteks</span> : null}
                          {modalityTags.map(tag => <span key={tag.key}>{tag.label}</span>)}
                          {toolMetadata ? <span>Tool calling tercantum</span> : null}
                          {model.supportedGenerationMethods?.length ? <span>API: {model.supportedGenerationMethods.join(', ')}</span> : null}
                          {model.promptPrice !== undefined && model.completionPrice !== undefined ? (
                            <span>Input ${((model.promptPrice ?? 0) * 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 })} · Output ${((model.completionPrice ?? 0) * 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 })} / 1 juta token</span>
                          ) : null}
                          {!modalityTags.length && !toolMetadata && !model.supportedGenerationMethods?.length
                            ? <span>Modalitas dan dukungan tools belum tercantum di metadata</span> : null}
                        </div>
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="ai-model-dialog-footer">
                  <label className="ai-model-custom-id" htmlFor="rk-model-custom-id">
                    <span>ID model pilihan</span>
                    <input id="rk-model-custom-id" value={selectedModelDraft}
                      onChange={(event) => setSelectedModelDraft(event.target.value)}
                      maxLength={200} spellCheck={false} placeholder="Pilih dari katalog atau masukkan ID model…" />
                  </label>
                  <button type="button" className="ai-settings-save ai-model-apply"
                    disabled={!selectedModelDraft.trim() || savingModel || loading || selectedModelDraft.trim() === routerStatus?.model}
                    onClick={() => void saveSelectedModel()}>
                    {savingModel ? 'Menyimpan…' : selectedModelDraft.trim() === routerStatus?.model ? 'Model sedang aktif' : 'Gunakan model'}
                  </button>
                </div>

                {error ? <div className="ai-model-catalog-error" role="alert">{error}</div> : null}
                {modelReport ? (
                  <div className="ai-model-report" role={modelReport.ok ? 'status' : 'alert'}>
                    <div className="ai-model-report-head">
                      <strong>{modelReport.ok ? 'Hasil diagnostik' : 'Model belum siap'}</strong>
                      <small>{modelReport.model} · {new Date(modelReport.checkedAt).toLocaleString()}</small>
                    </div>
                    {modelReport.checks.map(check => (
                      <div className="ai-model-check" key={check.id}>
                        <span className={'ai-model-check-state ' + check.status}>
                          {check.status === 'supported' ? 'Lolos' : check.status === 'unsupported' ? 'Tidak didukung' : 'Belum pasti'}
                        </span>
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
              </>
            )}
          </section>
        </div>
      ) : null}

      {historyOpen ? (
        <div className="ai-session-overlay" role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryOpen(false); }}>
          <section className="ai-session-history ai-sessions-modal" role="dialog" aria-modal="true"
            aria-label="Riwayat percakapan tersimpan" tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setHistoryOpen(false);
                inputRef.current?.focus();
              }
            }}>
            <header className="ai-session-panel-head">
              <div>
                <strong>Riwayat sesi</strong>
                <small>Pilih percakapan untuk melanjutkan. Hanya sesi pada workspace aktif yang ditampilkan.</small>
              </div>
              <button type="button" className="ai-icon-btn" autoFocus onClick={() => setHistoryOpen(false)} aria-label="Tutup riwayat"><IconX size={14} /></button>
            </header>
            {loadingSessions ? <p className="ai-session-empty">Memuat riwayat…</p> : workspaceSessions.length === 0 ? (
              <p className="ai-session-empty">Belum ada percakapan tersimpan untuk workspace ini.</p>
            ) : (
              <div className="ai-session-list ai-sessions-modal-list">
                {workspaceSessions.map(session => (
                  <div className={'ai-session-item' + (session.id === conversationId ? ' active' : '')} key={session.id}>
                    <button type="button" className="ai-session-open" disabled={loading}
                      onClick={() => { setHistoryOpen(false); if (session.id !== conversationId) setConversationId(session.id); }}>
                      <strong>{session.title || 'Percakapan baru'}</strong>
                      <code className="ai-session-code">{session.id}</code>
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
        </div>
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

      {!routerStatus?.configured ? (
        <section className="ai-setup-needed">
          <div className="ai-setup-icon">⚙</div>
          <strong>Hubungkan provider AI sebelum mulai chat</strong>
          <p>Pilih OpenRouter atau Google Gemini API, lalu simpan API key aktif. API key yang pernah dipublikasikan harus dicabut dan diganti.</p>
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
              <AgentWorkTimeline
                messages={messages}
                activities={toolActivities}
                terminalHistory={terminalHistory}
                lastRunResult={lastRunResult}
                copiedMessage={copiedMsg}
                copiedTerminalId={terminalCopiedId}
                checkpoints={checkpoints}
                onMessageCopy={saveCopied}
                onMessageRefork={(message) => void reforkFromMessage(message)}
                onMessageRewind={rewindFromMessage}
                messageActionsDisabled={loading || !sessionReady || !wb.root || pendingAttachments.length > 0}
                onTerminalCopy={(entry) => void copyTerminalDiagnostics(entry)}
              />
            )}
            <div ref={bottomRef} />
          </div>

          <div
            className="ai-run-dock"
            data-active={Boolean(loading || permission || agentQuestion || error)}
            data-awaiting-response={Boolean(permission || agentQuestion)}
          >
            {loading || permission || agentQuestion ? (
              <div className="ai-run-status-row" role="status">
                {loading && !permission && !agentQuestion ? <Spinner size={15} /> : <span className="ai-run-status-dot" />}
                <div>
                  <strong>{permission ? 'Menunggu persetujuan terminal' : agentQuestion ? 'Menunggu jawabanmu' : 'AI sedang bekerja…'}</strong>
                  <small title={activity || undefined}>{permission || agentQuestion ? 'Agent melanjutkan setelah keputusanmu dikirim' : 'Setiap langkah dan hasil tampil sebagai item di percakapan'}</small>
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
                  <button
                    type="button"
                    key="custom"
                    className={'ai-question-option ai-question-option-custom' + (selectedQuestionOption === CUSTOM_QUESTION_OPTION ? ' selected' : '')}
                    onClick={() => { setSelectedQuestionOption(CUSTOM_QUESTION_OPTION); setCustomQuestionAnswer(''); }}
                    disabled={submittingQuestion}
                    aria-pressed={selectedQuestionOption === CUSTOM_QUESTION_OPTION}
                  >
                    <span className="ai-question-option-top">
                      <strong>4. Custom (tulis sendiri)</strong>
                    </span>
                    <small>Tulis keputusan atau instruksi sendiri di luar tiga pilihan di atas.</small>
                  </button>
                </div>
                {selectedQuestionOption === CUSTOM_QUESTION_OPTION ? (
                  <div className="ai-question-custom">
                    <label htmlFor="ai-question-custom-answer">Jawaban custom</label>
                    <input
                      id="ai-question-custom-answer"
                      autoFocus
                      value={customQuestionAnswer}
                      onChange={(event) => setCustomQuestionAnswer(event.target.value)}
                      maxLength={2000}
                      placeholder="Masukkan keputusan atau instruksi khusus…"
                      disabled={submittingQuestion}
                    />
                  </div>
                ) : null}
                <footer className="ai-question-actions">
                  <span>Rekomendasi tidak dipilih otomatis. Agent menunggu keputusanmu.</span>
                  <button
                    type="button"
                    className="ai-question-submit"
                    disabled={submittingQuestion || (
                      selectedQuestionOption === CUSTOM_QUESTION_OPTION
                        ? !customQuestionAnswer.trim()
                        : selectedQuestionOption === null
                    )}
                    onClick={() => void answerAgentQuestion()}
                  >
                    {submittingQuestion ? <Spinner size={14} /> : null}
                    {submittingQuestion ? 'Mengirim…' : 'Kirim jawaban'}
                  </button>
                </footer>
              </section>
            ) : null}

            {error ? <div className="ai-error ai-run-dock-error" role="alert">{error}</div> : null}
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
            {slashMenuOpen ? (
              <div className="ai-slash-menu" role="listbox" aria-label="Perintah Agentic Coding">
                <div className="ai-slash-menu-heading">Perintah</div>
                {filteredSlashCommands.length ? filteredSlashCommands.map((item, index) => (
                  <button
                    type="button"
                    key={item.command}
                    className={'ai-slash-command' + (index === activeSlashCommandIndex ? ' active' : '')}
                    role="option"
                    aria-selected={index === activeSlashCommandIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveSlashCommandIndex(index)}
                    onClick={() => executeSlashCommand(item.command)}
                  >
                    <span className="ai-slash-command-icon" aria-hidden="true">{item.icon}</span>
                    <span className="ai-slash-command-copy">
                      <strong>{item.command}</strong>
                      <small>{item.description}</small>
                    </span>
                    <span className="ai-slash-command-title">{item.title}</span>
                  </button>
                )) : <p className="ai-slash-menu-empty">Tidak ada perintah yang cocok.</p>}
                <div className="ai-slash-menu-hint"><kbd>↑</kbd><kbd>↓</kbd> pilih <kbd>Enter</kbd> buka <kbd>Esc</kbd> tutup</div>
              </div>
            ) : null}
            <div className="ai-input-row">
              <button type="button" className="ai-attach-btn" aria-label="Lampirkan file"
                title="Lampirkan gambar, dokumen, audio, video, atau file teks"
                disabled={loading || selectingAttachments || !sessionReady || !wb.root}
                onClick={() => void pickAttachments()}>
                {selectingAttachments ? <Spinner size={16} /> : <IconPlus size={17} />}
              </button>
              <textarea
                ref={inputRef}
                className="ai-input"
                value={input}
                onChange={(event) => {
                  const nextInput = event.target.value;
                  setInput(nextInput);
                  const trimmedStart = nextInput.trimStart();
                  const opensCommandMenu = trimmedStart.startsWith('/') && !/\s/.test(trimmedStart);
                  setSlashMenuOpen(opensCommandMenu);
                  setActiveSlashCommandIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder={permission ? 'Setujui atau tolak command di panel di atas…' : agentQuestion ? 'Pilih opsi atau tulis jawaban custom pada panel di atas…' : loading ? 'Agent sedang bekerja…' : !sessionReady ? 'Menyiapkan sesi AI baru…' : !routerStatus?.configured ? 'Ketik /connect untuk menghubungkan AI, atau tulis instruksi…' : !wb.root ? 'Buka workspace proyek terlebih dahulu…' : 'Tulis instruksi atau ketik / untuk perintah…'}
                rows={3}
                disabled={loading || !sessionReady || !activeAgent}
                aria-label="Pesan AI coding agent"
              />
              <button
                type="button"
                className="ai-send-btn"
                onClick={() => void sendMessage()}
                disabled={loading || (!input.trim() && pendingAttachments.length === 0) || !activeAgent || !wb.root}
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

          <section className="ai-side-card ai-side-skills-card">
            <div className="ai-side-card-title">
              <strong>Skill aktif</strong>
              <span>{activeSkills.length}</span>
            </div>
            <div className="ai-side-scroll ai-side-skills-scroll">
              {activeSkills.length ? activeSkills.map((skill) => (
                <div className="ai-side-skill" key={skill.id} title={skill.reason}>
                  <strong>{skill.name}</strong>
                  {skill.reason ? <small>{skill.reason}</small> : null}
                </div>
              )) : <p className="ai-side-empty">Skill yang digunakan selama tugas akan muncul di sini.</p>}
            </div>
          </section>

          <section className="ai-side-card ai-side-tools-card">
            <div className="ai-side-card-title">
              <strong>Tool yang dipakai</strong>
              <span>{toolActivities.length}</span>
            </div>
            <div className="ai-side-scroll ai-side-tools-scroll">
              {toolActivities.length ? toolActivities.slice(-12).slice().reverse().map((item) => (
                <div className="ai-side-tool" key={item.id}>
                  <span className={'ai-side-tool-mark status-' + item.status} aria-hidden="true">
                    {item.status === 'running' ? '◌' : item.status === 'completed' ? '✓' : '×'}
                  </span>
                  <div>
                    <strong>{AGENT_TOOL_DISPLAY_NAMES[item.name] || item.name}</strong>
                    <small>{item.detail}</small>
                  </div>
                </div>
              )) : <p className="ai-side-empty">Tool yang digunakan agent pada run ini akan tampil di sini.</p>}
            </div>
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
