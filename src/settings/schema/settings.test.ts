import {
  DEFAULT_APPLY_MODEL_ID,
  DEFAULT_CHAT_MODELS,
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_EMBEDDING_MODELS,
  DEFAULT_PROVIDERS,
} from '../../constants'
import { cliSettingsSchema } from '../../types/cli.types'

import { SETTINGS_SCHEMA_VERSION } from './migrations'
import { parseSmartComposerSettings } from './settings'

describe('parseSmartComposerSettings', () => {
  it('should return default values for empty input', () => {
    const result = parseSmartComposerSettings({})
    expect(result).toEqual({
      version: SETTINGS_SCHEMA_VERSION,

      providers: [...DEFAULT_PROVIDERS],

      chatModels: [...DEFAULT_CHAT_MODELS],
      embeddingModels: [...DEFAULT_EMBEDDING_MODELS],

      chatModelId: DEFAULT_CHAT_MODEL_ID,
      applyModelId: DEFAULT_APPLY_MODEL_ID,
      embeddingModelId: DEFAULT_EMBEDDING_MODELS[0].id,

      systemPrompt: '',
      cli: cliSettingsSchema.parse(undefined),

      ragOptions: {
        chunkSize: 1000,
        thresholdTokens: 8192,
        minSimilarity: 0.0,
        limit: 10,
        excludePatterns: [],
        includePatterns: [],
      },

      mcp: {
        servers: [],
      },

      chatOptions: {
        includeCurrentFileContent: true,
        enableTools: true,
        maxAutoIterations: 1,
      },
    })
  })

  it('keeps legacy Groq routing through the full migration chain and reload', () => {
    const settings = parseSmartComposerSettings({
      applyModel: 'llama3-8b-8192',
      ollamaBaseUrl: '',
      groqApiKey: 'fake-groq-key',
      systemPrompt: 'retain',
      ragOptions: {},
    })

    expect(settings.applyModelId).toBe('groq/llama3-8b-8192')
    expect(settings.providers).toContainEqual(
      expect.objectContaining({
        id: 'groq',
        type: 'openai-compatible',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: 'fake-groq-key',
      }),
    )
    expect(settings.chatModels).toContainEqual(
      expect.objectContaining({
        id: 'groq/llama3-8b-8192',
        providerType: 'openai-compatible',
        providerId: 'groq',
        model: 'llama3-8b-8192',
      }),
    )
    expect(parseSmartComposerSettings(settings)).toEqual(settings)
  })

  it('preserves custom default-id collisions, endpoints, and selections through reload', () => {
    const customModels = [
      ['deepseek-chat', 'local-deepseek'],
      ['claude-3.7-sonnet', 'local-claude'],
      ['claude-3.7-sonnet-thinking', 'local-claude-thinking'],
      ['o3-mini', 'local-o3-mini'],
      ['gemini-2.5-pro', 'local-gemini'],
      ['gpt-4.1', 'local-gpt-4.1'],
      ['gpt-5', 'local-gpt-5'],
    ].map(([id, model]) => ({
      id,
      model,
      providerType: 'openai-compatible',
      providerId: 'local',
    }))
    const expectedCustomModels = customModels.map((model) => ({ ...model }))
    const settings = parseSmartComposerSettings({
      version: 2,
      providers: [
        {
          id: 'local',
          type: 'openai-compatible',
          baseUrl: 'http://127.0.0.1:1234/v1',
          apiKey: 'fake-local-key',
        },
        {
          id: 'mistral',
          type: 'openai-compatible',
          baseUrl: 'http://127.0.0.1:5678/v1',
          apiKey: 'fake-collision-key',
        },
      ],
      chatModels: customModels,
      chatModelId: 'gpt-5',
      applyModelId: 'o3-mini',
      systemPrompt: 'retain',
    })

    expect(settings.providers).toContainEqual(
      expect.objectContaining({
        id: 'local',
        type: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:1234/v1',
        apiKey: 'fake-local-key',
      }),
    )
    expect(settings.providers).toContainEqual(
      expect.objectContaining({
        id: 'mistral',
        type: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:5678/v1',
        apiKey: 'fake-collision-key',
      }),
    )
    for (const custom of expectedCustomModels)
      expect(settings.chatModels).toContainEqual(
        expect.objectContaining(custom),
      )
    expect(settings.chatModelId).toBe('gpt-5')
    expect(settings.applyModelId).toBe('o3-mini')
    expect(new Set(settings.chatModels.map((model) => model.id)).size).toBe(
      settings.chatModels.length,
    )
    expect(parseSmartComposerSettings(settings)).toEqual(settings)
  })
})
