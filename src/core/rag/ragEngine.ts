import { App } from 'obsidian'

import { QueryProgressState } from '../../components/chat-view/QueryProgress'
import {
  VectorManager,
  VectorScope,
} from '../../database/modules/vector/VectorManager'
import { SelectEmbedding } from '../../database/schema'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { EmbeddingModelClient } from '../../types/embedding'

import { getEmbeddingModelClient } from './embedding'

// TODO: do we really need this class? It seems like unnecessary abstraction.
export class RAGEngine {
  private app: App
  private settings: SmartComposerSettings
  private vectorManager: VectorManager | null = null
  private embeddingModel: EmbeddingModelClient | null = null
  private cleanupController = new AbortController()
  private operations = new Set<Promise<unknown>>()
  private closing = false

  constructor(
    app: App,
    settings: SmartComposerSettings,
    vectorManager: VectorManager,
  ) {
    this.app = app
    this.settings = settings
    this.vectorManager = vectorManager
    this.embeddingModel = getEmbeddingModelClient({
      settings,
      embeddingModelId: settings.embeddingModelId,
    })
  }

  async cleanup(): Promise<void> {
    this.closing = true
    this.cleanupController.abort()
    await Promise.all(
      [...this.operations].map((operation) => operation.catch(() => undefined)),
    )
    this.embeddingModel = null
    this.vectorManager = null
  }

  // TODO: use addSettingsChangeListener
  setSettings(settings: SmartComposerSettings) {
    this.settings = settings
    this.embeddingModel = getEmbeddingModelClient({
      settings,
      embeddingModelId: settings.embeddingModelId,
    })
  }

  // TODO: Implement automatic vault re-indexing when settings are changed.
  // Currently, users must manually re-index the vault.
  async updateVaultIndex(
    options: {
      reindexAll: boolean
      scope?: VectorScope
      signal?: AbortSignal
    } = {
      reindexAll: false,
    },
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void,
  ): Promise<void> {
    return this.runOperation(options.signal, (signal) =>
      this.updateVaultIndexInternal(
        { ...options, signal },
        onQueryProgressChange,
      ),
    )
  }

  async processQuery({
    query,
    scope,
    onQueryProgressChange,
    signal,
  }: {
    query: string
    scope?: VectorScope
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void
    signal?: AbortSignal
  }): Promise<
    (Omit<SelectEmbedding, 'embedding'> & {
      similarity: number
    })[]
  > {
    return this.runOperation(signal, async (operationSignal) => {
      if (!this.embeddingModel) {
        throw new Error('Embedding model is not set')
      }
      // TODO: Decide the vault index update strategy.
      // Current approach: Update on every query.
      await this.updateVaultIndexInternal(
        { reindexAll: false, scope, signal: operationSignal },
        onQueryProgressChange,
      )
      const queryEmbedding = await this.getQueryEmbedding(
        query,
        operationSignal,
      )
      onQueryProgressChange?.({
        type: 'querying',
      })
      const queryResult =
        (await this.vectorManager?.performSimilaritySearch(
          queryEmbedding,
          this.embeddingModel,
          {
            minSimilarity: this.settings.ragOptions.minSimilarity,
            limit: this.settings.ragOptions.limit,
            scope,
            excludePatterns: this.settings.ragOptions.excludePatterns,
            includePatterns: this.settings.ragOptions.includePatterns,
          },
        )) ?? []
      onQueryProgressChange?.({
        type: 'querying-done',
        queryResult,
      })
      return queryResult
    })
  }

  private async updateVaultIndexInternal(
    options: {
      reindexAll: boolean
      scope?: VectorScope
      signal?: AbortSignal
    },
    onQueryProgressChange?: (queryProgress: QueryProgressState) => void,
  ): Promise<void> {
    if (!this.embeddingModel) {
      throw new Error('Embedding model is not set')
    }
    await this.vectorManager?.updateVaultIndex(
      this.embeddingModel,
      {
        chunkSize: this.settings.ragOptions.chunkSize,
        excludePatterns: this.settings.ragOptions.excludePatterns,
        includePatterns: this.settings.ragOptions.includePatterns,
        reindexAll: options.reindexAll,
        scope: options.scope,
        signal: options.signal,
      },
      (indexProgress) => {
        onQueryProgressChange?.({
          type: 'indexing',
          indexProgress,
        })
      },
    )
  }

  private async getQueryEmbedding(
    query: string,
    signal?: AbortSignal,
  ): Promise<number[]> {
    if (!this.embeddingModel) {
      throw new Error('Embedding model is not set')
    }
    return this.embeddingModel.getEmbedding(query, {
      purpose: 'query',
      signal,
    })
  }

  private runOperation<T>(
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closing) {
      return Promise.reject(new DOMException('Operation aborted', 'AbortError'))
    }
    const controller = new AbortController()
    const signals = [this.cleanupController.signal, signal].filter(
      (value): value is AbortSignal => Boolean(value),
    )
    const abort = (event: Event) => {
      const source = event.target as AbortSignal
      controller.abort(source.reason)
    }
    for (const source of signals) {
      if (source.aborted) {
        controller.abort(source.reason)
      } else {
        source.addEventListener('abort', abort, { once: true })
      }
    }
    const promise = operation(controller.signal)
    this.operations.add(promise)
    const cleanup = () => {
      for (const source of signals) {
        source.removeEventListener('abort', abort)
      }
      this.operations.delete(promise)
    }
    void promise.then(cleanup, cleanup)
    return promise
  }
}
