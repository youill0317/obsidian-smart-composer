import { migrateFrom16To17 } from './16_to_17'

function voyageModels(providerId = 'voyage') {
  return ['voyage-4', 'voyage-4-large', 'voyage-4-lite'].map((model) => ({
    providerType: 'voyage',
    providerId,
    id: `voyage/${model}`,
    model,
    dimension: 1024,
  }))
}

describe('Migration from v16 to v17', () => {
  it('increments the version and recovers missing provider data', () => {
    const result = migrateFrom16To17({ version: 16 })
    expect(result.version).toBe(17)
    expect(result.providers).toContainEqual({ type: 'voyage', id: 'voyage' })
    expect(result.providers).toContainEqual({ type: 'openai', id: 'openai' })
  })

  it('only adds Voyage and preserves unrelated provider objects', () => {
    const provider = Object.freeze({
      type: 'openai-compatible',
      id: 'openai',
      apiKey: 'gateway-key',
      baseUrl: 'https://gateway.example/v1',
    })
    const providers = Object.freeze([provider])
    const result = migrateFrom16To17({ version: 16, providers })

    expect(result.providers).toEqual([
      provider,
      { type: 'voyage', id: 'voyage' },
    ])
    expect((result.providers as unknown[])[0]).toBe(provider)
    expect(providers).toEqual([provider])
  })

  it('preserves an existing Voyage provider and its credentials', () => {
    const provider = { type: 'voyage', id: 'voyage', apiKey: 'voyage-key' }
    const result = migrateFrom16To17({
      version: 16,
      providers: [provider],
      embeddingModels: [],
    })
    expect(result.providers).toEqual([provider])
    expect(result.embeddingModels).toEqual(voyageModels())
  })

  it('adds missing models without changing the selected embedding model', () => {
    const customModel = {
      providerType: 'openai-compatible',
      providerId: 'custom-provider',
      id: 'custom/embedding',
      model: 'embedding',
      dimension: 384,
    }
    const result = migrateFrom16To17({
      version: 16,
      embeddingModels: [customModel],
      embeddingModelId: customModel.id,
    })
    expect(result.embeddingModels).toEqual([...voyageModels(), customModel])
    expect(result.embeddingModelId).toBe(customModel.id)
  })

  it('binds new models to a collision-free provider', () => {
    const providers = [
      { type: 'openai-compatible', id: 'voyage', apiKey: 'custom-key' },
      { type: 'openai-compatible', id: 'voyage-2', apiKey: 'second-key' },
    ]
    const result = migrateFrom16To17({
      version: 16,
      providers,
      embeddingModels: [],
    })
    expect(result.providers).toEqual([
      ...providers,
      { type: 'voyage', id: 'voyage-3' },
    ])
    expect(result.embeddingModels).toEqual(voyageModels('voyage-3'))
    expect(migrateFrom16To17(result)).toEqual(result)
  })

  it('preserves user models whose ids match new defaults', () => {
    const userModel = {
      providerType: 'openai-compatible',
      providerId: 'voyage',
      id: 'voyage/voyage-4',
      model: 'custom-model',
      dimension: 256,
    }
    const result = migrateFrom16To17({
      version: 16,
      providers: [{ type: 'openai-compatible', id: 'voyage' }],
      embeddingModels: [userModel],
      embeddingModelId: userModel.id,
    })
    expect(result.embeddingModels).toEqual([
      ...voyageModels('voyage-2').slice(1),
      userModel,
    ])
    expect(result.embeddingModelId).toBe(userModel.id)
    expect(migrateFrom16To17(result)).toEqual(result)
  })

  it('leaves non-array embedding model data for schema recovery', () => {
    const embeddingModels = { invalid: true }
    const result = migrateFrom16To17({ version: 16, embeddingModels })
    expect(result.embeddingModels).toBe(embeddingModels)
  })

  it('does not throw when a provider array contains malformed entries', () => {
    expect(() =>
      migrateFrom16To17({ version: 16, providers: [null, {}] }),
    ).not.toThrow()
  })
})
