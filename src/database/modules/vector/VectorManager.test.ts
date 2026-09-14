import { App, TFile } from 'obsidian'

import { EmbeddingModelClient } from '../../../types/embedding'

import { VectorManager } from './VectorManager'

jest.mock('langchain/text_splitter', () => ({
  RecursiveCharacterTextSplitter: {
    fromLanguage: jest.fn(() => ({
      createDocuments: jest.fn(async ([content]: string[]) =>
        content.length === 0
          ? []
          : content.split('|').map((pageContent, index) => ({
              pageContent,
              metadata: {
                loc: { lines: { from: index + 1, to: index + 1 } },
              },
            })),
      ),
    })),
  },
}))

jest.mock('../../../components/modals/ErrorModal', () => ({
  ErrorModal: jest.fn(() => ({ open: jest.fn() })),
}))

const model: EmbeddingModelClient = {
  id: 'model',
  dimension: 2,
  getEmbedding: jest.fn(async () => [1, 0]),
}

const file = (path: string, mtime = 2) => ({ path, stat: { mtime } }) as TFile

const createManager = (files: TFile[], contents: Record<string, string>) => {
  const app = {
    vault: {
      getMarkdownFiles: jest.fn(() => files),
      cachedRead: jest.fn(async (target: TFile) => contents[target.path]),
    },
  } as unknown as App
  const manager = new VectorManager(app, {} as never)
  const repository = {
    getIndexedFilePaths: jest.fn(async () => [] as string[]),
    getVectorsByFilePath: jest.fn(
      async (): Promise<
        { mtime: number; dimension: number; metadata: Record<string, number> }[]
      > => [],
    ),
    deleteVectorsForMultipleFiles: jest.fn(async () => undefined),
    replaceVectorsForFile: jest.fn(async () => undefined),
    performSimilaritySearch: jest.fn(async () => []),
    clearAllVectors: jest.fn(async () => undefined),
    getEmbeddingStats: jest.fn(async () => []),
  }
  Object.assign(manager, { repository })
  const save = jest.fn(async () => undefined)
  manager.setSaveCallback(save)
  return { manager, repository, save }
}

const options = {
  chunkSize: 1000,
  excludePatterns: ['secret/**'],
  includePatterns: [] as string[],
}

