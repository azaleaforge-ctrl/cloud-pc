import type { AgentTerminalOutput, AgentTerminalProcess } from './agents';

export const MAX_AGENT_TERMINAL_HISTORY = 20;
export const MAX_AGENT_TERMINAL_OUTPUT_CHARS = 24_000;
export const MAX_AGENT_TERMINAL_OUTPUT_EVENTS = 300;

export interface AgentTerminalHistoryEntry {
  process: AgentTerminalProcess;
  outputs: AgentTerminalOutput[];
  outputChars: number;
}

export function upsertAgentTerminalProcess(
  history: AgentTerminalHistoryEntry[],
  process: AgentTerminalProcess,
  maxEntries = MAX_AGENT_TERMINAL_HISTORY,
): AgentTerminalHistoryEntry[] {
  const index = history.findIndex((entry) => entry.process.commandId === process.commandId);
  if (index >= 0) {
    return history.map((entry, currentIndex) => currentIndex === index
      ? { ...entry, process: { ...entry.process, ...process } }
      : entry);
  }
  return [...history, { process, outputs: [], outputChars: 0 }].slice(-Math.max(1, maxEntries));
}

export function appendAgentTerminalOutput(
  history: AgentTerminalHistoryEntry[],
  output: AgentTerminalOutput,
  maxChars = MAX_AGENT_TERMINAL_OUTPUT_CHARS,
  maxEvents = MAX_AGENT_TERMINAL_OUTPUT_EVENTS,
): AgentTerminalHistoryEntry[] {
  const index = history.findIndex((entry) => entry.process.commandId === output.commandId);
  if (index < 0 || !output.data) return history;
  const entry = history[index];
  const outputs = [...entry.outputs, output];
  let outputChars = entry.outputChars + output.data.length;
  const charLimit = Math.max(100, maxChars);
  const eventLimit = Math.max(1, maxEvents);

  while (outputs.length > eventLimit || outputChars > charLimit) {
    if (outputs.length === 1) {
      const only = outputs[0];
      const clipped = only.data.slice(-charLimit);
      outputChars = clipped.length;
      outputs[0] = { ...only, data: clipped };
      break;
    }
    const removed = outputs.shift();
    if (removed) outputChars -= removed.data.length;
  }

  return history.map((item, currentIndex) => currentIndex === index
    ? { ...item, outputs, outputChars }
    : item);
}

export function formatAgentTerminalOutput(outputs: AgentTerminalOutput[]): string {
  return outputs.map((item, index) => {
    const timestamp = new Date(item.ts).toLocaleTimeString();
    const separator = index === 0 ? '' : '\n';
    const data = item.data.endsWith('\n') ? item.data : item.data + '\n';
    return separator + '[' + timestamp + '] [' + item.stream.toUpperCase() + ']\n' + data;
  }).join('');
}

export function formatAgentTerminalDiagnostics(entry: AgentTerminalHistoryEntry): string {
  const process = entry.process;
  const finishedAt = process.finishedAt;
  const durationMs = Math.max(0, (finishedAt ?? Date.now()) - process.startedAt);
  const output = entry.outputs.map((item) => (
    '[' + new Date(item.ts).toISOString() + '] [' + item.stream.toUpperCase() + ']\n' + item.data
  )).join('\n');

  return [
    'Ruang Kerja · Agent Terminal Diagnostics',
    'Command ID: ' + process.commandId,
    'Command: ' + process.command,
    'Shell: ' + (process.shell || 'unknown'),
    'Working directory: ' + (process.cwd || 'unknown'),
    'Status: ' + process.status,
    'Started at: ' + new Date(process.startedAt).toISOString(),
    'Finished at: ' + (finishedAt ? new Date(finishedAt).toISOString() : 'still running'),
    'Duration: ' + (durationMs / 1000).toFixed(2) + ' seconds',
    'Timeout: ' + process.timeoutMs + ' ms',
    'Exit code: ' + (process.exitCode === undefined ? 'pending' : process.exitCode === null ? 'unknown' : String(process.exitCode)),
    ...(process.message ? ['Message: ' + process.message] : []),
    '',
    '--- Captured stdout/stderr ---',
    output || '(no output captured)',
  ].join('\n');
}
