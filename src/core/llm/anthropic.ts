import Anthropic from '@anthropic-ai/sdk'
import {
  Tool as AnthropicTool,
  ToolChoice as AnthropicToolChoice,
  Base64ImageSource,
  ContentBlockParam,
  ImageBlockParam,
  MessageCreateParamsBase,
  MessageParam,
  MessageStreamEvent,
  TextBlockParam,
  ThinkingConfigParam,
} from '@anthropic-ai/sdk/resources/messages'

import { ChatModel } from '../../types/chat-model.types'
import {
  AnthropicCompactionBlock,
  LLMOptions,
  LLMRequest,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
  RequestMessage,
  RequestTool,
  RequestToolChoice,
} from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
  ResponseUsage,
  ToolCall,
} from '../../types/llm/response'
import { LLMProvider } from '../../types/provider.types'
import { parseImageDataUrl } from '../../utils/llm/image'

import { BaseLLMProvider } from './base'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
} from './exception'
import {
  REASONING_EFFORTS,
  getClaudeMaxOutputTokens,
} from './modelCompatibility'

type UsageIteration = {
  type?: string
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export class AnthropicProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'anthropic' }>
> {
  private client: Anthropic

  private static readonly DEFAULT_MAX_TOKENS = 8192
  private static readonly COMPACTION_BETA = 'compact-2026-01-12'
  private static readonly COMPACTION_INSTRUCTIONS =
    'Summarize the transcript inside <summary></summary> tags. Include relevant information in the summary for continuing the task in the next context window. Do not call any tools while writing this summary; respond with text only.'
  private static readonly MODEL_LOOKUP_TIMEOUT_MS = 3000
  // Max output per provider and model from the Models API (null: unknown)
  private static readonly maxOutputTokensCache = new Map<
    string,
    number | null
  >()

  constructor(provider: Extract<LLMProvider, { type: 'anthropic' }>) {
    super(provider)
    this.client = new Anthropic({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl
        ? provider.baseUrl.replace(/\/+$/, '')
        : undefined, // use default
      dangerouslyAllowBrowser: true,
    })
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'anthropic') {
      throw new Error('Model is not a Anthropic model')
    }

    if (!this.client.apiKey) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} API key is missing. Please set it in settings menu.`,
      )
    }

    const { body, headers } = AnthropicProvider.buildRequest(
      model,
      request,
      await this.getMaxTokens(model, request, options),
    )

    try {
      // Streamed even here: the SDK rejects non-streaming requests whose
      // max_tokens could take longer than ten minutes.
      const stream = await this.client.messages.create(
        { ...body, stream: true },
        { signal: options?.signal, headers },
      )
      const response = await AnthropicProvider.collectMessage(stream)

      return AnthropicProvider.parseNonStreamingResponse(response)
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        // Anthropic's CORS Policy Change (March 2025)
        // Issue: https://github.com/glowingjade/obsidian-smart-composer/issues/286
        //
        // Anthropic recently changed their CORS policy for new individual accounts:
        // - New individual accounts now have CORS restrictions by default
        // - The error occurs even with valid API keys and anthropic-dangerous-direct-browser-access: true
        // - The error message contains "CORS requests are not allowed for this Organization"
        //
        // Solution: Users need to create an organization in their Anthropic account
        if (
          error.message.includes(
            'CORS requests are not allowed for this Organization',
          )
        ) {
          throw new LLMAPIKeyInvalidException(
            `Provider ${this.provider.id} is experiencing a CORS issue. This is a known issue with new individual Anthropic accounts.

To resolve this issue:

1. Go to https://console.anthropic.com/settings/organization
2. Create a new organization
3. Your API key should work properly after creating an organization

