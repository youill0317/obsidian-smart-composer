import { ChatModel } from './types/chat-model.types'
import { EmbeddingModel } from './types/embedding-model.types'
import { LLMProvider, LLMProviderType } from './types/provider.types'

export const CHAT_VIEW_TYPE = 'smtcmp-chat-view'
export const APPLY_VIEW_TYPE = 'smtcmp-apply-view'

export const PGLITE_DB_PATH = '.smtcmp_vector_db.tar.gz'
export const VECTOR_STORE_DIR = '.smtcmp_vector_store'

// Sign in with ChatGPT (ChatGPT plan usage for open-source apps).
// https://developers.openai.com/siwc/token-sharing-open-source
export const CODEX_DYNAMIC_CLIENT_ID = 'dynamic_agent_client'
export const CODEX_AGENT_NAME = 'Smart Composer'
export const CODEX_ISSUER = 'https://auth.openai.com'
export const CODEX_REDIRECT_PORT = 1455
export const CODEX_REDIRECT_URI = `http://127.0.0.1:${CODEX_REDIRECT_PORT}/auth/callback`
export const CODEX_RESOURCE = 'https://api.openai.com/v1'
export const CODEX_PLAN_USAGE_SCOPE = 'chatgpt.tokens.use.direct'
export const CODEX_RESPONSES_ENDPOINT = `${CODEX_RESOURCE}/responses`
export const CODEX_USAGE_URL = 'https://chatgpt.com/settings/usage'

// Default model ids
export const DEFAULT_CHAT_MODEL_ID = 'claude-opus-5-5'
// Keep the API-backed apply default. Plan models require a separate OAuth
// connection and must never be selected implicitly.
export const DEFAULT_APPLY_MODEL_ID = 'gpt-6.2-sol'

// Recommended model ids
export const RECOMMENDED_MODELS_FOR_CHAT = ['claude-opus-5-5', 'gpt-6.2-sol']
export const RECOMMENDED_MODELS_FOR_APPLY = ['gpt-6.2-sol']
export const RECOMMENDED_MODELS_FOR_EMBEDDING = [
  'voyage/voyage-4',
  'openai/text-embedding-3-small',
]

export const PLAN_PROVIDER_TYPES: readonly LLMProviderType[] = [
  'openai-plan',
] as const
export const PROVIDER_TYPES_INFO = {
  'openai-plan': {
    label: 'OpenAI Plan',
    defaultProviderId: 'openai-plan',
    requireApiKey: false,
    requireBaseUrl: false,
    supportChat: true,
    supportEmbedding: false,
    additionalSettings: [],
  },
  anthropic: {
    label: 'Anthropic',
    defaultProviderId: 'anthropic',
    requireApiKey: true,
    requireBaseUrl: false,
    supportChat: true,
    supportEmbedding: false,
    additionalSettings: [],
  },
  openai: {
    label: 'OpenAI',
    defaultProviderId: 'openai',
    requireApiKey: true,
    requireBaseUrl: false,
    supportChat: true,
    supportEmbedding: true,
    additionalSettings: [],
  },
  gemini: {
    label: 'Gemini',
    defaultProviderId: 'gemini',
    requireApiKey: true,
    requireBaseUrl: false,
    supportChat: true,
    supportEmbedding: true,
    additionalSettings: [],
  },
  xai: {
    label: 'xAI',
    defaultProviderId: 'xai',
    requireApiKey: true,
    requireBaseUrl: false,
    supportChat: true,
    supportEmbedding: false,
    additionalSettings: [],
  },
  deepseek: {
    label: 'DeepSeek',
    defaultProviderId: 'deepseek',
    requireApiKey: true,
    requireBaseUrl: false,
    supportChat: true,
    supportEmbedding: false,
    additionalSettings: [],
  },
  mistral: {
    label: 'Mistral',
    defaultProviderId: 'mistral',
    requireApiKey: true,
    requireBaseUrl: false,
    supportChat: true,
    supportEmbedding: false,
    additionalSettings: [],
  },
  voyage: {
    label: 'Voyage AI',
    defaultProviderId: 'voyage',
    requireApiKey: true,
    requireBaseUrl: false,
    supportChat: false,
    supportEmbedding: true,
    additionalSettings: [],
  },
  perplexity: {
    label: 'Perplexity',
    defaultProviderId: 'perplexity',
    requireApiKey: true,
    requireBaseUrl: false,
    supportChat: true,
    supportEmbedding: false,
    additionalSettings: [],
  },
  openrouter: {
    label: 'OpenRouter',
    defaultProviderId: 'openrouter',
    requireApiKey: true,
    requireBaseUrl: false,
    supportChat: true,
    supportEmbedding: false,
    additionalSettings: [],
  },
  ollama: {
    label: 'Ollama',
    defaultProviderId: 'ollama',
    requireApiKey: false,
    requireBaseUrl: false,
    supportChat: true,
    supportEmbedding: true,
    additionalSettings: [],
  },
  'lm-studio': {
    label: 'LM Studio',
    defaultProviderId: 'lm-studio',
    requireApiKey: false,
    requireBaseUrl: false,
    supportChat: true,
    supportEmbedding: true,
    additionalSettings: [],
  },
  'azure-openai': {
    label: 'Azure OpenAI',
    defaultProviderId: null, // no default provider for this type
    requireApiKey: true,
    requireBaseUrl: true,
    supportChat: true,
    supportEmbedding: false,
    additionalSettings: [
      {
        label: 'Deployment',
        key: 'deployment',
        placeholder: 'Enter your deployment name',
        type: 'text',
        required: true,
      },
      {
        label: 'API Version',
        key: 'apiVersion',
        placeholder: 'Enter your API version',
        type: 'text',
        required: true,
      },
    ],
  },
  'openai-compatible': {
    label: 'OpenAI Compatible',
    defaultProviderId: null, // no default provider for this type
    requireApiKey: false,
    requireBaseUrl: true,
    supportChat: true,
    supportEmbedding: true,
    additionalSettings: [
      {
        label: 'No Stainless Headers',
        key: 'noStainless',
        type: 'toggle',
        required: false,
        description:
          'Enable this if you encounter CORS errors related to Stainless headers (x-stainless-os, etc.)',
      },
    ],
  },
} as const satisfies Record<
  LLMProviderType,
  {
    label: string
    defaultProviderId: string | null
    requireApiKey: boolean
    requireBaseUrl: boolean
    supportChat: boolean
    supportEmbedding: boolean
    additionalSettings: {
      label: string
      key: string
      type: 'text' | 'toggle'
      placeholder?: string
      description?: string
      required?: boolean
    }[]
  }
