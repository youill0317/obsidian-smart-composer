import { PgliteDatabase } from 'drizzle-orm/pglite'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { minimatch } from 'minimatch'
import { App, TFile } from 'obsidian'

import { IndexProgress } from '../../../components/chat-view/QueryProgress'
import { ErrorModal } from '../../../components/modals/ErrorModal'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMBaseUrlNotSetException,
  LLMRateLimitExceededException,
} from '../../../core/llm/exception'
import {
  InsertEmbedding,
  SelectEmbedding,
  VectorMetaData,
} from '../../../database/schema'
import {
  EmbeddingDbStats,
  EmbeddingModelClient,
} from '../../../types/embedding'
import { chunkArray } from '../../../utils/common/chunk-array'

import { VectorRepository } from './VectorRepository'

export type VectorScope = {
  files: string[]
  folders: string[]
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Operation aborted', 'AbortError')
  }
}

const waitForRetry = (delay: number, signal?: AbortSignal) => {
  let abort: (() => void) | undefined
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Operation aborted', 'AbortError'),
      )
      return
    }
    const timeoutId = setTimeout(() => {
      if (abort) signal?.removeEventListener('abort', abort)
      resolve()
    }, delay)
    abort = () => {
      clearTimeout(timeoutId)
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('Operation aborted', 'AbortError'),
      )
    }
    if (signal) {
      signal.addEventListener('abort', abort, { once: true })
    }
  })
}

export class VectorManager {
  private app: App
  private repository: VectorRepository
  private saveCallback: (() => Promise<void>) | null = null
  private vacuumCallback: (() => Promise<void>) | null = null
  private mutationQueue: Promise<void> = Promise.resolve()
  private activeAbortController: AbortController | null = null
  private closing = false

  private async requestSave() {
    try {
      if (this.saveCallback) {
        await this.saveCallback()
      } else {
        throw new Error('No save callback set')
      }
    } catch (error) {
      new ErrorModal(
        this.app,
        'Error: save failed',
        'Failed to save the vector database changes. Please report this issue to the developer.',
        error instanceof Error ? error.message : 'Unknown error',
        {
          showReportBugButton: true,
        },
      ).open()
      throw error
    }
  }

  private async requestVacuum() {
    if (this.vacuumCallback) {
      await this.vacuumCallback()
    }
  }

  constructor(app: App, db: PgliteDatabase) {
    this.app = app
    this.repository = new VectorRepository(app, db)
  }

  setSaveCallback(callback: () => Promise<void>) {
    this.saveCallback = callback
  }

  setVacuumCallback(callback: () => Promise<void>) {
    this.vacuumCallback = callback
  }

  async performSimilaritySearch(
    queryVector: number[],
    embeddingModel: EmbeddingModelClient,
    options: {
      minSimilarity: number
      limit: number
      scope?: VectorScope
      excludePatterns?: string[]
      includePatterns?: string[]
    },
  ): Promise<
    (Omit<SelectEmbedding, 'embedding'> & {
      similarity: number
    })[]
  > {
    if (
      options.scope &&
      options.scope.files.length === 0 &&
      options.scope.folders.length === 0
    ) {
      return []
    }
    const allowedPaths =
      (options.excludePatterns?.length ?? 0) > 0 ||
      (options.includePatterns?.length ?? 0) > 0
        ? this.getAllowedFiles({
            excludePatterns: options.excludePatterns ?? [],
            includePatterns: options.includePatterns ?? [],
            scope: options.scope,
          }).map((file) => file.path)
        : undefined
    return await this.repository.performSimilaritySearch(
      queryVector,
      embeddingModel,
      { ...options, allowedPaths },
    )
  }

  async updateVaultIndex(
    embeddingModel: EmbeddingModelClient,
    options: {
      chunkSize: number
      excludePatterns: string[]
      includePatterns: string[]
      reindexAll?: boolean
      scope?: VectorScope
      signal?: AbortSignal
    },
    updateProgress?: (indexProgress: IndexProgress) => void,
  ): Promise<void> {
    return this.runMutation(
      (signal) =>
        this.updateVaultIndexInternal(
          embeddingModel,
          { ...options, signal },
          updateProgress,
        ),
      options.signal,
    )
  }

