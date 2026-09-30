import { ChatModel } from '../../types/chat-model.types'
import { LLMRequestNonStreaming } from '../../types/llm/request'
import { LLMResponseStreaming } from '../../types/llm/response'

import { LLMAPIKeyNotSetException } from './exception'
import { PerplexityProvider } from './perplexityProvider'

const model: ChatModel = {
  providerType: 'perplexity',
  providerId: 'pplx',
  id: 'sonar',
  model: 'sonar',
}
const request: LLMRequestNonStreaming = {
  model: 'sonar',
  messages: [
    { role: 'system', content: 'Be concise' },
    { role: 'user', content: 'News?' },
  ],
  max_tokens: 100,
  temperature: 0.2,
}
const source = { url: 'https://example.com', title: 'News' }
const search = { type: 'search_results', results: [source] }
const message = {
  type: 'message',
  id: 'msg-1',
  role: 'assistant',
  content: [
    {
      type: 'output_text',
      text: 'Hello [1]',
      annotations: [
        { type: 'url_citation', ...source, start_index: 6, end_index: 9 },
      ],
    },
  ],
}
const response = {
  object: 'response',
  id: 'resp-1',
  created_at: 123,
  model: 'perplexity/sonar',
  status: 'completed',
  output: [search, message],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
}
const provider = (baseUrl?: string) =>
  new PerplexityProvider({
    id: 'pplx',
    type: 'perplexity',
    apiKey: 'test-key',
    baseUrl,
  })