>

/**
 * Important
 * 1. When adding new default provider, settings migration should be added
 * 2. If there's same provider id in user's settings, it's data should be overwritten by default provider
 */
export const DEFAULT_PROVIDERS: readonly LLMProvider[] = [
  {
    type: 'openai-plan',
    id: PROVIDER_TYPES_INFO['openai-plan'].defaultProviderId,
  },
  {
    type: 'anthropic',
    id: PROVIDER_TYPES_INFO.anthropic.defaultProviderId,
  },
  {
    type: 'openai',
    id: PROVIDER_TYPES_INFO.openai.defaultProviderId,
  },
  {
    type: 'gemini',
    id: PROVIDER_TYPES_INFO.gemini.defaultProviderId,
  },
  {
    type: 'xai',
    id: PROVIDER_TYPES_INFO.xai.defaultProviderId,
  },
  {
    type: 'deepseek',
    id: PROVIDER_TYPES_INFO.deepseek.defaultProviderId,
  },
  {
    type: 'mistral',
    id: PROVIDER_TYPES_INFO.mistral.defaultProviderId,
  },
  {
    type: 'voyage',
    id: PROVIDER_TYPES_INFO.voyage.defaultProviderId,
  },
  {
    type: 'perplexity',
    id: PROVIDER_TYPES_INFO.perplexity.defaultProviderId,
  },
  {
    type: 'openrouter',
    id: PROVIDER_TYPES_INFO.openrouter.defaultProviderId,
  },
  {
    type: 'ollama',
    id: PROVIDER_TYPES_INFO.ollama.defaultProviderId,
  },
  {
    type: 'lm-studio',
    id: PROVIDER_TYPES_INFO['lm-studio'].defaultProviderId,
  },
]

/**
 * Important
 * 1. When adding new default model, settings migration should be added
 * 2. If there's same model id in user's settings, it's data should be overwritten by default model
 */
export const DEFAULT_CHAT_MODELS: readonly ChatModel[] = [
  {
    providerType: 'openai-plan',
    providerId: PROVIDER_TYPES_INFO['openai-plan'].defaultProviderId,
    id: 'gpt-6.2-sol (plan)',
    model: 'gpt-6.2-sol',
  },
  {
    providerType: 'openai',
    providerId: PROVIDER_TYPES_INFO.openai.defaultProviderId,
    id: 'gpt-6.2-sol',
    model: 'gpt-6.2-sol',
    reasoning: { reasoning_effort: 'medium' },
  },
  {
    providerType: 'anthropic',
    providerId: PROVIDER_TYPES_INFO.anthropic.defaultProviderId,
    id: 'claude-opus-5-5',
    model: 'claude-opus-5-5',
  },
  {
    providerType: 'gemini',
    providerId: PROVIDER_TYPES_INFO.gemini.defaultProviderId,
    id: 'gemini-4-carbon',
    model: 'gemini-4-carbon',
  },
  {
    providerType: 'deepseek',
    providerId: PROVIDER_TYPES_INFO.deepseek.defaultProviderId,
    id: 'deepseek-v4-pro',
    model: 'deepseek-v4-pro',
  },
  {
    providerType: 'xai',
    providerId: PROVIDER_TYPES_INFO.xai.defaultProviderId,
    id: 'grok-4.7',
    model: 'grok-4.7',
  },
]

