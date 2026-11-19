import Anthropic from '@anthropic-ai/sdk'
import {
  MessageParam,
  MessageStreamEvent,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages'

import { RequestMessage, RequestTool } from '../../types/llm/request'

import { AnthropicProvider } from './anthropic'

async function* streamOf(events: unknown[]) {
  for (const event of events) {
    yield event as MessageStreamEvent
  }
}

describe('AnthropicProvider prompt caching', () => {
  it('marks only the last block when the only user turn comes first', () => {
    const messages = AnthropicProvider.addCacheBreakpoints([
      { role: 'user', content: 'Edit my notes' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'cli', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
      },
    ])

    expect(messages[0]).toEqual({ role: 'user', content: 'Edit my notes' })
    expect(messages[2].content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 't1',
        content: 'ok',
        cache_control: { type: 'ephemeral' },
      },
    ])
  })

  it('converts string content and skips empty text', () => {
    expect(
      AnthropicProvider.addCacheBreakpoints([{ role: 'user', content: 'Hi' }]),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hi', cache_control: { type: 'ephemeral' } },
        ],
      },
    ])
    expect(
      AnthropicProvider.addCacheBreakpoints([{ role: 'user', content: '' }]),
    ).toEqual([{ role: 'user', content: '' }])
  })

  it('counts cached tokens as prompt tokens', async () => {
    async function* stream() {
      yield {
        type: 'message_start',
        message: {
          id: 'm1',
          model: 'claude',
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 3000,
            output_tokens: 1,
          },
        },
      } as unknown as MessageStreamEvent
      yield {
        type: 'message_delta',
        delta: {},
        usage: { output_tokens: 5 },
      } as unknown as MessageStreamEvent
    }

    let usage
    for await (const chunk of AnthropicProvider.streamResponseGenerator(
      stream(),
    )) {
      usage = chunk.usage
    }
    // message_delta counts are cumulative and replace those of message_start
    expect(usage).toEqual({
      prompt_tokens: 3210,
      completion_tokens: 5,
      total_tokens: 3215,
      cache_read_tokens: 3000,
      cache_write_tokens: 200,
    })
  })
})

describe('AnthropicProvider thinking', () => {
  afterEach(() => jest.restoreAllMocks())

  const request = {
    model: 'claude-opus-5-5',
    messages: [{ role: 'user' as const, content: 'Hi' }],
  }
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'm1',
        model: 'claude-opus-5-5',
        role: 'assistant',
        content: [],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Summary' },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: 'Hello' },
    },
    { type: 'content_block_stop', index: 1 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 3 },
    },
  ]

  function createProvider() {
    const provider = new AnthropicProvider({
      type: 'anthropic',
      id: 'anthropic',
      apiKey: 'test-key',
    })
    const create = jest
      .spyOn(Anthropic.Messages.prototype, 'create')
      .mockImplementation((async () => streamOf(events)) as never)
    return { provider, create }
  }

  it('sends effort and summarized adaptive thinking for Opus 5.5', async () => {
    const { provider, create } = createProvider()
    const result = await provider.generateResponse(
      {
        providerType: 'anthropic',
        providerId: 'anthropic',
        id: 'claude-opus-5-5',
        model: 'claude-opus-5-5',
        adaptive_thinking: { effort: 'xhigh', show_summaries: true },
      },
      request,
    )
    expect(create.mock.calls[0][0]).toMatchObject({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'xhigh' },
      max_tokens: 128_000,
      stream: true,
    })
    expect(result.choices[0].message.reasoning).toBe('Summary')
    expect(result.choices[0].message.content).toBe('Hello')
    expect(result.choices[0].finish_reason).toBe('end_turn')
    expect(result.usage?.completion_tokens).toBe(3)
  })

  it('omits thinking fields for Opus 5.5 when unset', async () => {
    const { provider, create } = createProvider()
    await provider.generateResponse(
      {
        providerType: 'anthropic',
        providerId: 'anthropic',
        id: 'claude-opus-5-5',
        model: 'claude-opus-5-5',
      },
      request,
    )
    const body = create.mock.calls[0][0]
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('output_config')
    expect(body.max_tokens).toBe(128_000)
  })

  const thinkingParams = (adaptive_thinking?: {
    effort?: string
    show_summaries?: boolean
  }) =>
    AnthropicProvider.buildThinkingParams({
      providerType: 'anthropic',
      providerId: 'anthropic',
      id: 'claude-opus-5-5',
      model: 'claude-opus-5-5',
      adaptive_thinking,
    })

  it.each([
    [{ effort: 'max' }, { output_config: { effort: 'max' } }],
    // Effort outside the list is not sent
    [{ effort: 'none' }, {}],
    [
      { show_summaries: true },
      { thinking: { type: 'adaptive', display: 'summarized' } },
    ],
  ])('builds thinking params for %j', (adaptive, expected) => {
    expect(thinkingParams(adaptive)).toEqual(expected)
  })

  it('streams summarized thinking as reasoning', () => {
    expect(
      AnthropicProvider.parseStreamingResponseChunk(
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Summary' },
        },
        'm1',
        'claude-opus-5-5',
      )?.choices[0].delta.reasoning,
    ).toBe('Summary')
  })
})

