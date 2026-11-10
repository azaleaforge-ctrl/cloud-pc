export type AgentReasoningEffort = 'low' | 'medium' | 'high' | 'maximal';
export type AgentReasoningParameter = 'reasoning' | 'reasoning_effort';

export function toProviderReasoningEffort(effort: AgentReasoningEffort): 'low' | 'medium' | 'high' | 'xhigh' {
  return effort === 'maximal' ? 'xhigh' : effort;
}

export function buildReasoningRequestParameters(
  effort: AgentReasoningEffort | undefined,
  parameter: AgentReasoningParameter | undefined,
): Record<string, unknown> {
  if (!effort || !parameter) return {};
  const value = toProviderReasoningEffort(effort);
  return parameter === 'reasoning'
    ? { reasoning: { effort: value } }
    : { reasoning_effort: value };
}

export function getReasoningParameter(supportedParameters: string[] | undefined): AgentReasoningParameter | null {
  if (!supportedParameters) return null;
  if (supportedParameters.includes('reasoning')) return 'reasoning';
  if (supportedParameters.includes('reasoning_effort')) return 'reasoning_effort';
  return null;
}
