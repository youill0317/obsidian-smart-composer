import { ChatModel } from '../../types/chat-model.types'

import { GeminiProvider } from './gemini'
import { normalizeModelCompatibility } from './modelCompatibility'

describe('normalizeModelCompatibility', () => {
  it.each(['gemini', 'gemini-plan'] as const)(
    'uses valid Gemini 3.8 Flash thinking on %s without changing saved settings',
    (providerType) => {
      const model = {
        providerType,
        providerId: providerType,
        id: 'custom-flash',
        model: 'gemini-3.8-flash',
        thinking: {
          enabled: true,
          control_mode: 'budget' as const,
          thinking_budget: 1024,
          include_thoughts: true,
        },
      }
      const normalized = normalizeModelCompatibility(model) as typeof model
      expect(GeminiProvider.buildThinkingConfig(normalized)).toEqual({
        thinkingLevel: 'MEDIUM',
        includeThoughts: true,
      })
      expect(model.thinking).toEqual({
        enabled: true,
        control_mode: 'budget',
        thinking_budget: 1024,
        include_thoughts: true,
      })
      for (const level of ['minimal', 'low', 'medium', 'high'] as const) {
        const withLevel = {
          ...model,
          thinking: { ...model.thinking, thinking_level: level },
        }
        expect(normalizeModelCompatibility(withLevel)).toHaveProperty(
          'thinking.thinking_level',
          level === 'minimal' ? 'low' : level,
        )
      }
      const disabled = {
        ...model,
        thinking: { ...model.thinking, enabled: false },
      }
      expect(
        GeminiProvider.buildThinkingConfig(
          normalizeModelCompatibility(disabled) as typeof disabled,
        ),
      ).toBeUndefined()
      const previous = { ...model, model: 'gemini-3-flash-preview' }
      expect(normalizeModelCompatibility(previous)).toBe(previous)
      const defaultModel = { ...model, thinking: undefined }
      expect(normalizeModelCompatibility(defaultModel)).toBe(defaultModel)
    },
  )
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
