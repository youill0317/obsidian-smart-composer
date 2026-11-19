import { LLMRequestNonStreaming } from '../../types/llm/request'
import { LLMProvider } from '../../types/provider.types'

import { buildCodexAuthorizeUrl, refreshCodexAccessToken } from './codexAuth'
import { CodexMessageAdapter } from './codexMessageAdapter'
import { OpenAICodexProvider } from './openaiCodexProvider'

jest.mock('obsidian', () => ({ Platform: { isDesktop: false } }), {
  virtual: true,
})
jest.mock('./codexAuth', () => ({
  ...jest.requireActual<object>('./codexAuth'),
  refreshCodexAccessToken: jest.fn(),
}))

const request: LLMRequestNonStreaming = {
  model: 'gpt-6.2-sol',
  messages: [
    { role: 'user', content: 'Read note' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', name: 'read_note', arguments: '{}' }],
    },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'read_note',
        parameters: { type: 'object', properties: {} },
      },
    },
  ],
}

function sse(events: unknown[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
  )
}

const created = {
  type: 'response.created',
  response: { id: 'r', created_at: 1, model: 'gpt-6.2-sol', output: [] },
}

describe('Sign in with ChatGPT authorize URL', () => {
  const base = {
    pkce: { verifier: 'v', challenge: 'c' },
    state: 's',
    nonce: 'n',
    hostId: 'urn:uuid:host',
  }

  it('registers a dynamic client on first sign-in', () => {
    const url = new URL(buildCodexAuthorizeUrl(base))
    expect(url.origin + url.pathname).toBe(
      'https://auth.openai.com/api/accounts/authorize',
    )
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client')
    expect(url.searchParams.get('agent_name_hint')).toBe('Smart Composer')
    expect(url.searchParams.get('ext_agent_host_id')).toBe('urn:uuid:host')
    expect(url.searchParams.get('resource')).toBe('https://api.openai.com/v1')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:1455/auth/callback',
    )
    expect(url.searchParams.get('scope')?.split(' ')).toContain(
      'chatgpt.tokens.use.direct',
    )
  })

  it('reuses the issued client without a name hint on reauthorization', () => {
    const url = new URL(
      buildCodexAuthorizeUrl({ ...base, clientId: 'oaiapp_1' }),
    )
    expect(url.searchParams.get('client_id')).toBe('oaiapp_1')
    expect(url.searchParams.has('agent_name_hint')).toBe(false)
  })
})

describe('ChatGPT plan Responses adapter', () => {
  it('wraps tools in a namespace and echoes it on function calls', async () => {
    const fetchFn = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        sse([created, { ...created, type: 'response.completed' }]),
      )
    const adapter = new CodexMessageAdapter({ fetchFn, toolNamespace: 'ns' })
    await adapter.generateResponse(request)
    const body = JSON.parse(fetchFn.mock.calls[0][1]?.body as string)
    expect(body.tools).toEqual([
      expect.objectContaining({
        type: 'namespace',
        name: 'ns',
        tools: [expect.objectContaining({ name: 'read_note' })],
      }),
    ])
    expect(body.input).toContainEqual(
      expect.objectContaining({ type: 'function_call', namespace: 'ns' }),
    )
    expect(body).toMatchObject({ store: false, stream: true })
    expect(body).not.toHaveProperty('max_output_tokens')
  })

  it('fails when the stream ends before response.completed', async () => {
    const fetchFn = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(async () => sse([created]))
    const adapter = new CodexMessageAdapter({ fetchFn })
    await expect(adapter.generateResponse(request)).rejects.toThrow(
      'ended before completion',
    )
    const stream = await adapter.streamResponse({ ...request, stream: true })
    await expect(
      (async () => {
        for await (const _chunk of stream) {
          // drain
        }
      })(),
    ).rejects.toThrow('ended before completion')
  })
})

