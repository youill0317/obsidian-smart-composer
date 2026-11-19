import OpenAI from 'openai'

import { ChatModel } from '../../types/chat-model.types'
import {
  LLMOptions,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
  RequestMessage,
  XaiCompactionItem,
  XaiProviderMetadata,
} from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
  ResponseUsage,
} from '../../types/llm/response'
import { LLMProvider } from '../../types/provider.types'
import { postJson } from '../../utils/llm/httpTransport'

import { BaseLLMProvider } from './base'
import { CodexMessageAdapter, buildCompactInput } from './codexMessageAdapter'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
} from './exception'
import {
  XAI_DEFAULT_CONTEXT_WINDOW,
  getXaiContextWindow,
} from './modelCompatibility'

// Images are not counted from their base64 size.
const IMAGE_TOKEN_ESTIMATE = 2_000

type PreparedRequest = {
  messages: RequestMessage[]
  head?: XaiCompactionItem
  // Set when this request was compacted; stored on the response.
  compaction?: Pick<XaiProviderMetadata, 'compaction' | 'tailLength'>
}

/**
 * xAI through its Responses API. xAI does not compact on its own, so a request
 * whose input reaches the context window is first compacted through
 * /responses/compact. The returned item is stored on the next assistant
 * message and heads the input of later requests in place of the messages it
 * replaced.
 */
export class XaiProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'xai' }>
> {
  private static readonly MODEL_LOOKUP_TIMEOUT_MS = 3000
  private static readonly COMPACT_RETRY_DELAY_MS = 5 * 60 * 1000
  // provider id/model -> context window from the Models API, null if unknown
  private static readonly contextWindowCache = new Map<string, number | null>()
  // provider id/model -> time of the last failed compaction
  private static readonly compactFailures = new Map<string, number>()

  private adapter: CodexMessageAdapter
  private baseUrl: string
  private fetchFn: typeof fetch

  constructor(provider: Extract<LLMProvider, { type: 'xai' }>) {
    super(provider)
    this.baseUrl = provider.baseUrl
      ? provider.baseUrl.replace(/\/+$/, '')
      : 'https://api.x.ai/v1'
    this.fetchFn = async (input, init) => {
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
    }
    this.adapter = new CodexMessageAdapter({
      endpoint: `${this.baseUrl}/responses`,
      fetchFn: this.fetchFn,
      clientCompaction: true,
    })
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'xai') {
      throw new Error('Model is not an xAI model')
    }

    const headers = this.getAuthHeaders()
    try {
      const prepared = await this.prepare(request, headers, options)
      const response = await this.adapter.generateResponse(
        { ...request, messages: prepared.messages },
        options,
        headers,
        prepared.head,
      )
      const xai = toMetadata(prepared, response.usage)
      const message = response.choices[0]?.message
      if (message && xai) {
        message.providerMetadata = { ...message.providerMetadata, xai }
      }
      return response
    } catch (error) {
      throw mapAuthError(error)
    }
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (model.providerType !== 'xai') {
      throw new Error('Model is not an xAI model')
    }

    const headers = this.getAuthHeaders()
    try {
      const prepared = await this.prepare(request, headers, options)
      const stream = await this.adapter.streamResponse(
        { ...request, messages: prepared.messages },
        options,
        headers,
        prepared.head,
      )
      return withMetadata(stream, prepared, request.model)
    } catch (error) {
      throw mapAuthError(error)
    }
  }

  async getEmbedding(
    _model: string,
    _text: string,
    _options?: { dimensions?: number },
  ): Promise<number[]> {
    throw new Error(
      `Provider ${String(this.provider.id)} does not support embeddings. Please use a different provider.`,
    )
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.provider.apiKey) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} API key is missing. Please set it in settings menu.`,
      )
    }
    return { Authorization: `Bearer ${this.provider.apiKey}` }
  }

  // Replays the stored compaction item and compacts again when the input has
  // reached the threshold. A failed compaction sends the request as it is.
  private async prepare(
    request: LLMRequestNonStreaming | LLMRequestStreaming,
    headers: Record<string, string>,
    options?: LLMOptions,
  ): Promise<PreparedRequest> {
    const system = request.messages.filter((m) => m.role === 'system')
    const { head, tail } = replayCompaction(
      request.messages.filter((m) => m.role !== 'system'),
    )
    const uncompacted = { messages: [...system, ...tail], head }

    const key = `${this.provider.id}/${request.model}`
    const failedAt = XaiProvider.compactFailures.get(key)
    if (
      failedAt !== undefined &&
      Date.now() - failedAt < XaiProvider.COMPACT_RETRY_DELAY_MS
    ) {
      return uncompacted
    }
    const contextWindow = await this.getXaiModelContextWindow(
      request.model,
      headers,
    )
    if (estimateContextTokens(system, tail) < contextWindow) {
      return uncompacted
    }
    const split = findCompactionSplit(tail, contextWindow)
    if (split <= 0) {
      return uncompacted
    }

    try {
      const response = await postJson<{ output?: XaiCompactionItem[] }>(
        `${this.baseUrl}/responses/compact`,
        {
          model: request.model,
          input: buildCompactInput([...system, ...tail.slice(0, split)], head),
        },
        { headers, signal: options?.signal, fetchFn: this.fetchFn },
      )
      const item = response.output?.find((i) => i.type === 'compaction')
      if (!item) {
        throw new Error('The compaction response has no compaction item')
      }
      XaiProvider.compactFailures.delete(key)
      const remaining = tail.slice(split)
      return {
        messages: [...system, ...remaining],
        head: item,
        compaction: { compaction: item, tailLength: remaining.length },
      }
    } catch (error) {
      if (options?.signal?.aborted) throw error
      console.error('xAI compaction failed:', error)
      XaiProvider.compactFailures.set(key, Date.now())
      return uncompacted
    }
  }

  // The model's context window, from the known models or else the Models API.
  private async getXaiModelContextWindow(
    model: string,
    headers: Record<string, string>,
  ): Promise<number> {
    const known = getXaiContextWindow(model)
    if (known) return known

    const key = `${this.provider.id}/${model}`
    if (!XaiProvider.contextWindowCache.has(key)) {
      try {
        const response = await fetch(`${this.baseUrl}/models`, {
          headers,
          signal: AbortSignal.timeout(XaiProvider.MODEL_LOOKUP_TIMEOUT_MS),
        })
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`)
        }
        const { data } = (await response.json()) as {
          data?: { id: string; aliases?: string[]; context_length?: number }[]
        }
        const entry = data?.find(
          (m) => m.id === model || m.aliases?.includes(model),
        )
        const contextLength = entry?.context_length
        XaiProvider.contextWindowCache.set(
          key,
          typeof contextLength === 'number' && contextLength > 0
            ? contextLength
            : null,
        )
      } catch {
        XaiProvider.contextWindowCache.set(key, null)
      }
    }
    return XaiProvider.contextWindowCache.get(key) ?? XAI_DEFAULT_CONTEXT_WINDOW
  }
}

