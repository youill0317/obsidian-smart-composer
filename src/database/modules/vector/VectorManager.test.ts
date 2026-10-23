import { App } from 'obsidian'

import { createMemoryAdapter } from './memoryAdapter.testutil'
import { VectorManager } from './VectorManager'
import { VectorStore } from './VectorStore'

jest.mock('../../../components/modals/ErrorModal', () => ({
  ErrorModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}))

function setup() {
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
  const { adapter } = createMemoryAdapter()
  const store = new VectorStore(adapter)
  const manager = new VectorManager(app, store)
  return { manager, store, adapter, files, cachedRead }
}

const embeddingModel = {
  id: 'model',
  dimension: 1,
  getEmbedding: jest.fn().mockResolvedValue([1]),
}

async function seed(store: VectorStore, paths: string[]) {
  const index = await store.getIndex(embeddingModel)
  for (const path of paths) {
    index.setFile(path, 1, [
      { content: path, metadata: { startLine: 1, endLine: 1 }, embedding: [1] },
    ])
  }
  await index.flush()
  return index
}

it('removes indexed vectors that the current include patterns exclude', async () => {
  const { manager, store, adapter } = setup()
  const index = await seed(store, ['public/a.md', 'private/b.md', 'gone.md'])
  await manager.updateVaultIndex(embeddingModel, {
    chunkSize: 1000,
    excludePatterns: [],
    includePatterns: ['public/**'],
  })
  expect(index.paths()).toEqual(['public/a.md'])
  // Persisted, not only removed in memory.
  const reloaded = await new VectorStore(adapter).getIndex(embeddingModel)
  expect(reloaded.paths()).toEqual(['public/a.md'])
})

it('persists the cleared index when a rebuild finds nothing to index', async () => {
  const { manager, store, adapter } = setup()
  await seed(store, ['public/a.md'])
  await manager.updateVaultIndex(embeddingModel, {
    chunkSize: 1000,
    excludePatterns: ['**/*.md'],
    includePatterns: [],
    reindexAll: true,
  })
  const reloaded = await new VectorStore(adapter).getIndex(embeddingModel)
  expect(reloaded.paths()).toEqual([])
})

it('only indexes files inside the query scope', async () => {
  const { manager, cachedRead } = setup()
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

it('skips files whose stored mtime is current', async () => {
  const { manager, store, files, cachedRead } = setup()
  await seed(store, ['public/a.md', 'private/b.md'])
  files[1].stat.mtime = 2
  cachedRead.mockResolvedValue('changed')
  await manager.updateVaultIndex(embeddingModel, {
    chunkSize: 1000,
    excludePatterns: [],
    includePatterns: [],
  })
  expect(cachedRead.mock.calls).toEqual([
    [expect.objectContaining({ path: 'private/b.md' })],
  ])
  const index = await store.getIndex(embeddingModel)
  expect(index.getMtime('private/b.md')).toBe(2)
})

it('leaves partially embedded files unindexed so the next update retries them', async () => {
  const { manager, store, adapter, cachedRead } = setup()
  cachedRead.mockImplementation((file: { path: string }) =>
    Promise.resolve(file.path === 'private/b.md' ? 'bad' : 'good'),
  )
  const model = {
    id: 'model',
    dimension: 1,
    getEmbedding: (text: string) =>
      text === 'bad' ? Promise.reject(new Error('fail')) : Promise.resolve([1]),
  }
  await manager.updateVaultIndex(model, {
    chunkSize: 1000,
    excludePatterns: [],
    includePatterns: [],
  })
  expect((await store.getIndex(model)).paths()).toEqual(['public/a.md'])
  const reloaded = await new VectorStore(adapter).getIndex(model)
  expect(reloaded.paths()).toEqual(['public/a.md'])
})

it('treats an embedding of the wrong dimension as a failed chunk', async () => {
  const { manager, store, cachedRead } = setup()
  cachedRead.mockResolvedValue('text')
  const model = {
    id: 'model',
    dimension: 2,
    getEmbedding: () => Promise.resolve([1, 0, 0]),
  }
  await manager.updateVaultIndex(model, {
    chunkSize: 1000,
    excludePatterns: [],
    includePatterns: [],
  })
  expect((await store.getIndex(model)).paths()).toEqual([])
})
