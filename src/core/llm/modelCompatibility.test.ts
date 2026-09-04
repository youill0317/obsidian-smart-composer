import { ChatModel } from '../../types/chat-model.types'

import { normalizeModelCompatibility } from './modelCompatibility'

describe('normalizeModelCompatibility', () => {
  it.each(['anthropic', 'anthropic-plan'] as const)(
    'removes legacy thinking budgets from Opus 5 on %s',
    (providerType) => {
      const model = {
        providerType,
        providerId: providerType,
        id: `claude-opus-5-${providerType}`,
        model: 'claude-opus-5',
        thinking: { enabled: true, budget_tokens: 8192 },
      } as ChatModel
      const normalized = normalizeModelCompatibility(model)
      expect('thinking' in normalized && normalized.thinking).toBeUndefined()
      expect(model).toHaveProperty('thinking.budget_tokens', 8192)
    },
  )

  it('keeps legacy thinking for models that still use it', () => {
    const model = {
      providerType: 'anthropic',
      providerId: 'anthropic',
      id: 'claude-opus-4.5',
      model: 'claude-opus-4-5',
      thinking: { enabled: true, budget_tokens: 8192 },
    } as ChatModel
    expect(normalizeModelCompatibility(model)).toBe(model)
  })
})
