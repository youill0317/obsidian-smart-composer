import { PgliteDatabase } from 'drizzle-orm/pglite'
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

export class VectorManager {
  private app: App
  private repository: VectorRepository
  private saveCallback: (() => Promise<void>) | null = null
  private vacuumCallback: (() => Promise<void>) | null = null

  private splitMarkdownIntoHeaderSections(
    content: string,
    options: {
      maxHeaderLevel: number
    } = { maxHeaderLevel: 3 },
  ): {
    headerPath: string
    startLine: number
    endLine: number
    content: string
  }[] {
    const lines = content.split('\n')
    const maxHeaderLevel = Math.max(1, Math.min(6, options.maxHeaderLevel))

    const headers: {
      level: number
      title: string
      line: number // 1-based
      pathTitles: string[]
    }[] = []

    const stack: { level: number; title: string }[] = []

    for (let i = 0; i < lines.length; i += 1) {
      const lineText = lines[i]
      const match = /^(#{1,6})\s+(.*)$/.exec(lineText)
      if (!match) continue

      const level = match[1].length
      if (level > maxHeaderLevel) continue

      const title = match[2].trim()

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop()
      }
      stack.push({ level, title })

      headers.push({
        level,
        title,
        line: i + 1,
        pathTitles: stack.map((h) => h.title),
      })
    }

    if (headers.length === 0) {
      return [
        {
          headerPath: '',
          startLine: 1,
          endLine: Math.max(1, lines.length),
          content,
        },
      ]
    }

    const sections = headers.map((header, index) => {
      let endLine = lines.length
      for (let j = index + 1; j < headers.length; j += 1) {
        if (headers[j].level <= header.level) {
          endLine = headers[j].line - 1
          break
        }
      }
      const startLine = header.line
      const sectionContent = lines.slice(startLine - 1, endLine).join('\n')
      return {
        headerPath: header.pathTitles.join(' > '),
        startLine,
        endLine: Math.max(startLine, endLine),
        content: sectionContent,
      }
    })

    return sections
  }

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
      scope?: {
        files: string[]
        folders: string[]
      }
    },
  ): Promise<
    (Omit<SelectEmbedding, 'embedding'> & {
      similarity: number
    })[]
  > {
    return await this.repository.performSimilaritySearch(
      queryVector,
      embeddingModel,
      options,
    )
  }

  async updateVaultIndex(
    embeddingModel: EmbeddingModelClient,
    options: {
      chunkSize: number
      excludePatterns: string[]
      includePatterns: string[]
      reindexAll?: boolean
    },
    updateProgress?: (indexProgress: IndexProgress) => void,
  ): Promise<void> {
    let filesToIndex: TFile[]
    if (options.reindexAll) {
      filesToIndex = await this.getFilesToIndex({
        embeddingModel: embeddingModel,
        excludePatterns: options.excludePatterns,
        includePatterns: options.includePatterns,
        reindexAll: true,
      })
      await this.repository.clearAllVectors(embeddingModel)
    } else {
      await this.deleteVectorsForDeletedFiles(embeddingModel)
      filesToIndex = await this.getFilesToIndex({
        embeddingModel: embeddingModel,
        excludePatterns: options.excludePatterns,
        includePatterns: options.includePatterns,
      })
      await this.repository.deleteVectorsForMultipleFiles(
        filesToIndex.map((file) => file.path),
        embeddingModel,
      )
    }

    if (filesToIndex.length === 0) {
      return
    }

    const leafTextSplitter = RecursiveCharacterTextSplitter.fromLanguage(
      'markdown',
      {
        // NOTE: chunkSize is applied *within each header section* as an upper bound.
        // This enables hierarchical (parent-child) retrieval without extra LLM calls.
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

            const sections = this.splitMarkdownIntoHeaderSections(
              sanitizedContent,
              {
                maxHeaderLevel: 3,
              },
            )

            const sectionChunks = (
              await Promise.all(
                sections.map(async (section) => {
                  // Avoid wasting embedding calls on empty sections
                  if (section.content.trim().length === 0) {
                    return []
                  }

                  // Stage 2: only split within the header section when it is too large
                  const docs =
                    section.content.length <= options.chunkSize
                      ? [
                          {
                            pageContent: section.content,
                            metadata: {
                              loc: {
                                lines: {
                                  from: 1,
                                  to: Math.max(
                                    1,
                                    section.endLine - section.startLine + 1,
                                  ),
                                },
                              },
                            },
                          },
                        ]
                      : await leafTextSplitter.createDocuments([section.content])

                  return docs.map(
                    (
                      doc,
                    ): Omit<InsertEmbedding, 'model' | 'dimension'> => {
                      const from =
                        (doc as any)?.metadata?.loc?.lines?.from ?? 1
                      const to =
                        (doc as any)?.metadata?.loc?.lines?.to ??
                        Math.max(1, section.endLine - section.startLine + 1)

                      const leafStartLine = section.startLine + from - 1
                      const leafEndLine = section.startLine + to - 1

                      return {
                        path: file.path,
                        mtime: file.stat.mtime,
                        content: doc.pageContent,
                        metadata: {
                          startLine: leafStartLine,
                          endLine: leafEndLine,
                          parentStartLine: section.startLine,
                          parentEndLine: section.endLine,
                          headerPath: section.headerPath,
                        },
                      }
                    },
                  )
                }),
              )
            ).flat()

            return sectionChunks
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
    const batchChunks = chunkArray(contentChunks, 100)
    const failedChunks: {
      path: string
      metadata: VectorMetaData
      error: string
    }[] = []

    try {
      for (const batchChunk of batchChunks) {
        const embeddingChunks: (InsertEmbedding | null)[] = await Promise.all(
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

                  const headerPath = chunk.metadata.headerPath
                  const embeddingText = headerPath
                    ? `Header: ${headerPath}\n\n${chunk.content}`
                    : chunk.content

                  const embedding = await embeddingModel.getEmbedding(
                    embeddingText,
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
        await this.repository.insertVectors(validEmbeddingChunks)
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
      await this.requestSave()
    }
  }

  async clearAllVectors(embeddingModel: EmbeddingModelClient) {
    await this.repository.clearAllVectors(embeddingModel)
    await this.requestVacuum()
    await this.requestSave()
  }

  private async deleteVectorsForDeletedFiles(
    embeddingModel: EmbeddingModelClient,
  ) {
    const indexedFilePaths =
      await this.repository.getIndexedFilePaths(embeddingModel)
    for (const filePath of indexedFilePaths) {
      if (!this.app.vault.getAbstractFileByPath(filePath)) {
        await this.repository.deleteVectorsForMultipleFiles(
          [filePath],
          embeddingModel,
        )
      }
    }
  }

  private async getFilesToIndex({
    embeddingModel,
    excludePatterns,
    includePatterns,
    reindexAll,
  }: {
    embeddingModel: EmbeddingModelClient
    excludePatterns: string[]
    includePatterns: string[]
    reindexAll?: boolean
  }): Promise<TFile[]> {
    let filesToIndex = this.app.vault.getMarkdownFiles()

    filesToIndex = filesToIndex.filter((file) => {
      return !excludePatterns.some((pattern) => minimatch(file.path, pattern))
    })

    if (includePatterns.length > 0) {
      filesToIndex = filesToIndex.filter((file) => {
        return includePatterns.some((pattern) => minimatch(file.path, pattern))
      })
    }

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
        if (fileChunks.length === 0) {
          // File is not indexed, so we need to index it
          const fileContent = await this.app.vault.cachedRead(file)
          if (fileContent.length === 0) {
            // Ignore empty files
            return null
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

  async getEmbeddingStats(): Promise<EmbeddingDbStats[]> {
    return await this.repository.getEmbeddingStats()
  }
}