async function collect(stream: AsyncIterable<LLMResponseStreaming>) {
  const chunks: LLMResponseStreaming[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function sse(events: unknown[]) {
  const text =
    events
      .map(
        (event) =>
          `event: ${(event as { type: string }).type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`,
      )
      .join('') + 'data: [DONE]\r\n\r\n'
  const bytes = new TextEncoder().encode(text)
  return new Response(
    new ReadableStream({
      start(controller) {
        // Split inside SSE/JSON fields to exercise the SDK's real decoder.
        for (let i = 0; i < bytes.length; i += 17)
          controller.enqueue(bytes.slice(i, i + 17))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

describe('Perplexity Agent API', () => {
  afterEach(() => jest.restoreAllMocks())

  it.each([
    ['sonar', 'fast'],
    ['sonar-pro', 'fast'],
    ['sonar-reasoning-pro', 'low'],
    ['sonar-deep-research', 'high'],
  ])(
    'maps legacy %s to preset %s and preserves the request contract',
    async (name, preset) => {
      const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      const result = await provider().generateResponse(
        { ...model, web_search_options: { search_context_size: 'high' } },
        { ...request, model: name },
      )
      const [url, init] = fetch.mock.calls[0]
      expect(url).toBe('https://api.perplexity.ai/v1/responses')
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Bearer test-key',
      )
      expect(JSON.parse(init?.body as string)).toEqual({
        preset,
        input: request.messages.map((m) => ({ type: 'message', ...m })),
        max_output_tokens: 100,
        temperature: 0.2,
        stream: false,
        tools: [{ type: 'web_search', search_context_size: 'high' }],
      })
      expect(result.choices[0].message.content).toBe('Hello [1]')
      expect(result.choices[0].message.annotations).toHaveLength(1)
      expect(result.choices[0].message.annotations).toContainEqual({
        type: 'url_citation',
        url_citation: expect.objectContaining(source),
      })
      expect(result.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      })
    },
  )

  it.each([
    ['https://api.perplexity.ai/', 'https://api.perplexity.ai/v1/responses'],
    [
      'https://proxy.example/pplx/v1///',
      'https://proxy.example/pplx/v1/responses',
    ],
  ])(
    'uses the configured base URL %s and direct Agent model',
    async (baseUrl, endpoint) => {
      const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      await provider(baseUrl).generateResponse(model, {
        ...request,
        model: 'perplexity/sonar',
      })
      expect(fetch.mock.calls[0][0]).toBe(endpoint)
      const body = JSON.parse(fetch.mock.calls[0][1]?.body as string)
      expect(body.model).toBe('perplexity/sonar')
      expect(body.preset).toBeUndefined()
      expect(body.tools).toEqual([{ type: 'web_search' }])
    },
  )

  it('preserves multiple tool results and image input in Responses format', async () => {
    const call = { id: 'call-1', name: 'read_note', arguments: '{}' }
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await provider().generateResponse(model, {
      ...request,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: 'https://example.com/image.png' },
            },
          ],
        },
        { role: 'assistant', content: '', tool_calls: [call] },
        { role: 'tool', tool_call: call, content: 'First' },
        {
          role: 'tool',
          tool_call: { ...call, id: 'call-2' },
          content: 'Second',
        },
      ],
    })
    const body = JSON.parse(fetch.mock.calls[0][1]?.body as string)
    expect(body.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_image',
            image_url: 'https://example.com/image.png',
            detail: 'auto',
          },
        ],
      },
      { type: 'message', role: 'assistant', content: '' },
      {
        type: 'function_call',
        call_id: 'call-1',
        name: 'read_note',
        arguments: '{}',
      },
      { type: 'function_call_output', call_id: 'call-1', output: 'First' },
      { type: 'function_call_output', call_id: 'call-2', output: 'Second' },
    ])
  })

  it('parses fragmented typed SSE, sources, completion and usage without repeating text or sources', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      sse([
        { type: 'response.created', response: { ...response, output: [] } },
        { type: 'response.reasoning.search_results', results: [source] },
        { type: 'response.output_item.done', output_index: 0, item: search },
        { type: 'response.output_text.delta', delta: 'Hello ' },
        { type: 'response.output_text.delta', delta: '[1]' },
        { type: 'response.output_item.done', output_index: 1, item: message },
        { type: 'response.completed', response },
      ]),
    )
    const chunks = await collect(
      await provider().streamResponse(model, { ...request, stream: true }),
    )
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string).stream).toBe(true)
    expect(chunks.map((c) => c.choices[0].delta.content ?? '').join('')).toBe(
      'Hello [1]',
    )
    expect(chunks.flatMap((c) => c.choices[0].delta.annotations ?? [])).toEqual(
      [{ type: 'url_citation', url_citation: source }],
    )
    expect(chunks[chunks.length - 1]).toMatchObject({
      id: 'resp-1',
      created: 123,
      choices: [{ finish_reason: 'stop' }],
      usage: { total_tokens: 15 },
    })
  })

  it.each([
    [
      [{ type: 'response.failed', error: { message: 'Search failed' } }],
      'Search failed',
    ],
    [[{ type: 'error', message: 'Bad input' }], 'Bad input'],
    [
      [{ type: 'response.output_text.delta', delta: 'partial' }],
      'ended before completion',
    ],
  ])('rejects failed or interrupted streams', async (events, error) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(sse(events))
    await expect(
      collect(
        await provider().streamResponse(model, { ...request, stream: true }),
      ),
    ).rejects.toThrow(error)
  })

  it('handles sources and text returned only in the terminal response and incomplete status', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      sse([
        {
          type: 'response.completed',
          response: { ...response, status: 'incomplete' },
        },
      ]),
    )
    const chunks = await collect(
      await provider().streamResponse(model, { ...request, stream: true }),
    )
    expect(chunks[0].choices[0]).toMatchObject({
      finish_reason: 'length',
      delta: {
        content: 'Hello [1]',
        annotations: [
          {
            type: 'url_citation',
            url_citation: expect.objectContaining(source),
          },
        ],
      },
    })
  })

  it('preserves missing-key and HTTP authentication errors', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid key' } }), {
        status: 401,
      }),
    )
    await expect(
      new PerplexityProvider({
        id: 'pplx',
        type: 'perplexity',
      }).generateResponse(model, request),
    ).rejects.toBeInstanceOf(LLMAPIKeyNotSetException)
    expect(fetch).not.toHaveBeenCalled()
    await expect(provider().generateResponse(model, request)).rejects.toThrow(
      'Invalid key',
    )
  })

  it('forwards cancellation to the SDK transport', async () => {
    const controller = new AbortController()
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url: unknown, init?: RequestInit) => {
        controller.abort()
        expect(init?.signal?.aborted).toBe(true)
        throw new DOMException('Aborted', 'AbortError')
      })
    await expect(
      provider().generateResponse(model, request, {
        signal: controller.signal,
      }),
    ).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
