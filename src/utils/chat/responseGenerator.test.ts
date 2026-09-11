import { ToolManager } from '../../core/tools/toolManager'
import { ChatMessage } from '../../types/chat'
import { ToolCallResponseStatus as Status } from '../../types/tool-call.types'

import { ResponseGenerator, ResponseGeneratorParams } from './responseGenerator'

function setup(consumeIteration?: () => boolean) {
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
    listAvailableTools: jest.fn().mockResolvedValue([]),
    prepareCall: jest.fn().mockResolvedValue({ status: Status.Running }),
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
    maxAutoIterations: 10,
    consumeIteration,
    promptGenerator: {
      generateRequestMessages: async () => [],
    } as unknown as ResponseGeneratorParams['promptGenerator'],
    toolManager: manager as unknown as ToolManager,
  }
  return { streamResponse, manager, params }
}

it('does not reset a shared iteration budget when resuming after approval', async () => {
  let remaining = 10
  const setupResult = setup(() => remaining > 0 && remaining-- > 0)
  setupResult.manager.prepareCall.mockResolvedValueOnce({
    status: Status.PendingApproval,
  })
  const first = new ResponseGenerator(setupResult.params)
  let messages: ChatMessage[] = []
  first.subscribe((value) => {
    messages = value
  })
  await first.run()
  expect(remaining).toBe(9)
  expect(setupResult.manager.callTool).not.toHaveBeenCalled()
  expect(messages.at(-1)?.role).toBe('tool')
  const resumed = new ResponseGenerator({ ...setupResult.params, messages })
  await resumed.run()
  expect(setupResult.streamResponse).toHaveBeenCalledTimes(10)
  expect(resumed.reachedLimit).toBe(true)
  expect(remaining).toBe(0)
})

it('retains MCP-only iteration limits and stops without tools or after cancellation', async () => {
  const { params, streamResponse, manager } = setup()
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