// The latest stored compaction item replaces the messages before its tail.
function replayCompaction(conversation: RequestMessage[]): {
  head?: XaiCompactionItem
  tail: RequestMessage[]
} {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const message = conversation[i]
    if (message.role !== 'assistant') continue
    const xai = message.providerMetadata?.xai
    if (!xai?.compaction) continue
    const start = i - (xai.tailLength ?? 0)
    // The messages no longer line up with the compaction; send them all.
    if (start < 0 || conversation[start].role === 'tool') {
      return { tail: conversation }
    }
    return { head: xai.compaction, tail: conversation.slice(start) }
  }
  return { tail: conversation }
}

// Compacts what precedes the latest user message, which is then sent as it
// is. When no earlier turn precedes it, or the turn alone still fills the
// window, the tool run is split before its latest round.
function findCompactionSplit(
  tail: RequestMessage[],
  contextWindow: number,
): number {
  let lastToolRound = -1
  for (let i = tail.length - 1; i > 0; i--) {
    const message = tail[i]
    if (message.role === 'user') {
      const followsTurn = tail.slice(0, i).some((m) => m.role === 'assistant')
      if (
        followsTurn &&
        (lastToolRound < 0 || estimateTokens(tail.slice(i)) < contextWindow)
      ) {
        return i
      }
      break
    }
    if (
      lastToolRound < 0 &&
      message.role === 'assistant' &&
      message.tool_calls?.length
    ) {
      lastToolRound = i
    }
  }
  return lastToolRound
}

// The latest reported size plus an estimate for the messages after it.
function estimateContextTokens(
  system: RequestMessage[],
  tail: RequestMessage[],
): number {
  for (let i = tail.length - 1; i >= 0; i--) {
    const message = tail[i]
    const reported =
      message.role === 'assistant'
        ? message.providerMetadata?.xai?.contextTokens
        : undefined
    if (reported !== undefined) {
      return reported + estimateTokens(tail.slice(i + 1))
    }
  }
  return estimateTokens([...system, ...tail])
}

// One token per three UTF-8 bytes overestimates English and code and stays
// close for Korean, where a character is three bytes.
function estimateTokens(messages: RequestMessage[]): number {
  const encoder = new TextEncoder()
  let bytes = 0
  let images = 0
  for (const message of messages) {
    if (typeof message.content === 'string') {
      bytes += encoder.encode(message.content).length
    } else {
      for (const part of message.content) {
        if (part.type === 'text') {
          bytes += encoder.encode(part.text).length
        } else {
          images += 1
        }
      }
    }
    if (message.role === 'assistant') {
      for (const toolCall of message.tool_calls ?? []) {
        bytes += encoder.encode(
          toolCall.name + (toolCall.arguments ?? ''),
        ).length
      }
    }
  }
  return Math.ceil(bytes / 3) + images * IMAGE_TOKEN_ESTIMATE
}

function toMetadata(
  prepared: PreparedRequest,
  usage: ResponseUsage | undefined,
): XaiProviderMetadata | undefined {
  if (!prepared.compaction && !usage) return undefined
  return {
    ...prepared.compaction,
    ...(usage && {
      contextTokens: usage.prompt_tokens + usage.completion_tokens,
    }),
  }
}

// The metadata goes out once, with the usage at the end of the stream.
async function* withMetadata(
  stream: AsyncIterable<LLMResponseStreaming>,
  prepared: PreparedRequest,
  model: string,
): AsyncIterable<LLMResponseStreaming> {
  let sent = false
  for await (const chunk of stream) {
    const xai = !sent && chunk.usage && toMetadata(prepared, chunk.usage)
    if (!xai) {
      yield chunk
      continue
    }
    sent = true
    yield {
      ...chunk,
      choices: chunk.choices.map((choice) => ({
        ...choice,
        delta: {
          ...choice.delta,
          providerMetadata: { ...choice.delta.providerMetadata, xai },
        },
      })),
    }
  }
  if (!sent && prepared.compaction) {
    yield {
      id: 'xai-compaction',
      model,
      object: 'chat.completion.chunk',
      choices: [
        {
          finish_reason: null,
          delta: { providerMetadata: { xai: prepared.compaction } },
        },
      ],
    }
  }
}

function mapAuthError(error: unknown): unknown {
  if (error instanceof OpenAI.AuthenticationError) {
    return new LLMAPIKeyInvalidException(
      'xAI API key is invalid. Please update it in settings menu.',
      error,
    )
  }
  return error
}
