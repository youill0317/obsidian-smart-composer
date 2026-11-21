import OpenAI from 'openai'
import { ReasoningEffort } from 'openai/resources/shared'

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
import { CodexMessageAdapter } from './codexMessageAdapter'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMRateLimitExceededException,
} from './exception'
import { REASONING_EFFORTS } from './modelCompatibility'

export class OpenAIAuthenticatedProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'openai' }>
> {
  private client: OpenAI
  private responsesAdapter: CodexMessageAdapter

  constructor(provider: Extract<LLMProvider, { type: 'openai' }>) {
    super(provider)
    this.client = new OpenAI({
      apiKey: provider.apiKey ?? '',
      baseURL: provider.baseUrl
        ? provider.baseUrl.replace(/\/+$/, '')
        : undefined, // use default
      dangerouslyAllowBrowser: true,
    })
    this.responsesAdapter = new CodexMessageAdapter({
      endpoint: `${this.client.baseURL.replace(/\/+$/, '')}/responses`,
      includeMaxOutputTokens: true,
      fetchFn: async (input, init) => {
        const response = await fetch(input, init)
        if (!response.ok) {
          throw OpenAI.APIError.generate(
            response.status,
            undefined,
            await response.text(),
            response.headers,
          )
        }
        return response
      },
    })
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'openai') {
      throw new Error('Model is not an OpenAI model')
    }

    if (!this.client.apiKey) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} API key is missing. Please set it in settings menu.`,
      )
    }
    try {
      return await this.responsesAdapter.generateResponse(
        {
          ...request,
          reasoning_effort: getReasoningEffort(model),
          reasoning_summary: 'auto',
        },
        options,
        { Authorization: `Bearer ${this.client.apiKey}` },
      )
    } catch (error) {
      console.error('Error in generateResponse:', error)
      if (error instanceof OpenAI.AuthenticationError) {
        throw new LLMAPIKeyInvalidException(
          'OpenAI API key is invalid. Please update it in settings menu.',
          error,
        )
      }
      throw error
    }
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (model.providerType !== 'openai') {
      throw new Error('Model is not an OpenAI model')
    }

    if (!this.client.apiKey) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} API key is missing. Please set it in settings menu.`,
      )
    }
    try {
      return await this.responsesAdapter.streamResponse(
        {
          ...request,
          reasoning_effort: getReasoningEffort(model),
          reasoning_summary: 'auto',
        },
        options,
        { Authorization: `Bearer ${this.client.apiKey}` },
      )
    } catch (error) {
      console.error('Error in streamResponse:', error)
      if (error instanceof OpenAI.AuthenticationError) {
        throw new LLMAPIKeyInvalidException(
          'OpenAI API key is invalid. Please update it in settings menu.',
          error,
        )
      }
      throw error
    }
  }

  async getEmbedding(
    model: string,
    text: string,
    options?: { dimensions?: number },
  ): Promise<number[]> {
    if (!this.client.apiKey) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} API key is missing. Please set it in settings menu.`,
      )
    }

    try {
      const embedding = await this.client.embeddings.create({
        model: model,
        input: text,
        ...(options?.dimensions && { dimensions: options.dimensions }),
      })
      return embedding.data[0].embedding
    } catch (error) {
      if (error.status === 429) {
        throw new LLMRateLimitExceededException(
          'OpenAI API rate limit exceeded. Please try again later.',
        )
      }
      throw error
    }
  }
}

function getReasoningEffort(
  model: ChatModel & { providerType: 'openai' },
): ReasoningEffort | undefined {
  const effort = model.reasoning?.reasoning_effort
  return effort && (REASONING_EFFORTS as readonly string[]).includes(effort)
    ? (effort as ReasoningEffort)
    : undefined
}
