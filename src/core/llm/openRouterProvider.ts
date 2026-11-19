import OpenAI from 'openai'
import {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions'

import { ChatModel } from '../../types/chat-model.types'
import {
  LLMOptions,
  LLMRequest,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
} from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
} from '../../types/llm/response'
import { LLMProvider } from '../../types/provider.types'

import { BaseLLMProvider } from './base'
import { OpenAIMessageAdapter } from './openaiMessageAdapter'

// OpenRouter's context-compression plugin shortens prompts that exceed the
// model's context window instead of failing the request.
class OpenRouterMessageAdapter extends OpenAIMessageAdapter {
  protected buildChatCompletionCreateParams(params: {
    request: LLMRequest
    stream: false
  }): ChatCompletionCreateParamsNonStreaming
  protected buildChatCompletionCreateParams(params: {
    request: LLMRequest
    stream: true
  }): ChatCompletionCreateParamsStreaming
  protected buildChatCompletionCreateParams({
    request,
    stream,
  }: {
    request: LLMRequest
    stream: boolean
  }):
    | ChatCompletionCreateParamsStreaming
    | ChatCompletionCreateParamsNonStreaming {
    const params = stream
      ? super.buildChatCompletionCreateParams({ request, stream: true })
      : super.buildChatCompletionCreateParams({ request, stream: false })
    return Object.assign(params, {
      plugins: [{ id: 'context-compression' }],
    })
  }
}

export class OpenRouterProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'openrouter' }>
> {
  private adapter: OpenRouterMessageAdapter
  private client: OpenAI

  constructor(provider: Extract<LLMProvider, { type: 'openrouter' }>) {
    super(provider)
    this.adapter = new OpenRouterMessageAdapter()
    this.client = new OpenAI({
      apiKey: provider.apiKey ?? '',
      baseURL: provider.baseUrl
        ? provider.baseUrl?.replace(/\/+$/, '')
        : 'https://openrouter.ai/api/v1',
      dangerouslyAllowBrowser: true,
    })
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'openrouter') {
      throw new Error('Model is not an OpenRouter model')
    }

    return this.adapter.generateResponse(this.client, request, options)
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (model.providerType !== 'openrouter') {
      throw new Error('Model is not an OpenRouter model')
    }

    return this.adapter.streamResponse(this.client, request, options)
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
