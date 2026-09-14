import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import { App, FileSystemAdapter } from 'obsidian'

import { smartComposerSettingsSchema } from '../../settings/schema/setting.types'
import { CLI_TOOL_NAME, CliExecution } from '../../types/cli.types'
import { ToolCallResponseStatus as Status } from '../../types/tool-call.types'
// Match the chat UI's load order for the existing MCP/helper dependency.
import '../mcp/tool-name-utils'
import { McpManager } from '../mcp/mcpManager'
import { ToolManager } from '../tools/toolManager'

import { CliManager } from './cliManager'
import { runCli } from './runner'

jest.mock('obsidian', () => ({
  Platform: { isDesktop: true, isWin: true },
  FileSystemAdapter: class {
    constructor(private base: string) {}
    getBasePath() {
      return this.base
    }
  },
}))
jest.mock('./runner', () => ({ runCli: jest.fn() }))
const run = jest.mocked(runCli)
const preview: CliExecution = {
  cliId: 'x',
  name: 'X',
  command: 'C:\\x.exe',
  args: ['write'],
  cwd: 'C:\\vault',
  timeoutSeconds: 60,
  automatic: false,
  configuration: 'one',
}
const ok = {
  stdout: '',
  stderr: '',
  exitCode: 0,
  signal: null,
  truncated: false,
}

beforeEach(() => run.mockReset())

it('requires exact approval, reapproves changed settings and rejects duplicate execution', async () => {
  const manager = new CliManager({} as App, () =>
    smartComposerSettingsSchema.parse({}),
  )
  const prepare = jest.spyOn(manager, 'prepare').mockResolvedValue(preview)
  run.mockResolvedValue(ok)
  expect((await manager.execute('one', {})).status).toBe(Status.PendingApproval)
  expect(run).not.toHaveBeenCalled()
  expect(
    (await manager.execute('one', {}, { ...preview, configuration: 'old' }))
      .status,
  ).toBe(Status.PendingApproval)
  const a = manager.execute('one', {}, preview)
  const b = manager.execute('one', {}, preview)
  expect(a).toBe(b)
  expect((await a).status).toBe(Status.Success)
  await manager.execute('one', {}, preview)
  expect(run).toHaveBeenCalledTimes(1)
  prepare.mockRejectedValue(new Error('disabled'))
  expect((await manager.execute('two', {}, preview)).status).toBe(Status.Error)
  expect(run).toHaveBeenCalledTimes(1)
})

it('serializes CLI work and cancels queued calls without starting them', async () => {
  const manager = new CliManager({} as App, () =>
    smartComposerSettingsSchema.parse({}),
  )
  jest
    .spyOn(manager, 'prepare')
    .mockResolvedValue({ ...preview, automatic: true })
  let finish!: (value: typeof ok) => void
  run.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const first = manager.execute('first', {})
  const second = manager.execute('second', {})
  await new Promise((resolve) => setImmediate(resolve))
  expect(run).toHaveBeenCalledTimes(1)
  manager.abortToolCall('second')
  finish(ok)
  await first
  expect((await second).status).toBe(Status.Aborted)
  expect(run).toHaveBeenCalledTimes(1)
})

it('routes CLI even when MCP initialization fails', async () => {
  const settings = smartComposerSettingsSchema.parse({})
  settings.cli.connections[0].enabled = true
  const cli = new CliManager({} as App, () => settings)
  jest.spyOn(cli, 'prepare').mockResolvedValue(preview)
  const tools = new ToolManager(cli, async () => {
    throw new Error('MCP unavailable')
  })
  expect((await tools.listAvailableTools())[0].name).toBe(CLI_TOOL_NAME)
  const response = await tools.prepareCall(
    { id: 'call', name: CLI_TOOL_NAME, arguments: '{}' },
    'chat',
  )
  expect(response.status).toBe(Status.PendingApproval)
  const mcp = {
    listAvailableTools: jest.fn().mockResolvedValue([{ name: 'server__tool' }]),
    callTool: jest.fn().mockResolvedValue({ status: Status.Success }),
    isToolExecutionAllowed: jest.fn().mockReturnValue(true),
  }
  const mixed = new ToolManager(cli, async () => mcp as unknown as McpManager)
  expect(await mixed.listAvailableTools()).toHaveLength(2)
  await mixed.callTool({ name: 'server__tool', id: 'mcp', args: '{}' })
  expect(mcp.callTool).toHaveBeenCalledTimes(1)
})

