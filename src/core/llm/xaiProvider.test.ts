import { ChatModel } from '../../types/chat-model.types'
import {
  LLMRequestNonStreaming,
  LLMRequestStreaming,
  RequestMessage,
  XaiCompactionItem,
} from '../../types/llm/request'
import { LLMResponseStreaming } from '../../types/llm/response'

import { CodexMessageAdapter } from './codexMessageAdapter'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
} from './exception'
import { XaiProvider } from './xaiProvider'

jest.mock('obsidian', () => ({ Platform: { isDesktop: false } }), {
  virtual: true,
})

const model: ChatModel = {
  providerType: 'xai',
  providerId: 'xai',
  id: 'grok-4.7',
  model: 'grok-4.7',
}
const item: XaiCompactionItem = {
  type: 'compaction',
  id: 'cmp_1',
  encrypted_content: 'opaque',
}
const tool = {
  type: 'function' as const,
  function: {
    name: 'read_note',
    parameters: { type: 'object' as const, properties: {} },
  },
}
const toolCall = { id: 'call-1', name: 'read_note', arguments: '{}' }

let providerCount = 0
function newProvider(baseUrl?: string) {
  // The caches are per provider id, so each test gets its own.
  providerCount += 1
  return new XaiProvider({
    type: 'xai',
    id: `xai-${providerCount}`,
    apiKey: 'xai-key',
    ...(baseUrl && { baseUrl }),
  })
}

