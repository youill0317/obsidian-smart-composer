import { GenerateContentResponse } from '@google/genai'

import { GeminiProvider } from './gemini'

describe('GeminiProvider usage', () => {
  it('reports cached content tokens as part of the prompt tokens', () => {
    const usageMetadata = {
      promptTokenCount: 1000,
      cachedContentTokenCount: 600,
      candidatesTokenCount: 20,
      totalTokenCount: 1020,
    }
    const expected = {
      prompt_tokens: 1000,
      completion_tokens: 20,
      total_tokens: 1020,
      cache_read_tokens: 600,
    }
    const response = { usageMetadata } as unknown as GenerateContentResponse
    expect(
      GeminiProvider.parseNonStreamingResponse(response, 'gemini-4-carbon', 'm')
        .usage,
    ).toEqual(expected)
    expect(
      GeminiProvider.parseStreamingResponseChunk(
        response,
        'gemini-4-carbon',
        'm',
      ).usage,
    ).toEqual(expected)
  })
})

describe('GeminiProvider thinking config', () => {
  const config = (thinking?: Record<string, unknown>) =>
    GeminiProvider.buildThinkingConfig({
      providerType: 'gemini',
      providerId: 'gemini',
      id: 'gemini-4-carbon',
      model: 'gemini-4-carbon',
      thinking,
    })

  it('sends the saved thinking level and thoughts', () => {
    expect(config({ thinking_level: 'high' })).toEqual({
      thinkingLevel: 'HIGH',
      includeThoughts: true,
    })
  })

  it('omits a thinking level outside the list', () => {
    expect(config({ thinking_level: 'xhigh' })).toEqual({
      includeThoughts: true,
    })
    expect(config()).toEqual({ includeThoughts: true })
  })
})
