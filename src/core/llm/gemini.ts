import {
  Content,
  FunctionCall,
  FunctionCallingConfigMode,
  FunctionDeclaration,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
  Schema,
  Tool as GeminiTool,
  Type,
} from '@google/genai'
import { v4 as uuidv4 } from 'uuid'

import { ChatModel } from '../../types/chat-model.types'
import {
  LLMOptions,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
  RequestMessage,
  RequestTool,
} from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
} from '../../types/llm/response'
import { LLMProvider } from '../../types/provider.types'
import { parseImageDataUrl } from '../../utils/llm/image'

import { BaseLLMProvider } from './base'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
  LLMRateLimitExceededException,
} from './exception'

/**
 * GeminiProvider using '@google/genai' SDK
 * Documentation: https://googleapis.github.io/js-genai/
 */

/**
 * Note on OpenAI Compatibility API:
 * Gemini provides an OpenAI-compatible endpoint (https://ai.google.dev/gemini-api/docs/openai)
 * which allows using the OpenAI SDK with Gemini models. However, there are currently CORS issues
 * preventing its use in Obsidian. Consider switching to this endpoint in the future once these
 * issues are resolved.
 */
export class GeminiProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'gemini' }>
> {
  private client: GoogleGenAI
  private apiKey: string

  constructor(provider: Extract<LLMProvider, { type: 'gemini' }>) {
    super(provider)
    if (provider.baseUrl) {
      throw new Error('Gemini does not support custom base URL')
    }

    this.client = new GoogleGenAI({ apiKey: provider.apiKey ?? '' })
    this.apiKey = provider.apiKey ?? ''
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'gemini') {
      throw new Error('Model is not a Gemini model')
    }

    if (!this.apiKey) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} API key is missing. Please set it in settings menu.`,
      )
    }

    const systemMessages = request.messages.filter((m) => m.role === 'system')
    const systemInstruction: string | undefined =
      systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join('\n')
        : undefined

    try {
      const result = await this.client.models.generateContent({
        model: request.model,
        contents: request.messages
          .map((message) => GeminiProvider.parseRequestMessage(message))
          .filter((m): m is Content => m !== null),
        config: {
          maxOutputTokens: request.max_tokens,
          temperature: request.temperature,
          topP: request.top_p,
          presencePenalty: request.presence_penalty,
          frequencyPenalty: request.frequency_penalty,
          systemInstruction: systemInstruction,
          tools: request.tools?.map((tool) =>
            GeminiProvider.parseRequestTool(tool),
          ),
          abortSignal: options?.signal,
        },
      })

      const messageId = crypto.randomUUID() // Gemini does not return a message id
      return GeminiProvider.parseNonStreamingResponse(
        result,
        request.model,
        messageId,
      )
    } catch (error) {
      const isInvalidApiKey =
        error.message?.includes('API_KEY_INVALID') ||
        error.message?.includes('API key not valid')

      if (isInvalidApiKey) {
        throw new LLMAPIKeyInvalidException(
          `Provider ${this.provider.id} API key is invalid. Please update it in settings menu.`,
          error as Error,
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
    if (model.providerType !== 'gemini') {
      throw new Error('Model is not a Gemini model')
    }

    if (!this.apiKey) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} API key is missing. Please set it in settings menu.`,
      )
    }

    const systemMessages = request.messages.filter((m) => m.role === 'system')
    const systemInstruction: string | undefined =
      systemMessages.length > 0
        ? systemMessages.map((m) => m.content).join('\n')
        : undefined

    try {
      const stream = await this.client.models.generateContentStream({
        model: request.model,
        contents: request.messages
          .map((message) => GeminiProvider.parseRequestMessage(message))
          .filter((m): m is Content => m !== null),
        config: {
          maxOutputTokens: request.max_tokens,
          temperature: request.temperature,
          topP: request.top_p,
          presencePenalty: request.presence_penalty,
          frequencyPenalty: request.frequency_penalty,
          systemInstruction: systemInstruction,
          tools: request.tools?.map((tool) =>
            GeminiProvider.parseRequestTool(tool),
          ),
          abortSignal: options?.signal,
        },
      })

      const messageId = crypto.randomUUID() // Gemini does not return a message id
      return this.streamResponseGenerator(stream, request.model, messageId)
    } catch (error) {
      const isInvalidApiKey =
        error.message?.includes('API_KEY_INVALID') ||
        error.message?.includes('API key not valid')

      if (isInvalidApiKey) {
        throw new LLMAPIKeyInvalidException(
          `Gemini API key is invalid. Please update it in settings menu.`,
          error as Error,
        )
      }

      throw error
    }
  }

  private async *streamResponseGenerator(
    stream: AsyncGenerator<GenerateContentResponse, unknown, unknown>,
    model: string,
    messageId: string,
  ): AsyncIterable<LLMResponseStreaming> {
    for await (const chunk of stream) {
      yield GeminiProvider.parseStreamingResponseChunk(chunk, model, messageId)
    }
  }

  static parseRequestMessage(message: RequestMessage): Content | null {
    switch (message.role) {
      case 'system':
        // System messages should be extracted and handled separately
        return null
      case 'user': {
        const contentParts: Part[] = Array.isArray(message.content)
          ? message.content.map((part) => {
              switch (part.type) {
                case 'text':
                  return { text: part.text }
                case 'image_url': {
                  const { mimeType, base64Data } = parseImageDataUrl(
                    part.image_url.url,
                  )
                  GeminiProvider.validateImageType(mimeType)

                  return {
                    inlineData: {
                      data: base64Data,
                      mimeType,
                    },
                  }
                }
              }
            })
          : [{ text: message.content }]

        return {
          role: 'user',
          parts: contentParts,
        }
      }
      case 'assistant': {
        const contentParts: Part[] = [
          ...(message.content === '' ? [] : [{ text: message.content }]),
          ...(message.tool_calls?.map((toolCall): Part => {
            try {
              const args = JSON.parse(toolCall.arguments ?? '{}')
              return {
                functionCall: {
                  name: toolCall.name,
                  args,
                },
              }
            } catch (error) {
              // If the arguments are not valid JSON, return an empty object
              return {
                functionCall: {
                  name: toolCall.name,
                  args: {},
                },
              }
            }
          }) ?? []),
        ]

        if (message.geminiThoughtSignature) {
          contentParts.push(message.geminiThoughtSignature as Part)
        }

        if (contentParts.length === 0) {
          return null
        }

        return {
          role: 'model',
          parts: contentParts,
        }
      }
      case 'tool': {
        return {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: message.tool_call.name,
                response: { result: message.content }, // Gemini requires a response object
              },
            },
          ],
        }
      }
    }
  }

  static parseNonStreamingResponse(
    response: GenerateContentResponse,
    model: string,
    messageId: string,
  ): LLMResponseNonStreaming {
    const thoughtSignaturePart =
      GeminiProvider.extractThoughtSignaturePart(response)

    return {
      id: messageId,
      choices: [
        {
          finish_reason:
            response.candidates?.[0]?.finishReason ?? null,
          message: {
            content: response.text ?? '',
            role: 'assistant',
            tool_calls: response.functionCalls?.map((f: FunctionCall) => ({
              id: uuidv4(),
              type: 'function',
              function: {
                name: f.name ?? '',
                arguments: JSON.stringify(f.args),
              },
            })),
            geminiThoughtSignature: thoughtSignaturePart,
          },
        },
      ],
      created: Date.now(),
      model: model,
      object: 'chat.completion',
      usage: response.usageMetadata
        ? {
            prompt_tokens: response.usageMetadata.promptTokenCount ?? 0,
            completion_tokens:
              response.usageMetadata.candidatesTokenCount ?? 0,
            total_tokens: response.usageMetadata.totalTokenCount ?? 0,
          }
        : undefined,
    }
  }

  static parseStreamingResponseChunk(
    chunk: GenerateContentResponse,
    model: string,
    messageId: string,
  ): LLMResponseStreaming {
    const thoughtSignaturePart =
      GeminiProvider.extractThoughtSignaturePart(chunk)

    return {
      id: messageId,
      choices: [
        {
          finish_reason: chunk.candidates?.[0]?.finishReason ?? null,
          delta: {
            content: chunk.text ?? '',
            tool_calls: chunk.functionCalls?.map((f: FunctionCall, index: number) => ({
              index,
              id: uuidv4(),
              type: 'function',
              function: {
                name: f.name ?? '',
                arguments: JSON.stringify(f.args),
              },
            })),
            geminiThoughtSignature: thoughtSignaturePart,
          },
        },
      ],
      created: Date.now(),
      model: model,
      object: 'chat.completion.chunk',
      usage: chunk.usageMetadata
        ? {
            prompt_tokens: chunk.usageMetadata.promptTokenCount ?? 0,
            completion_tokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
            total_tokens: chunk.usageMetadata.totalTokenCount ?? 0,
          }
        : undefined,
    }
  }

  private static removeAdditionalProperties(schema: unknown): unknown {
    // TODO: Remove this function when Gemini supports additionalProperties field in JSON schema
    if (typeof schema !== 'object' || schema === null) {
      return schema
    }

    if (Array.isArray(schema)) {
      return schema.map((item) => this.removeAdditionalProperties(item))
    }

    const { additionalProperties: _, ...rest } = schema as Record<
      string,
      unknown
    >

    return Object.fromEntries(
      Object.entries(rest).map(([key, value]) => [
        key,
        this.removeAdditionalProperties(value),
      ]),
    )
  }

  private static parseRequestTool(tool: RequestTool): GeminiTool {
    // Gemini does not support additionalProperties field in JSON schema, so we need to clean it
    const cleanedParameters = this.removeAdditionalProperties(
      tool.function.parameters,
    ) as Record<string, unknown>

    const functionDeclaration: FunctionDeclaration = {
      name: tool.function.name,
      description: tool.function.description,
      parameters: {
        type: Type.OBJECT,
        properties: (cleanedParameters.properties ?? {}) as Record<
          string,
          Schema
        >,
      },
    }

    return {
      functionDeclarations: [functionDeclaration],
    }
  }

  private static validateImageType(mimeType: string) {
    const SUPPORTED_IMAGE_TYPES = [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/heic',
      'image/heif',
    ]
    if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
      throw new Error(
        `Gemini does not support image type ${mimeType}. Supported types: ${SUPPORTED_IMAGE_TYPES.join(
          ', ',
        )}`,
      )
    }
  }

  async getEmbedding(model: string, text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} API key is missing. Please set it in settings menu.`,
      )
    }

    try {
      const response = await this.client.models.embedContent({
        model: model,
        contents: text,
      })
      return response.embeddings?.[0]?.values ?? []
    } catch (error) {
      if (error.status === 429) {
        throw new LLMRateLimitExceededException(
          'Gemini API rate limit exceeded. Please try again later.',
        )
      }
      throw error
    }
  }

  private static extractThoughtSignaturePart(
    response: GenerateContentResponse,
  ): Part | undefined {
    const parts = response.candidates?.[0]?.content?.parts
    if (!Array.isArray(parts)) {
      return undefined
    }

    return parts.find((part) => {
      if (!part || typeof part !== 'object') {
        return false
      }
      const record = part as Record<string, unknown>
      return (
        Object.prototype.hasOwnProperty.call(record, 'thoughtSignature') ||
        Object.prototype.hasOwnProperty.call(record, 'thought_signature')
      )
    })
  }
}
