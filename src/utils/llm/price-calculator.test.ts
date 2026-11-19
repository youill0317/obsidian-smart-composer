import { ChatModel } from '../../types/chat-model.types'

import { calculateLLMCost } from './price-calculator'

const usage = {
  prompt_tokens: 100_000,
  completion_tokens: 100_000,
  total_tokens: 200_000,
}

describe('calculateLLMCost', () => {
  it.each([
    ['openai', 'gpt-6.2-sol', 1.2],
    ['deepseek', 'deepseek-chat', null],
    ['deepseek', 'deepseek-reasoner', null],
    ['gemini', 'gemini-4-carbon', 2.4],
    ['gemini', 'gemini-3.8-flash', 0.45],
    ['anthropic', 'claude-opus-5-5', 2.4],
    ['xai', 'grok-4.7', 0.8],
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
    ['gemini', 'gemini-3.8-flash', 200_001, 0.52500075],
    ['openai', 'gpt-6.2-sol', 271_999, 1.543998],
    ['openai', 'gpt-6.2-sol', 272_000, 1.544],
    ['openai', 'gpt-6.2-sol', 272_001, 2.588004],
    ['gemini', 'gemini-4-carbon', 272_001, 3.088004],
    ['anthropic', 'claude-opus-5-5', 272_001, 3.088004],
    ['xai', 'grok-4.7', 199_999, 0.999998],
    ['xai', 'grok-4.7', 200_000, 2],
    ['xai', 'grok-4.7', 200_001, 2.000004],
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
      ).toBeCloseTo(expected, 8)
    },
  )

  it('should price cached Anthropic prompt tokens', () => {
    expect(
      calculateLLMCost({
        model: {
          providerType: 'anthropic',
          providerId: 'anthropic',
          id: 'claude-opus-5-5',
          model: 'claude-opus-5-5',
        } as ChatModel,
        usage: {
          prompt_tokens: 100_000,
          completion_tokens: 0,
          total_tokens: 100_000,
          cache_read_tokens: 80_000,
          cache_write_tokens: 10_000,
        },
      }),
    ).toBeCloseTo((10_000 * 4 + 80_000 * 0.2 + 10_000 * 5) / 1_000_000)
  })

  const cachedUsage = (prompt: number, read: number, write = 0) => ({
    prompt_tokens: prompt,
    completion_tokens: 0,
    total_tokens: prompt,
    cache_read_tokens: read,
    cache_write_tokens: write,
  })
  const priceOf = (
    providerType: string,
    model: string,
    usage: ReturnType<typeof cachedUsage>,
  ) =>
    calculateLLMCost({
      model: {
        providerType,
        providerId: providerType,
        id: model,
        model,
      } as ChatModel,
      usage,
    })

  it('falls back to 0.1x reads and 1.25x writes without listed cache rates', () => {
    expect(
      priceOf(
        'deepseek',
        'deepseek-v4-pro',
        cachedUsage(100_000, 80_000, 10_000),
      ),
    ).toBeCloseTo((10_000 * 1.32 + 80_000 * 0.132 + 10_000 * 1.65) / 1_000_000)
    expect(
      priceOf('xai', 'grok-4.7', cachedUsage(100_000, 50_000)),
    ).toBeCloseTo((50_000 * 2 + 50_000 * 0.2) / 1_000_000)
  })

  it('prices cached input at the listed rates', () => {
    expect(
      priceOf('openai', 'gpt-6.2-sol', cachedUsage(100_000, 50_000)),
    ).toBeCloseTo((50_000 * 2 + 50_000 * 0.1) / 1_000_000)
    expect(
      priceOf('gemini', 'gemini-4-carbon', cachedUsage(100_000, 50_000)),
    ).toBeCloseTo((50_000 * 4 + 50_000 * 0.2) / 1_000_000)
  })

  it('doubles the Sol cached rate above 272K prompt tokens', () => {
    expect(
      priceOf('openai', 'gpt-6.2-sol', cachedUsage(300_000, 200_000)),
    ).toBeCloseTo((100_000 * 4 + 200_000 * 0.2) / 1_000_000)
  })
})
