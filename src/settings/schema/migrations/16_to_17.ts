import { SettingMigration } from '../setting.types'

import { getMigratedProviders } from './migrationUtils'

const DEFAULT_PROVIDERS_V17 = [
  { type: 'anthropic-plan', id: 'anthropic-plan' },
  { type: 'openai-plan', id: 'openai-plan' },
  { type: 'gemini-plan', id: 'gemini-plan' },
  { type: 'anthropic', id: 'anthropic' },
  { type: 'openai', id: 'openai' },
  { type: 'gemini', id: 'gemini' },
  { type: 'xai', id: 'xai' },
  { type: 'deepseek', id: 'deepseek' },
  { type: 'mistral', id: 'mistral' },
  { type: 'voyage', id: 'voyage' },
  { type: 'perplexity', id: 'perplexity' },
  { type: 'openrouter', id: 'openrouter' },
  { type: 'ollama', id: 'ollama' },
  { type: 'lm-studio', id: 'lm-studio' },
] as const

const VOYAGE_EMBEDDING_MODELS = [
  {
    providerType: 'voyage',
    providerId: 'voyage',
    id: 'voyage/voyage-4',
    model: 'voyage-4',
    dimension: 1024,
  },
  {
    providerType: 'voyage',
    providerId: 'voyage',
    id: 'voyage/voyage-4-large',
    model: 'voyage-4-large',
    dimension: 1024,
  },
  {
    providerType: 'voyage',
    providerId: 'voyage',
    id: 'voyage/voyage-4-lite',
    model: 'voyage-4-lite',
    dimension: 1024,
  },
] as const

export const migrateFrom16To17: SettingMigration['migrate'] = (data) => {
  const newData = { ...data }
  newData.version = 17

  if (
    Array.isArray(newData.providers) &&
    newData.providers.some(
      (provider) =>
        (provider as { id?: unknown; type?: unknown } | null)?.id ===
          'voyage' &&
        (provider as { id?: unknown; type?: unknown } | null)?.type !==
          'voyage',
    )
  ) {
    return newData
  }

  newData.providers = getMigratedProviders(newData, DEFAULT_PROVIDERS_V17)

  // DEFAULT_EMBEDDING_MODELS in constants.ts says a default should overwrite a
  // user entry with the same id. That rule is for defaults whose data changes
  // over time; these Voyage ids are new, so a collision can only be a model the
  // user created. Overwriting it would swap the provider and dimension out from
  // under vectors that were embedded in a different space, so keep theirs.
  if (Array.isArray(newData.embeddingModels)) {
    const embeddingModels = newData.embeddingModels
    const missingModels = VOYAGE_EMBEDDING_MODELS.filter(
      (defaultModel) =>
        !embeddingModels.some(
          (model) => (model as { id?: unknown } | null)?.id === defaultModel.id,
        ),
    )
    newData.embeddingModels = [...missingModels, ...embeddingModels]
  }

  return newData
}
