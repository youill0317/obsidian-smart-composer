import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMRateLimitExceededException,
} from './exception'
import { VoyageProvider } from './voyageProvider'

describe('VoyageProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('requests embeddings from the Voyage API', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
        { status: 200 },
      ),
    )
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })

    const embedding = await provider.getEmbedding('voyage-4', 'hello', {
      dimensions: 3,
      purpose: 'document',
    })

    expect(embedding).toEqual([0.1, 0.2, 0.3])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.voyageai.com/v1/embeddings',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer voyage-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: 'hello',
          model: 'voyage-4',
          input_type: 'document',
          output_dimension: 3,
        }),
        signal: expect.anything(),
      },
    )
  })

  it('requires an API key before requesting embeddings', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
    })

    await expect(
      provider.getEmbedding('voyage-4', 'hello'),
    ).rejects.toBeInstanceOf(LLMAPIKeyNotSetException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps Voyage authentication failures to API key errors', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 401 }))
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'bad-key',
    })

    await expect(
      provider.getEmbedding('voyage-4', 'hello'),
    ).rejects.toBeInstanceOf(LLMAPIKeyInvalidException)
  })

  it('maps Voyage rate limit failures to rate limit errors', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 429 }))
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })

    await expect(
      provider.getEmbedding('voyage-4', 'hello'),
    ).rejects.toBeInstanceOf(LLMRateLimitExceededException)
  })

  it('rejects empty embedding vectors', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [] }] }), {
        status: 200,
      }),
    )
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })

    await expect(provider.getEmbedding('voyage-4', 'hello')).rejects.toThrow(
      'Voyage AI embedding response did not include a vector.',
    )
  })

  it('rejects vectors with an unexpected requested dimension', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
        status: 200,
      }),
    )
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })

    await expect(
      provider.getEmbedding('voyage-4', 'hello', { dimensions: 3 }),
    ).rejects.toThrow('Embedding dimension mismatch: expected 3, got 2')
  })

  it('rejects non-finite vector values', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{"data":[{"embedding":[1e10000]}]}', { status: 200 }),
      )
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })

    await expect(provider.getEmbedding('voyage-4', 'hello')).rejects.toThrow()
  })

  it('rejects an oversized response before JSON parsing', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('x'.repeat(256 * 1024 + 1)))
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })

    await expect(provider.getEmbedding('voyage-4', 'hello')).rejects.toThrow(
      'safety limit',
    )
  })

  it('honors an already-aborted embedding request', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
    const controller = new AbortController()
    controller.abort()
    const provider = new VoyageProvider({
      type: 'voyage',
      id: 'voyage',
      apiKey: 'voyage-secret',
    })

    await expect(
      provider.getEmbedding('voyage-4', 'hello', {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
