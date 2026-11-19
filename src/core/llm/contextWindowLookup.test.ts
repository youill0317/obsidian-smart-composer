import { DeepSeekStudioProvider } from './deepseekStudioProvider'
import { GeminiProvider } from './gemini'
import { MistralProvider } from './mistralProvider'

type Lookup = { client: { models: Record<string, jest.Mock> } }

describe('context window lookup', () => {
  it('reads the input limit of a Gemini model once per session', async () => {
    const provider = new GeminiProvider({
      type: 'gemini',
      id: 'gemini-lookup',
      apiKey: 'test-key',
    })
    const get = jest.fn().mockResolvedValue({ inputTokenLimit: 2_000_000 })
    ;(provider as unknown as Lookup).client.models.get = get
    expect(await provider.getContextWindow('gemini-4-argon')).toBe(2_000_000)
    expect(await provider.getContextWindow('gemini-4-argon')).toBe(2_000_000)
    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0][0]).toMatchObject({ model: 'gemini-4-argon' })
  })

  it('finds a DeepSeek model in the model list', async () => {
    const provider = new DeepSeekStudioProvider({
      type: 'deepseek',
      id: 'deepseek-lookup',
      apiKey: 'test-key',
    })
    ;(provider as unknown as Lookup).client.models.list = jest
      .fn()
      .mockResolvedValue({
        data: [
          { id: 'deepseek-v4-pro', context_window: 1_048_576 },
          { id: 'deepseek-flash', context_window: 524_288 },
        ],
      })
    expect(await provider.getContextWindow('deepseek-flash')).toBe(524_288)
    expect(await provider.getContextWindow('unlisted')).toBeUndefined()
  })

  it('reads the context length of a Mistral model', async () => {
    const provider = new MistralProvider({
      type: 'mistral',
      id: 'mistral-lookup',
      apiKey: 'test-key',
    })
    const retrieve = jest.fn().mockResolvedValue({ max_context_length: 32_768 })
    ;(provider as unknown as Lookup).client.models.retrieve = retrieve
    expect(await provider.getContextWindow('mistral-small')).toBe(32_768)
    expect(retrieve.mock.calls[0][0]).toBe('mistral-small')
  })

  it('reports no window when the lookup fails', async () => {
    const provider = new MistralProvider({
      type: 'mistral',
      id: 'mistral-failing',
      apiKey: 'test-key',
    })
    ;(provider as unknown as Lookup).client.models.retrieve = jest
      .fn()
      .mockRejectedValue(new Error('offline'))
    expect(await provider.getContextWindow('mistral-small')).toBeUndefined()
  })
})
