import { SettingMigration } from '../setting.types'

export const CHAT_MODELS_ADDED_IN_V18 = [
  {
    providerType: 'openai-plan',
    providerId: 'openai-plan',
    id: 'gpt-6-astra (plan)',
    model: 'gpt-6-astra',
  },
  {
    providerType: 'openai',
    providerId: 'openai',
    id: 'gpt-6-astra',
    model: 'gpt-6-astra',
    reasoning: { enabled: true, reasoning_effort: 'medium' },
  },
  {
    providerType: 'anthropic-plan',
    providerId: 'anthropic-plan',
    id: 'claude-opus-5 (plan)',
    model: 'claude-opus-5',
  },
  {
    providerType: 'openai-plan',
    providerId: 'openai-plan',
    id: 'gpt-5.3-codex-spark (plan)',
    model: 'gpt-5.3-codex-spark',
  },
  {
    providerType: 'gemini-plan',
    providerId: 'gemini-plan',
    id: 'gemini-3.8-flash (plan)',
    model: 'gemini-3.8-flash',
  },
  {
    providerType: 'anthropic',
    providerId: 'anthropic',
    id: 'claude-opus-5',
    model: 'claude-opus-5',
  },
  {
    providerType: 'gemini',
    providerId: 'gemini',
    id: 'gemini-3.8-flash',
    model: 'gemini-3.8-flash',
  },
  {
    providerType: 'deepseek',
    providerId: 'deepseek',
    id: 'deepseek-v4-pro',
    model: 'deepseek-v4-pro',
  },
  {
    providerType: 'xai',
    providerId: 'xai',
    id: 'grok-4.6',
    model: 'grok-4.6',
  },
] as const

// Fixed v17 identities: changing a custom model's id or binding makes it user-owned.
export const CHAT_MODELS_RETIRED_IN_V18 = [
  ['anthropic-plan', 'claude-opus-4.5 (plan)', 'claude-opus-4-5'],
  ['anthropic-plan', 'claude-sonnet-4.5 (plan)', 'claude-sonnet-4-5'],
  ['openai-plan', 'gpt-5.2 (plan)', 'gpt-5.2'],
  ['gemini-plan', 'gemini-3-pro-preview (plan)', 'gemini-3-pro-preview'],
  ['gemini-plan', 'gemini-3-flash-preview (plan)', 'gemini-3-flash-preview'],
  ['anthropic', 'claude-opus-4.5', 'claude-opus-4-5'],
  ['anthropic', 'claude-sonnet-4.5', 'claude-sonnet-4-5'],
  ['anthropic', 'claude-haiku-4.5', 'claude-haiku-4-5'],
  ['openai', 'gpt-5.2', 'gpt-5.2'],
  ['openai', 'gpt-5-mini', 'gpt-5-mini'],
  ['openai', 'gpt-4.1-mini', 'gpt-4.1-mini'],
  ['openai', 'o4-mini', 'o4-mini'],
  ['gemini', 'gemini-3-pro-preview', 'gemini-3-pro-preview'],
  ['gemini', 'gemini-3-flash-preview', 'gemini-3-flash-preview'],
  ['deepseek', 'deepseek-chat', 'deepseek-chat'],
  ['deepseek', 'deepseek-reasoner', 'deepseek-reasoner'],
  ['xai', 'grok-4-1-fast', 'grok-4-1-fast'],
  ['xai', 'grok-4-1-fast-non-reasoning', 'grok-4-1-fast-non-reasoning'],
].map(([providerType, id, model]) => ({
  providerType,
  providerId: providerType,
  id,
  model,
}))

const REPLACEMENT_IDS: Record<string, string> = {
  'anthropic-plan': 'claude-opus-5 (plan)',
  'openai-plan': 'gpt-6-astra (plan)',
  'gemini-plan': 'gemini-3.8-flash (plan)',
  anthropic: 'claude-opus-5',
  openai: 'gpt-6-astra',
  gemini: 'gemini-3.8-flash',
  deepseek: 'deepseek-v4-pro',
  xai: 'grok-4.6',
}

type ModelIdentity = {
  id?: unknown
  providerType?: unknown
  providerId?: unknown
  model?: unknown
} | null

export const migrateFrom17To18: SettingMigration['migrate'] = (data) => {
  const newData: Record<string, unknown> = { ...data, version: 18 }
  const models: ModelIdentity[] = Array.isArray(data.chatModels)
    ? data.chatModels
    : CHAT_MODELS_RETIRED_IN_V18
  const retired = models.filter((model) =>
    CHAT_MODELS_RETIRED_IN_V18.some(
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

  for (const model of CHAT_MODELS_ADDED_IN_V18) {
    let id: string = model.id
    let suffix = 1
    let existing = retained.find((candidate) => candidate?.id === id)
    // A colliding id may use different credentials. Keep it and give the new
    // built-in its own id instead of silently switching authentication paths.
    while (
      existing &&
      (existing.providerType !== model.providerType ||
        existing.providerId !== model.providerId ||
        existing.model !== model.model)
    ) {
      suffix += 1
      id = `${model.id}-${suffix}`
      existing = retained.find((candidate) => candidate?.id === id)
    }
    replacementIds.set(model.id, id)
    if (!existing) added.push({ ...model, id })
  }
  newData.chatModels = [...added, ...retained]

  for (const key of ['chatModelId', 'applyModelId']) {
    const old = retired.find((model) => model?.id === data[key])
    if (!old) continue
    const replacement =
      key === 'applyModelId' && old.providerType === 'openai-plan'
        ? 'gpt-5.3-codex-spark (plan)'
        : REPLACEMENT_IDS[old.providerType as string]
    newData[key] = replacementIds.get(replacement)
  }
  return newData
}
