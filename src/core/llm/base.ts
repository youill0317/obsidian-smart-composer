import { ChatModel } from '../../types/chat-model.types'
import {
  LLMOptions,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
} from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
} from '../../types/llm/response'
import { LLMProvider } from '../../types/provider.types'

export type ProviderEmbeddingOptions = {
  dimensions?: number
  purpose?: 'query' | 'document'
}

const modelLimits = new Map<string, Promise<number | undefined>>()

// TODO: do these really have to be class? why not just function?
export abstract class BaseLLMProvider<P extends LLMProvider> {
  protected static readonly MODEL_LIMIT_LOOKUP_TIMEOUT_MS = 3000

  protected readonly provider: P
  constructor(provider: P) {
    this.provider = provider
  }

  // The model's context window from the provider's models API. Providers
  // without such an API report none.
  getContextWindow(_model: string): Promise<number | undefined> {
    return Promise.resolve(undefined)
  }

  // Looks a model up once per session; a failed lookup reports no window.
  protected lookupContextWindow(
    model: string,
    lookup: () => Promise<unknown>,
  ): Promise<number | undefined> {
    const key = `${this.provider.id}/${model}`
    let value = modelLimits.get(key)
    if (!value) {
      const pending: Promise<number | undefined> = lookup().then(
        (found) => (typeof found === 'number' && found > 0 ? found : undefined),
        () => undefined,
      )
      void pending.then((found) => {
        if (found === undefined && modelLimits.get(key) === pending)
          modelLimits.delete(key)
      })
      modelLimits.set(key, pending)
      value = pending
    }
    return value
  }

  abstract generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming>

  abstract streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>>

  abstract getEmbedding(
    model: string,
    text: string,
    options?: ProviderEmbeddingOptions,
  ): Promise<number[]>
}