For more information, please refer to the following issue:
https://github.com/glowingjade/obsidian-smart-composer/issues/286`,
            error,
          )
        }
        throw new LLMAPIKeyInvalidException(
          `Provider ${this.provider.id} API key is invalid. Please update it in settings menu.`,
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
    if (model.providerType !== 'anthropic') {
      throw new Error('Model is not a Anthropic model')
    }

    if (!this.client.apiKey) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} API key is missing. Please set it in settings menu.`,
      )
    }

    const { body, headers } = AnthropicProvider.buildRequest(
      model,
      request,
      await this.getMaxTokens(model, request, options),
    )

    try {
      const stream = await this.client.messages.create(
        { ...body, stream: true },
        { signal: options?.signal, headers },
      )

      return AnthropicProvider.streamResponseGenerator(stream)
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        // Anthropic's CORS Policy Change (March 2025)
        // Issue: https://github.com/glowingjade/obsidian-smart-composer/issues/286
        //
        // Anthropic recently changed their CORS policy for new individual accounts:
        // - New individual accounts now have CORS restrictions by default
        // - The error occurs even with valid API keys and anthropic-dangerous-direct-browser-access: true
        // - The error message contains "CORS requests are not allowed for this Organization"
        //
        // Solution: Users need to create an organization in their Anthropic account
        if (
          error.message.includes(
            'CORS requests are not allowed for this Organization',
          )
        ) {
          throw new LLMAPIKeyInvalidException(
            `Provider ${this.provider.id} is experiencing a CORS issue. This is a known issue with new individual Anthropic accounts.

To resolve this issue:

1. Go to https://console.anthropic.com/settings/organization
2. Create a new organization
3. Your API key should work properly after creating an organization

