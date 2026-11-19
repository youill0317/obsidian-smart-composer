import { SettingMigration } from '../setting.types'

const REMOVED_PROVIDER_TYPES = ['anthropic-plan', 'gemini-plan']
const FALLBACK_MODEL_IDS = {
  chatModelId: 'claude-opus-5-5',
  applyModelId: 'gpt-6-luna',
  embeddingModelId: 'voyage/voyage-4',
}

type UnknownRecord = Record<string, unknown>

/**
 * Removes the Claude and Gemini plan providers and their models.
 */
export const migrateFrom24To25: SettingMigration['migrate'] = (data) => {
  const newData: UnknownRecord = { ...data, version: 25 }
  if (Array.isArray(data.providers)) {
    newData.providers = (data.providers as UnknownRecord[]).filter(
      (provider) => !REMOVED_PROVIDER_TYPES.includes(provider?.type as string),
    )
  }
  for (const [catalog, selections] of [
    ['chatModels', ['chatModelId', 'applyModelId']],
    ['embeddingModels', ['embeddingModelId']],
  ] as const) {
    if (!Array.isArray(data[catalog])) continue
    const models = data[catalog] as UnknownRecord[]
    const removedIds = models
      .filter((model) =>
        REMOVED_PROVIDER_TYPES.includes(model?.providerType as string),
      )
      .map((model) => model?.id)
    const retained = models.filter(
      (model) =>
        !REMOVED_PROVIDER_TYPES.includes(model?.providerType as string),
    )
    newData[catalog] = retained
    const hasModel = (id: unknown) =>
      typeof id === 'string' && retained.some((model) => model?.id === id)
    for (const key of selections) {
      if (!removedIds.includes(data[key]) || hasModel(data[key])) continue
      // Prefer the default if it still exists, then any remaining model that
      // is not a plan model.
      newData[key] =
        [
          FALLBACK_MODEL_IDS[key],
          retained.find((model) => model?.providerType !== 'openai-plan')?.id,
          retained[0]?.id,
        ].find(hasModel) ?? FALLBACK_MODEL_IDS[key]
    }
  }
  return newData
}
