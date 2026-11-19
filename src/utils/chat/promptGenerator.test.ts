import { App, TFile } from 'obsidian'

import { RAGEngine } from '../../core/rag/ragEngine'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import {
  ChatAssistantMessage,
  ChatMessage,
  ChatUserMessage,
} from '../../types/chat'
import { RequestMessage } from '../../types/llm/request'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import { PromptGenerator } from './promptGenerator'

const FILE_HEADER = '## Current File'
// No provider compaction and no listed context window: limit 272,000 tokens
const MODEL = { providerType: 'openai-compatible', model: 'local' } as const

function setup() {
  const files: Record<string, string> = { 'note.md': 'v1', 'other.md': 'o1' }
  const cachedRead = jest.fn(async (file: TFile) => files[file.path])
  const app = { vault: { cachedRead } } as unknown as App
  const ragEngine = {
    processQuery: jest.fn().mockResolvedValue([
      {
        id: 1,
        path: 'snippet.md',
        mtime: 0,
        content: 'snippet',
        model: 'model',
        dimension: 1,
        metadata: { startLine: 3, endLine: 3 },
        similarity: 0.9,
      },
    ]),
  } as unknown as RAGEngine
  const settings = {
    systemPrompt: 'custom',
    chatModelId: 'model',
    chatModels: [],
    chatOptions: { includeCurrentFileContent: true },
    ragOptions: { thresholdTokens: 1000 },
  } as unknown as SmartComposerSettings
  const generator = new PromptGenerator(async () => ragEngine, app, settings)

  let count = 0
  const userMessage = (text: string, path = 'note.md'): ChatUserMessage => ({
    role: 'user',
    content: {
      root: { children: [{ type: 'text', text }] },
    } as unknown as ChatUserMessage['content'],
    promptContent: null,
    id: `user-${++count}`,
    mentionables: [{ type: 'current-file', file: { path } as TFile }],
  })
  // Mirrors the submit path in Chat.tsx
  const submit = async (
    history: ChatMessage[],
    text: string,
    { useVaultSearch = false, path = 'note.md' } = {},
  ): Promise<ChatMessage[]> => {
    const message = userMessage(text, path)
    const { promptContent, similaritySearchResults } =
      await generator.compileUserMessagePrompt({ message, useVaultSearch })
    const currentFile = await generator.captureCurrentFile({
      message,
      previousMessages: history,
    })
    return [
      ...history,
      { ...message, promptContent, similaritySearchResults, currentFile },
    ]
  }
  const reply = (history: ChatMessage[]): ChatMessage[] => [
    ...history,
    { role: 'assistant', content: 'answer', id: `assistant-${++count}` },
  ]
  const request = async (messages: ChatMessage[]) =>
    (await generator.generateRequestMessages({ messages, model: MODEL }))
      .requestMessages

  return { generator, files, cachedRead, userMessage, submit, reply, request }
}

function expectPrefix(first: RequestMessage[], second: RequestMessage[]) {
  expect(second.length).toBeGreaterThan(first.length)
  expect(JSON.stringify(second.slice(0, first.length))).toBe(
    JSON.stringify(first),
  )
}

const text = (message?: RequestMessage) => JSON.stringify(message?.content)
const countBlocks = (request: RequestMessage[]) =>
  JSON.stringify(request).split(FILE_HEADER).length - 1

it('keeps the prefix across tool loop iterations even if the note changes', async () => {
  const { files, submit, request } = setup()
  let messages = await submit([], 'search', { useVaultSearch: true })
  const first = await request(messages)
  expect(text(first.at(-1))).toContain(FILE_HEADER)
  expect(text(first.at(-1))).toContain('startLine and endLine')

  files['note.md'] = 'edited by tool'
  messages = [
    ...messages,
    {
      role: 'assistant',
      content: '',
      id: 'assistant',
      toolCallRequests: [{ id: 'call', name: 'tool' }],
    },
    {
      role: 'tool',
      id: 'tool',
      toolCalls: [
        {
          request: { id: 'call', name: 'tool' },
          response: {
            status: ToolCallResponseStatus.Success,
            data: { type: 'text', text: 'done' },
          },
        },
      ],
    },
  ]
  expectPrefix(first, await request(messages))
})

