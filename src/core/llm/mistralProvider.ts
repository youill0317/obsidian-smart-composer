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

import { BaseLLMProvider } from './base'
import { MistralMessageAdapter } from './mistralMessageAdapter'
import { NoStainlessOpenAI } from './NoStainlessOpenAI'

export class MistralProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'mistral' }>
> {
  private adapter: MistralMessageAdapter
  private client: NoStainlessOpenAI

  constructor(provider: Extract<LLMProvider, { type: 'mistral' }>) {
    super(provider)
    this.adapter = new MistralMessageAdapter()
    this.client = new NoStainlessOpenAI({
      apiKey: provider.apiKey ?? '',
      baseURL: provider.baseUrl
        ? provider.baseUrl.replace(/\/+$/, '')
        : 'https://api.mistral.ai/v1',
      dangerouslyAllowBrowser: true,
    })
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'mistral') {
      throw new Error('Model is not a Mistral model')
    }

    return this.adapter.generateResponse(this.client, request, options)
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (model.providerType !== 'mistral') {
      throw new Error('Model is not a Mistral model')
    }

    return this.adapter.streamResponse(this.client, request, options)
  }

  override getContextWindow(model: string): Promise<number | undefined> {
    return this.lookupContextWindow(
      model,
      async () =>
        // The installed SDK types do not know Mistral's `max_context_length`.
        (
          (await this.client.models.retrieve(model, {
            timeout: BaseLLMProvider.MODEL_LIMIT_LOOKUP_TIMEOUT_MS,
            maxRetries: 0,
          })) as { max_context_length?: number }
        ).max_context_length,
    )
  }

  async getEmbedding(
    _model: string,
    _text: string,
    _options?: { dimensions?: number },
  ): Promise<number[]> {
    throw new Error(
      `Provider ${this.provider.id} does not support embeddings. Please use a different provider.`,
    )
  }
}
