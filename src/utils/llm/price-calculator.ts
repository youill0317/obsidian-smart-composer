import {
  ANTHROPIC_PRICES,
  DEEPSEEK_PRICES,
  GEMINI_PRICES,
  LONG_CONTEXT_PRICING_RULES,
  ModelPricing,
  OPENAI_PRICES,
  XAI_PRICES,
} from '../../constants'
import { ChatAssistantMessage } from '../../types/chat'
import { ChatModel } from '../../types/chat-model.types'
import { ResponseUsage } from '../../types/llm/response'

// Returns the cost in dollars. Returns null if the model is not supported.
export const calculateLLMCost = ({
  model,
  usage,
}: {
  model: ChatModel
  usage: ResponseUsage
}): number | null => {
  let modelPricing: ModelPricing | undefined
  switch (model.providerType) {
    case 'openai':
      modelPricing = OPENAI_PRICES[model.model]
      break
    case 'anthropic':
      modelPricing = ANTHROPIC_PRICES[model.model]
      break
    case 'gemini':
      modelPricing = GEMINI_PRICES[model.model]
      break
    case 'xai':
      modelPricing = XAI_PRICES[model.model]
      break
    case 'deepseek':
      modelPricing = DEEPSEEK_PRICES[model.model]
      break
    default:
      return null
  }
  if (!modelPricing) return null

  const rule =
    LONG_CONTEXT_PRICING_RULES[`${model.providerType}/${model.model}`]
  const usesLongContextPricing =
    rule !== undefined &&
    (rule.thresholdInclusive
      ? usage.prompt_tokens >= rule.thresholdPromptTokens
      : usage.prompt_tokens > rule.thresholdPromptTokens)
  if (usesLongContextPricing) {
    modelPricing = rule.pricing
  }

  // Gemini reports visible candidate tokens separately from thinking tokens,
  // while total_tokens includes the full generation. Bill the larger generated
  // count so hidden thinking is not accidentally priced as free.
  const completionTokens =
    model.providerType === 'gemini'
      ? Math.max(
          usage.completion_tokens,
          usage.total_tokens - usage.prompt_tokens,
        )
      : usage.completion_tokens

  // prompt_tokens includes the cached tokens. Without listed cache rates,
  // reads cost 0.1x and writes 1.25x the input price.
  const cacheRead = usage.cache_read_tokens ?? 0
  const cacheWrite = usage.cache_write_tokens ?? 0
  const uncachedTokens = usage.prompt_tokens - cacheRead - cacheWrite
  const cachedInputPrice = modelPricing.cachedInput ?? modelPricing.input * 0.1
  const cacheWritePrice = modelPricing.cacheWrite ?? modelPricing.input * 1.25

  return (
    (uncachedTokens * modelPricing.input +
      cacheRead * cachedInputPrice +
      cacheWrite * cacheWritePrice +
      completionTokens * modelPricing.output) /
    1_000_000
  )
}

// Long-context tiers apply per API request. Never aggregate prompt tokens
// before choosing the tier, and do not silently turn unknown prices into $0.
export const calculateMessageGroupCost = (
  messages: ChatAssistantMessage[],
): number | null => {
  const pricedMessages = messages.flatMap(({ metadata }) =>
    metadata?.model && metadata.usage
      ? [{ model: metadata.model, usage: metadata.usage }]
      : [],
  )
  if (pricedMessages.length === 0) return null

  let total = 0
  for (const { model, usage } of pricedMessages) {
    const cost = calculateLLMCost({ model, usage })
    if (cost === null) return null
    total += cost
  }
  return total
}