it('keeps the prefix and a single block when the note is unchanged', async () => {
  const { submit, reply, request } = setup()
  let messages = await submit([], 'first')
  const first = await request(messages)
  messages = await submit(reply(messages), 'second')
  const second = await request(messages)
  expectPrefix(first, second)
  expect(text(second.at(-1))).not.toContain(FILE_HEADER)
  expect(countBlocks(second)).toBe(1)
})

it('moves the block to the newest message when the note changes', async () => {
  const { files, submit, reply, request } = setup()
  let messages = await submit([], 'first')
  const first = await request(messages)
  const captured = first.length - 1

  files['note.md'] = 'v2'
  messages = await submit(reply(messages), 'second')
  const second = await request(messages)
  expect(second.slice(0, captured)).toStrictEqual(first.slice(0, captured))
  expect(text(second[captured])).not.toContain(FILE_HEADER)
  expect(text(second.at(-1))).toContain('v2')
  expect(countBlocks(second)).toBe(1)

  messages = await submit(reply(messages), 'third', { path: 'other.md' })
  const third = await request(messages)
  expect(text(third.at(-1))).toContain('other.md')
  expect(countBlocks(third)).toBe(1)
})

it('keeps the prefix across alternating RAG and non-RAG turns', async () => {
  const { submit, reply, request } = setup()
  let messages = await submit([], 'rag', { useVaultSearch: true })
  let previous = await request(messages)
  for (const useVaultSearch of [false, true, false]) {
    messages = await submit(reply(messages), 'next', { useVaultSearch })
    const next = await request(messages)
    expectPrefix(previous, next)
    previous = next
  }
})

it('captures once on the next turn of a conversation without a capture', async () => {
  const { userMessage, submit, reply, request } = setup()
  let messages: ChatMessage[] = [
    { ...userMessage('old'), promptContent: 'old prompt' },
  ]
  const first = await request(messages)
  messages = await submit(reply(messages), 'new')
  const second = await request(messages)
  expectPrefix(first, second)
  expect(text(second.at(-1))).toContain(FILE_HEADER)
  messages = await submit(reply(messages), 'again')
  expectPrefix(second, await request(messages))
})

it('re-captures when a resubmitted message drops the live capture', async () => {
  const { files, submit, reply, request } = setup()
  let messages = await submit([], 'first')
  files['note.md'] = 'v2'
  messages = await submit(reply(messages), 'second')
  // Editing the second message drops it and everything after it
  messages = await submit(messages.slice(0, 2), 'edited')
  const edited = await request(messages)
  expect(text(edited.at(-1))).toContain('v2')
  expect(countBlocks(edited)).toBe(1)
})

it('does not read the note in the fallback compilation', async () => {
  const { cachedRead, userMessage, request } = setup()
  const result = await request([userMessage('uncompiled')])
  expect(cachedRead).not.toHaveBeenCalled()
  expect(countBlocks(result)).toBe(0)
})