describe('ChatGPT plan token refresh', () => {
  it('shares one refresh across provider instances', async () => {
    let resolve!: (value: unknown) => void
    jest.mocked(refreshCodexAccessToken).mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const provider: Extract<LLMProvider, { type: 'openai-plan' }> = {
      type: 'openai-plan',
      id: 'openai-plan',
      registration: { clientId: 'oaiapp_1', subject: 'user' },
      oauth: {
        accessToken: 'old',
        refreshToken: 'refresh-old',
        expiresAt: 0,
        idToken: 'id',
        scopes: ['chatgpt.tokens.use.direct'],
      },
    }
    const onUpdate = jest.fn()
    type WithHeaders = { getAuthHeaders(): Promise<Record<string, string>> }
    const [a, b] = [1, 2].map(
      () =>
        new OpenAICodexProvider(
          structuredClone(provider),
          onUpdate,
        ) as unknown as WithHeaders,
    )
    const headers = Promise.all([a.getAuthHeaders(), b.getAuthHeaders()])
    resolve({
      access_token: 'new',
      refresh_token: 'refresh-new',
      id_token: 'id',
      expires_in: 3600,
    })
    expect(await headers).toEqual([
      { authorization: 'Bearer new' },
      { authorization: 'Bearer new' },
    ])
    expect(refreshCodexAccessToken).toHaveBeenCalledTimes(1)
    expect(refreshCodexAccessToken).toHaveBeenCalledWith(
      'refresh-old',
      'oaiapp_1',
    )
    // The refresher saves; the waiter syncs the same saved tokens.
    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(onUpdate.mock.calls[1][1]).toEqual(onUpdate.mock.calls[0][1])
  })

  it('adopts a completed refresh instead of reusing the consumed token', async () => {
    jest.mocked(refreshCodexAccessToken).mockReset().mockResolvedValueOnce({
      access_token: 'late-new',
      refresh_token: 'late-refresh-new',
      id_token: 'id',
      expires_in: 3600,
    })
    const provider: Extract<LLMProvider, { type: 'openai-plan' }> = {
      type: 'openai-plan',
      id: 'openai-plan',
      registration: { clientId: 'oaiapp_1', subject: 'user' },
      oauth: {
        accessToken: 'late-old',
        refreshToken: 'late-refresh-old',
        expiresAt: 0,
        idToken: 'id',
        scopes: ['chatgpt.tokens.use.direct'],
      },
    }
    const onUpdate = jest.fn()
    type WithHeaders = { getAuthHeaders(): Promise<Record<string, string>> }
    const [a, b] = [1, 2].map(
      () =>
        new OpenAICodexProvider(
          structuredClone(provider),
          onUpdate,
        ) as unknown as WithHeaders,
    )
    await a.getAuthHeaders()
    expect(await b.getAuthHeaders()).toEqual({
      authorization: 'Bearer late-new',
    })
    expect(refreshCodexAccessToken).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[1][1]).toEqual(onUpdate.mock.calls[0][1])
  })
})

describe('ChatGPT plan reasoning effort', () => {
  it.each([
    ['xhigh', 'xhigh'],
    ['none', undefined],
  ])('sends effort %s as %p', (effort, expected) => {
    type WithNormalize = {
      normalizeRequest(
        model: unknown,
        request: LLMRequestNonStreaming,
      ): LLMRequestNonStreaming
    }
    const provider = new OpenAICodexProvider({
      type: 'openai-plan',
      id: 'openai-plan',
    }) as unknown as WithNormalize
    expect(
      provider.normalizeRequest(
        {
          providerType: 'openai-plan',
          providerId: 'openai-plan',
          id: 'gpt-6.2-sol',
          model: 'gpt-6.2-sol',
          reasoning: { reasoning_effort: effort },
        },
        request,
      ).reasoning_effort,
    ).toBe(expected)
  })
})

