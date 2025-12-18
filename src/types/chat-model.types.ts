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

const reasoningSchema = z
  .object({
    enabled: z.boolean(),
    reasoning_effort: z.string().optional(),
  })
  .optional()

const thinkingSchema = z
  .object({
    enabled: z.boolean(),
    budget_tokens: z.number(),
  })
  .optional()

export const chatModelSchema = z.discriminatedUnion('providerType', [
  z.object({
    providerType: z.literal('openai'),
    ...baseChatModelSchema.shape,
    reasoning: reasoningSchema,
  }),
  z.object({
    providerType: z.literal('anthropic'),
    ...baseChatModelSchema.shape,
    thinking: thinkingSchema,
  }),
  z.object({
    providerType: z.literal('gemini'),
    ...baseChatModelSchema.shape,
    thinkingConfig: z
      .object({
        includeThoughts: z.boolean(),
        thinkingLevel: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    providerType: z.literal('groq'),
    ...baseChatModelSchema.shape,
    reasoning: reasoningSchema,
  }),
  z.object({
    providerType: z.literal('openrouter'),
    ...baseChatModelSchema.shape,
    reasoning: reasoningSchema,
    thinking: thinkingSchema,
  }),
  z.object({
    providerType: z.literal('ollama'),
    ...baseChatModelSchema.shape,
    reasoning: reasoningSchema,
    thinking: thinkingSchema,
  }),
  z.object({
    providerType: z.literal('lm-studio'),
    ...baseChatModelSchema.shape,
    reasoning: reasoningSchema,
    thinking: thinkingSchema,
  }),
  z.object({
    providerType: z.literal('deepseek'),
    ...baseChatModelSchema.shape,
    reasoning: reasoningSchema,
  }),
  z.object({
    providerType: z.literal('perplexity'),
    ...baseChatModelSchema.shape,
    web_search_options: z
      .object({
        search_context_size: z.string(),
      })
      .optional(),
  }),
  z.object({
    providerType: z.literal('mistral'),
    ...baseChatModelSchema.shape,
  }),
  z.object({
    providerType: z.literal('morph'),
    ...baseChatModelSchema.shape,
  }),
  z.object({
    providerType: z.literal('azure-openai'),
    ...baseChatModelSchema.shape,
    reasoning: reasoningSchema,
  }),
  z.object({
    providerType: z.literal('openai-compatible'),
    ...baseChatModelSchema.shape,
    reasoning: reasoningSchema,
    thinking: thinkingSchema,
  }),
])

export type ChatModel = z.infer<typeof chatModelSchema>
