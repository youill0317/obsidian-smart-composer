import { DEFAULT_CHAT_MODELS } from '../../../constants'
import { parseSmartComposerSettings } from '../settings'

import { migrateFrom16To17 } from './16_to_17'
import {
  CHAT_MODELS_ADDED_IN_V18,
  CHAT_MODELS_RETIRED_IN_V18,
  migrateFrom17To18,
} from './17_to_18'

describe('Migration from v17 to v18', () => {
  const apiModel = {
    providerType: 'openai',
    providerId: 'openai',
    id: 'gpt-4.1-mini',
    model: 'gpt-4.1-mini',
  }

  it('replaces all 18 retired built-ins with the 9 current defaults', () => {
    const result = migrateFrom17To18({
      version: 17,
      chatModels: CHAT_MODELS_RETIRED_IN_V18,
      chatModelId: 'claude-sonnet-4.5',
      applyModelId: apiModel.id,
    })
    expect(CHAT_MODELS_RETIRED_IN_V18).toHaveLength(18)
    expect(CHAT_MODELS_ADDED_IN_V18).toHaveLength(9)
    expect(result.chatModels).toEqual(CHAT_MODELS_ADDED_IN_V18)
    expect(result.chatModels).toEqual(DEFAULT_CHAT_MODELS)
    expect(result.chatModelId).toBe('claude-opus-5')
    expect(result.applyModelId).toBe('gpt-6-astra')
  })

  it.each([
    ['openai', 'gpt-6-astra', 'gpt-6-astra'],
    ['openai-plan', 'gpt-6-astra (plan)', 'gpt-5.3-codex-spark (plan)'],
    ['anthropic', 'claude-opus-5', 'claude-opus-5'],
    ['anthropic-plan', 'claude-opus-5 (plan)', 'claude-opus-5 (plan)'],
    ['gemini', 'gemini-3.8-flash', 'gemini-3.8-flash'],
    ['gemini-plan', 'gemini-3.8-flash (plan)', 'gemini-3.8-flash (plan)'],
    ['deepseek', 'deepseek-v4-pro', 'deepseek-v4-pro'],
    ['xai', 'grok-4.6', 'grok-4.6'],
  ])(
    'keeps %s selections on the same provider and authentication',
    (type, chat, apply) => {
      for (const old of CHAT_MODELS_RETIRED_IN_V18.filter(
        (model) => model.providerType === type,
      )) {
        const result = migrateFrom17To18({
          chatModels: [old],
          chatModelId: old.id,
          applyModelId: old.id,
        })
        expect(result.chatModelId).toBe(chat)
        expect(result.applyModelId).toBe(apply)
      }
    },
  )

  it.each([
    { id: 'my-mini' },
    { providerType: 'openai-compatible' },
    { providerId: 'my-gateway' },
    { model: 'my-model' },
  ])('preserves customized legacy identities: %p', (change) => {
    const custom = { ...apiModel, ...change }
    const result = migrateFrom17To18({
      chatModels: [custom],
      chatModelId: custom.id,
      applyModelId: custom.id,
    })
    expect(result.chatModels).toContain(custom)
    expect(result.chatModelId).toBe(custom.id)
    expect(result.applyModelId).toBe(custom.id)
  })

  it('preserves current model settings, providers and credentials', () => {
    const current = {
      ...CHAT_MODELS_ADDED_IN_V18.find((model) => model.id === 'gpt-6-astra'),
      enable: false,
      promptLevel: 'none',
      reasoning: { enabled: true, reasoning_effort: 'low' },
    }
    const providers = [{ id: 'openai', type: 'openai', apiKey: 'test-key' }]
    const result = migrateFrom17To18({
      chatModels: [current],
      providers,
      chatModelId: current.id,
      applyModelId: current.id,
    })
    expect(result.chatModels).toContain(current)
    expect(result.providers).toBe(providers)
    expect(result.chatModelId).toBe(current.id)
    expect(result.applyModelId).toBe(current.id)
  })

  it('resolves occupied replacement ids without switching API users to plans', () => {
    const custom = {
      id: 'gpt-6-astra',
      model: 'gpt-6-astra',
      providerType: 'openai-plan',
      providerId: 'openai-plan',
    }
    const occupied = { ...custom, id: 'gpt-6-astra-2' }
    const result = migrateFrom17To18({
      chatModels: [apiModel, custom, occupied],
      chatModelId: apiModel.id,
      applyModelId: apiModel.id,
    })
    expect(result.chatModels).toContain(custom)
    expect(result.chatModels).toContain(occupied)
    expect(result.chatModelId).toBe('gpt-6-astra-3')
    expect(result.applyModelId).toBe('gpt-6-astra-3')
    expect(result.chatModels).toContainEqual({
      id: 'gpt-6-astra-3',
      model: 'gpt-6-astra',
      reasoning: { enabled: true, reasoning_effort: 'medium' },
      providerType: 'openai',
      providerId: 'openai',
    })
    expect(migrateFrom17To18(result)).toEqual(result)
  })

  it('loads and re-loads the v16 to v18 chain with valid selections', () => {
    const initial = {
      version: 16,
      chatModels: CHAT_MODELS_RETIRED_IN_V18,
      chatModelId: 'gpt-5.2 (plan)',
      applyModelId: apiModel.id,
    }
    const first = migrateFrom17To18(migrateFrom16To17(initial))
    expect(migrateFrom17To18(first)).toEqual(first)
    const settings = parseSmartComposerSettings(initial)
    expect(settings.version).toBe(18)
    expect(settings.chatModels).toEqual(DEFAULT_CHAT_MODELS)
    expect(settings.chatModelId).toBe('gpt-6-astra (plan)')
    expect(settings.applyModelId).toBe('gpt-6-astra')
    expect(parseSmartComposerSettings(settings)).toEqual(settings)
  })

  it.each([undefined, { invalid: true }])(
    'recovers a missing or malformed catalog without dangling legacy selections',
    (chatModels) => {
      const settings = parseSmartComposerSettings({
        version: 17,
        chatModels,
        chatModelId: 'gpt-5.2 (plan)',
        applyModelId: apiModel.id,
      })
      expect(settings.chatModels).toEqual(DEFAULT_CHAT_MODELS)
      expect(settings.chatModelId).toBe('gpt-6-astra (plan)')
      expect(settings.applyModelId).toBe('gpt-6-astra')
    },
  )
})