  private async updateVaultIndexInternal(
    embeddingModel: EmbeddingModelClient,
    options: {
      chunkSize: number
      excludePatterns: string[]
      includePatterns: string[]
      reindexAll?: boolean
      scope?: VectorScope
      signal?: AbortSignal
    },
    updateProgress?: (indexProgress: IndexProgress) => void,
  ): Promise<void> {
    let didMutate = false
    try {
      throwIfAborted(options.signal)
      const allowedFiles = this.getAllowedFiles({
        excludePatterns: options.excludePatterns,
        includePatterns: options.includePatterns,
      })
      const allowedPaths = new Set(allowedFiles.map((file) => file.path))
      const indexedPaths =
        await this.repository.getIndexedFilePaths(embeddingModel)
      const stalePaths = [...new Set(indexedPaths)].filter(
        (path) => !allowedPaths.has(path),
      )
      if (stalePaths.length > 0) {
        await this.repository.deleteVectorsForMultipleFiles(
          stalePaths,
          embeddingModel,
        )
        didMutate = true
      }

      const filesToIndex = await this.getFilesToIndex({
        embeddingModel,
        excludePatterns: options.excludePatterns,
        includePatterns: options.includePatterns,
        reindexAll: options.reindexAll,
        scope: options.scope,
      })

      if (filesToIndex.length === 0) {
        return
      }

      const textSplitter = RecursiveCharacterTextSplitter.fromLanguage(
        'markdown',
        {
          chunkSize: options.chunkSize,
          // TODO: Use token-based chunking after migrating to WebAssembly-based tiktoken
          // Current token counting method is too slow for practical use
          // lengthFunction: async (text) => {
          //   return await tokenCount(text)
          // },
        },
      )

      const failedFiles: { path: string; error: unknown }[] = []
      const chunksByFile = new Map<
        string,
        Omit<InsertEmbedding, 'model' | 'dimension'>[]
      >()
      await Promise.all(
        filesToIndex.map(async (file) => {
          try {
            throwIfAborted(options.signal)
            const fileContent = await this.app.vault.cachedRead(file)
            throwIfAborted(options.signal)
            // Remove null bytes from the content
            // eslint-disable-next-line no-control-regex
            const sanitizedContent = fileContent.replace(/\x00/g, '')

            const fileDocuments = await textSplitter.createDocuments([
              sanitizedContent,
            ])
            chunksByFile.set(
              file.path,
              fileDocuments.map(
                (
                  chunk,
                  chunkIndex,
                ): Omit<InsertEmbedding, 'model' | 'dimension'> => {
                  return {
                    path: file.path,
                    mtime: file.stat.mtime,
                    content: chunk.pageContent,
                    metadata: {
                      startLine: chunk.metadata.loc.lines.from as number,
                      endLine: chunk.metadata.loc.lines.to as number,
                      chunkIndex,
                      chunkCount: fileDocuments.length,
                    },
                  }
                },
              ),
            )
          } catch (error) {
            failedFiles.push({
              path: file.path,
              error,
            })
          }
        }),
      )
      throwIfAborted(options.signal)
      const contentChunks = [...chunksByFile.values()].flat()

      updateProgress?.({
        completedChunks: 0,
        totalChunks: contentChunks.length,
        totalFiles: filesToIndex.length,
      })

      let completedChunks = 0
      const batchChunks = chunkArray(contentChunks, 100)
      const failedChunks: {
        path: string
        metadata: VectorMetaData
        error: unknown
      }[] = []
      const embeddedByFile = new Map<string, InsertEmbedding[]>()
      const failedPaths = new Set(failedFiles.map(({ path }) => path))
      const processedChunks = new Map<string, number>()

      for (const [path, chunks] of chunksByFile) {
        if (chunks.length === 0) {
          await this.repository.replaceVectorsForFile(path, embeddingModel, [])
          didMutate = true
        }
      }

      for (const batchChunk of batchChunks) {
        const embeddingChunks: (InsertEmbedding | null)[] = await Promise.all(
          batchChunk.map(async (chunk) => {
            if (failedPaths.has(chunk.path)) {
              return null
            }
            try {
              for (let attempt = 0; ; attempt += 1) {
                try {
                  throwIfAborted(options.signal)
                  if (chunk.content.length === 0) {
                    throw new Error(
                      `Chunk content is empty in file: ${chunk.path}`,
                    )
                  }
                  if (chunk.content.includes('\x00')) {
                    // this should never happen because we remove null bytes from the content
                    throw new Error(
                      `Chunk content contains null bytes in file: ${chunk.path}`,
                    )
                  }

                  const embedding = await embeddingModel.getEmbedding(
                    chunk.content,
                    { purpose: 'document', signal: options.signal },
                  )
                  completedChunks += 1

                  updateProgress?.({
                    completedChunks,
                    totalChunks: contentChunks.length,
                    totalFiles: filesToIndex.length,
                  })

                  return {
                    path: chunk.path,
                    mtime: chunk.mtime,
                    content: chunk.content,
                    model: embeddingModel.id,
                    dimension: embeddingModel.dimension,
                    embedding,
                    metadata: chunk.metadata,
                  }
                } catch (error) {
                  if (
                    attempt >= 7 ||
                    !(
                      error instanceof LLMRateLimitExceededException ||
                      (error as { status?: number }).status === 429
                    )
                  ) {
                    throw error
                  }
                  updateProgress?.({
                    completedChunks,
                    totalChunks: contentChunks.length,
                    totalFiles: filesToIndex.length,
                    waitingForRateLimit: true,
                  })
                  await waitForRetry(
                    Math.min(2000 * 2 ** attempt, 60000),
                    options.signal,
                  )
                }
              }
            } catch (error) {
              failedPaths.add(chunk.path)
              failedChunks.push({
                path: chunk.path,
                metadata: chunk.metadata,
                error,
              })

              return null
            }
          }),
        )

        const validEmbeddingChunks = embeddingChunks.filter(
          (chunk) => chunk !== null,
        )
        for (const chunk of validEmbeddingChunks) {
          const fileChunks = embeddedByFile.get(chunk.path) ?? []
          fileChunks.push(chunk)
          embeddedByFile.set(chunk.path, fileChunks)
        }
        throwIfAborted(options.signal)
        for (const chunk of batchChunk) {
          processedChunks.set(
            chunk.path,
            (processedChunks.get(chunk.path) ?? 0) + 1,
          )
        }
        for (const path of new Set(batchChunk.map((chunk) => chunk.path))) {
          if (processedChunks.get(path) === chunksByFile.get(path)?.length) {
            if (!failedPaths.has(path)) {
              await this.repository.replaceVectorsForFile(
                path,
                embeddingModel,
                embeddedByFile.get(path) ?? [],
              )
              didMutate = true
            }
            embeddedByFile.delete(path)
          }
        }
      }

      const failures = [...failedFiles, ...failedChunks]
      if (failures.length > 0) {
        const firstError = failures[0].error
        if (
          firstError instanceof DOMException &&
          firstError.name === 'AbortError'
        ) {
          throw firstError
        }
        if (
          firstError instanceof LLMAPIKeyNotSetException ||
          firstError instanceof LLMAPIKeyInvalidException ||
          firstError instanceof LLMBaseUrlNotSetException
        ) {
          new ErrorModal(this.app, 'Error', firstError.message, undefined, {
            showSettingsButton: true,
          }).open()
        } else {
          const errorDetails =
            `Failed to index ${failedPaths.size} file(s):\n\n` +
            failures
              .map(
                ({ path, error }) =>
                  `File: ${path}\nError: ${
                    error instanceof Error ? error.message : 'Unknown error'
                  }`,
              )
              .join('\n\n')

          new ErrorModal(
            this.app,
            'Error: embedding failed',
            `Some files couldn't be indexed.
Please report this issue to the developer if it persists.`,
            `[Error Log]\n\n${errorDetails}`,
            { showReportBugButton: true },
          ).open()
        }
        if (firstError instanceof Error) {
          throw firstError
        }
        throw new Error(`Failed to index: ${[...failedPaths].join(', ')}`)
      }
    } finally {
      if (didMutate) {
        await this.requestSave()
      }
    }
  }

