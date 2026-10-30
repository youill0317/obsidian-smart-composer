import { MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages'

import { AnthropicProvider } from './anthropic'

describe('AnthropicProvider prompt caching', () => {
  it('marks only the last block of the last message', () => {
    const messages = AnthropicProvider.addCacheBreakpoint([
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
      AnthropicProvider.addCacheBreakpoint([{ role: 'user', content: 'Hi' }]),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hi', cache_control: { type: 'ephemeral' } },
        ],
      },
    ])
    expect(
      AnthropicProvider.addCacheBreakpoint([{ role: 'user', content: '' }]),
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
    expect(usage).toEqual({
      prompt_tokens: 3210,
      completion_tokens: 6,
      total_tokens: 3216,
      cache_read_tokens: 3000,
      cache_write_tokens: 200,
    })
  })
})
