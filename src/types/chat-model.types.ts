import { z } from 'zod'

import { PromptLevel } from './prompt-level.types'

const baseChatModelSchema = z.object({
  providerId: z
    .string({
      required_error: 'provider ID is required',
    })
    .min(1, 'provider ID is required'),
  id: z
    .string({
      required_error: 'id is required',
    })
    .min(1, 'id is required'),
  model: z
    .string({
      required_error: 'model is required',
    })
    .min(1, 'model is required'),
  promptLevel: z
    .nativeEnum(PromptLevel)
    .default(PromptLevel.Default)
    .optional(),
  enable: z.boolean().default(true).optional(),
})

// Entered by the user for providers whose API does not report it
const contextWindow = z.number().int().positive().optional()

export const chatModelSchema = z.discriminatedUnion('providerType', [
  z.object({
    providerType: z.literal('openai-plan'),
    ...baseChatModelSchema.shape,
    reasoning: z
      .object({
        reasoning_effort: z.string().optional(),
        reasoning_summary: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    providerType: z.literal('anthropic'),
    ...baseChatModelSchema.shape,
    adaptive_thinking: z
      .object({
        effort: z.string().optional(),
        show_summaries: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    providerType: z.literal('openai'),
    ...baseChatModelSchema.shape,
    reasoning: z
      .object({
        reasoning_effort: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    providerType: z.literal('gemini'),
    ...baseChatModelSchema.shape,
    thinking: z
      .object({
        thinking_level: z.string().optional(),
        // Return thought summaries in response
        include_thoughts: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    providerType: z.literal('xai'),
    ...baseChatModelSchema.shape,
  }),
  z.object({
    providerType: z.literal('deepseek'),
    ...baseChatModelSchema.shape,
  }),
  z.object({
    providerType: z.literal('mistral'),
    ...baseChatModelSchema.shape,
  }),
  z.object({
    providerType: z.literal('perplexity'),
    ...baseChatModelSchema.shape,
    web_search_options: z
      .object({
        search_context_size: z.string(),
      })
      .optional(),
    contextWindow,
  }),
  z.object({
    providerType: z.literal('openrouter'),
    ...baseChatModelSchema.shape,
  }),
  z.object({
    providerType: z.literal('ollama'),
    ...baseChatModelSchema.shape,
    contextWindow,
  }),
  z.object({
    providerType: z.literal('lm-studio'),
    ...baseChatModelSchema.shape,
    contextWindow,
  }),
  z.object({
    providerType: z.literal('azure-openai'),
    ...baseChatModelSchema.shape,
    contextWindow,
  }),
  z.object({
    providerType: z.literal('openai-compatible'),
    ...baseChatModelSchema.shape,
    contextWindow,
  }),
])

export type ChatModel = z.infer<typeof chatModelSchema>