  async clearAllVectors(
    embeddingModel: EmbeddingModelClient,
    signal?: AbortSignal,
  ) {
    return this.runMutation(async (operationSignal) => {
      throwIfAborted(operationSignal)
      await this.repository.clearAllVectors(embeddingModel)
      await this.requestVacuum()
      await this.requestSave()
    }, signal)
  }

  private async getFilesToIndex({
    embeddingModel,
    excludePatterns,
    includePatterns,
    reindexAll,
    scope,
  }: {
    embeddingModel: EmbeddingModelClient
    excludePatterns: string[]
    includePatterns: string[]
    reindexAll?: boolean
    scope?: VectorScope
  }): Promise<TFile[]> {
    let filesToIndex = this.getAllowedFiles({
      excludePatterns,
      includePatterns,
      scope,
    })

    if (reindexAll) {
      return filesToIndex
    }

    // Check for updated or new files
    filesToIndex = await Promise.all(
      filesToIndex.map(async (file) => {
        // TODO: Query all rows at once and compare them to enhance performance
        const fileChunks = await this.repository.getVectorsByFilePath(
          file.path,
          embeddingModel,
        )
        const chunkIndexes = new Set(
          fileChunks.map((chunk) => chunk.metadata.chunkIndex),
        )
        const complete = fileChunks.every(
          (chunk) =>
            chunk.dimension === embeddingModel.dimension &&
            chunk.metadata.chunkCount === fileChunks.length &&
            chunk.metadata.chunkIndex !== undefined,
        )
        if (
          fileChunks.length === 0 ||
          !complete ||
          chunkIndexes.size !== fileChunks.length ||
          !fileChunks.every((_, index) => chunkIndexes.has(index))
        ) {
          // File is not indexed, so we need to index it
          const fileContent = await this.app.vault.cachedRead(file)
          if (fileContent.length === 0) {
            // Ignore new empty files, but remove vectors left from old content.
            return fileChunks.length > 0 ? file : null
          }
          return file
        }
        const outOfDate = file.stat.mtime > fileChunks[0].mtime
        if (outOfDate) {
          // File has changed, so we need to re-index it
          return file
        }
        return null
      }),
    ).then((files) => files.filter(Boolean) as TFile[])

    return filesToIndex
  }