describe('AnthropicProvider cache breakpoints', () => {
  const marked = (messages: MessageParam[]) =>
    messages.flatMap((message, m) =>
      typeof message.content === 'string'
        ? []
        : message.content.flatMap((block, b) =>
            'cache_control' in block && block.cache_control ? [[m, b]] : [],
          ),
    )

  it('marks the end of the history before the newest user turn and the last block', () => {
    const messages = AnthropicProvider.addCacheBreakpoints([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: [{ type: 'text', text: 'Answer' }] },
      { role: 'user', content: 'Second' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'cli', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
      },
    ])
    expect(marked(messages)).toEqual([
      [1, 0],
      [4, 0],
    ])
    expect(messages[0]).toEqual({ role: 'user', content: 'First' })
  })

  it('sends one breakpoint when the newest user turn is the first message', () => {
    const messages = AnthropicProvider.addCacheBreakpoints([
      { role: 'user', content: 'Edit my notes' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'cli', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
      },
    ])
    expect(marked(messages)).toEqual([[2, 0]])
  })

  it('marks a compaction block once even when it ends the earlier history', () => {
    const messages = AnthropicProvider.addCacheBreakpoints([
      {
        role: 'assistant',
        content: [
          {
            type: 'compaction',
            content: 'Summary',
          } as unknown as TextBlockParam,
        ],
      },
      { role: 'user', content: 'Next' },
    ])
    expect(marked(messages)).toEqual([
      [0, 0],
      [1, 0],
    ])
  })

  it('sends the system prompt as a cached text block', () => {
    const { body } = AnthropicProvider.buildRequest(
      claudeModel('claude-opus-5-5'),
      {
        model: 'claude-opus-5-5',
        messages: [
          { role: 'system', content: 'Be brief' },
          { role: 'user', content: 'Hi' },
        ],
      },
      1000,
    )
    expect(body.system).toEqual([
      { type: 'text', text: 'Be brief', cache_control: { type: 'ephemeral' } },
    ])
    expect(
      AnthropicProvider.buildRequest(
        claudeModel('claude-opus-5-5'),
        {
          model: 'claude-opus-5-5',
          messages: [{ role: 'user', content: 'Hi' }],
        },
        1000,
      ).body.system,
    ).toBeUndefined()
  })
})

