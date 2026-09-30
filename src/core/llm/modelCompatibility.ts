import { ChatModel } from '../../types/chat-model.types'

export const SOL_REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

// Claude Opus 5 and 5.5 use adaptive thinking by default and reject the legacy
// `thinking: { type: enabled, budget_tokens }` wire format. The current model
// schema only represents that legacy format, so omit it until adaptive controls
// are modeled explicitly instead of sending an invalid request.
export function normalizeModelCompatibility(model: ChatModel): ChatModel {
  if (
    (model.providerType === 'gemini' || model.providerType === 'gemini-plan') &&
    model.model === 'gemini-3.8-flash' &&
    model.thinking
  ) {
    return {
      ...model,
      thinking: {
        ...model.thinking,
        control_mode: 'level',
        thinking_level:
          model.thinking.thinking_level === 'minimal'
            ? 'low'
            : (model.thinking.thinking_level ?? 'medium'),
        thinking_budget: undefined,
      },
    }
  }
  if (
    (model.providerType === 'openai' || model.providerType === 'openai-plan') &&
    ['gpt-6-astra', 'gpt-6.1-sol'].includes(model.model) &&
    ['none', 'minimal'].includes(model.reasoning?.reasoning_effort ?? '')
  ) {
    return {
      ...model,
      reasoning: { ...model.reasoning, reasoning_effort: 'low' },
    } as ChatModel
  }
  if (
    (model.providerType === 'anthropic' ||
      model.providerType === 'anthropic-plan') &&
    ['claude-opus-5', 'claude-opus-5-5'].includes(model.model) &&
    'thinking' in model &&
    model.thinking
  ) {
    return { ...model, thinking: undefined } as ChatModel
  }
  return model
}
