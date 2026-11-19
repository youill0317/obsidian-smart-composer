import { ToolManager } from '../../core/tools/toolManager'
import { ChatMessage } from '../../types/chat'
import { ToolCallResponseStatus as Status } from '../../types/tool-call.types'

import { ResponseGenerator, ResponseGeneratorParams } from './responseGenerator'

function setup() {
  const streamResponse = jest.fn().mockImplementation(async function* () {
    yield {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'id',
                function: {
                  name: 'sc_cli_execute',
                  arguments: '{"cliId":"obsidian","args":["help"]}',
                },
              },
            ],
          },
        },
      ],
    }
  })
  const manager = {
    listAvailableTools: jest.fn().mockResolvedValue([
      { name: 'sc_cli_execute', inputSchema: {} },
      { name: 'srv__tool', inputSchema: {} },
    ]),
    prepareCall: jest.fn().mockResolvedValue({ status: Status.Running }),
    callTool: jest.fn().mockResolvedValue({
      status: Status.Success,
      data: { type: 'text', text: '{}' },
    }),
  }
  const params: ResponseGeneratorParams = {
    providerClient: {
      streamResponse,
      getContextWindow: async () => undefined,
    } as unknown as ResponseGeneratorParams['providerClient'],
    model: {} as ResponseGeneratorParams['model'],
    messages: [],
    conversationId: 'conversation',
    enableTools: true,
    maxAutoIterations: 10,
    promptGenerator: {
      generateRequestMessages: async () => ({ requestMessages: [] }),
    } as unknown as ResponseGeneratorParams['promptGenerator'],
    toolManager: manager as unknown as ToolManager,
  }
  return { streamResponse, manager, params }
}

it('stops at the iteration limit, without tools or after cancellation', async () => {
  const { params, streamResponse, manager } = setup()
  await new ResponseGenerator({ ...params, maxAutoIterations: 1 }).run()
  expect(streamResponse).toHaveBeenCalledTimes(1)
  streamResponse.mockImplementation(async function* () {
    yield { choices: [{ delta: { content: 'done' } }] }
  })
  await new ResponseGenerator(params).run()
  const controller = new AbortController()
  controller.abort()
  await new ResponseGenerator({
    ...params,
    abortSignal: controller.signal,
  }).run()
  expect(streamResponse).toHaveBeenCalledTimes(2)
  expect(manager.callTool).toHaveBeenCalledTimes(1)
})

it('does not dispatch tools when stopped during asynchronous preparation', async () => {
  const { params, manager } = setup()
  let ready!: (response: { status: Status }) => void
  let started!: () => void
  const preparing = new Promise<void>((resolve) => {
    started = resolve
  })
  manager.prepareCall.mockImplementationOnce(() => {
    started()
    return new Promise((resolve) => {
      ready = resolve
    })
  })
  const controller = new AbortController()
  const generator = new ResponseGenerator({
    ...params,
    abortSignal: controller.signal,
  })
  let messages: ChatMessage[] = []
  generator.subscribe((value) => {
    messages = value
  })
  const running = generator.run()
  await preparing
  controller.abort()
  ready({ status: Status.Running })
  await running
  expect(manager.callTool).not.toHaveBeenCalled()
  expect(manager.prepareCall).toHaveBeenCalledTimes(1)
  const result = messages.at(-1)
  expect(result?.role === 'tool' && result.toolCalls[0].response.status).toBe(
    Status.Aborted,
  )
})

it('does not run tool calls for tools that were not offered', async () => {
  const { params, manager } = setup()
  const generator = new ResponseGenerator({ ...params, enableTools: false })
  let messages: ChatMessage[] = []
  generator.subscribe((value) => {
    messages = value
  })
  await generator.run()
  expect(manager.prepareCall).not.toHaveBeenCalled()
  expect(manager.callTool).not.toHaveBeenCalled()
  const result = messages.at(-1)
  expect(result?.role === 'tool' && result.toolCalls[0].response.status).toBe(
    Status.Error,
  )
})

it('keeps the first provider entry and the latest compaction from a stream', async () => {
  const { params, streamResponse } = setup()
  const compaction = (content: string) => ({
    anthropic: { compaction: { type: 'compaction' as const, content } },
  })
  streamResponse.mockImplementation(async function* () {
    for (const providerMetadata of [
      { gemini: { thoughtSignature: 'first' } },
      compaction('S1'),
      { gemini: { thoughtSignature: 'second' } },
      compaction('S2'),
    ]) {
      yield { choices: [{ delta: { content: 'x', providerMetadata } }] }
    }
  })
  const generator = new ResponseGenerator(params)
  let messages: ChatMessage[] = []
  generator.subscribe((value) => {
    messages = value
  })
  await generator.run()
  const assistant = messages.find((message) => message.role === 'assistant')
  expect(assistant?.role === 'assistant' && assistant.providerMetadata).toEqual(
    {
      gemini: { thoughtSignature: 'first' },
      ...compaction('S2'),
    },
  )
})

it('trims with the context window entered for the model', async () => {
  const { params, streamResponse } = setup()
  streamResponse.mockImplementation(async function* () {
    yield { choices: [{ delta: { content: 'done' } }] }
  })
  const generateRequestMessages = jest
    .fn()
    .mockResolvedValue({ requestMessages: [] })
  await new ResponseGenerator({
    ...params,
    model: {
      providerType: 'ollama',
      providerId: 'ollama',
      id: 'local',
      model: 'local',
      contextWindow: 32_768,
    },
    promptGenerator: {
      generateRequestMessages,
    } as unknown as ResponseGeneratorParams['promptGenerator'],
  }).run()
  expect(generateRequestMessages.mock.calls[0][0].contextWindow).toBe(32_768)
})
