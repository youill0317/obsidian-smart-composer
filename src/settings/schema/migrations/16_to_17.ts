import { SettingMigration } from '../setting.types'

// Keep this historical snapshot independent of future catalog changes.
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

const VOYAGE_MODELS = ['voyage-4', 'voyage-4-large', 'voyage-4-lite'] as const

type ProviderIdentity = { id?: unknown; type?: unknown } | null

export const migrateFrom16To17: SettingMigration['migrate'] = (data) => {
  const newData: Record<string, unknown> = { ...data, version: 17 }
  // This migration adds Voyage only. Rebuilding all default providers would
  // discard custom providers whose ids match a default but whose types differ.
  const providers: unknown[] = Array.isArray(data.providers)
    ? [...data.providers]
    : DEFAULT_PROVIDERS_V17.map((provider) => ({ ...provider }))

  let providerId = 'voyage'
  let suffix = 1
  while (
    providers.some(
      (provider) =>
        (provider as ProviderIdentity)?.id === providerId &&
        (provider as ProviderIdentity)?.type !== 'voyage',
    )
  ) {
    suffix += 1
    providerId = `voyage-${suffix}`
  }

  // Reuse the same generated id on repeated migrations without changing keys,
  // endpoints, or any other properties of existing providers.
  if (
    !providers.some(
      (provider) => (provider as ProviderIdentity)?.id === providerId,
    )
  ) {
    providers.push({ type: 'voyage', id: providerId })
  }
  newData.providers = providers

  // A colliding model id belongs to the user, including its embedding space.
  // Only new models are bound to the collision-free Voyage provider id.
  if (Array.isArray(data.embeddingModels)) {
    const existingIds = new Set(
      data.embeddingModels.map(
        (model) => (model as { id?: unknown } | null)?.id,
      ),
    )
    const missingModels = VOYAGE_MODELS.filter(
      (model) => !existingIds.has(`voyage/${model}`),
    ).map((model) => ({
      providerType: 'voyage',
      providerId,
      id: `voyage/${model}`,
      model,
      dimension: 1024,
    }))
    newData.embeddingModels = [...missingModels, ...data.embeddingModels]
  }

  return newData
}
