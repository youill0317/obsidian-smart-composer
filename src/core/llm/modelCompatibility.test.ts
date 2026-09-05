import { ChatModel } from '../../types/chat-model.types'

import { normalizeModelCompatibility } from './modelCompatibility'

describe('normalizeModelCompatibility', () => {
  it.each(['openai', 'openai-plan'] as const)(
    'maps unsupported Astra efforts without changing saved %s settings',
    (providerType) => {
      for (const effort of ['none', 'minimal']) {
        const model = {
          providerType,
          providerId: providerType,
          id: 'custom-astra',
          model: 'gpt-6-astra',
          reasoning: { enabled: true, reasoning_effort: effort },
        } as ChatModel
        expect(normalizeModelCompatibility(model)).toHaveProperty(
          'reasoning.reasoning_effort',
          'low',
        )
        expect(model).toHaveProperty('reasoning.reasoning_effort', effort)
        const legacyModel = { ...model, model: 'gpt-5.2' }
        expect(normalizeModelCompatibility(legacyModel)).toBe(legacyModel)
      }
    },
  )
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
