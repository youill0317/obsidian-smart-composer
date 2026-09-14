import {
  NEW_DEFAULT_CHAT_MODELS,
  NEW_DEFAULT_PROVIDERS,
  migrateFrom2To3,
} from './2_to_3'

describe('settings 2_to_3 migration', () => {
  it('should add new default providers when no providers exist', () => {
    const oldSettings = {
      version: 2,
      providers: [],
    }

    const result = migrateFrom2To3(oldSettings)
    expect(result.version).toBe(3)
    expect(result.providers).toEqual(NEW_DEFAULT_PROVIDERS)
  })

  it('should preserve existing providers and add new ones', () => {
    const oldSettings = {
      version: 2,
      providers: [
        {
          type: 'openai',
          id: 'openai',
          apiKey: 'test-key',
        },
      ],
    }

    const result = migrateFrom2To3(oldSettings)
    expect(result.version).toBe(3)
    expect(result.providers).toEqual([
      {
        type: 'openai',
        id: 'openai',
        apiKey: 'test-key',
      },
      ...NEW_DEFAULT_PROVIDERS,
    ])
    expect(result.providers).toHaveLength(4) // 1 existing + 3 new
  })

  it('preserves a custom provider when its ID matches a new default', () => {
    const oldSettings = {
      version: 2,
      providers: [
        {
          type: 'openai-compatible', // Different type
          id: 'lm-studio', // Same ID as new provider
          baseUrl: 'http://localhost:1234',
          apiKey: 'test-key',
        },
      ],
    }

    const result = migrateFrom2To3(oldSettings)
    expect(result.version).toBe(3)
    expect(result.providers).toContainEqual({
      type: 'openai-compatible',
      id: 'lm-studio',
      baseUrl: 'http://localhost:1234', // Other settings preserved
      apiKey: 'test-key',
    })
  })

  it('should handle missing providers array', () => {
    const oldSettings = {
      version: 2,
    }

    const result = migrateFrom2To3(oldSettings)
    expect(result.version).toBe(3)
    expect(result).toEqual({
      version: 3,
    })
  })

  it('should add new chat models when no chat models exist', () => {
    const oldSettings = {
      version: 2,
      providers: [],
      chatModels: [],
    }

    const result = migrateFrom2To3(oldSettings)
    expect(result.chatModels).toEqual(NEW_DEFAULT_CHAT_MODELS)
  })

  it('should preserve existing chat models and add new ones', () => {
    const oldSettings = {
      version: 2,
      providers: [],
      chatModels: [
        {
          providerType: 'openai',
          providerId: 'openai',
          id: 'gpt-4',
          model: 'gpt-4',
        },
      ],
    }

    const result = migrateFrom2To3(oldSettings)
    expect(result.chatModels).toEqual([
      {
        providerType: 'openai',
        providerId: 'openai',
        id: 'gpt-4',
        model: 'gpt-4',
      },
      ...NEW_DEFAULT_CHAT_MODELS,
    ])
  })

  it('preserves a custom chat model with the same ID', () => {
    const oldSettings = {
      version: 2,
      providers: [],
      chatModels: [
        {
          providerType: 'openai',
          providerId: 'custom',
          id: 'deepseek-chat', // Same ID as new model
          model: 'custom-model',
        },
      ],
    }

    const result = migrateFrom2To3(oldSettings)
    expect(result.chatModels).toContainEqual({
      providerType: 'openai',
      providerId: 'custom',
      id: 'deepseek-chat',
      model: 'custom-model',
    })
  })
})
