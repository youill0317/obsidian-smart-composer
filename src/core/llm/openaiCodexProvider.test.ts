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
  model: 'gpt-6-astra',
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
  response: { id: 'r', created_at: 1, model: 'gpt-6-astra', output: [] },
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
