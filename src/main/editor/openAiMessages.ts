/**
 * Normalize OpenAI-compatible assistant tool-call messages for strict router schemas.
 *
 * Some OpenAI-compatible gateways only accept content=null when an assistant
 * message contains tool_calls. Preserve any accompanying assistant text as a
 * separate assistant message, then emit the tool-call declaration with null content.
 */
export function normalizeOpenAiToolCallMessages(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return messages.flatMap((message) => {
    const calls = message.tool_calls;
    if (message.role !== 'assistant' || !Array.isArray(calls) || calls.length === 0) {
      return [message];
    }

    const content = message.content;
    const toolCallMessage = { ...message, content: null };
    if (typeof content === 'string' && content.trim()) {
      return [
        { role: 'assistant', content },
        toolCallMessage,
      ];
    }
    if (Array.isArray(content) && content.length > 0) {
      return [
        { role: 'assistant', content },
        toolCallMessage,
      ];
    }
    return [toolCallMessage];
  });
}
