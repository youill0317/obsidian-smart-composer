import { App } from 'obsidian'

import { DatabaseManager } from './DatabaseManager'

jest.mock('../components/modals/ErrorModal', () => ({
  ErrorModal: jest.fn(() => ({ open: jest.fn() })),
}))

describe('DatabaseManager lifecycle', () => {
  it('serializes saves and closes only after the final saved snapshot', async () => {
    let activeDumps = 0
    let maxActiveDumps = 0
    const pgClient = {
      dumpDataDir: jest.fn(async () => {
        activeDumps += 1
        maxActiveDumps = Math.max(maxActiveDumps, activeDumps)
        await Promise.resolve()
        activeDumps -= 1
        return new Blob(['database'])
      }),
      close: jest.fn(async () => undefined),
    }
    const writeBinary = jest.fn(async () => undefined)
    const app = { vault: { adapter: { writeBinary } } } as unknown as App
    const manager = new DatabaseManager(app, 'database.gz')
    Object.assign(manager, { pgClient })

    const firstSave = manager.save()
    const secondSave = manager.save()
    await Promise.all([firstSave, secondSave, manager.cleanup()])

    expect(maxActiveDumps).toBe(1)
    expect(pgClient.dumpDataDir).toHaveBeenCalledTimes(3)
    expect(writeBinary).toHaveBeenCalledTimes(3)
    expect(pgClient.close).toHaveBeenCalledTimes(1)
  })
})
