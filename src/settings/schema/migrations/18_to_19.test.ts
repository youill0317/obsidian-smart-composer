import { migrateFrom18To19 } from './18_to_19'

it('bumps the version while preserving existing settings', () => {
  const previous = {
    version: 18,
    chatOptions: { maxAutoIterations: 3 },
    providers: [{ id: 'custom' }],
  }
  const next = migrateFrom18To19(previous)
  expect(next).toEqual({ ...previous, version: 19 })
  expect(previous.version).toBe(18)
})
