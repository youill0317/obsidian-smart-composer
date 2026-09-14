import { ToolManager } from '../../core/tools/toolManager'
import { ChatMessage } from '../../types/chat'
import { ToolCallResponseStatus as Status } from '../../types/tool-call.types'

import { ResponseGenerator, ResponseGeneratorParams } from './responseGenerator'

const tool = (name: string) => ({
  name,
  description: name,
  inputSchema: { type: 'object' as const },
})

function setup(
  toolName = 'sc_cli_execute',
  cliAutoIterationBudget: { remaining: number } | undefined = {
    remaining: 10,
  },
) {
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
                  name: toolName,
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
    listAvailableTools: jest.fn().mockResolvedValue([tool(toolName)]),
    prepareCall: jest.fn().mockImplementation((request, _conversation, names) =>
      Promise.resolve({
        status: names.has(request.name) ? Status.Running : Status.Error,
        error: names.has(request.name) ? undefined : 'not available',
      }),
    ),
    callTool: jest.fn().mockResolvedValue({
      status: Status.Success,
      data: { type: 'text', text: '{}' },
    }),
  }
  const params: ResponseGeneratorParams = {
    providerClient: {
      streamResponse,
    } as unknown as ResponseGeneratorParams['providerClient'],
    model: {} as ResponseGeneratorParams['model'],
    messages: [],
    conversationId: 'conversation',
    enableTools: true,
    maxAutoIterations: 1,
    cliAutoIterationBudget,
    promptGenerator: {
      generateRequestMessages: async () => [],
    } as unknown as ResponseGeneratorParams['promptGenerator'],
    toolManager: manager as unknown as ToolManager,
  }
  return { streamResponse, manager, params }
}

it('does not reset a shared iteration budget when resuming after approval', async () => {
  const budget = { remaining: 10 }
  const setupResult = setup('sc_cli_execute', budget)
  setupResult.manager.prepareCall.mockResolvedValueOnce({
    status: Status.PendingApproval,
  })
  const first = new ResponseGenerator(setupResult.params)
  let messages: ChatMessage[] = []
  first.subscribe((value) => {
    messages = value
  })
  await first.run()
  expect(budget.remaining).toBe(9)
  expect(setupResult.manager.callTool).not.toHaveBeenCalled()
  expect(messages.at(-1)?.role).toBe('tool')
  const resumed = new ResponseGenerator({ ...setupResult.params, messages })
  await resumed.run()
  expect(setupResult.streamResponse).toHaveBeenCalledTimes(10)
  expect(resumed.reachedLimit).toBe(true)
  expect(budget.remaining).toBe(0)
})

it('retains MCP-only iteration limits and stops without tools or after cancellation', async () => {
  const { params, streamResponse, manager } = setup('server__tool', undefined)
  await new ResponseGenerator({ ...params, maxAutoIterations: 1 }).run()
  expect(streamResponse).toHaveBeenCalledTimes(1)
  streamResponse.mockImplementation(async function* () {
    yield { choices: [{ delta: { content: 'done' } }] }
  })
  const done = new ResponseGenerator(params)
  await done.run()
  expect(done.reachedLimit).toBe(false)
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

it('keeps CLI and MCP limits independent in mixed tool rounds', async () => {
  const { params, streamResponse, manager } = setup('server__tool', {
    remaining: 3,
  })
  manager.listAvailableTools.mockResolvedValue([
    tool('server__tool'),
    tool('sc_cli_execute'),
  ])
  const requestedTools = ['server__tool', 'sc_cli_execute', 'server__tool']
  streamResponse.mockImplementation(async function* () {
    const name = requestedTools.shift() ?? 'unexpected'
    yield {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `id-${name}`,
                function: { name, arguments: '{}' },
              },
            ],
          },
        },
      ],
    }
  })
  const generator = new ResponseGenerator(params)
  let messages: ChatMessage[] = []
  generator.subscribe((value) => {
    messages = value
  })

  await generator.run()

  expect(manager.callTool).toHaveBeenCalledTimes(2)
  expect(params.cliAutoIterationBudget?.remaining).toBe(2)
  expect(generator.reachedLimit).toBe(true)
  const lastMessage = messages.at(-1)
  expect(lastMessage?.role).toBe('tool')
  if (lastMessage?.role !== 'tool') throw new Error('Expected tool message')
  expect(lastMessage.toolCalls[0].response.status).toBe(Status.Error)
  const lastAdvertisedTools = streamResponse.mock.calls[2][1].tools.map(
    (entry: { function: { name: string } }) => entry.function.name,
  )
  expect(lastAdvertisedTools).toEqual(['sc_cli_execute'])
})

it('records an explicit error for a tool call received while tools are off', async () => {
  const { params, manager } = setup()
  const generator = new ResponseGenerator({ ...params, enableTools: false })
  let messages: ChatMessage[] = []
  generator.subscribe((value) => {
    messages = value
  })

  await generator.run()

  expect(manager.listAvailableTools).not.toHaveBeenCalled()
  expect(manager.callTool).not.toHaveBeenCalled()
  const lastMessage = messages.at(-1)
  expect(lastMessage?.role).toBe('tool')
  if (lastMessage?.role !== 'tool') throw new Error('Expected tool message')
  expect(lastMessage.toolCalls[0].response.status).toBe(Status.Error)
})
