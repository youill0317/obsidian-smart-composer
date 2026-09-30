import { SettingMigration } from '../setting.types'

const RETIRED_MODEL_ID = 'gpt-5.3-codex-spark (plan)'
const REPLACEMENT_MODEL_ID = 'gpt-6-astra (plan)'
const FALLBACK_MODEL_IDS = {
  chatModelId: 'claude-opus-5',
  applyModelId: 'gpt-6-astra',
}

type UnknownRecord = Record<string, unknown>

/**
 * Moves the OpenAI plan provider to Sign in with ChatGPT. Tokens issued to the
 * Codex CLI client do not work there, so they are removed and the user signs in
 * again. Also removes the retired gpt-5.3-codex-spark plan model.
 */
export const migrateFrom20To21: SettingMigration['migrate'] = (data) => {
  const providers = Array.isArray(data.providers)
    ? (data.providers as UnknownRecord[]).map((provider) => {
        if (provider?.type !== 'openai-plan') return provider
        const {
          oauth: _oauth,
          credentialsSecretId: _secret,
          ...rest
        } = provider
        return rest
      })
    : data.providers

  const chatModels = Array.isArray(data.chatModels)
    ? (data.chatModels as UnknownRecord[]).filter(
        (model) => model?.id !== RETIRED_MODEL_ID,
      )
    : data.chatModels
  const hasModel = (id: string) =>
    Array.isArray(chatModels) &&
    chatModels.some((model: UnknownRecord) => model?.id === id)

  const newData: UnknownRecord = { ...data, version: 21, providers, chatModels }
  for (const key of ['chatModelId', 'applyModelId'] as const) {
    if (data[key] !== RETIRED_MODEL_ID) continue
    // Prefer a model that still exists; with none left, use the default.
    newData[key] =
      [
        REPLACEMENT_MODEL_ID,
        FALLBACK_MODEL_IDS[key],
        (chatModels as UnknownRecord[] | undefined)?.[0]?.id,
      ].find((id) => typeof id === 'string' && hasModel(id)) ??
      FALLBACK_MODEL_IDS[key]
  }
  return newData
}
