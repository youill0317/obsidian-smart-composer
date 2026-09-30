import { SettingMigration } from '../setting.types'

// Fixed snapshots keep this migration independent of future catalog changes.
export const CHAT_MODELS_ADDED_IN_V22 = [
  {
    providerType: 'openai-plan',
    providerId: 'openai-plan',
    id: 'gpt-6.1-sol (plan)',
    model: 'gpt-6.1-sol',
  },
  {
    providerType: 'openai',
    providerId: 'openai',
    id: 'gpt-6.1-sol',
    model: 'gpt-6.1-sol',
    reasoning: { enabled: true, reasoning_effort: 'medium' },
  },
  {
    providerType: 'openai-plan',
    providerId: 'openai-plan',
    id: 'gpt-6-luna (plan)',
    model: 'gpt-6-luna',
  },
  {
    providerType: 'openai',
    providerId: 'openai',
    id: 'gpt-6-luna',
    model: 'gpt-6-luna',
  },
  {
    providerType: 'anthropic-plan',
    providerId: 'anthropic-plan',
    id: 'claude-opus-5-5 (plan)',
    model: 'claude-opus-5-5',
  },
  {
    providerType: 'anthropic',
    providerId: 'anthropic',
    id: 'claude-opus-5-5',
    model: 'claude-opus-5-5',
  },
  {
    providerType: 'xai',
    providerId: 'xai',
    id: 'grok-4.7',
    model: 'grok-4.7',
  },
] as const

export const EMBEDDING_MODELS_ADDED_IN_V22 = [
  {
    providerType: 'gemini',
    providerId: 'gemini',
    id: 'gemini/gemini-embedding-2',
    model: 'gemini-embedding-2',
    dimension: 3072,
  },
] as const

const RETIRED_CHAT_MODELS = [
  ['openai', 'gpt-6-astra', 'gpt-6-astra'],
  ['openai-plan', 'gpt-6-astra (plan)', 'gpt-6-astra'],
  ['anthropic', 'claude-opus-5', 'claude-opus-5'],
  ['anthropic-plan', 'claude-opus-5 (plan)', 'claude-opus-5'],
  ['xai', 'grok-4.6', 'grok-4.6'],
].map(([providerType, id, model]) => ({
  providerType,
  providerId: providerType,
  id,
  model,
}))
const RETIRED_EMBEDDING_MODELS = [
  {
    providerType: 'gemini',
    providerId: 'gemini',
    id: 'gemini/text-embedding-004',
    model: 'text-embedding-004',
  },
]
const REPLACEMENT_IDS: Record<string, string> = {
  'gpt-6-astra': 'gpt-6.1-sol',
  'gpt-6-astra (plan)': 'gpt-6.1-sol (plan)',
  'claude-opus-5': 'claude-opus-5-5',
  'claude-opus-5 (plan)': 'claude-opus-5-5 (plan)',
  'grok-4.6': 'grok-4.7',
  'gemini/text-embedding-004': 'gemini/gemini-embedding-2',
}

type ModelIdentity = {
  id?: unknown
  providerType?: unknown
  providerId?: unknown
  model?: unknown
} | null

export const migrateFrom21To22: SettingMigration['migrate'] = (data) => {
  const newData: Record<string, unknown> = { ...data, version: 22 }
  for (const [catalog, defaults, retiredDefaults, selections] of [
    [
      'chatModels',
      CHAT_MODELS_ADDED_IN_V22,
      RETIRED_CHAT_MODELS,
      ['chatModelId', 'applyModelId'],
    ],
    [
      'embeddingModels',
      EMBEDDING_MODELS_ADDED_IN_V22,
      RETIRED_EMBEDDING_MODELS,
      ['embeddingModelId'],
    ],
  ] as const) {
    const models: ModelIdentity[] = Array.isArray(data[catalog])
      ? (data[catalog] as ModelIdentity[])
      : retiredDefaults
    const retired = models.filter((model) =>
      retiredDefaults.some(
        (old) =>
          model?.id === old.id &&
          model.providerType === old.providerType &&
          model.providerId === old.providerId &&
          model.model === old.model,
      ),
    )
    const retained = models.filter((model) => !retired.includes(model))
    const added: ModelIdentity[] = []
    const replacementIds = new Map<string, string>()
    for (const model of defaults) {
      let id: string = model.id
      let suffix = 1
      let existing = retained.find((candidate) => candidate?.id === id)
      // Preserve custom bindings, including credentials, on id collisions.
      while (
        existing &&
        (existing.providerType !== model.providerType ||
          existing.providerId !== model.providerId ||
          existing.model !== model.model)
      ) {
        id = `${model.id}-${++suffix}`
        existing = retained.find((candidate) => candidate?.id === id)
      }
      replacementIds.set(model.id, id)
      if (!existing) added.push({ ...model, id })
      else if (catalog === 'embeddingModels') {
        retained[retained.indexOf(existing)] = { ...existing, ...model, id }
      }
    }
    // Let the settings schema supply the full catalog when none was saved.
    newData[catalog] = Array.isArray(data[catalog])
      ? [...added, ...retained]
      : undefined
    for (const key of selections) {
      const old = retired.find((model) => model?.id === data[key])
      if (!old) continue
      const replacement =
        key === 'applyModelId' && old.model === 'gpt-6-astra'
          ? old.providerType === 'openai-plan'
            ? 'gpt-6-luna (plan)'
            : 'gpt-6-luna'
          : REPLACEMENT_IDS[old.id as string]
      newData[key] = replacementIds.get(replacement)
    }
  }
  return newData
}
