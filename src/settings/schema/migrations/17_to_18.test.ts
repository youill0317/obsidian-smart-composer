import { migrateFrom16To17 } from './16_to_17'
import { CHAT_MODELS_ADDED_IN_V18, migrateFrom17To18 } from './17_to_18'

describe('Migration from v17 to v18', () => {
  const apiModel = {
    providerType: 'openai',
    providerId: 'openai',
    id: 'gpt-4.1-mini',
    model: 'gpt-4.1-mini',
    enable: false,
    promptLevel: 'none',
    reasoning: { enabled: true, reasoning_effort: 'low' },
  }
  const planModel = {
    providerType: 'anthropic-plan',
    providerId: 'anthropic-plan',
    id: 'claude-sonnet-4.5 (plan)',
    model: 'claude-sonnet-4-5',
    thinking: { enabled: true, budget_tokens: 4096 },
  }

  it('adds models without replacing user models or selections', () => {
    const result = migrateFrom17To18({
      version: 17,
      chatModels: [apiModel, planModel],
      chatModelId: apiModel.id,
      applyModelId: apiModel.id,
    })

    expect(result.version).toBe(18)
    expect(result.chatModels).toEqual([
      ...CHAT_MODELS_ADDED_IN_V18,
      apiModel,
      planModel,
    ])
    expect(result.chatModelId).toBe(apiModel.id)
    expect(result.applyModelId).toBe(apiModel.id)
  })

  it('preserves a user model that collides with a new default id', () => {
    const userModel = {
      ...apiModel,
      id: 'gpt-5.6-sol',
      model: 'gateway-model',
    }
    const result = migrateFrom17To18({
      version: 17,
      chatModels: [userModel],
    })

    expect(
      Array.isArray(result.chatModels) &&
        result.chatModels.filter(
          (model) => (model as { id?: unknown }).id === userModel.id,
        ),
    ).toEqual([userModel])
  })

  it('is idempotent and supports the v16 to v17 to v18 chain', () => {
    const v17 = migrateFrom16To17({
      version: 16,
      chatModels: [apiModel],
      chatModelId: apiModel.id,
      applyModelId: apiModel.id,
    })
    const first = migrateFrom17To18(v17)
    const second = migrateFrom17To18(first)

    expect(second).toEqual(first)
    expect(first.version).toBe(18)
    expect(first.chatModelId).toBe(apiModel.id)
    expect(first.applyModelId).toBe(apiModel.id)
  })

  it('leaves malformed non-array model data for schema recovery', () => {
    const chatModels = { invalid: true }
    const result = migrateFrom17To18({ version: 17, chatModels })

    expect(result.chatModels).toBe(chatModels)
  })
})
