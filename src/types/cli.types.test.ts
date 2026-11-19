import { SETTINGS_SCHEMA_VERSION } from '../settings/schema/migrations'
import { parseSmartComposerSettings } from '../settings/schema/settings'

import { DEFAULT_OBSIDIAN_CLI, cliSettingsSchema } from './cli.types'

const conn = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Name ${id}`,
  preset: 'custom',
  command: `cmd-${id}`,
  args: ['--x'],
  batchArgumentMode: 'direct',
  cwd: '/tmp',
  instructions: `use ${id}`,
  enabled: true,
  timeoutSeconds: 30,
  ...extra,
})

describe('cliSettingsSchema', () => {
  it('keeps all valid connections unchanged', () => {
    const connections = [conn('a'), conn('b'), conn('c')]
    expect(cliSettingsSchema.parse({ connections })).toEqual({ connections })
  })

  it('keeps an invalid connection disabled with the bad field defaulted', () => {
    const result = cliSettingsSchema.parse({
      connections: [
        conn('a'),
        conn('b', { timeoutSeconds: 999, preset: 'future' }),
        conn('c'),
      ],
    })
    expect(result.connections).toEqual([
      conn('a'),
      conn('b', { timeoutSeconds: 60, preset: 'custom', enabled: false }),
      conn('c'),
    ])
  })

  it('defaults missing optional fields of a broken connection', () => {
    const { args: _args, ...rest } = conn('b', { cwd: 5 })
    const result = cliSettingsSchema.parse({ connections: [rest] })
    expect(result.connections).toEqual([
      conn('b', { args: [], cwd: '', enabled: false }),
    ])
  })

  it('drops only unsalvageable elements', () => {
    const { command: _command, ...noCommand } = conn('x')
    const result = cliSettingsSchema.parse({
      connections: [
        conn('a'),
        noCommand,
        'oops',
        null,
        conn('bad id!'),
        conn('b'),
      ],
    })
    expect(result.connections).toEqual([conn('a'), conn('b')])
  })

  it('uses the default list when connections is missing', () => {
    expect(cliSettingsSchema.parse({})).toEqual({
      connections: [DEFAULT_OBSIDIAN_CLI],
    })
  })

  it.each([undefined, null, 'x', ['a']])(
    'falls back entirely for non-object cli %p',
    (cli) => {
      expect(cliSettingsSchema.parse(cli)).toEqual({
        connections: [DEFAULT_OBSIDIAN_CLI],
      })
    },
  )

  it('is idempotent', () => {
    const once = cliSettingsSchema.parse({
      connections: [conn('a'), conn('b', { timeoutSeconds: 999 })],
    })
    expect(cliSettingsSchema.parse(once)).toEqual(once)
  })

  it('preserves other settings and connections via parseSmartComposerSettings', () => {
    const result = parseSmartComposerSettings({
      version: SETTINGS_SCHEMA_VERSION,
      systemPrompt: 'keep me',
      cli: {
        connections: [conn('a'), conn('b', { timeoutSeconds: 999 })],
      },
    })
    expect(result.systemPrompt).toBe('keep me')
    expect(result.cli.connections).toEqual([
      conn('a'),
      conn('b', { timeoutSeconds: 60, enabled: false }),
    ])
  })
})