  private getAllowedFiles({
    excludePatterns,
    includePatterns,
    scope,
  }: {
    excludePatterns: string[]
    includePatterns: string[]
    scope?: VectorScope
  }): TFile[] {
    const files = new Set(scope?.files)
    const folders = scope?.folders.map((folder) =>
      folder.endsWith('/') ? folder : `${folder}/`,
    )
    return this.app.vault.getMarkdownFiles().filter((file) => {
      if (excludePatterns.some((pattern) => minimatch(file.path, pattern))) {
        return false
      }
      if (
        includePatterns.length > 0 &&
        !includePatterns.some((pattern) => minimatch(file.path, pattern))
      ) {
        return false
      }
      return (
        !scope ||
        files.has(file.path) ||
        folders?.some((folder) => file.path.startsWith(folder))
      )
    })
  }

  private runMutation<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.closing) {
      return Promise.reject(new DOMException('Operation aborted', 'AbortError'))
    }
    const result = this.mutationQueue.then(async () => {
      if (this.closing) {
        throw new DOMException('Operation aborted', 'AbortError')
      }
      throwIfAborted(signal)
      const controller = new AbortController()
      this.activeAbortController = controller
      const abort = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', abort, { once: true })
      try {
        return await operation(controller.signal)
      } finally {
        signal?.removeEventListener('abort', abort)
        if (this.activeAbortController === controller) {
          this.activeAbortController = null
        }
      }
    })
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async cleanup(): Promise<void> {
    this.closing = true
    this.activeAbortController?.abort()
    await this.mutationQueue
  }

  async getEmbeddingStats(): Promise<EmbeddingDbStats[]> {
    return await this.repository.getEmbeddingStats()
  }
}
