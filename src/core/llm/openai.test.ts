import { ChatModel } from '../../types/chat-model.types'
import { LLMRequestNonStreaming } from '../../types/llm/request'

import { CodexMessageAdapter } from './codexMessageAdapter'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
} from './exception'
import { OpenAIAuthenticatedProvider } from './openai'
import { OpenAIMessageAdapter } from './openaiMessageAdapter'

jest.mock('obsidian', () => ({ Platform: { isDesktop: false } }), {
  virtual: true,
})

const model: ChatModel = {
  providerType: 'openai',
  providerId: 'openai',
  id: 'gpt-6-astra',
  model: 'gpt-6-astra',
  reasoning: { enabled: true, reasoning_effort: 'high' },
}
const request: LLMRequestNonStreaming = {
  model: model.model,
  messages: [{ role: 'user', content: 'Read note' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'read_note',
        parameters: { type: 'object', properties: {} },
      },
    },
  ],
  max_tokens: 1000,
  temperature: 0.5,
  top_p: 0.9,
}
const tool = {
  type: 'function_call',
  id: 'item-1',
  call_id: 'call-1',
  name: 'read_note',
  arguments: '{}',
}

function responseStream() {
  const response = {
    id: 'response-1',
    created_at: 1,
    model: model.model,
    output: [],
  }
  return new Response(
    [
      { type: 'response.created', response },
      { type: 'response.output_item.added', output_index: 0, item: tool },
      {
        type: 'response.completed',
        response: {
          ...response,
          output: [tool],
          usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
        },
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(''),
  )
}

describe('OpenAI Astra Responses transport', () => {
  afterEach(() => jest.restoreAllMocks())

  it('surfaces server failures after an HTTP 200 response in both modes', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          `data: ${JSON.stringify({
            type: 'response.failed',
            response: { error: { message: 'Generation failed' } },
          })}\n\n`,
        ),
    )
    const provider = new OpenAIAuthenticatedProvider({
      type: 'openai',
      id: 'openai',
      apiKey: 'api-test-key',
    })
    await expect(provider.generateResponse(model, request)).rejects.toThrow(
      'Generation failed',
    )
    const stream = await provider.streamResponse(model, {
      ...request,
      stream: true,
    })
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow(
      'Generation failed',
    )
  })

  it('uses API auth and Responses for tools, including tool output on the next turn', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => responseStream())
    const provider = new OpenAIAuthenticatedProvider({
      type: 'openai',
      id: 'openai',
      apiKey: 'api-test-key',
      baseUrl: 'https://gateway.example/v1/',
    })
    const result = await provider.generateResponse(model, request)
    const call = result.choices[0].message.tool_calls?.[0]
    expect(call).toEqual({
      id: 'call-1',
      type: 'function',
      function: { name: 'read_note', arguments: '{}' },
    })
    expect(result.usage?.total_tokens).toBe(25)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://gateway.example/v1/responses')
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer api-test-key',
    })
    const body = JSON.parse(init?.body as string)
    expect(body).toMatchObject({
      model: model.model,
      stream: true,
      max_output_tokens: 1000,
      reasoning: { effort: 'high' },
      tools: [{ type: 'function', name: 'read_note' }],
    })
    for (const field of ['temperature', 'top_p', 'max_tokens']) {
      expect(body).not.toHaveProperty(field)
    }
    await provider.generateResponse(model, {
      ...request,
      messages: [
        ...request.messages,
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call-1', name: 'read_note', arguments: '{}' }],
        },
        {
          role: 'tool',
          content: 'note contents',
          tool_call: { id: 'call-1', name: 'read_note', arguments: '{}' },
        },
      ],
    })
    expect(
      JSON.parse(fetchMock.mock.calls[1][1]?.body as string).input,
    ).toEqual(
      expect.arrayContaining([
        {
          type: 'function_call',
          call_id: 'call-1',
          name: 'read_note',
          arguments: '{}',
        },
        {
          type: 'function_call_output',
          call_id: 'call-1',
          output: 'note contents',
        },
      ]),
    )
  })

  it('streams tool calls through fetch even on mobile and preserves cancellation', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(responseStream())
    const provider = new OpenAIAuthenticatedProvider({
      type: 'openai',
      id: 'openai',
      apiKey: 'api-test-key',
    })
    const signal = new AbortController().signal
    const stream = await provider.streamResponse(
      model,
      { ...request, stream: true },
      { signal },
    )
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    expect(chunks[0].choices[0].delta.tool_calls?.[0]).toMatchObject({
      id: 'call-1',
      function: { name: 'read_note', arguments: '{}' },
    })
    expect(chunks[1].usage?.total_tokens).toBe(25)
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(signal)
  })

  it('requires an API key and maps an API authentication failure', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('invalid key', { status: 401 }))
    const provider = new OpenAIAuthenticatedProvider({
      type: 'openai',
      id: 'openai',
    })
    await expect(
      provider.generateResponse(model, request),
    ).rejects.toBeInstanceOf(LLMAPIKeyNotSetException)
    expect(fetchMock).not.toHaveBeenCalled()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const authenticated = new OpenAIAuthenticatedProvider({
      type: 'openai',
      id: 'openai',
      apiKey: 'invalid-test-key',
    })
    await expect(
      authenticated.generateResponse(model, request),
    ).rejects.toBeInstanceOf(LLMAPIKeyInvalidException)
  })

  it('keeps other OpenAI models on the existing adapter', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
    const adapter = jest
      .spyOn(OpenAIMessageAdapter.prototype, 'streamResponse')
      .mockResolvedValue((async function* () {})())
    const provider = new OpenAIAuthenticatedProvider({
      type: 'openai',
      id: 'openai',
      apiKey: 'api-test-key',
    })
    await provider.streamResponse(
      { ...model, model: 'gpt-5.6-sol' },
      { ...request, model: 'gpt-5.6-sol', stream: true },
    )
    expect(adapter).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps output token limits out of the existing plan adapter contract', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(responseStream())
    const adapter = new CodexMessageAdapter({ fetchFn: fetchMock })
    await adapter.generateResponse(request)
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]?.body as string),
    ).not.toHaveProperty('max_output_tokens')
  })
})
