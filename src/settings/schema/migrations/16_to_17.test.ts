import { migrateFrom16To17 } from './16_to_17'

describe('Migration from v16 to v17', () => {
  it('should increment version to 17', () => {
    const result = migrateFrom16To17({ version: 16 })

    expect(result.version).toBe(17)
  })

  it('should add the Voyage AI provider while preserving custom providers', () => {
    const result = migrateFrom16To17({
      version: 16,
      providers: [
        { type: 'openai', id: 'openai', apiKey: 'openai-key' },
        { type: 'custom', id: 'custom-provider', apiKey: 'custom-key' },
      ],
    })

    expect(
      Array.isArray(result.providers) &&
        result.providers.find(
          (provider) => (provider as { type?: string }).type === 'voyage',
        ),
    ).toEqual({ type: 'voyage', id: 'voyage' })
    expect(
      Array.isArray(result.providers) &&
        result.providers.find(
          (provider) => (provider as { id?: string }).id === 'custom-provider',
        ),
    ).toEqual({
      type: 'custom',
      id: 'custom-provider',
      apiKey: 'custom-key',
    })
  })

  it('should prepend missing Voyage AI embedding models', () => {
    const customModel = {
      providerType: 'custom',
      providerId: 'custom-provider',
      id: 'custom/embedding',
      model: 'embedding',
      dimension: 384,
    }

    const result = migrateFrom16To17({
      version: 16,
      embeddingModels: [customModel],
    })

    expect(result.embeddingModels).toEqual([
      ...getDefaultVoyageEmbeddingModels(),
      customModel,
    ])
  })

  it('should preserve the selected embedding model', () => {
    const result = migrateFrom16To17({
      version: 16,
      embeddingModelId: 'openai/text-embedding-3-small',
    })

    expect(result.embeddingModelId).toBe('openai/text-embedding-3-small')
  })

  it('should preserve an id conflict while migrating unrelated data', () => {
    const providers = [
      { type: 'openai-compatible', id: 'voyage', apiKey: 'custom-key' },
    ]
    const embeddingModels = [
      {
        providerType: 'openai-compatible',
        providerId: 'voyage',
        id: 'custom/embedding',
        model: 'embedding',
        dimension: 1024,
      },
    ]

    const result = migrateFrom16To17({
      version: 16,
      providers,
      embeddingModels,
    })

    expect(
      Array.isArray(result.providers) &&
        result.providers.find(
          (provider) => (provider as { id?: string }).id === 'voyage',
        ),
    ).toEqual(providers[0])
    expect(result.embeddingModels).toEqual([
      ...getDefaultVoyageEmbeddingModels(),
      ...embeddingModels,
    ])
  })

  it('should preserve user models with Voyage default ids', () => {
    const userModel = {
      providerType: 'voyage',
      providerId: 'custom-voyage',
      id: 'voyage/voyage-4',
      model: 'custom-model',
      dimension: 256,
    }

    const result = migrateFrom16To17({
      version: 16,
      embeddingModels: [userModel],
    })

    expect(result.embeddingModels).toEqual([
      ...getDefaultVoyageEmbeddingModels().slice(1),
      userModel,
    ])
  })

  it('should leave non-array embedding models unchanged', () => {
    const embeddingModels = { invalid: true }

    const result = migrateFrom16To17({
      version: 16,
      embeddingModels,
    })

    expect(result.embeddingModels).toBe(embeddingModels)
  })
})

function getDefaultVoyageEmbeddingModels() {
  return [
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
  ]
}