describe('dropping old turns to fit the context window', () => {
  const SIZE = 10_000
  const user = (id: string, extra?: Partial<ChatUserMessage>): ChatMessage => ({
    role: 'user',
    content: null,
    promptContent: `${id}:`.padEnd(SIZE, 'x'),
    id,
    mentionables: [],
    ...extra,
  })
  const assistant = (
    id: string,
    extra?: Partial<ChatAssistantMessage>,
  ): ChatMessage => ({
    role: 'assistant',
    content: `${id}:`.padEnd(SIZE, 'x'),
    id,
    ...extra,
  })
  const usage = (promptTokens: number) => ({
    metadata: {
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: 1000,
        total_tokens: promptTokens + 1000,
      },
    },
  })
  // Four finished turns; a4 was produced by a request of 250k input tokens
  const history = (extra?: Partial<ChatAssistantMessage>) => [
    user('u1'),
    assistant('a1'),
    user('u2'),
    assistant('a2'),
    user('u3'),
    assistant('a3'),
    user('u4'),
    assistant('a4', { ...usage(250_000), ...extra }),
    user('u5'),
  ]
  const chars = (request: RequestMessage[]) =>
    request.reduce((sum, m) => sum + JSON.stringify(m.content).length - 2, 0)
  const build = async (
    messages: ChatMessage[],
    model: { providerType: string; model: string } = MODEL,
  ) => {
    const { generator } = setup()
    const generate = (history: ChatMessage[]) =>
      generator.generateRequestMessages({
        messages: history,
        model: model as typeof MODEL,
      })
    // Record the size of the request that produced each reply with usage
    const recorded: ChatMessage[] = []
    for (const [index, message] of messages.entries()) {
      if (message.role !== 'assistant' || !message.metadata?.usage) {
        recorded.push(message)
        continue
      }
      const from = messages.findIndex((m) => m.id === message.requestStartId)
      recorded.push({
        ...message,
        requestChars: (await generate(messages.slice(Math.max(from, 0), index)))
          .requestChars,
      })
    }
    return generate(recorded)
  }
  const firstHistoryMessage = (request: RequestMessage[]) =>
    String(request[2].content).slice(0, 3)

  it('drops nothing before any usage is known', async () => {
    const messages = history({ metadata: undefined })
    const { requestMessages, requestStartId } = await build(messages)
    expect(requestMessages).toHaveLength(2 + messages.length)
    expect(requestStartId).toBeUndefined()
  })

  it('sends the same request while under the limit', async () => {
    const without = await build(history({ metadata: undefined }))
    const under = await build(history(usage(100_000)))
    expect(under.requestMessages).toStrictEqual(without.requestMessages)
    expect(under.requestStartId).toBeUndefined()
  })

  it('drops the oldest whole turns down to the target', async () => {
    const messages = history()
    const { requestMessages, requestStartId } = await build(messages)
    expect(requestStartId).toBe('u3')
    expect(requestMessages[0].role).toBe('system')
    expect(String(requestMessages[1].content)).toContain('custom')
    expect(requestMessages[2].role).toBe('user')
    expect(firstHistoryMessage(requestMessages)).toBe('u3:')
    expect(String(requestMessages.at(-1)?.content).slice(0, 3)).toBe('u5:')
    expect(requestMessages).toHaveLength(2 + 5)

    // Apportion the reported tokens of a4's request by characters
    const a4Request = (await build(messages.slice(0, 7))).requestMessages
    const estimate = (250_000 * chars(requestMessages)) / chars(a4Request)
    expect(estimate).toBeLessThanOrEqual(272_000 * 0.7)
  })

  it('keeps a recorded cut although newer usage is below the limit', async () => {
    const messages = [
      ...history(),
      assistant('a5', { ...usage(150_000), requestStartId: 'u3' }),
      user('u6'),
    ]
    const { requestMessages, requestStartId } = await build(messages)
    expect(requestStartId).toBe('u3')
    expect(firstHistoryMessage(requestMessages)).toBe('u3:')
  })

  it('only moves the cut forward', async () => {
    const messages = [
      ...history({ requestStartId: 'u2' }),
      assistant('a5', { ...usage(100_000), requestStartId: 'u3' }),
      user('u6'),
      // A later reply that names an older message does not move it back
      assistant('a6', { ...usage(100_000), requestStartId: 'u2' }),
      user('u7'),
    ]
    expect((await build(messages)).requestStartId).toBe('u3')

    // Reaching the limit again advances from the recorded cut
    messages[11] = assistant('a6', { ...usage(240_000), requestStartId: 'u3' })
    const { requestMessages, requestStartId } = await build(messages)
    expect(requestStartId).toBe('u5')
    expect(firstHistoryMessage(requestMessages)).toBe('u5:')
  })

  it('moves the current file block to the first message sent', async () => {
    const messages = history()
    messages[0] = user('u1', {
      currentFile: { path: 'note.md', content: 'note body' },
    })
    const { requestMessages } = await build(messages)
    expect(countBlocks(requestMessages)).toBe(1)
    expect(text(requestMessages[2])).toContain(FILE_HEADER)
    expect(text(requestMessages[2])).toContain('note body')
  })

  it('sizes the request with the capture it was sent with', async () => {
    const note = (content: string) => ({ path: 'note.md', content })
    const messages = [
      user('u1', { currentFile: note('a'.repeat(60 * SIZE)) }),
      assistant('a1', usage(200_000)),
      // The note changed, so the newest message captures it again
      user('u2', { currentFile: note('b'.repeat(60 * SIZE)) }),
    ]
    const { requestMessages, requestStartId } = await build(messages)
    expect(requestStartId).toBeUndefined()
    expect(requestMessages).toHaveLength(2 + messages.length)
    expect(countBlocks(requestMessages)).toBe(1)
  })

  it('ignores usage of replies without a recorded request size', async () => {
    const { generator } = setup()
    const { requestStartId } = await generator.generateRequestMessages({
      messages: history(),
      model: MODEL,
    })
    expect(requestStartId).toBeUndefined()
  })

  describe('after a provider compaction', () => {
    const opus = { providerType: 'anthropic', model: 'claude-opus-5-5' }
    const compacted = {
      providerMetadata: {
        anthropic: {
          compaction: { type: 'compaction' as const, content: 'summary' },
        },
      },
    }
    const note = { currentFile: { path: 'note.md', content: 'note body' } }

    it('sends the custom instructions and the current file after the compacted turn', async () => {
      const messages = [
        user('u1', note),
        assistant('a1'),
        user('u2'),
        assistant('a2', compacted),
        user('u3'),
      ]
      const { requestMessages } = await build(messages, opus)
      expect(requestMessages.map((m) => m.role)).toEqual([
        'system',
        'user',
        'assistant',
        'user',
        'assistant',
        'user',
        'user',
        'user',
      ])
      expect(text(requestMessages[1])).not.toContain(FILE_HEADER)
      expect(text(requestMessages[5])).toContain('custom')
      expect(text(requestMessages[6])).toContain('note body')
      expect(text(requestMessages[7])).toContain('u3:')
      expect(countBlocks(requestMessages)).toBe(1)

      // A compaction of another provider does not move them
      const other = (await build(messages)).requestMessages
      expect(text(other[1])).toContain('custom')
      expect(text(other[2])).toContain('note body')
    })

    it('keeps a tool result next to its call', async () => {
      const messages: ChatMessage[] = [
        user('u1', note),
        assistant('a1', {
          ...compacted,
          toolCallRequests: [{ id: 'call', name: 'tool' }],
        }),
        {
          role: 'tool',
          id: 'tool',
          toolCalls: [
            {
              request: { id: 'call', name: 'tool' },
              response: {
                status: ToolCallResponseStatus.Success,
                data: { type: 'text', text: 'done' },
              },
            },
          ],
        },
      ]
      const { requestMessages } = await build(messages, opus)
      expect(requestMessages.map((m) => m.role)).toEqual([
        'system',
        'user',
        'assistant',
        'tool',
        'user',
        'user',
      ])
      expect(text(requestMessages[4])).toContain('custom')
      expect(text(requestMessages[5])).toContain('note body')
    })

    it('leaves a current file captured after the compaction in its message', async () => {
      const { requestMessages } = await build(
        [user('u1'), assistant('a1', compacted), user('u2', note)],
        opus,
      )
      expect(requestMessages).toHaveLength(5)
      expect(text(requestMessages[3])).toContain('custom')
      expect(text(requestMessages[4])).toContain('note body')
      expect(text(requestMessages[4])).toContain('u2:')
    })
  })

  it('leaves trimming to providers that compact', async () => {
    const messages = history()
    const opus = { providerType: 'anthropic', model: 'claude-opus-5-5' }
    const compacting = await build(messages, opus)
    expect(compacting.requestStartId).toBeUndefined()
    expect(compacting.requestMessages).toHaveLength(2 + messages.length)

    // An existing cut is still honoured
    const cut = await build(
      [...messages, assistant('a5', { requestStartId: 'u3' }), user('u6')],
      opus,
    )
    expect(cut.requestStartId).toBe('u3')
    expect(firstHistoryMessage(cut.requestMessages)).toBe('u3:')
  })

  it('ignores a cut that names a missing or non-user message', async () => {
    for (const requestStartId of ['gone', 'a2']) {
      const result = await build(history({ ...usage(100_000), requestStartId }))
      expect(result.requestStartId).toBeUndefined()
      expect(firstHistoryMessage(result.requestMessages)).toBe('u1:')
    }
  })
})
