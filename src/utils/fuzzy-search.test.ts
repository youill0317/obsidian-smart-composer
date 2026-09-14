import { App, TFile } from 'obsidian'

import { fuzzySearch } from './fuzzy-search'

jest.mock('obsidian', () => ({}), { virtual: true })
// Match esbuild's default-import interop while exercising the real dependency.
jest.mock('fuzzysort', () => ({
  __esModule: true,
  default: jest.requireActual('fuzzysort'),
}))

describe('mention lookup with partially matching keys', () => {
  const file = {
    path: 'invoices/notes.md',
    name: 'notes.md',
    extension: 'md',
    stat: { mtime: Date.now() },
  } as TFile
  const app = {
    workspace: { getActiveFile: () => null, getLeavesOfType: () => [] },
    vault: { getFiles: () => [file], getAllFolders: () => [] },
  } as unknown as App

  it('finds the vault item without a name key', () => {
    expect(fuzzySearch(app, 'vault')).toContainEqual({ type: 'vault' })
  })

  it('finds a file when only its folder path matches', () => {
    expect(fuzzySearch(app, 'invoices')).toContainEqual({ type: 'file', file })
  })
})