function responseStream(output: unknown[] = [message('Hello')]) {
  const response = {
    id: 'resp-1',
    created_at: 1,
    model: model.model,
    output: [],
  }
  return new Response(
    [
      { type: 'response.created', response },
      ...output.flatMap((o, index) => [
        { type: 'response.output_item.added', output_index: index, item: o },
        ...((o as { type: string }).type === 'message'
          ? [
              {
                type: 'response.output_text.delta',
                item_id: 'msg-1',
                output_index: index,
                content_index: 0,
                delta: 'Hello',
              },
            ]
          : []),
      ]),
      {
        type: 'response.completed',
        response: {
          ...response,
          output,
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        },
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('') + 'data: [DONE]\n\n',
  )
}

function message(text: string) {
  return {
    type: 'message',
    id: 'msg-1',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  }
}

type Routes = {
  responses?: () => Response | Promise<Response>
  compact?: () => Response | Promise<Response>
  models?: () => Response | Promise<Response>
}

function mockFetch(routes: Routes = {}) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/responses/compact')) {
        return routes.compact
          ? routes.compact()
          : Response.json({ object: 'response.compaction', output: [item] })
      }
      if (url.endsWith('/responses')) {
        return routes.responses ? routes.responses() : responseStream()
      }
      if (url.endsWith('/models')) {
        return routes.models ? routes.models() : Response.json({ data: [] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
}

type FetchCall = Parameters<typeof fetch>

function callsTo(
  fetchMock: { mock: { calls: FetchCall[] } },
  suffix: string,
): FetchCall[] {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(suffix))
}

function bodyOf(call: FetchCall): Record<string, unknown> {
  return JSON.parse(call[1]?.body as string) as Record<string, unknown>
}

function request(messages: RequestMessage[]): LLMRequestNonStreaming {
  return { model: model.model, messages }
}

async function collect(stream: AsyncIterable<LLMResponseStreaming>) {
  const chunks: LLMResponseStreaming[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

// An assistant reply whose response reported this many context tokens
function reported(contextTokens: number, content = 'Earlier answer') {
  return {
    role: 'assistant' as const,
    content,
    providerMetadata: { xai: { contextTokens } },
  }
}

const system: RequestMessage = { role: 'system', content: 'Be brief.' }
// Estimates to 2 tokens; grok-4.7 compacts at 450,000.
const next: RequestMessage = { role: 'user', content: 'Next' }

describe('xAI Responses requests', () => {
  afterEach(() => jest.restoreAllMocks())

  it('sends a plain chat to /responses with the system prompt as instructions', async () => {
    const fetchMock = mockFetch()
    const result = await newProvider().generateResponse(
      model,
      request([system, { role: 'user', content: 'Hi' }]),
    )

    const [call] = callsTo(fetchMock, '/responses')
    expect(call[0]).toBe('https://api.x.ai/v1/responses')
    expect(call[1]?.headers).toMatchObject({
      Authorization: 'Bearer xai-key',
    })
    expect(bodyOf(call)).toEqual({
      model: 'grok-4.7',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
      instructions: 'Be brief.',
      store: false,
      stream: true,
    })
    expect(result.choices[0].message.content).toBe('Hello')
    expect(result.usage?.prompt_tokens).toBe(100)
    expect(result.choices[0].message.providerMetadata).toEqual({
      xai: { contextTokens: 120 },
    })
  })

  it('sends tools and replays a tool round trip', async () => {
    const fetchMock = mockFetch({
      responses: () =>
        responseStream([
          {
            type: 'function_call',
            id: 'fc-1',
            call_id: 'call-1',
            name: 'read_note',
            arguments: '{}',
          },
        ]),
    })
    const provider = newProvider()
    const first = await provider.generateResponse(model, {
      ...request([{ role: 'user', content: 'Read it' }]),
      tools: [tool],
    })
    expect(first.choices[0].message.tool_calls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'read_note', arguments: '{}' },
      },
    ])
    expect(bodyOf(callsTo(fetchMock, '/responses')[0]).tools).toEqual([
      {
        type: 'function',
        name: 'read_note',
        description: null,
        parameters: { type: 'object', properties: {} },
        strict: false,
      },
    ])

    await provider.generateResponse(model, {
      ...request([
        { role: 'user', content: 'Read it' },
        { role: 'assistant', content: '', tool_calls: [toolCall] },
        { role: 'tool', tool_call: toolCall, content: 'note contents' },
      ]),
      tools: [tool],
    })
    expect(bodyOf(callsTo(fetchMock, '/responses')[1]).input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'Read it' }] },
      { role: 'assistant', content: '' },
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
    ])
  })

  it('sends images as input_image parts', async () => {
    const fetchMock = mockFetch()
    await newProvider().generateResponse(
      model,
      request([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,AAAA' },
            },
          ],
        },
      ]),
    )
    expect(bodyOf(callsTo(fetchMock, '/responses')[0]).input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'What is this?' },
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,AAAA',
            detail: 'auto',
          },
        ],
      },
    ])
  })

  it('streams text and attaches the reported size once at the end', async () => {
    mockFetch()
    const chunks = await collect(
      await newProvider('https://proxy.example/v1/').streamResponse(model, {
        ...request([{ role: 'user', content: 'Hi' }]),
        stream: true,
      } as LLMRequestStreaming),
    )
    expect(chunks.map((c) => c.choices[0].delta.content ?? '').join('')).toBe(
      'Hello',
    )
    const withMetadata = chunks.filter(
      (c) => c.choices[0].delta.providerMetadata,
    )
    expect(withMetadata).toHaveLength(1)
    expect(withMetadata[0].choices[0].delta.providerMetadata).toEqual({
      xai: { contextTokens: 120 },
    })
    expect(withMetadata[0].usage?.total_tokens).toBe(120)
  })

  it('uses the custom base URL', async () => {
    const fetchMock = mockFetch()
    await newProvider('https://proxy.example/v1/').generateResponse(
      model,
      request([{ role: 'user', content: 'Hi' }]),
    )
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://proxy.example/v1/responses',
    )
  })

  it('requires an API key and maps an authentication failure', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = mockFetch({
      responses: () =>
        new Response('{"error":"Incorrect API key"}', { status: 401 }),
    })
    const withoutKey = new XaiProvider({ type: 'xai', id: 'xai-nokey' })
    await expect(
      withoutKey.generateResponse(model, request([])),
    ).rejects.toBeInstanceOf(LLMAPIKeyNotSetException)
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(
      newProvider().streamResponse(model, {
        ...request([{ role: 'user', content: 'Hi' }]),
        stream: true,
      } as LLMRequestStreaming),
    ).rejects.toBeInstanceOf(LLMAPIKeyInvalidException)
  })

  it('ignores OpenAI compaction items, which xAI cannot read', async () => {
    const fetchMock = mockFetch()
    await newProvider().generateResponse(
      model,
      request([
        { role: 'user', content: 'First' },
        {
          role: 'assistant',
          content: 'Answer',
          providerMetadata: {
            openai: {
              compaction: { type: 'compaction', encrypted_content: 'openai' },
            },
          },
        },
        { role: 'user', content: 'Second' },
      ]),
    )
    const body = bodyOf(callsTo(fetchMock, '/responses')[0])
    expect(body.input).toHaveLength(3)
    expect(JSON.stringify(body.input)).not.toContain('openai')
    expect(body).not.toHaveProperty('context_management')
  })

  it('does not support embeddings', async () => {
    await expect(newProvider().getEmbedding('m', 'text')).rejects.toThrow(
      'does not support embeddings',
    )
  })
})

