import OpenAI from 'openai'
import type {
  Response,
  ResponseCreateParamsBase,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses'

import {
  LLMOptions,
  LLMRequest,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
} from '../../types/llm/request'
import {
  Annotation,
  LLMResponseNonStreaming,
  LLMResponseStreaming,
} from '../../types/llm/response'

type SearchResult = { url: string; title?: string }
type AgentOutput =
  | ResponseOutputItem
  | {
      type: 'search_results'
      results: SearchResult[]
    }
type AgentResponse = Omit<Response, 'output'> & { output: AgentOutput[] }
type AgentEvent =
  | Exclude<
      ResponseStreamEvent,
      {
        type:
          | 'response.output_item.added'
          | 'response.output_item.done'
          | 'response.created'
          | 'response.completed'
          | 'response.incomplete'
          | 'response.failed'
      }
    >
  | {
      type: 'response.output_item.added' | 'response.output_item.done'
      item: AgentOutput
      output_index: number
    }
  | {
      type: 'response.created' | 'response.completed' | 'response.incomplete'
      response: AgentResponse
    }
  | {
      type: 'response.failed'
      error?: { message?: string }
      response?: AgentResponse
    }
  | {
      type: 'response.reasoning.search_results'
      results: SearchResult[]
    }

// Preserve saved Sonar configurations using Perplexity's documented migration
// presets. Do not pin a model: each preset selects its own model and tools.
// https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview
const legacyPresets: Record<string, string> = {
  sonar: 'fast',
  'sonar-pro': 'fast',
  'sonar-reasoning-pro': 'low',
  'sonar-deep-research': 'high',
}

export class PerplexityMessageAdapter {
  private buildRequest(
    request: LLMRequest,
  ): ResponseCreateParamsBase & { preset?: string } {
    const input: ResponseInputItem[] = []
    for (const message of request.messages) {
      if (message.role === 'tool') {
        input.push({
          type: 'function_call_output',
          call_id: message.tool_call.id,
          output: message.content,
        })
        continue
      }
      input.push({
        type: 'message',
        role: message.role,
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content.map((part) =>
                part.type === 'text'
                  ? { type: 'input_text', text: part.text }
                  : {
                      type: 'input_image',
                      image_url: part.image_url.url,
                      detail: 'auto' as const,
                    },
              ),
      })
      if (message.role === 'assistant') {
        for (const call of message.tool_calls ?? []) {
          input.push({
            type: 'function_call',
            call_id: call.id,
            name: call.name,
            arguments: call.arguments ?? '{}',
          })
        }
      }
    }
    const preset = Object.prototype.hasOwnProperty.call(
      legacyPresets,
      request.model,
    )
      ? legacyPresets[request.model]
      : undefined
    const location = request.web_search_options?.user_location?.approximate
    return {
      ...(preset ? { preset } : { model: request.model }),
      input,
      max_output_tokens: request.max_tokens,
      temperature: request.temperature,
      top_p: request.top_p,
      ...(request.reasoning_effort && {
        reasoning: { effort: request.reasoning_effort },
      }),
      tools: [
        {
          type: 'web_search',
          search_context_size: request.web_search_options?.search_context_size,
          ...(location && {
            user_location: {
              city: location.city,
              country: location.country,
              region: location.region,
            },
          }),
        },
        ...(request.tools ?? []).map((tool) => ({
          type: 'function' as const,
          ...tool.function,
          strict: false,
        })),
      ],
      tool_choice:
        typeof request.tool_choice === 'object'
          ? { type: 'function', name: request.tool_choice.function.name }
          : request.tool_choice,
    }
  }

  async generateResponse(
    client: OpenAI,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    const response = (await client.responses.create(
      { ...this.buildRequest(request), stream: false },
      { signal: options?.signal },
    )) as AgentResponse
    return this.parseResponse(response)
  }

  async streamResponse(
    client: OpenAI,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    // /v1/responses is the documented OpenAI-compatible alias of /v1/agent.
    // Reuse the SDK's SSE parser, retries, errors and abort handling.
    const stream = await client.responses.create(
      { ...this.buildRequest(request), stream: true },
      { signal: options?.signal },
    )
    return this.parseStream(stream as AsyncIterable<AgentEvent>, request.model)
  }

  private parseResponse(response: AgentResponse): LLMResponseNonStreaming {
    if (response.error || response.status === 'failed') {
      throw new Error(response.error?.message ?? 'Perplexity response failed')
    }
    const messages = response.output.filter((item) => item.type === 'message')
    const calls = response.output.filter(
      (item) => item.type === 'function_call',
    )
    return {
      id: response.id,
      created: response.created_at,
      model: response.model,
      object: 'chat.completion',
      usage: response.usage
        ? {
            prompt_tokens: response.usage.input_tokens,
            completion_tokens: response.usage.output_tokens,
            total_tokens: response.usage.total_tokens,
          }
        : undefined,
      choices: [
        {
          finish_reason:
            response.status === 'incomplete'
              ? 'length'
              : calls.length
                ? 'tool_calls'
                : 'stop',
          message: {
            role: 'assistant',
            content: messages
              .flatMap((item) => item.content)
              .map((part) =>
                part.type === 'output_text' ? part.text : part.refusal,
              )
              .join(''),
            annotations: [
              ...new Map(
                response.output
                  .flatMap((item) => this.annotations(item))
                  .map((annotation) => [
                    annotation.url_citation.url,
                    annotation,
                  ]),
              ).values(),
            ],
            ...(calls.length && {
              tool_calls: calls.map((call) => ({
                id: call.call_id,
                type: 'function' as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            }),
          },
        },
      ],
    }
  }

  private annotations(item: AgentOutput): Annotation[] {
    if (item.type === 'search_results') {
      return item.results.map(({ url, title }) => ({
        type: 'url_citation',
        url_citation: { url, title },
      }))
    }
    if (item.type !== 'message') return []
    return item.content.flatMap((part) =>
      part.type === 'output_text'
        ? (part.annotations ?? []).flatMap((annotation) => {
            if (annotation.type !== 'url_citation') return []
            const { type, ...citation } = annotation
            return [{ type, url_citation: citation }]
          })
        : [],
    )
  }

  private async *parseStream(
    stream: AsyncIterable<AgentEvent>,
    model: string,
  ): AsyncIterable<LLMResponseStreaming> {
    let id = ''
    let created: number | undefined
    let sawTerminal = false
    const sentSources = new Set<string>()
    const sentCalls = new Set<string>()
    let sentText = false
    for await (const event of stream) {
      let delta: LLMResponseStreaming['choices'][number]['delta'] = {}
      let finishReason: string | null = null
      let usage: LLMResponseStreaming['usage']
      if (event.type === 'error') throw new Error(event.message)
      if (event.type === 'response.failed') {
        throw new Error(
          event.error?.message ??
            event.response?.error?.message ??
            'Perplexity response failed',
        )
      }
      if (event.type === 'response.created') {
        id = event.response.id
        created = event.response.created_at
        model = event.response.model
        continue
      }
      if (event.type === 'response.output_text.delta') {
        delta.content = event.delta
        sentText = true
      } else if (event.type === 'response.reasoning.search_results') {
        delta.annotations = this.annotations({
          type: 'search_results',
          results: event.results,
        })
      } else if (event.type === 'response.output_item.done') {
        delta.annotations = this.annotations(event.item)
        if (event.item.type === 'function_call') {
          const call = event.item
          sentCalls.add(call.call_id)
          delta.tool_calls = [
            {
              index: event.output_index,
              id: call.call_id,
              type: 'function',
              function: { name: call.name, arguments: call.arguments },
            },
          ]
        }
      } else if (event.type === 'response.output_text.annotation.added') {
        const annotation = event.annotation as {
          type: string
        } & Annotation['url_citation']
        if (annotation.type === 'url_citation') {
          const { type: _type, ...citation } = annotation
          delta.annotations = [{ type: 'url_citation', url_citation: citation }]
        }
      } else if (event.type === 'response.reasoning_summary_text.delta') {
        delta.reasoning = event.delta
      } else if (
        event.type === 'response.completed' ||
        event.type === 'response.incomplete'
      ) {
        const response = this.parseResponse(event.response)
        id = response.id
        created = response.created
        model = response.model
        const message = response.choices[0].message
        delta = {
          annotations: message.annotations,
          ...(!sentText && { content: message.content }),
          tool_calls: event.response.output.flatMap((item, index) =>
            item.type === 'function_call' && !sentCalls.has(item.call_id)
              ? [
                  {
                    index,
                    id: item.call_id,
                    type: 'function' as const,
                    function: { name: item.name, arguments: item.arguments },
                  },
                ]
              : [],
          ),
        }
        finishReason =
          event.type === 'response.incomplete'
            ? 'length'
            : response.choices[0].finish_reason
        usage = response.usage
        sawTerminal = true
      } else {
        continue
      }
      delta.annotations = delta.annotations?.filter((annotation) => {
        const url = annotation.url_citation.url
        if (sentSources.has(url)) return false
        sentSources.add(url)
        return true
      })
      yield {
        id,
        created,
        model,
        object: 'chat.completion.chunk',
        choices: [
          {
            finish_reason: finishReason,
            delta: { role: 'assistant', ...delta },
          },
        ],
        usage,
      }
    }
    if (!sawTerminal)
      throw new Error('Perplexity response stream ended before completion')
  }
}