describe('AnthropicProvider compaction', () => {
  const request = (model: string, messages: RequestMessage[]) => ({
    model,
    messages,
  })

  it('enables compaction with the API default trigger', () => {
    const { body, headers } = AnthropicProvider.buildRequest(
      claudeModel('claude-opus-5-5'),
      request('claude-opus-5-5', [{ role: 'user', content: 'Hi' }]),
      1000,
    )
    expect(headers).toEqual({ 'anthropic-beta': 'compact-2026-01-12' })
    expect(body).toMatchObject({
      context_management: { edits: [{ type: 'compact_20260112' }] },
    })
    expect(
      (body as unknown as { context_management: { edits: object[] } })
        .context_management.edits[0],
    ).not.toHaveProperty('trigger')
  })

  it('tells the summarizer not to call tools only when tools are defined', () => {
    const edit = (tools?: RequestTool[]) =>
      (
        AnthropicProvider.buildRequest(
          claudeModel('claude-sonnet-5-5'),
          {
            ...request('claude-sonnet-5-5', [{ role: 'user', content: 'Hi' }]),
            tools,
          },
          1000,
        ).body as unknown as {
          context_management: { edits: Record<string, unknown>[] }
        }
      ).context_management.edits[0]
    expect(
      edit([
        {
          type: 'function',
          function: {
            name: 'search',
            parameters: { type: 'object', properties: {} },
          },
        },
      ]),
    ).toEqual({
      type: 'compact_20260112',
      instructions:
        'Summarize the transcript inside <summary></summary> tags. Include relevant information in the summary for continuing the task in the next context window. Do not call any tools while writing this summary; respond with text only.',
    })
    expect(edit()).not.toHaveProperty('instructions')
  })

  it('re-emits the latest compaction first and drops what it replaces', () => {
    const compaction = (content: string) => ({
      anthropic: { compaction: { type: 'compaction' as const, content } },
    })
    const { body } = AnthropicProvider.buildRequest(
      claudeModel('claude-opus-5-5'),
      request('claude-opus-5-5', [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Old' },
        {
          role: 'assistant',
          content: 'A1',
          providerMetadata: compaction('S1'),
        },
        { role: 'user', content: 'Middle' },
        {
          role: 'assistant',
          content: 'A2',
          tool_calls: [{ id: 't1', name: 'cli', arguments: '{}' }],
          providerMetadata: compaction('S2'),
        },
        {
          role: 'tool',
          tool_call: { id: 't1', name: 'cli', arguments: '{}' },
          content: 'ok',
        },
        { role: 'user', content: 'New' },
      ]),
      1000,
    )
    expect(body.system).toEqual([
      { type: 'text', text: 'System', cache_control: { type: 'ephemeral' } },
    ])
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'compaction',
            content: 'S2',
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: 'A2' },
          { type: 'tool_use', id: 't1', name: 'cli', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: 'ok',
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'New', cache_control: { type: 'ephemeral' } },
        ],
      },
    ])
  })

  const compactionEvents = [
    {
      type: 'message_start',
      message: {
        id: 'm1',
        model: 'claude-opus-5-5',
        role: 'assistant',
        content: [],
        usage: { input_tokens: 20, output_tokens: 1 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'compaction', content: null },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'compaction_delta', content: 'Summary' },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: 'Hello' },
    },
    { type: 'content_block_stop', index: 1 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: {
        input_tokens: 23000,
        output_tokens: 1000,
        iterations: [
          { type: 'compaction', input_tokens: 180000, output_tokens: 3500 },
          { type: 'message', input_tokens: 23000, output_tokens: 1000 },
        ],
      },
    },
  ]

  it('captures the compaction block and its billed usage from a stream', async () => {
    const chunks = []
    for await (const chunk of AnthropicProvider.streamResponseGenerator(
      streamOf(compactionEvents),
    )) {
      chunks.push(chunk)
    }
    expect(
      chunks.map((c) => c.choices[0]?.delta.providerMetadata).filter(Boolean),
    ).toEqual([
      { anthropic: { compaction: { type: 'compaction', content: 'Summary' } } },
    ])
    expect(chunks.at(-1)?.usage).toEqual({
      prompt_tokens: 203000,
      completion_tokens: 4500,
      total_tokens: 207500,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    })
  })

  it('captures the compaction block from a complete response', async () => {
    const response = AnthropicProvider.parseNonStreamingResponse(
      await AnthropicProvider.collectMessage(streamOf(compactionEvents)),
    )
    expect(response.choices[0].message).toMatchObject({
      content: 'Hello',
      providerMetadata: {
        anthropic: { compaction: { type: 'compaction', content: 'Summary' } },
      },
    })
    expect(response.usage?.prompt_tokens).toBe(203000)
  })

  it('does not keep a compaction block without a summary', () => {
    const response = AnthropicProvider.parseNonStreamingResponse({
      id: 'm1',
      model: 'claude-opus-5-5',
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'compaction', content: null }],
      usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Anthropic.Message)
    expect(response.choices[0].message.providerMetadata).toBeUndefined()
  })
})

describe('AnthropicProvider max output', () => {
  afterEach(() => jest.restoreAllMocks())

  function setup(providerId: string) {
    const provider = new AnthropicProvider({
      type: 'anthropic',
      id: providerId,
      apiKey: 'test-key',
    })
    const create = jest
      .spyOn(Anthropic.Messages.prototype, 'create')
      .mockImplementation((async () => streamOf([])) as never)
    const retrieve = jest.spyOn(Anthropic.Models.prototype, 'retrieve')
    const send = async (model: string, maxTokens?: number) => {
      const stream = await provider.streamResponse(claudeModel(model), {
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
        ...(maxTokens && { max_tokens: maxTokens }),
      })
      for await (const _chunk of stream) {
        // drain
      }
      return create.mock.calls.at(-1)?.[0].max_tokens
    }
    return { send, retrieve }
  }

  it('uses the known maximum without a lookup', async () => {
    const { send, retrieve } = setup('known')
    expect(await send('claude-opus-5-5')).toBe(128_000)
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('keeps a caller-supplied max_tokens', async () => {
    const { send, retrieve } = setup('caller')
    expect(await send('claude-opus-5-5', 500)).toBe(500)
    expect(await send('claude-unknown', 500)).toBe(500)
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('looks up an unknown model once', async () => {
    const { send, retrieve } = setup('lookup')
    retrieve.mockResolvedValue({ max_tokens: 96_000 } as never)
    expect(await send('claude-new')).toBe(96_000)
    expect(await send('claude-new')).toBe(96_000)
    expect(retrieve).toHaveBeenCalledTimes(1)
    expect(retrieve.mock.calls[0][1]).toMatchObject({ maxRetries: 0 })
  })

  it('falls back to the default when the lookup fails, without retrying', async () => {
    const { send, retrieve } = setup('failing')
    retrieve.mockRejectedValue(new Error('404'))
    expect(await send('claude-unknown')).toBe(8192)
    expect(await send('claude-unknown')).toBe(8192)
    expect(retrieve).toHaveBeenCalledTimes(1)
  })
})

function claudeModel(model: string) {
  return {
    providerType: 'anthropic' as const,
    providerId: 'anthropic',
    id: model,
    model,
  }
}