describe('xAI compaction', () => {
  afterEach(() => jest.restoreAllMocks())

  it('does not compact below the context window', async () => {
    const fetchMock = mockFetch()
    await newProvider().generateResponse(
      model,
      request([
        system,
        { role: 'user', content: 'Q' },
        reported(499_997),
        next,
      ]),
    )
    expect(callsTo(fetchMock, '/responses/compact')).toHaveLength(0)
    expect(callsTo(fetchMock, '/models')).toHaveLength(0)
  })

  it('compacts before the latest user message at the threshold', async () => {
    const fetchMock = mockFetch()
    const result = await newProvider().generateResponse(
      model,
      request([
        system,
        { role: 'user', content: 'Q' },
        reported(499_998),
        next,
      ]),
    )

    const [compact] = callsTo(fetchMock, '/responses/compact')
    expect(compact[0]).toBe('https://api.x.ai/v1/responses/compact')
    expect(bodyOf(compact)).toEqual({
      model: 'grok-4.7',
      input: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: [{ type: 'input_text', text: 'Q' }] },
        { role: 'assistant', content: 'Earlier answer' },
      ],
    })

    const body = bodyOf(callsTo(fetchMock, '/responses')[0])
    expect(body.input).toEqual([
      item,
      { role: 'user', content: [{ type: 'input_text', text: 'Next' }] },
    ])
    expect(body).not.toHaveProperty('instructions')
    expect(result.choices[0].message.providerMetadata).toEqual({
      xai: { compaction: item, tailLength: 1, contextTokens: 120 },
    })
  })

  it('keeps a tool loop in progress after the compaction item', async () => {
    const fetchMock = mockFetch()
    const chunks = await collect(
      await newProvider().streamResponse(model, {
        ...request([
          system,
          { role: 'user', content: 'Q' },
          reported(510_000),
          { role: 'user', content: 'Read it' },
          { role: 'assistant', content: '', tool_calls: [toolCall] },
          { role: 'tool', tool_call: toolCall, content: 'note contents' },
        ]),
        stream: true,
      } as LLMRequestStreaming),
    )

    expect(bodyOf(callsTo(fetchMock, '/responses/compact')[0]).input).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: [{ type: 'input_text', text: 'Q' }] },
      { role: 'assistant', content: 'Earlier answer' },
    ])
    expect(bodyOf(callsTo(fetchMock, '/responses')[0]).input).toEqual([
      item,
      { role: 'user', content: [{ type: 'input_text', text: 'Read it' }] },
      { role: 'assistant', content: '' },
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
    ])
    const metadata = chunks
      .map((c) => c.choices[0].delta.providerMetadata)
      .filter(Boolean)
    expect(metadata).toEqual([
      { xai: { compaction: item, tailLength: 3, contextTokens: 120 } },
    ])
  })

  it('compacts a single long tool run before its latest round', async () => {
    const fetchMock = mockFetch()
    const secondCall = { ...toolCall, id: 'call-2' }
    await newProvider().generateResponse(
      model,
      request([
        system,
        { role: 'user', content: 'Read everything' },
        { ...reported(510_000, ''), tool_calls: [toolCall] },
        { role: 'tool', tool_call: toolCall, content: 'first' },
        { role: 'assistant', content: '', tool_calls: [secondCall] },
        { role: 'tool', tool_call: secondCall, content: 'second' },
      ]),
    )
    expect(
      bodyOf(callsTo(fetchMock, '/responses/compact')[0]).input,
    ).toHaveLength(5)
    expect(bodyOf(callsTo(fetchMock, '/responses')[0]).input).toEqual([
      item,
      { role: 'assistant', content: '' },
      {
        type: 'function_call',
        call_id: 'call-2',
        name: 'read_note',
        arguments: '{}',
      },
      { type: 'function_call_output', call_id: 'call-2', output: 'second' },
    ])
  })

  it('replays the stored item in place of the messages it replaced', async () => {
    const fetchMock = mockFetch()
    await newProvider().generateResponse(
      model,
      request([
        system,
        { role: 'user', content: 'Q' },
        reported(10),
        { role: 'user', content: 'Read it' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [toolCall],
          providerMetadata: {
            xai: { compaction: item, tailLength: 1, contextTokens: 5_000 },
          },
        },
        { role: 'tool', tool_call: toolCall, content: 'note contents' },
        reported(6_000, 'Done'),
        { role: 'user', content: 'Thanks' },
      ]),
    )

    expect(callsTo(fetchMock, '/responses/compact')).toHaveLength(0)
    const body = bodyOf(callsTo(fetchMock, '/responses')[0])
    expect(body).not.toHaveProperty('instructions')
    expect(body.input).toEqual([
      item,
      { role: 'user', content: [{ type: 'input_text', text: 'Read it' }] },
      { role: 'assistant', content: '' },
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
      { role: 'assistant', content: 'Done' },
      { role: 'user', content: [{ type: 'input_text', text: 'Thanks' }] },
    ])
  })

  it('re-compacts from the stored item without the system prompt', async () => {
    const fetchMock = mockFetch()
    await newProvider().generateResponse(
      model,
      request([
        system,
        { role: 'user', content: 'Q' },
        {
          role: 'assistant',
          content: 'A',
          providerMetadata: {
            xai: { compaction: item, tailLength: 1, contextTokens: 510_000 },
          },
        },
        next,
      ]),
    )
    expect(bodyOf(callsTo(fetchMock, '/responses/compact')[0]).input).toEqual([
      item,
      { role: 'user', content: [{ type: 'input_text', text: 'Q' }] },
      { role: 'assistant', content: 'A' },
    ])
  })

  it('sends the request uncompacted when /compact fails, and waits before retrying', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = mockFetch({
      compact: () => new Response('{"error":"bad"}', { status: 400 }),
    })
    const provider = newProvider()
    const messages = [
      system,
      { role: 'user' as const, content: 'Q' },
      reported(510_000),
      next,
    ]
    const result = await provider.generateResponse(model, request(messages))
    expect(result.choices[0].message.content).toBe('Hello')
    expect(result.choices[0].message.providerMetadata).toEqual({
      xai: { contextTokens: 120 },
    })
    const body = bodyOf(callsTo(fetchMock, '/responses')[0])
    expect(body.instructions).toBe('Be brief.')
    expect(body.input).toHaveLength(3)

    await provider.generateResponse(model, request(messages))
    expect(callsTo(fetchMock, '/responses/compact')).toHaveLength(1)
    expect(callsTo(fetchMock, '/responses')).toHaveLength(2)
  })
})