For more information, please refer to the following issue:
https://github.com/glowingjade/obsidian-smart-composer/issues/286`,
            error,
          )
        }
        throw new LLMAPIKeyInvalidException(
          `Provider ${this.provider.id} API key is invalid. Please update it in settings menu.`,
          error,
        )
      }

      throw error
    }
  }

  static buildRequest(
    model: ChatModel & { providerType: 'anthropic' },
    request: LLMRequest,
    maxTokens: number,
  ): { body: MessageCreateParamsBase; headers: Record<string, string> } {
    const systemMessage = AnthropicProvider.validateSystemMessages(
      request.messages,
    )

    const body: MessageCreateParamsBase = {
      model: request.model,
      messages: AnthropicProvider.addCacheBreakpoints(
        AnthropicProvider.buildMessages(request.messages),
      ),
      system: systemMessage
        ? [
            {
              type: 'text',
              text: systemMessage,
              cache_control: { type: 'ephemeral' },
            },
          ]
        : undefined,
      // The installed SDK has no types for adaptive thinking and
      // `output_config`, so they are typed as the legacy thinking param.
      ...(AnthropicProvider.buildThinkingParams(model) as {
        thinking?: ThinkingConfigParam
      }),
      tools: request.tools?.map((t) => AnthropicProvider.parseRequestTool(t)),
      tool_choice: request.tool_choice
        ? AnthropicProvider.parseRequestToolChoice(request.tool_choice)
        : undefined,
      max_tokens: maxTokens,
      temperature: request.temperature,
      top_p: request.top_p,
      // The installed SDK has no types for `context_management`.
      ...({
        context_management: {
          edits: [
            {
              type: 'compact_20260112',
              // With tools defined, the model may call one instead of
              // summarizing, which yields a compaction block without content.
              ...(!!request.tools?.length && {
                instructions: AnthropicProvider.COMPACTION_INSTRUCTIONS,
              }),
            },
          ],
        },
      } as object),
    }
    return {
      body,
      headers: { 'anthropic-beta': AnthropicProvider.COMPACTION_BETA },
    }
  }

  // The model's maximum output, from the known models or else the Models API.
  // If neither knows it, the previous default is kept, since asking for more
  // than a model allows is rejected.
  private async getMaxTokens(
    model: ChatModel & { providerType: 'anthropic' },
    request: LLMRequest,
    options?: LLMOptions,
  ): Promise<number> {
    if (request.max_tokens) return request.max_tokens
    const known = getClaudeMaxOutputTokens(model.model)
    if (known) return known

    const key = `${this.provider.id}/${model.model}`
    if (!AnthropicProvider.maxOutputTokensCache.has(key)) {
      try {
        const info = await this.client.models.retrieve(
          encodeURIComponent(model.model),
          {
            signal: options?.signal,
            timeout: AnthropicProvider.MODEL_LOOKUP_TIMEOUT_MS,
            maxRetries: 0,
          },
        )
        // The installed SDK types predate `max_tokens` on model info.
        const max = (info as { max_tokens?: number | null }).max_tokens
        AnthropicProvider.maxOutputTokensCache.set(
          key,
          typeof max === 'number' && max > 0 ? max : null,
        )
      } catch {
        if (!options?.signal?.aborted) {
          AnthropicProvider.maxOutputTokensCache.set(key, null)
        }
      }
    }
    return (
      AnthropicProvider.maxOutputTokensCache.get(key) ??
      AnthropicProvider.DEFAULT_MAX_TOKENS
    )
  }

  // Thinking is adaptive and always on. It takes `output_config.effort` and
  // an optional summary display.
  static buildThinkingParams(
    model: ChatModel & { providerType: 'anthropic' },
  ): Record<string, unknown> {
    const { effort, show_summaries } = model.adaptive_thinking ?? {}
    return {
      ...(show_summaries && {
        thinking: { type: 'adaptive', display: 'summarized' },
      }),
      ...(effort &&
        (REASONING_EFFORTS as readonly string[]).includes(effort) && {
          output_config: { effort },
        }),
    }
  }

  static async *streamResponseGenerator(
    stream: AsyncIterable<MessageStreamEvent>,
  ): AsyncIterable<LLMResponseStreaming> {
    let messageId = ''
    let model = ''
    let usage: Anthropic.Usage | undefined
    // Compaction blocks by index. The SDK types do not know them.
    const compactions = new Map<number, string | null>()

    for await (const chunk of stream) {
      if (chunk.type === 'message_start') {
        messageId = chunk.message.id
        model = chunk.message.model
        usage = chunk.message.usage
      } else if (
        chunk.type === 'content_block_start' &&
        (chunk.content_block as { type: string }).type === 'compaction'
      ) {
        const block = chunk.content_block as { content?: string | null }
        compactions.set(chunk.index, block.content ?? null)
      } else if (
        chunk.type === 'content_block_delta' &&
        (chunk.delta as { type: string }).type === 'compaction_delta'
      ) {
        const delta = chunk.delta as { content?: string | null }
        compactions.set(chunk.index, delta.content ?? null)
      } else if (
        chunk.type === 'content_block_start' ||
        chunk.type === 'content_block_delta'
      ) {
        const parsedChunk = AnthropicProvider.parseStreamingResponseChunk(
          chunk,
          messageId,
          model,
        )
        if (parsedChunk !== null) {
          yield parsedChunk
        }
      } else if (chunk.type === 'content_block_stop') {
        const content = compactions.get(chunk.index)
        if (typeof content === 'string') {
          yield {
            id: messageId,
            choices: [
              {
                finish_reason: null,
                delta: {
                  providerMetadata: {
                    anthropic: { compaction: { type: 'compaction', content } },
                  },
                },
              },
            ],
            object: 'chat.completion.chunk',
            model: model,
          }
        }
      } else if (chunk.type === 'message_delta') {
        usage = AnthropicProvider.mergeUsage(usage, chunk.usage)
      }
    }

    // After the stream is complete, yield the final usage
    yield {
      id: messageId,
      choices: [],
      object: 'chat.completion.chunk',
      model: model,
      usage: usage
        ? AnthropicProvider.parseUsage(usage)
        : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }
  }

  // Rebuilds the final message from a stream, keeping block types the SDK
  // types do not know (compaction).
  static async collectMessage(
    stream: AsyncIterable<MessageStreamEvent>,
  ): Promise<Anthropic.Message> {
    let message: Anthropic.Message | undefined
    const blocks: {
      type: string
      text?: string
      thinking?: string
      input?: unknown
      content?: string | null
    }[] = []
    const toolInputs = new Map<number, string>()

    for await (const event of stream) {
      if (event.type === 'message_start') {
        message = event.message
      } else if (event.type === 'content_block_start') {
        blocks[event.index] = { ...event.content_block }
      } else if (event.type === 'content_block_delta') {
        const block = blocks[event.index]
        const delta = event.delta as {
          type: string
          text?: string
          thinking?: string
          partial_json?: string
          content?: string | null
        }
        if (!block) continue
        if (delta.type === 'text_delta') {
          block.text = (block.text ?? '') + (delta.text ?? '')
        } else if (delta.type === 'thinking_delta') {
          block.thinking = (block.thinking ?? '') + (delta.thinking ?? '')
        } else if (delta.type === 'input_json_delta') {
          toolInputs.set(
            event.index,
            (toolInputs.get(event.index) ?? '') + (delta.partial_json ?? ''),
          )
        } else if (delta.type === 'compaction_delta') {
          block.content = delta.content ?? null
        }
      } else if (event.type === 'content_block_stop') {
        const json = toolInputs.get(event.index)
        if (json && blocks[event.index]) {
          blocks[event.index].input = JSON.parse(json) as unknown
        }
      } else if (event.type === 'message_delta' && message) {
        message = {
          ...message,
          stop_reason: event.delta.stop_reason,
          usage:
            AnthropicProvider.mergeUsage(message.usage, event.usage) ??
            message.usage,
        }
      }
    }

    if (!message) {
      throw new Error('Anthropic stream ended without a message')
    }
    return {
      ...message,
      content: blocks.filter(Boolean) as unknown as Anthropic.ContentBlock[],
    }
  }

  // message_delta usage is cumulative, so its counts replace earlier ones.
  private static mergeUsage(
    usage: Anthropic.Usage | undefined,
    delta: Partial<Anthropic.Usage> | null | undefined,
  ): Anthropic.Usage | undefined {
    if (!delta) return usage
    const defined = Object.fromEntries(
      Object.entries(delta).filter(([, value]) => value != null),
    )
    return { ...usage, ...defined } as Anthropic.Usage
  }

  // The latest compaction block replaces everything before its assistant
  // message, so the earlier messages are not sent.
  static buildMessages(messages: RequestMessage[]): MessageParam[] {
    let start = 0
    messages.forEach((message, index) => {
      if (
        message.role === 'assistant' &&
        message.providerMetadata?.anthropic?.compaction
      ) {
        start = index
      }
    })
    return messages
      .slice(start)
      .map((m) => AnthropicProvider.parseRequestMessage(m))
      .filter((m) => m !== null)
  }

  static parseRequestMessage(message: RequestMessage): MessageParam | null {
    switch (message.role) {
      case 'user': {
        if (Array.isArray(message.content)) {
          const content = message.content.map(
            (part): TextBlockParam | ImageBlockParam => {
              switch (part.type) {
                case 'text':
                  return { type: 'text', text: part.text }
                case 'image_url': {
                  const { mimeType, base64Data } = parseImageDataUrl(
                    part.image_url.url,
                  )
                  AnthropicProvider.validateImageType(mimeType)
                  return {
                    type: 'image',
                    source: {
                      data: base64Data,
                      media_type: mimeType as Base64ImageSource['media_type'],
                      type: 'base64',
                    },
                  }
                }
              }
            },
          )
          return { role: 'user', content }
        }
        return { role: 'user', content: message.content }
      }
      case 'assistant': {
        const anthropicToolCalls = message.tool_calls?.map(
          (toolCall): ContentBlockParam => {
            const parsedArgs = (() => {
              if (toolCall.arguments && toolCall.arguments.length > 0) {
                try {
                  return JSON.parse(toolCall.arguments) as unknown
                } catch (error) {
                  return {}
                }
              }
              return {}
            })()

            return {
              type: 'tool_use' as const,
              id: toolCall.id,
              name: toolCall.name,
              input: parsedArgs,
            }
          },
        )

        const compaction = message.providerMetadata?.anthropic?.compaction

        const messageContent = [
          // The installed SDK has no type for compaction blocks.
          ...(compaction ? [compaction as unknown as ContentBlockParam] : []),
          ...(message.content.trim() === ''
            ? []
            : [
                {
                  type: 'text' as const,
                  text: message.content,
                },
              ]),
          ...(anthropicToolCalls ? anthropicToolCalls : []),
        ]

        if (messageContent.length === 0) {
          // No content or tool calls, skip the message
          return null
        }

        return { role: 'assistant', content: messageContent }
      }
      case 'system': {
        // System messages should be extracted and handled separately
        return null
      }
      case 'tool': {
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: message.tool_call.id,
              content: message.content,
            },
          ],
        }
      }
    }
  }

  static parseNonStreamingResponse(
    response: Anthropic.Message,
  ): LLMResponseNonStreaming {
    const textContent = response.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('')

    const reasoningContent =
      response.content
        .filter((c) => c.type === 'thinking')
        .map((c) => c.thinking)
        .join('') || undefined

    const toolCalls: ToolCall[] = response.content
      .filter((c) => c.type === 'tool_use')
      .map((c): ToolCall => {
        return {
          id: c.id,
          type: 'function',
          function: {
            name: c.name,
            arguments: JSON.stringify(c.input),
          },
        }
      })

    // The last compaction block reflects the final prompt state. A block
    // without a summary compacted nothing and is not kept.
    let compaction: AnthropicCompactionBlock | undefined
    for (const block of response.content as { type: string }[]) {
      const content = (block as { content?: unknown }).content
      if (block.type === 'compaction' && typeof content === 'string') {
        compaction = { type: 'compaction', content }
      }
    }

    return {
      id: response.id,
      choices: [
        {
          finish_reason: response.stop_reason,
          message: {
            content: textContent,
            reasoning: reasoningContent,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            role: response.role,
            providerMetadata: compaction
              ? { anthropic: { compaction } }
              : undefined,
          },
        },
      ],
      model: response.model,
      object: 'chat.completion',
      usage: AnthropicProvider.parseUsage(response.usage),
    }
  }

  static parseStreamingResponseChunk(
    chunk: MessageStreamEvent,
    messageId: string,
    model: string,
  ): LLMResponseStreaming | null {
    if (
      chunk.type !== 'content_block_start' &&
      chunk.type !== 'content_block_delta'
    ) {
      throw new Error('Unsupported chunk type')
    }

    if (chunk.type === 'content_block_start') {
      if (chunk.content_block.type === 'tool_use') {
        return {
          id: messageId,
          choices: [
            {
              finish_reason: null,
              delta: {
                tool_calls: [
                  {
                    index: chunk.index,
                    id: chunk.content_block.id,
                    type: 'function',
                    function: {
                      name: chunk.content_block.name,
                      // arguments are not provided in the start event
                    },
                  },
                ],
              },
            },
          ],
          object: 'chat.completion.chunk',
          model: model,
        }
      }
    }

    if (chunk.type === 'content_block_delta') {
      if (chunk.delta.type === 'text_delta') {
        return {
          id: messageId,
          choices: [
            {
              finish_reason: null,
              delta: {
                content: chunk.delta.text,
              },
            },
          ],
          object: 'chat.completion.chunk',
          model: model,
        }
      } else if (chunk.delta.type === 'thinking_delta') {
        return {
          id: messageId,
          choices: [
            {
              finish_reason: null,
              delta: {
                reasoning: chunk.delta.thinking,
              },
            },
          ],
          object: 'chat.completion.chunk',
          model: model,
        }
      } else if (chunk.delta.type === 'input_json_delta') {
        return {
          id: messageId,
          choices: [
            {
              finish_reason: null,
              delta: {
                tool_calls: [
                  {
                    index: chunk.index,
                    function: {
                      arguments: chunk.delta.partial_json,
                    },
                  },
                ],
              },
            },
          ],
          object: 'chat.completion.chunk',
          model: model,
        }
      }
    }
    return null
  }

  // Message breakpoints, next to the one on the system prompt: the compaction
  // block, the end of the history before the newest user turn (so a change
  // inside that turn only rewrites what follows), and the last block. A
  // breakpoint already set is not counted twice, so at most four are sent.
  static addCacheBreakpoints(messages: MessageParam[]): MessageParam[] {
    const result = [...messages]
    const mark = (messageIndex: number, blockIndex?: number) => {
      const message = result[messageIndex]
      if (!message) return
      const content: ContentBlockParam[] =
        typeof message.content === 'string'
          ? [{ type: 'text', text: message.content }]
          : message.content
      const index = blockIndex ?? content.length - 1
      const block = content[index]
      if (!block || (block.type === 'text' && !block.text)) return
      result[messageIndex] = {
        ...message,
        content: content.map((b, i) =>
          i === index
            ? ({
                ...b,
                cache_control: { type: 'ephemeral' },
              } as ContentBlockParam)
            : b,
        ),
      }
    }

    result.forEach((message, messageIndex) => {
      if (typeof message.content === 'string') return
      message.content.forEach((block, blockIndex) => {
        if ((block as { type: string }).type === 'compaction') {
          mark(messageIndex, blockIndex)
        }
      })
    })

    // Tool results are sent as user messages but belong to the current turn.
    let newestUserTurn = -1
    result.forEach((message, index) => {
      if (
        message.role === 'user' &&
        (typeof message.content === 'string' ||
          message.content.some((block) => block.type !== 'tool_result'))
      ) {
        newestUserTurn = index
      }
    })
    if (newestUserTurn > 0) {
      mark(newestUserTurn - 1)
    }

    mark(result.length - 1)
    return result
  }

  // input_tokens excludes the tokens read from or written to the cache. With
  // compaction, the top-level counts leave out the compaction pass, which is
  // billed too and is only listed in `iterations`.
  private static parseUsage(usage: Anthropic.Usage): ResponseUsage {
    const iterations =
      (usage as { iterations?: UsageIteration[] }).iterations ?? []
    const parts: UsageIteration[] = [
      usage,
      ...iterations.filter((iteration) => iteration.type === 'compaction'),
    ]
    let promptTokens = 0
    let completionTokens = 0
    let cacheRead = 0
    let cacheWrite = 0
    for (const part of parts) {
      const read = part.cache_read_input_tokens ?? 0
      const write = part.cache_creation_input_tokens ?? 0
      promptTokens += (part.input_tokens ?? 0) + read + write
      completionTokens += part.output_tokens ?? 0
      cacheRead += read
      cacheWrite += write
    }
    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
    }
  }

  static validateSystemMessages(
    messages: RequestMessage[],
  ): string | undefined {
    const systemMessages = messages.filter((m) => m.role === 'system')
    if (systemMessages.length > 1) {
      throw new Error(`Anthropic does not support more than one system message`)
    }
    const systemMessage =
      systemMessages.length > 0 ? systemMessages[0].content : undefined
    if (systemMessage && typeof systemMessage !== 'string') {
      throw new Error(
        `Anthropic only supports string content for system messages`,
      )
    }
    return systemMessage
  }

  private static validateImageType(mimeType: string) {
    const SUPPORTED_IMAGE_TYPES = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ]
    if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
      throw new Error(
        `Anthropic does not support image type ${mimeType}. Supported types: ${SUPPORTED_IMAGE_TYPES.join(
          ', ',
        )}`,
      )
    }
  }

  static parseRequestTool(tool: RequestTool): AnthropicTool {
    return {
      name: tool.function.name,
      input_schema: {
        ...tool.function.parameters,
        type: 'object',
      },
      description: tool.function.description,
    }
  }

  static parseRequestToolChoice(
    toolChoice: RequestToolChoice,
  ): AnthropicToolChoice {
    if (toolChoice === 'none') {
      return {
        type: 'none',
      }
    }
    if (toolChoice === 'auto') {
      return {
        type: 'auto',
      }
    }
    if (toolChoice === 'required') {
      return {
        type: 'any',
      }
    }
    if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
      return {
        type: 'tool',
        name: toolChoice.function.name,
      }
    }
    throw new Error(`Unsupported tool choice: ${JSON.stringify(toolChoice)}`)
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
