import { smartComposerSettingsSchema } from '../../settings/schema/setting.types'
import { McpServerState, McpServerStatus } from '../../types/mcp.types'
import { ToolCallResponseStatus as Status } from '../../types/tool-call.types'

import './tool-name-utils'
import { McpManager } from './mcpManager'

jest.mock('obsidian', () => ({ Platform: { isDesktop: true } }))

it('rechecks global and per-tool settings before MCP execution', async () => {
  const settings = smartComposerSettingsSchema.parse({})
  settings.mcp.servers = [
    {
      id: 'server',
      enabled: true,
      parameters: { command: 'server' },
      toolOptions: {
        tool: { allowAutoExecution: true, disabled: false },
      },
    },
  ]
  const client = {
    listTools: jest.fn().mockResolvedValue({ tools: [{ name: 'tool' }] }),
    callTool: jest.fn(),
    close: jest.fn(),
  }
  const manager = new McpManager({
    settings,
    registerSettingsListener: () => () => {},
  })
  ;(manager as unknown as { servers: McpServerState[] }).servers = [
    {
      name: 'server',
      config: settings.mcp.servers[0],
      status: McpServerStatus.Connected,
      client: client as unknown as Extract<
        McpServerState,
        { status: McpServerStatus.Connected }
      >['client'],
      tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
    },
  ]

  manager.allowToolForConversation('server__tool', 'chat')
  expect(
    manager.isToolExecutionAllowed({
      requestToolName: 'server__tool',
      conversationId: 'chat',
    }),
  ).toBe(true)

  settings.chatOptions.enableTools = false
  expect(
    manager.isToolExecutionAllowed({
      requestToolName: 'server__tool',
      conversationId: 'chat',
    }),
  ).toBe(false)
  expect((await manager.callTool({ name: 'server__tool' })).status).toBe(
    Status.Error,
  )

  settings.chatOptions.enableTools = true
  settings.mcp.servers[0].toolOptions.tool.disabled = true
  expect((await manager.callTool({ name: 'server__tool' })).status).toBe(
    Status.Error,
  )
  expect(client.callTool).not.toHaveBeenCalled()
})