describe('xAI context window lookup', () => {
  afterEach(() => jest.restoreAllMocks())

  const unknown: ChatModel = { ...model, id: 'grok-next', model: 'grok-next' }
  const ask = (provider: XaiProvider, contextTokens: number) =>
    provider.generateResponse(unknown, {
      model: unknown.model,
      messages: [
        { role: 'user', content: 'Q' },
        reported(contextTokens),
        { role: 'user', content: 'Next' },
      ],
    })

  it('uses a known window without a lookup', async () => {
    const fetchMock = mockFetch()
    await newProvider().generateResponse(model, request([]))
    expect(callsTo(fetchMock, '/models')).toHaveLength(0)
  })

  it('looks up context_length once and compacts at it', async () => {
    const fetchMock = mockFetch({
      models: () =>
        Response.json({
          data: [
            { id: 'grok-other', context_length: 50_000 },
            {
              id: 'grok-next-0901',
              aliases: ['grok-next'],
              context_length: 100_000,
            },
          ],
        }),
    })
    const provider = newProvider()
    await ask(provider, 99_000)
    expect(callsTo(fetchMock, '/responses/compact')).toHaveLength(0)
    await ask(provider, 100_000)
    expect(callsTo(fetchMock, '/responses/compact')).toHaveLength(1)
    expect(callsTo(fetchMock, '/models')).toHaveLength(1)
    expect(callsTo(fetchMock, '/models')[0][0]).toBe(
      'https://api.x.ai/v1/models',
    )
  })

  it('falls back to a 272k window when the model is not listed', async () => {
    const fetchMock = mockFetch()
    const provider = newProvider()
    await ask(provider, 271_900)
    expect(callsTo(fetchMock, '/responses/compact')).toHaveLength(0)
    await ask(provider, 272_000)
    expect(callsTo(fetchMock, '/responses/compact')).toHaveLength(1)
    expect(callsTo(fetchMock, '/models')).toHaveLength(1)
  })

  it('falls back and caches the failure when the lookup fails', async () => {
    const fetchMock = mockFetch({
      models: () => Promise.reject(new Error('offline')),
    })
    const provider = newProvider()
    const result = await ask(provider, 272_000)
    expect(result.choices[0].message.content).toBe('Hello')
    expect(callsTo(fetchMock, '/responses/compact')).toHaveLength(1)
    await ask(provider, 10)
    expect(callsTo(fetchMock, '/models')).toHaveLength(1)
  })
})

describe('OpenAI Responses adapter', () => {
  it('keeps server compaction and ignores xAI compaction items', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(responseStream())
    await new CodexMessageAdapter({ fetchFn: fetchMock }).generateResponse({
      model: 'gpt-6.2-sol',
      messages: [
        system,
        { role: 'user', content: 'Q' },
        {
          role: 'assistant',
          content: 'A',
          providerMetadata: { xai: { compaction: item, tailLength: 1 } },
        },
        next,
      ],
    })
    const body = bodyOf(fetchMock.mock.calls[0])
    expect(body.instructions).toBe('Be brief.')
    expect(body.input).toHaveLength(3)
    expect(JSON.stringify(body.input)).not.toContain('opaque')
    expect(body.context_management).toEqual([{ type: 'compaction' }])
  })
})
