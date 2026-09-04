import { parseSmartComposerSettings } from '../settings'

import { migrateFrom16To17 } from './16_to_17'

it('preserves selections and provider bindings through full settings loading', () => {
  const providers = [
    {
      type: 'openai-compatible',
      id: 'openai',
      apiKey: 'gateway-key',
      baseUrl: 'https://gateway.example/v1',
    },
    {
      type: 'openai-compatible',
      id: 'voyage',
      apiKey: 'custom-key',
      baseUrl: 'https://embedding.example/v1',
    },
  ]
  const chatModel = {
    providerType: 'openai-compatible',
    providerId: 'openai',
    id: 'custom-chat',
    model: 'gateway-chat',
    enable: false,
  }
  const embeddingModel = {
    providerType: 'openai-compatible',
    providerId: 'voyage',
    id: 'voyage/voyage-4',
    model: 'existing-embedding',
    dimension: 256,
  }
  const original = {
    version: 16,
    providers,
    chatModels: [chatModel],
    chatModelId: chatModel.id,
    applyModelId: chatModel.id,
    embeddingModels: [embeddingModel],
    embeddingModelId: embeddingModel.id,
  }
  const settings = parseSmartComposerSettings(original)

  for (const provider of providers) {
    expect(settings.providers.find((p) => p.id === provider.id)).toEqual(
      provider,
    )
  }
  expect(settings.chatModelId).toBe(chatModel.id)
  expect(settings.applyModelId).toBe(chatModel.id)
  expect(settings.chatModels).toContainEqual(chatModel)
  expect(settings.embeddingModelId).toBe(embeddingModel.id)
  expect(settings.embeddingModels).toContainEqual(embeddingModel)

  const addedModels = settings.embeddingModels.filter(
    (model) => model.providerType === 'voyage',
  )
  expect(addedModels).toHaveLength(2)
  for (const model of addedModels) {
    expect(model.providerId).toBe('voyage-2')
    expect(
      settings.providers.find((provider) => provider.id === model.providerId)
        ?.type,
    ).toBe('voyage')
  }
  expect(parseSmartComposerSettings(settings)).toEqual(settings)
  const once = migrateFrom16To17(original)
  expect(migrateFrom16To17(once)).toEqual(once)
})