/**
 * Important
 * 1. When adding new default embedding model, settings migration should be added
 * 2. If there's same embedding model id in user's settings, it's data should be overwritten by default embedding model
 */
export const DEFAULT_EMBEDDING_MODELS: readonly EmbeddingModel[] = [
  {
    providerType: 'voyage',
    providerId: PROVIDER_TYPES_INFO.voyage.defaultProviderId,
    id: 'voyage/voyage-4',
    model: 'voyage-4',
    dimension: 1024,
  },
  {
    providerType: 'voyage',
    providerId: PROVIDER_TYPES_INFO.voyage.defaultProviderId,
    id: 'voyage/voyage-4-large',
    model: 'voyage-4-large',
    dimension: 1024,
  },
  {
    providerType: 'voyage',
    providerId: PROVIDER_TYPES_INFO.voyage.defaultProviderId,
    id: 'voyage/voyage-4-lite',
    model: 'voyage-4-lite',
    dimension: 1024,
  },
  {
    providerType: 'openai',
    providerId: PROVIDER_TYPES_INFO.openai.defaultProviderId,
    id: 'openai/text-embedding-3-small',
    model: 'text-embedding-3-small',
    dimension: 1536,
  },
  {
    providerType: 'openai',
    providerId: PROVIDER_TYPES_INFO.openai.defaultProviderId,
    id: 'openai/text-embedding-3-large',
    model: 'text-embedding-3-large',
    dimension: 3072,
  },
  {
    providerType: 'gemini',
    providerId: PROVIDER_TYPES_INFO.gemini.defaultProviderId,
    id: 'gemini/gemini-embedding-2',
    model: 'gemini-embedding-2',
    dimension: 3072,
  },
  {
    providerType: 'ollama',
    providerId: PROVIDER_TYPES_INFO.ollama.defaultProviderId,
    id: 'ollama/nomic-embed-text',
    model: 'nomic-embed-text',
    dimension: 768,
  },
  {
    providerType: 'ollama',
    providerId: PROVIDER_TYPES_INFO.ollama.defaultProviderId,
    id: 'ollama/mxbai-embed-large',
    model: 'mxbai-embed-large',
    dimension: 1024,
  },
  {
    providerType: 'ollama',
    providerId: PROVIDER_TYPES_INFO.ollama.defaultProviderId,
    id: 'ollama/bge-m3',
    model: 'bge-m3',
    dimension: 1024,
  },
]

// Pricing in dollars per million tokens
export type ModelPricing = {
  input: number
  output: number
  // Cache reads and (5-minute) cache writes, where the provider lists them
  cachedInput?: number
  cacheWrite?: number
}

export type LongContextPricingRule = {
  thresholdPromptTokens: number
  thresholdInclusive: boolean
  pricing: ModelPricing
}

export const OPENAI_PRICES: Record<string, ModelPricing> = {
  'gpt-6.2-sol': { input: 2, output: 10, cachedInput: 0.1 },
}

export const ANTHROPIC_PRICES: Record<string, ModelPricing> = {
  'claude-opus-5-5': { input: 4, output: 20, cachedInput: 0.2, cacheWrite: 5 },
}

export const GEMINI_PRICES: Record<string, ModelPricing> = {
  'gemini-4-carbon': { input: 4, output: 20, cachedInput: 0.2 },
  // Introductory rates through 2026-12-31; standard rates become $1.50/$7.50.
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
}

export const XAI_PRICES: Record<string, ModelPricing> = {
  'grok-4.7': { input: 2, output: 6 },
}

export const DEEPSEEK_PRICES: Record<string, ModelPricing> = {
  // Peak, cache-miss pricing. Actual cost can be lower off-peak or on cache hit.
  'deepseek-v4-pro': { input: 1.32, output: 3.96 },
}

export const LONG_CONTEXT_PRICING_RULES: Record<
  string,
  LongContextPricingRule
> = {
  'openai/gpt-6.2-sol': {
    thresholdPromptTokens: 272_000,
    thresholdInclusive: false,
    pricing: { input: 4, output: 15, cachedInput: 0.2 },
  },
  'xai/grok-4.7': {
    thresholdPromptTokens: 200_000,
    thresholdInclusive: true,
    pricing: { input: 4, output: 12 },
  },
}
