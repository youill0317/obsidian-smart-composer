import { ChatModel } from '../../types/chat-model.types'

// Reasoning efforts of the current OpenAI and Anthropic models
export const REASONING_EFFORTS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

// Thinking levels of the current Gemini models
export const GEMINI_THINKING_LEVELS = ['low', 'medium', 'high'] as const

// Other Claude models are looked up through the Models API.
const CLAUDE_MAX_OUTPUT_TOKENS: Record<string, number> = {
  'claude-opus-5-5': 128_000,
}

export function getClaudeMaxOutputTokens(model: string): number | undefined {
  return CLAUDE_MAX_OUTPUT_TOKENS[model]
}

// https://docs.x.ai/developers/models
const XAI_CONTEXT_WINDOWS: Record<string, number> = {
  'grok-4.7': 500_000,
}
export const XAI_DEFAULT_CONTEXT_WINDOW = 272_000

export function getXaiContextWindow(model: string): number | undefined {
  return XAI_CONTEXT_WINDOWS[model]
}

// Providers whose API does not report a context window; the user enters it.
export const MANUAL_CONTEXT_WINDOW_PROVIDERS: ChatModel['providerType'][] = [
  'perplexity',
  'ollama',
  'lm-studio',
  'azure-openai',
  'openai-compatible',
]

const CONTEXT_WINDOWS: Record<string, number> = {
  'gemini-4-carbon': 1_048_576,
  'deepseek-v4-pro': 1_048_576,
}
const DEFAULT_CONTEXT_WINDOW = 272_000

function hasProviderCompaction(
  providerType: ChatModel['providerType'],
): boolean {
  switch (providerType) {
    case 'openai':
    case 'anthropic':
    case 'openai-plan':
    case 'xai':
    case 'openrouter':
      return true
    default:
      return false
  }
}

/** Whether the client trims this model's history without knowing its window. */
export function needsContextWindowLookup(
  model: Pick<ChatModel, 'providerType' | 'model'>,
): boolean {
  return (
    !hasProviderCompaction(model.providerType) && !CONTEXT_WINDOWS[model.model]
  )
}

/**
 * Token counts at which the client drops the oldest turns from a request
 * (`limit`, the context window) and the size it drops down to (`target`,
 * 70% of it). Null when the provider compacts long conversations itself.
 * `lookedUpWindow` is the window reported by the provider's models API.
 */
export function getClientHistoryLimit(
  model: Pick<ChatModel, 'providerType' | 'model'>,
  lookedUpWindow?: number,
): { limit: number; target: number } | null {
  if (hasProviderCompaction(model.providerType)) return null
  const contextWindow =
    CONTEXT_WINDOWS[model.model] ?? lookedUpWindow ?? DEFAULT_CONTEXT_WINDOW
  return { limit: contextWindow, target: contextWindow * 0.7 }
}