describe('Responses compaction and cached tokens', () => {
  const compactionItem = {
    type: 'compaction',
    id: 'cmp_1',
    encrypted_content: 'opaque',
    created_by: 'server',
  }
  const stored = {
    type: 'compaction',
    id: 'cmp_1',
    encrypted_content: 'opaque',
  }
  const usage = {
    input_tokens: 1000,
    output_tokens: 10,
    total_tokens: 1010,
    input_tokens_details: { cached_tokens: 800, cache_write_tokens: 150 },
  }
  const events = [
    created,
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: compactionItem,
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: compactionItem,
    },
    {
      type: 'response.output_item.added',
      output_index: 1,
      item: { type: 'message', role: 'assistant', content: [] },
    },
    {
      type: 'response.content_part.added',
      output_index: 1,
      content_index: 0,
      part: { type: 'output_text', text: '' },
    },
    {
      type: 'response.output_text.delta',
      output_index: 1,
      content_index: 0,
      delta: 'Hi',
    },
    {
      type: 'response.completed',
      response: {
        ...created.response,
        output: [
          compactionItem,
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hi' }],
          },
        ],
        usage,
      },
    },
  ]

  const ENDPOINT = 'https://api.test/responses'

  function adapterFor(responseEvents: unknown[]) {
    const fetchFn = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(async () => sse(responseEvents))
    return {
      adapter: new CodexMessageAdapter({ fetchFn, endpoint: ENDPOINT }),
      fetchFn,
    }
  }

  it('enables compaction with the server default threshold', async () => {
    const { adapter, fetchFn } = adapterFor(events)
    await adapter.generateResponse(request)
    expect(
      JSON.parse(fetchFn.mock.calls[0][1]?.body as string).context_management,
    ).toEqual([{ type: 'compaction' }])
  })

  it('captures the compaction item and cached tokens from a response', async () => {
    const { adapter } = adapterFor(events)
    const result = await adapter.generateResponse(request)
    expect(result.choices[0].message.providerMetadata).toEqual({
      openai: { compaction: stored, endpoint: ENDPOINT },
    })
    expect(result.usage).toEqual({
      prompt_tokens: 1000,
      completion_tokens: 10,
      total_tokens: 1010,
      cache_read_tokens: 800,
      cache_write_tokens: 150,
    })
  })

  it('captures the compaction item from a stream', async () => {
    const { adapter } = adapterFor(events)
    const chunks = []
    for await (const chunk of await adapter.streamResponse({
      ...request,
      stream: true,
    })) {
      chunks.push(chunk)
    }
    expect(
      chunks.map((c) => c.choices[0]?.delta.providerMetadata).filter(Boolean),
    ).toEqual([{ openai: { compaction: stored, endpoint: ENDPOINT } }])
    expect(chunks.at(-1)?.usage?.cache_read_tokens).toBe(800)
  })

  it('falls back to the completed response output', async () => {
    const { adapter } = adapterFor(
      events.filter((event) => event.type !== 'response.output_item.done'),
    )
    const chunks = []
    for await (const chunk of await adapter.streamResponse({
      ...request,
      stream: true,
    })) {
      chunks.push(chunk)
    }
    expect(chunks.at(-1)?.choices[0].delta.providerMetadata).toEqual({
      openai: { compaction: stored, endpoint: ENDPOINT },
    })
  })

  it('replays the latest compaction item and drops the items before it', async () => {
    const { adapter, fetchFn } = adapterFor(events)
    const metadata = (id: string, endpoint = ENDPOINT) => ({
      openai: {
        compaction: {
          type: 'compaction' as const,
          id,
          encrypted_content: id,
        },
        endpoint,
      },
    })
    await adapter.generateResponse({
      model: 'gpt-6.2-sol',
      messages: [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Old' },
        { role: 'assistant', content: 'A1', providerMetadata: metadata('c1') },
        { role: 'user', content: 'Middle' },
        { role: 'assistant', content: 'A2', providerMetadata: metadata('c2') },
        { role: 'user', content: 'New' },
      ],
    })
    const body = JSON.parse(fetchFn.mock.calls[0][1]?.body as string)
    expect(body.instructions).toBe('System')
    expect(body.input).toEqual([
      { type: 'compaction', id: 'c2', encrypted_content: 'c2' },
      { role: 'assistant', content: 'A2' },
      { role: 'user', content: [{ type: 'input_text', text: 'New' }] },
    ])
  })

  it('sends the whole history when the item came from another endpoint', async () => {
    const { adapter, fetchFn } = adapterFor(events)
    await adapter.generateResponse({
      model: 'gpt-6.2-sol',
      messages: [
        { role: 'user', content: 'Old' },
        {
          role: 'assistant',
          content: 'A1',
          providerMetadata: {
            openai: {
              compaction: { type: 'compaction', encrypted_content: 'c1' },
              endpoint: 'https://other.example/responses',
            },
          },
        },
        { role: 'user', content: 'New' },
      ],
    })
    expect(JSON.parse(fetchFn.mock.calls[0][1]?.body as string).input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'Old' }] },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: [{ type: 'input_text', text: 'New' }] },
    ])
  })

  it('joins the text of every message item in a response', async () => {
    const message = (text: string) => ({
      type: 'message',
      content: [{ type: 'output_text', text }],
    })
    const { adapter } = adapterFor([
      created,
      {
        type: 'response.completed',
        response: {
          id: 'r',
          created_at: 1,
          model: 'gpt-6.2-sol',
          output: [message('First. '), message('Second.')],
        },
      },
    ])
    const result = await adapter.generateResponse(request)
    expect(result.choices[0].message.content).toBe('First. Second.')
  })

  it('does not repeat a streamed reasoning summary when it completes', async () => {
    const { adapter } = adapterFor([
      { type: 'response.created', response: { id: 'r', created_at: 1 } },
      {
        type: 'response.reasoning_summary_text.delta',
        item_id: 'rs',
        summary_index: 0,
        delta: 'Ab',
      },
      {
        type: 'response.reasoning_summary_text.delta',
        item_id: 'rs',
        summary_index: 0,
        delta: 'c',
      },
      {
        type: 'response.reasoning_summary_text.done',
        item_id: 'rs',
        summary_index: 0,
        text: 'Abc',
      },
      ...events.filter(
        (event) => (event as { type: string }).type === 'response.completed',
      ),
    ])
    const chunks = []
    for await (const chunk of await adapter.streamResponse({
      ...request,
      stream: true,
    })) {
      chunks.push(chunk)
    }
    expect(
      chunks.map((c) => c.choices[0]?.delta.reasoning ?? '').join(''),
    ).toBe('Abc')
  })
})
