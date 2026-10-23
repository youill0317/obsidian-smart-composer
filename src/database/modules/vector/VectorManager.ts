import { backOff } from 'exponential-backoff'
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
import { VectorMetaData } from '../../../database/schema'
import {
  EmbeddingDbStats,
  EmbeddingModelClient,
} from '../../../types/embedding'
import { chunkArray } from '../../../utils/common/chunk-array'

import {
  EmbeddedChunk,
  EmbeddingSearchResult,
  ModelVectorIndex,
  VectorStore,
  isInScope,
} from './VectorStore'

type ContentChunk = {
  path: string
  mtime: number
  content: string
  metadata: VectorMetaData
}

export class VectorManager {
  private app: App
  private store: VectorStore

  private async requestSave(index: ModelVectorIndex) {
    try {
      await index.flush()
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
    }
  }

  constructor(app: App, store: VectorStore) {
    this.app = app
    this.store = store
  }

  async performSimilaritySearch(
    queryVector: number[],
    embeddingModel: EmbeddingModelClient,
    options: {
      minSimilarity: number
      limit: number
      scope?: {
        files: string[]
        folders: string[]
      }
    },
  ): Promise<EmbeddingSearchResult[]> {
    const index = await this.store.getIndex(embeddingModel)
    return index.search(queryVector, options)
  }

