import { ChatModel } from '../../types/chat-model.types'

import { calculateLLMCost } from './price-calculator'

const usage = {
  prompt_tokens: 100_000,
  completion_tokens: 100_000,
  total_tokens: 200_000,
}

describe('calculateLLMCost', () => {
  it.each([
    ['openai', 'gpt-5.6-sol', 2.4],
    ['anthropic', 'claude-opus-5', 3],
    ['xai', 'grok-4.6', 0.8],
    ['deepseek', 'deepseek-v4-pro', 0.528],
  ] as const)('should price %s/%s', (providerType, model, expected) => {
    expect(
      calculateLLMCost({
        model: {
          providerType,
          providerId: providerType,
          id: model,
          model,
        } as ChatModel,
        usage,
      }),
    ).toBe(expected)
  })

  it.each([
    ['gemini', 'gemini-3.1-pro-preview', 199_999, 1.599998],
    ['gemini', 'gemini-3.1-pro-preview', 200_000, 1.6],
    ['gemini', 'gemini-3.1-pro-preview', 200_001, 2.600004],
    ['openai', 'gpt-5.6-sol', 271_999, 3.087996],
    ['openai', 'gpt-5.6-sol', 272_000, 3.088],
    ['openai', 'gpt-5.6-sol', 272_001, 5.176008],
    ['xai', 'grok-4.6', 199_999, 0.999998],
    ['xai', 'grok-4.6', 200_000, 2],
    ['xai', 'grok-4.6', 200_001, 2.000004],
  ] as const)(
    'prices the %s/%s boundary at %s prompt tokens',
    (providerType, modelName, promptTokens, expected) => {
      const model = {
        providerType,
        providerId: providerType,
        id: modelName,
        model: modelName,
      } as ChatModel

      expect(
        calculateLLMCost({
          model,
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: 100_000,
            total_tokens: promptTokens + 100_000,
          },
        }),
      ).toBeCloseTo(expected)
    },
  )
})
