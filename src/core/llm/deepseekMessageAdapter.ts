import {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'

import { RequestMessage } from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
  ResponseProviderMetadata,
} from '../../types/llm/response'

import { OpenAIMessageAdapter } from './openaiMessageAdapter'

/**
 * Adapter for DeepSeek's API that extends OpenAIMessageAdapter to handle the additional
 * 'reasoning_content' field in DeepSeek's response format while maintaining OpenAI compatibility.
 */
export class DeepSeekMessageAdapter extends OpenAIMessageAdapter {
  private readonly streamingMetadata = new Map<
    string,
    ResponseProviderMetadata
  >()

  protected parseNonStreamingResponse(
    response: ChatCompletion,
  ): LLMResponseNonStreaming {
    return {
      id: response.id,
      choices: response.choices.map((choice) => {
        const reasoningContent = (
          choice.message as unknown as { reasoning_content?: string }
        ).reasoning_content
        return {
          finish_reason: choice.finish_reason,
          message: {
            content: choice.message.content,
            reasoning: reasoningContent,
            role: choice.message.role,
            tool_calls: this.normalizeToolCalls(choice.message.tool_calls),
            providerMetadata: reasoningContent
              ? { deepseek: { reasoningContent } }
              : undefined,
          },
        }
      }),
      created: response.created,
      model: response.model,
      object: 'chat.completion',
      system_fingerprint: response.system_fingerprint,
      usage: response.usage,
    }
  }

  protected parseStreamingResponseChunk(
    chunk: ChatCompletionChunk,
  ): LLMResponseStreaming {
    return {
      id: chunk.id,
      choices: chunk.choices.map((choice) => {
        const reasoningDelta = (
          choice.delta as unknown as { reasoning_content?: string }
        ).reasoning_content
        let providerMetadata = this.streamingMetadata.get(chunk.id)
        if (reasoningDelta) {
          if (!providerMetadata) {
            providerMetadata = { deepseek: { reasoningContent: '' } }
            this.streamingMetadata.set(chunk.id, providerMetadata)
          }
          const deepseek = providerMetadata.deepseek
          if (deepseek) {
            deepseek.reasoningContent =
              (deepseek.reasoningContent ?? '') + reasoningDelta
          }
        }

        const result = {
          finish_reason: choice.finish_reason ?? null,
          delta: {
            content: choice.delta.content ?? null,
            reasoning: reasoningDelta,
            role: choice.delta.role,
            tool_calls: choice.delta.tool_calls,
            providerMetadata,
          },
        }
        if (choice.finish_reason) {
          this.streamingMetadata.delete(chunk.id)
        }
        return result
      }),
      created: chunk.created,
      model: chunk.model,
      object: 'chat.completion.chunk',
      system_fingerprint: chunk.system_fingerprint,
      usage: chunk.usage ?? undefined,
    }
  }

  protected parseRequestMessage(
    message: RequestMessage,
  ): ChatCompletionMessageParam {
    const baseMessage = super.parseRequestMessage(message)
    if (
      message.role === 'assistant' &&
      message.providerMetadata?.deepseek?.reasoningContent
    ) {
      return {
        ...baseMessage,
        reasoning_content: message.providerMetadata.deepseek.reasoningContent,
      } as unknown as ChatCompletionMessageParam
    }
    return baseMessage
  }
}
