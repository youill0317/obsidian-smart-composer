import { SettingMigration } from '../setting.types'

export const CHAT_MODELS_ADDED_IN_V18 = [
  {
    providerType: 'anthropic-plan',
    providerId: 'anthropic-plan',
    id: 'claude-opus-5 (plan)',
    model: 'claude-opus-5',
  },
  {
    providerType: 'openai-plan',
    providerId: 'openai-plan',
    id: 'gpt-5.6-sol (plan)',
    model: 'gpt-5.6-sol',
  },
  {
    providerType: 'openai-plan',
    providerId: 'openai-plan',
    id: 'gpt-5.6-luna (plan)',
    model: 'gpt-5.6-luna',
  },
  {
    providerType: 'gemini-plan',
    providerId: 'gemini-plan',
    id: 'gemini-3.1-pro-preview (plan)',
    model: 'gemini-3.1-pro-preview',
  },
  {
    providerType: 'anthropic',
    providerId: 'anthropic',
    id: 'claude-opus-5',
    model: 'claude-opus-5',
  },
  {
    providerType: 'openai',
    providerId: 'openai',
    id: 'gpt-5.6-sol',
    model: 'gpt-5.6-sol',
  },
  {
    providerType: 'gemini',
    providerId: 'gemini',
    id: 'gemini-3.1-pro-preview',
    model: 'gemini-3.1-pro-preview',
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

export const migrateFrom17To18: SettingMigration['migrate'] = (data) => {
  const newData: Record<string, unknown> = { ...data, version: 18 }

  if (Array.isArray(data.chatModels)) {
    const existingIds = new Set(
      data.chatModels.flatMap((model) => {
        const id = (model as { id?: unknown } | null)?.id
        return typeof id === 'string' ? [id] : []
      }),
    )
    const missingModels = CHAT_MODELS_ADDED_IN_V18.filter(
      (model) => !existingIds.has(model.id),
    )
    newData.chatModels = [...missingModels, ...data.chatModels]
  }

  // Existing selections and model objects belong to the user. In particular,
  // do not cross API/plan authentication boundaries or change model tiers.
  return newData
}
