import { GeminiProvider } from './gemini'
import { LmStudioProvider } from './lmStudioProvider'
import { OllamaProvider } from './ollama'
import { OpenAIAuthenticatedProvider } from './openai'
import { OpenAICompatibleProvider } from './openaiCompatibleProvider'

jest.mock('obsidian', () => ({ Platform: { isDesktop: false } }))

describe('embedding provider cancellation', () => {
  const signal = new AbortController().signal

  it.each([
    [
      'OpenAI',
      () =>
        new OpenAIAuthenticatedProvider({
          type: 'openai',
          id: 'openai',
          apiKey: 'test-key',
        }),
    ],
    ['Ollama', () => new OllamaProvider({ type: 'ollama', id: 'ollama' })],
    [
      'LM Studio',
      () => new LmStudioProvider({ type: 'lm-studio', id: 'lm-studio' }),
    ],
    [
      'OpenAI-compatible',
      () =>
        new OpenAICompatibleProvider({
          type: 'openai-compatible',
          id: 'compatible',
          apiKey: 'test-key',
          baseUrl: 'https://provider.example/v1',
        }),
    ],
  ])(
    'passes the signal to %s embedding requests',
    async (_name, createProvider) => {
      const create = jest.fn().mockResolvedValue({
        data: [{ embedding: [0.1, 0.2] }],
      })
      const provider = createProvider()
      Object.assign(provider, {
        client: { apiKey: 'test-key', embeddings: { create } },
      })

      await expect(
        provider.getEmbedding('embedding-model', 'text', { signal }),
      ).resolves.toEqual([0.1, 0.2])
      expect(create.mock.calls[0][1]).toEqual({ signal })
    },
  )

  it('passes the signal through Gemini embed configuration', async () => {
    const embedContent = jest.fn().mockResolvedValue({
      embeddings: [{ values: [0.1, 0.2] }],
    })
    const provider = new GeminiProvider({
      type: 'gemini',
      id: 'gemini',
      apiKey: 'test-key',
    })
    Object.assign(provider, {
      client: { models: { embedContent } },
    })

    await expect(
      provider.getEmbedding('embedding-model', 'text', {
        dimensions: 2,
        signal,
      }),
    ).resolves.toEqual([0.1, 0.2])
    expect(embedContent).toHaveBeenCalledWith({
      model: 'embedding-model',
      contents: 'text',
      config: { outputDimensionality: 2, abortSignal: signal },
    })
  })
})
