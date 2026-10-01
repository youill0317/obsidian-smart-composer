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
  const cachedRead = jest.fn().mockResolvedValue('')
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) =>
        files.find((file) => file.path === path) ?? null,
      cachedRead,
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
  return { manager, repository, save, cachedRead }
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

it('only indexes files inside the query scope', async () => {
  const { manager, repository, cachedRead } = setup([])
  repository.getVectorsByFilePath.mockResolvedValue([])
  await manager.updateVaultIndex(embeddingModel, {
    chunkSize: 1000,
    excludePatterns: [],
    includePatterns: [],
    scope: { files: [], folders: ['public'] },
  })
  expect(cachedRead.mock.calls).toEqual([
    [expect.objectContaining({ path: 'public/a.md' })],
  ])
})

it('removes partially embedded files so the next update retries them', async () => {
  const { manager, repository, cachedRead } = setup([])
  repository.getVectorsByFilePath.mockResolvedValue([])
  Object.assign(repository, { insertVectors: jest.fn() })
  cachedRead.mockImplementation((file: { path: string }) =>
    Promise.resolve(file.path === 'private/b.md' ? 'bad' : 'good'),
  )
  const model = {
    id: 'model',
    dimension: 1,
    getEmbedding: (text: string) =>
      text === 'bad' ? Promise.reject(new Error('fail')) : Promise.resolve([1]),
  } as never
  await manager.updateVaultIndex(model, {
    chunkSize: 1000,
    excludePatterns: [],
    includePatterns: [],
  })
  expect(repository.deleteVectorsForMultipleFiles).toHaveBeenLastCalledWith(
    ['private/b.md'],
    model,
  )
})
