import { ChatModel } from '../../types/chat-model.types'

// Claude Opus 5 uses adaptive thinking by default and rejects the legacy
// `thinking: { type: enabled, budget_tokens }` wire format. The current model
// schema only represents that legacy format, so omit it until adaptive controls
// are modeled explicitly instead of sending an invalid request.
export function normalizeModelCompatibility(model: ChatModel): ChatModel {
  if (
    (model.providerType === 'anthropic' ||
      model.providerType === 'anthropic-plan') &&
    model.model === 'claude-opus-5' &&
    'thinking' in model &&
    model.thinking
  ) {
    return { ...model, thinking: undefined } as ChatModel
  }
  return model
}
