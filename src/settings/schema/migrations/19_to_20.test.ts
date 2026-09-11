import { DEFAULT_OBSIDIAN_CLI } from '../../../types/cli.types'

import { migrateFrom19To20 } from './19_to_20'

it('adds disabled CLI defaults while preserving existing settings', () => {
  const previous = {
    version: 19,
    chatOptions: { maxAutoIterations: 3 },
    mcp: { servers: [{ id: 'existing' }] },
    providers: [{ id: 'custom' }],
  }
  const next = migrateFrom19To20(previous)
  expect(next).toEqual({
    ...previous,
    version: 20,
    cli: { connections: [DEFAULT_OBSIDIAN_CLI], maxAutoIterations: 10 },
  })
  expect(previous.version).toBe(19)
  expect(migrateFrom19To20(next)).toEqual(next)
})