  async updateVaultIndex(
    embeddingModel: EmbeddingModelClient,
    options: {
      chunkSize: number
      excludePatterns: string[]
      includePatterns: string[]
      reindexAll?: boolean
      scope?: { files: string[]; folders: string[] }
    },
    updateProgress?: (indexProgress: IndexProgress) => void,
  ): Promise<void> {
    const index = await this.store.getIndex(embeddingModel)
    let filesToIndex: TFile[]
    if (options.reindexAll) {
      filesToIndex = await this.getFilesToIndex({
        index,
        excludePatterns: options.excludePatterns,
        includePatterns: options.includePatterns,
        reindexAll: true,
      })
      index.clear()
    } else {
      this.deleteStaleVectors(index, options)
      filesToIndex = await this.getFilesToIndex({
        index,
        excludePatterns: options.excludePatterns,
        includePatterns: options.includePatterns,
        scope: options.scope,
      })
      index.deleteFiles(filesToIndex.map((file) => file.path))
    }

    if (filesToIndex.length === 0) {
      // Persists the deletions above; writes nothing if there were none.
      await this.requestSave(index)
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

    const failedFiles: { path: string; error: string }[] = []
    const contentChunks = (
      await Promise.all(
        filesToIndex.map(async (file) => {
          try {
            const fileContent = await this.app.vault.cachedRead(file)
            // Remove null bytes from the content
            // eslint-disable-next-line no-control-regex
            const sanitizedContent = fileContent.replace(/\x00/g, '')

            const fileDocuments = await textSplitter.createDocuments([
              sanitizedContent,
            ])
            return fileDocuments.map((chunk): ContentChunk => {
              return {
                path: file.path,
                mtime: file.stat.mtime,
                content: chunk.pageContent,
                metadata: {
                  startLine: chunk.metadata.loc.lines.from as number,
                  endLine: chunk.metadata.loc.lines.to as number,
                },
              }
            })
          } catch (error) {
            failedFiles.push({
              path: file.path,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
            return [] // Return empty array for failed files
          }
        }),
      )
    ).flat()

    if (failedFiles.length > 0) {
      const errorDetails =
        `Failed to process ${failedFiles.length} file(s):\n\n` +
        failedFiles
          .map(({ path, error }) => `File: ${path}\nError: ${error}`)
          .join('\n\n')

      new ErrorModal(
        this.app,
        'Error: chunk embedding failed',
        `Some files failed to process. Please report this issue to the developer if it persists.`,
        `[Error Log]\n\n${errorDetails}`,
        {
          showReportBugButton: true,
        },
      ).open()
    }

    if (contentChunks.length === 0) {
      throw new Error('All files failed to process. Stopping indexing process.')
    }

    updateProgress?.({
      completedChunks: 0,
      totalChunks: contentChunks.length,
      totalFiles: filesToIndex.length,
    })

    let completedChunks = 0
    // A file is stored only once all of its chunks are embedded, so a file
    // with a failed chunk stays unindexed and is retried by the next update.
    const pendingFiles = new Map<
      string,
      { mtime: number; chunks: EmbeddedChunk[]; remaining: number }
    >()
    const positions = contentChunks.map((chunk) => {
      const pending = pendingFiles.get(chunk.path) ?? {
        mtime: chunk.mtime,
        chunks: [],
        remaining: 0,
      }
      pendingFiles.set(chunk.path, pending)
      return pending.remaining++
    })
    const batchChunks = chunkArray(
      contentChunks.map((chunk, i) => ({ ...chunk, position: positions[i] })),
      100,
    )
    const failedChunks: {
      path: string
      metadata: VectorMetaData
      error: string
    }[] = []

    try {
      for (const batchChunk of batchChunks) {
        const embeddingChunks: (
          | (EmbeddedChunk & { path: string; position: number })
          | null
        )[] = await Promise.all(
          batchChunk.map(async (chunk) => {
            try {
              return await backOff(
                async () => {
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
                    { purpose: 'document' },
                  )
                  if (embedding.length !== embeddingModel.dimension) {
                    throw new Error(
                      `Embedding has ${embedding.length} dimensions, but model ${embeddingModel.id} is configured for ${embeddingModel.dimension}`,
                    )
                  }
                  completedChunks += 1

                  updateProgress?.({
                    completedChunks,
                    totalChunks: contentChunks.length,
                    totalFiles: filesToIndex.length,
                  })

                  return {
                    path: chunk.path,
                    position: chunk.position,
                    content: chunk.content,
                    embedding,
                    metadata: chunk.metadata,
                  }
                },
                {
                  numOfAttempts: 8,
                  startingDelay: 2000,
                  timeMultiple: 2,
                  maxDelay: 60000,
                  retry: (error) => {
                    if (
                      error instanceof LLMRateLimitExceededException ||
                      error.status === 429
                    ) {
                      updateProgress?.({
                        completedChunks,
                        totalChunks: contentChunks.length,
                        totalFiles: filesToIndex.length,
                        waitingForRateLimit: true,
                      })
                      return true
                    }
                    return false
                  },
                },
              )
            } catch (error) {
              failedChunks.push({
                path: chunk.path,
                metadata: chunk.metadata,
                error: error instanceof Error ? error.message : 'Unknown error',
              })

              return null
            }
          }),
        )

        const validEmbeddingChunks = embeddingChunks.filter(
          (chunk) => chunk !== null,
        )
        // If all chunks in this batch failed, stop processing
        if (validEmbeddingChunks.length === 0 && batchChunk.length > 0) {
          throw new Error(
            'All chunks in batch failed to embed. Stopping indexing process.',
          )
        }
        for (const { path, position, ...chunk } of validEmbeddingChunks) {
          const pending = pendingFiles.get(path)
          if (!pending) continue
          pending.chunks[position] = chunk
          pending.remaining -= 1
          if (pending.remaining === 0) {
            index.setFile(path, pending.mtime, pending.chunks)
            pendingFiles.delete(path)
          }
        }
      }
    } catch (error) {
      if (
        error instanceof LLMAPIKeyNotSetException ||
        error instanceof LLMAPIKeyInvalidException ||
        error instanceof LLMBaseUrlNotSetException
      ) {
        new ErrorModal(this.app, 'Error', (error as Error).message, undefined, {
          showSettingsButton: true,
        }).open()
      } else {
        const errorDetails =
          `Failed to process ${failedChunks.length} file(s):\n\n` +
          failedChunks
            .map((chunk) => `File: ${chunk.path}\nError: ${chunk.error}`)
            .join('\n\n')

        new ErrorModal(
          this.app,
          'Error: embedding failed',
          `The indexing process was interrupted because several files couldn't be processed.
Please report this issue to the developer if it persists.`,
          `[Error Log]\n\n${errorDetails}`,
          {
            showReportBugButton: true,
          },
        ).open()
      }
    } finally {
      await this.requestSave(index)
    }
  }

  async clearAllVectors(embeddingModel: EmbeddingModelClient) {
    const index = await this.store.getIndex(embeddingModel)
    index.clear()
    await this.requestSave(index)
  }

  // Remove vectors of deleted files and of files the current include/exclude
  // patterns no longer allow, so they cannot be retrieved.
  private deleteStaleVectors(
    index: ModelVectorIndex,
    patterns: { excludePatterns: string[]; includePatterns: string[] },
  ) {
    index.deleteFiles(
      index
        .paths()
        .filter(
          (filePath) =>
            !this.app.vault.getAbstractFileByPath(filePath) ||
            !matchesIndexPatterns(filePath, patterns),
        ),
    )
  }

  private async getFilesToIndex({
    index,
    excludePatterns,
    includePatterns,
    reindexAll,
    scope,
  }: {
    index: ModelVectorIndex
    excludePatterns: string[]
    includePatterns: string[]
    reindexAll?: boolean
    scope?: { files: string[]; folders: string[] }
  }): Promise<TFile[]> {
    let filesToIndex = this.app.vault
      .getMarkdownFiles()
      .filter((file) =>
        matchesIndexPatterns(file.path, { excludePatterns, includePatterns }),
      )
      // Same scope semantics as the similarity search.
      .filter((file) => isInScope(file.path, scope))

    if (reindexAll) {
      return filesToIndex
    }

    // Check for updated or new files
    filesToIndex = await Promise.all(
      filesToIndex.map(async (file) => {
        const indexedMtime = index.getMtime(file.path)
        if (indexedMtime === undefined) {
          // File is not indexed, so we need to index it
          const fileContent = await this.app.vault.cachedRead(file)
          if (fileContent.length === 0) {
            // Ignore empty files
            return null
          }
          return file
        }
        const outOfDate = file.stat.mtime > indexedMtime
        if (outOfDate) {
          // File has changed, so we need to re-index it
          return file
        }
        return null
      }),
    ).then((files) => files.filter(Boolean) as TFile[])

    return filesToIndex
  }

  async getEmbeddingStats(): Promise<EmbeddingDbStats[]> {
    return await this.store.getStats()
  }
}

function matchesIndexPatterns(
  filePath: string,
  {
    excludePatterns,
    includePatterns,
  }: { excludePatterns: string[]; includePatterns: string[] },
): boolean {
  if (excludePatterns.some((pattern) => minimatch(filePath, pattern)))
    return false
  return (
    includePatterns.length === 0 ||
    includePatterns.some((pattern) => minimatch(filePath, pattern))
  )
}
