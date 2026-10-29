import type { AgentCheckpointSummary, ChatMessage } from './agents';

export interface AgentReforkPlan {
  /** Prompt returned to the composer; it is not duplicated in the branch history. */
  prompt: string;
  /** Existing messages that precede the selected user prompt. */
  messages: ChatMessage[];
  /** Attachment bytes are ephemeral; the user must re-select them in a new branch. */
  requiresAttachmentReselect: boolean;
}

export function createAgentReforkPlan(messages: ChatMessage[], selectedMessageId: string): AgentReforkPlan | null {
  const selectedIndex = messages.findIndex(message => message.id === selectedMessageId);
  if (selectedIndex < 0) return null;
  const selected = messages[selectedIndex];
  if (selected.role !== 'user') return null;
  return {
    prompt: selected.content,
    messages: messages.slice(0, selectedIndex)
      .filter(message => message.role === 'user' || message.role === 'assistant')
      .map(message => ({ ...message, streaming: false })),
    requiresAttachmentReselect: !!selected.attachments?.length,
  };
}

/**
 * New sessions persist runId on each user prompt. For v1.0.6 sessions, infer a
 * checkpoint only when its creation timestamp falls between a prompt and the
 * next user prompt. A message with a runId never falls back to time heuristics.
 */
export function findCheckpointForMessage(
  message: ChatMessage,
  messages: ChatMessage[],
  checkpoints: AgentCheckpointSummary[],
): AgentCheckpointSummary | undefined {
  if (message.runId) return checkpoints.find(checkpoint => checkpoint.runId === message.runId);
  const index = messages.findIndex(candidate => candidate.id === message.id);
  if (index < 0) return undefined;
  const nextUserTs = messages.slice(index + 1).find(candidate => candidate.role === 'user')?.ts
    ?? Number.POSITIVE_INFINITY;
  return checkpoints
    .filter(checkpoint => checkpoint.createdAt >= message.ts && checkpoint.createdAt < nextUserTs)
    .sort((left, right) => left.createdAt - right.createdAt)[0];
}
