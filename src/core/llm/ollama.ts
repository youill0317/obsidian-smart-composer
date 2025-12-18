/**
 * This provider is nearly identical to OpenAICompatibleProvider, but uses a custom OpenAI client
 * (NoStainlessOpenAI) to work around CORS issues specific to Ollama.
 */

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
import { NoStainlessOpenAI } from './NoStainlessOpenAI'
import { OpenAIMessageAdapter } from './openaiMessageAdapter'

export class OllamaProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'ollama' }>
> {
  private adapter: OpenAIMessageAdapter
  private client: NoStainlessOpenAI

  constructor(provider: Extract<LLMProvider, { type: 'ollama' }>) {
    super(provider)
    this.adapter = new OpenAIMessageAdapter()
    this.client = new NoStainlessOpenAI({
      baseURL: `${provider.baseUrl ? provider.baseUrl.replace(/\/+$/, '') : 'http://127.0.0.1:11434'}/v1`,
      apiKey: provider.apiKey ?? '',
      dangerouslyAllowBrowser: true,
    })
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'ollama') {
      throw new Error('Model is not an Ollama model')
    }

    return this.adapter.generateResponse(
      this.client,
      {
        ...request,
        reasoning_effort: model.reasoning?.enabled
          ? (model.reasoning.reasoning_effort as any)
          : undefined,
        thinking: model.thinking?.enabled
          ? {
              type: 'enabled',
              budget_tokens: model.thinking.budget_tokens,
            }
          : undefined,
      },
      options,
    )
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (model.providerType !== 'ollama') {
      throw new Error('Model is not an Ollama model')
    }

    return this.adapter.streamResponse(
      this.client,
      {
        ...request,
        reasoning_effort: model.reasoning?.enabled
          ? (model.reasoning.reasoning_effort as any)
          : undefined,
        thinking: model.thinking?.enabled
          ? {
              type: 'enabled',
              budget_tokens: model.thinking.budget_tokens,
            }
          : undefined,
      },
      options,
    )
  }

  async getEmbedding(model: string, text: string): Promise<number[]> {
    const embedding = await this.client.embeddings.create({
      model: model,
      input: text,
      encoding_format: 'float',
    })
    return embedding.data[0].embedding
  }
}
