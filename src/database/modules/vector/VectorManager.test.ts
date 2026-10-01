import { App } from 'obsidian'

import { VectorManager } from './VectorManager'

jest.mock('../../../components/modals/ErrorModal', () => ({
  ErrorModal: jest.fn(),
}))

function setup(indexedPaths: string[]) {
  const files = ['public/a.md', 'private/b.md'].map((path) => ({
    path,
    stat: { mtime: 1 },
  }))
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) =>
        files.find((file) => file.path === path) ?? null,
      cachedRead: jest.fn().mockResolvedValue(''),
    },
  } as unknown as App
  const repository = {
    getIndexedFilePaths: jest.fn().mockResolvedValue(indexedPaths),
    getVectorsByFilePath: jest.fn().mockResolvedValue([{ mtime: 1 }]),
    deleteVectorsForMultipleFiles: jest.fn().mockResolvedValue(undefined),
    clearAllVectors: jest.fn().mockResolvedValue(undefined),
  }
  const manager = new VectorManager(app, null as never)
  Object.assign(manager, { repository })
  const save = jest.fn().mockResolvedValue(undefined)
  manager.setSaveCallback(save)
  return { manager, repository, save }
}

const embeddingModel = { id: 'model' } as never

it('removes indexed vectors that the current include patterns exclude', async () => {
  const { manager, repository } = setup([
    'public/a.md',
    'private/b.md',
    'private/b.md',
    'gone.md',
  ])
  await manager.updateVaultIndex(embeddingModel, {
    chunkSize: 1000,
    excludePatterns: [],
    includePatterns: ['public/**'],
  })
  expect(repository.deleteVectorsForMultipleFiles).toHaveBeenCalledWith(
    ['private/b.md', 'gone.md'],
    embeddingModel,
  )
})

it('persists the cleared index when a rebuild finds nothing to index', async () => {
  const { manager, repository, save } = setup([])
  await manager.updateVaultIndex(embeddingModel, {
    chunkSize: 1000,
    excludePatterns: ['**/*.md'],
    includePatterns: [],
    reindexAll: true,
  })
  expect(repository.clearAllVectors).toHaveBeenCalled()
  expect(save).toHaveBeenCalled()
})