describe('VectorManager indexing integrity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('purges excluded vectors while a scoped update embeds only its files', async () => {
    const scoped = file('scope/note.md')
    const outside = file('outside.md')
    const secret = file('secret/note.md')
    const { manager, repository, save } = createManager(
      [scoped, outside, secret],
      {
        [scoped.path]: 'scope content',
        [outside.path]: 'outside content',
        [secret.path]: 'secret content',
      },
    )
    repository.getIndexedFilePaths.mockResolvedValue([
      outside.path,
      secret.path,
    ])

    await manager.updateVaultIndex(model, {
      ...options,
      scope: { files: [scoped.path], folders: [] },
    })

    expect(repository.deleteVectorsForMultipleFiles).toHaveBeenCalledWith(
      [secret.path],
      model,
    )
    expect(model.getEmbedding).toHaveBeenCalledTimes(1)
    expect(model.getEmbedding).toHaveBeenCalledWith('scope content', {
      purpose: 'document',
      signal: expect.any(AbortSignal),
    })
    expect(repository.replaceVectorsForFile).toHaveBeenCalledWith(
      scoped.path,
      model,
      expect.any(Array),
    )
    expect(save).toHaveBeenCalledTimes(1)

    await manager.performSimilaritySearch([1, 0], model, {
      minSimilarity: 0,
      limit: 10,
      excludePatterns: options.excludePatterns,
      includePatterns: [],
    })
    expect(repository.performSimilaritySearch).toHaveBeenCalledWith(
      [1, 0],
      model,
      expect.objectContaining({
        allowedPaths: [scoped.path, outside.path],
      }),
    )
  })

  it('persists an empty full reindex after exclusions remove every vector', async () => {
    const secret = file('secret/note.md')
    const { manager, repository, save } = createManager([secret], {
      [secret.path]: 'secret content',
    })
    repository.getIndexedFilePaths.mockResolvedValue([secret.path])

    await manager.updateVaultIndex(model, { ...options, reindexAll: true })

    expect(repository.deleteVectorsForMultipleFiles).toHaveBeenCalledWith(
      [secret.path],
      model,
    )
    expect(repository.replaceVectorsForFile).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('removes legacy partial vectors when their file is now empty', async () => {
    const note = file('note.md')
    const { manager, repository, save } = createManager([note], {
      [note.path]: '',
    })
    repository.getIndexedFilePaths.mockResolvedValue([note.path])
    repository.getVectorsByFilePath.mockResolvedValue([
      { mtime: note.stat.mtime, dimension: 2, metadata: {} },
    ])

    await manager.updateVaultIndex(model, {
      ...options,
      excludePatterns: [],
    })

    expect(repository.replaceVectorsForFile).toHaveBeenCalledWith(
      note.path,
      model,
      [],
    )
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('uses SQL scope directly when no include or exclude patterns are set', async () => {
    const note = file('folder/note.md')
    const { manager, repository } = createManager([note], {
      [note.path]: 'content',
    })
    const scope = { files: [], folders: ['folder'] }

    await manager.performSimilaritySearch([1, 0], model, {
      minSimilarity: 0,
      limit: 10,
      excludePatterns: [],
      includePatterns: [],
      scope,
    })

    expect(repository.performSimilaritySearch).toHaveBeenCalledWith(
      [1, 0],
      model,
      expect.objectContaining({ scope, allowedPaths: undefined }),
    )

    repository.performSimilaritySearch.mockClear()
    await expect(
      manager.performSimilaritySearch([1, 0], model, {
        minSimilarity: 0,
        limit: 10,
        scope: { files: [], folders: [] },
      }),
    ).resolves.toEqual([])
    expect(repository.performSimilaritySearch).not.toHaveBeenCalled()
  })

  it('keeps the previous file vectors and rejects when any chunk fails', async () => {
    const note = file('note.md')
    const { manager, repository } = createManager([note], {
      [note.path]: 'first|second',
    })
    repository.getIndexedFilePaths.mockResolvedValue([note.path])
    repository.getVectorsByFilePath.mockResolvedValue([
      { mtime: note.stat.mtime, dimension: 2, metadata: {} },
    ])
    const embeddingError = new Error('provider failed')
    const getEmbedding = jest
      .fn()
      .mockResolvedValueOnce([1, 0])
      .mockRejectedValueOnce(embeddingError)
    const failingModel = { ...model, getEmbedding }

    await expect(
      manager.updateVaultIndex(failingModel, {
        ...options,
        excludePatterns: [],
      }),
    ).rejects.toThrow('provider failed')

    expect(repository.replaceVectorsForFile).not.toHaveBeenCalled()
  })

  it('aborts an active embedding and waits for it during cleanup', async () => {
    const note = file('note.md')
    const { manager, repository } = createManager([note], {
      [note.path]: 'content',
    })
    let embeddingStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      embeddingStarted = resolve
    })
    const abortingModel: EmbeddingModelClient = {
      ...model,
      getEmbedding: jest.fn(
        (_text, requestOptions) =>
          new Promise<number[]>((_resolve, reject) => {
            embeddingStarted?.()
            requestOptions?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Operation aborted', 'AbortError')),
              { once: true },
            )
          }),
      ),
    }
    const update = manager.updateVaultIndex(abortingModel, {
      ...options,
      excludePatterns: [],
    })
    const rejectedUpdate = expect(update).rejects.toMatchObject({
      name: 'AbortError',
    })

    await started
    await manager.cleanup()
    await rejectedUpdate
    expect(repository.replaceVectorsForFile).not.toHaveBeenCalled()
  })
})
