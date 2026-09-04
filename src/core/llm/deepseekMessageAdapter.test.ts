import { ChatCompletionChunk } from 'openai/resources/chat/completions'

import { DeepSeekMessageAdapter } from './deepseekMessageAdapter'

class TestAdapter extends DeepSeekMessageAdapter {
  parse(chunk: ChatCompletionChunk) {
    return this.parseStreamingResponseChunk(chunk)
  }
}

function chunk(
  reasoning: string | undefined,
  finishReason: 'stop' | null = null,
) {
  return {
    id: 'response-1',
    created: 0,
    model: 'deepseek-v4-pro',
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        delta: reasoning ? { reasoning_content: reasoning } : {},
      },
    ],
  } as unknown as ChatCompletionChunk
}

describe('DeepSeekMessageAdapter streaming metadata', () => {
  it('keeps the full reasoning content for the next tool-call request', () => {
    const adapter = new TestAdapter()
    const first = adapter.parse(chunk('A'))
    const firstMetadata = first.choices[0].delta.providerMetadata

    adapter.parse(chunk('B'))
    adapter.parse(chunk('C'))

    expect(firstMetadata?.deepseek?.reasoningContent).toBe('ABC')
  })

  it('does not leak reasoning into a later response', () => {
    const adapter = new TestAdapter()
    adapter.parse(chunk('A'))
    adapter.parse(chunk(undefined, 'stop'))

    const later = adapter.parse({
      ...chunk('B'),
      id: 'response-2',
    } as ChatCompletionChunk)
    expect(
      later.choices[0].delta.providerMetadata?.deepseek?.reasoningContent,
    ).toBe('B')
  })
})