it('validates real execution previews before asking for approval', async () => {
  const cache = join(process.cwd(), 'node_modules', '.cache')
  mkdirSync(cache, { recursive: true })
  const directory = mkdtempSync(join(cache, 'cli-prepare-'))
  try {
    const command = join(directory, 'Obsidian.com')
    writeFileSync(command, '')
    const settings = smartComposerSettingsSchema.parse({})
    settings.cli.connections[0] = {
      ...settings.cli.connections[0],
      command,
      enabled: true,
    }
    const adapter = new FileSystemAdapter()
    jest.spyOn(adapter, 'getBasePath').mockReturnValue(directory)
    const app = { vault: { adapter } } as unknown as App
    const manager = new CliManager(app, () => settings)
    const prepared = await manager.prepare({
      cliId: 'obsidian',
      args: ['read', 'path=한글 note.md'],
    })
    expect(prepared).toMatchObject({ command, cwd: directory, automatic: true })
    for (const args of [
      [],
      ['read'],
      ['delete'],
      ['task', 'line=3', 'done'],
      ['task', 'ref=note.md:0', 'done'],
      ['sync:restore', 'version=1'],
      ['publish:add'],
      ['publish:remove'],
      ['template:insert', 'name=Example'],
      ['read', 'vault=Other', 'path=x'],
      ['vault:open', 'name=Other'],
    ]) {
      await expect(
        manager.prepare({ cliId: 'obsidian', args }),
      ).rejects.toThrow()
    }
    for (const args of [
      ['task', 'path=note.md', 'line=3', 'done'],
      ['task', 'ref=note.md:3', 'done'],
      ['task', 'daily', 'line=3', 'done'],
      ['sync:restore', 'path=note.md', 'version=1'],
      ['publish:add', 'path=note.md'],
      ['publish:add', 'changed'],
      ['publish:remove', 'path=note.md'],
    ]) {
      expect(
        (await manager.prepare({ cliId: 'obsidian', args })).automatic,
      ).toBe(false)
    }
    const invalid = await new ToolManager(manager, async () => {
      throw Error('unused')
    }).prepareCall(
      { id: 'invalid', name: CLI_TOOL_NAME, arguments: '{' },
      'chat',
    )
    expect(invalid.status).toBe(Status.Error)
    settings.cli.connections[0].enabled = false
    await expect(
      manager.prepare({ cliId: 'obsidian', args: ['version'] }),
    ).rejects.toThrow('disabled')
    expect(
      (await manager.prepare({ cliId: 'obsidian', args: ['version'] }, true))
        .automatic,
    ).toBe(true)
    const batch = join(directory, 'tool.cmd')
    writeFileSync(batch, '')
    settings.cli.connections[0] = {
      ...settings.cli.connections[0],
      preset: 'custom',
      command: batch,
      enabled: true,
    }
    await expect(
      manager.prepare({ cliId: 'obsidian', args: ['line\nbreak'] }),
    ).rejects.toThrow('line breaks')
    expect(
      (await manager.prepare({ cliId: 'obsidian', args: [] })).automatic,
    ).toBe(false)
    const request = { cliId: 'obsidian', args: ['plain'] }
    const direct = await manager.prepare(request)
    expect(direct.batchArgumentMode).toBe('direct')
    settings.cli.connections[0].batchArgumentMode = 'forwarded'
    const changed = await manager.execute('changed-mode', request, direct)
    expect(changed.status).toBe(Status.PendingApproval)
    expect(run).not.toHaveBeenCalled()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('honors cancellation before and during MCP initialization', async () => {
  const cli = new CliManager({} as App, () =>
    smartComposerSettingsSchema.parse({}),
  )
  const mcp = new McpManager({
    settings: smartComposerSettingsSchema.parse({}),
    registerSettingsListener: () => () => {},
  })
  const controller = new AbortController()
  controller.abort()
  expect(
    await mcp.callTool({ name: 'server__write', signal: controller.signal }),
  ).toEqual({ status: Status.Aborted })
  const call = jest.spyOn(mcp, 'callTool')
  let ready!: (manager: McpManager) => void
  const initialization = new Promise<McpManager>((resolve) => {
    ready = resolve
  })
  const tools = new ToolManager(cli, () => initialization)
  const pendingController = new AbortController()
  const pending = tools.callTool({
    name: 'server__write',
    id: 'pending',
    signal: pendingController.signal,
  })
  pendingController.abort()
  ready(mcp)
  expect(await pending).toEqual({ status: Status.Aborted })
  expect(call).not.toHaveBeenCalled()
})
