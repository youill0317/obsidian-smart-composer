import {
  DEFAULT_CHAT_MODELS,
  DEFAULT_EMBEDDING_MODELS,
} from '../../../constants'
import { parseSmartComposerSettings } from '../settings'

import { CHAT_MODELS_ADDED_IN_V18 } from './17_to_18'
import { migrateFrom21To22 } from './21_to_22'

import { SETTINGS_SCHEMA_VERSION } from '.'

const oldEmbedding = {
  providerType: 'gemini',
  providerId: 'gemini',
  id: 'gemini/text-embedding-004',
  model: 'text-embedding-004',
  dimension: 768,
}
const oldModels = CHAT_MODELS_ADDED_IN_V18.filter(
  (model) => model.id !== 'gpt-5.3-codex-spark (plan)',
)

it.each([
  ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'],
  ['gpt-6-astra (plan)', 'gpt-6.1-sol (plan)', 'gpt-6-luna (plan)'],
  ['claude-opus-5', 'claude-opus-5-5', 'claude-opus-5-5'],
  ['claude-opus-5 (plan)', 'claude-opus-5-5 (plan)', 'claude-opus-5-5 (plan)'],
  ['grok-4.6', 'grok-4.7', 'grok-4.7'],
])('replaces %s and preserves authentication paths', (old, chat, apply) => {
  const initial = {
    version: 21,
    chatModels: oldModels,
    chatModelId: old,
    applyModelId: old,
    embeddingModels: [
      ...DEFAULT_EMBEDDING_MODELS.filter((m) => m.providerType !== 'gemini'),
      oldEmbedding,
    ],
    embeddingModelId: oldEmbedding.id,
  }
  const before = JSON.stringify(initial)
  const settings = parseSmartComposerSettings(initial)
  expect(settings.version).toBe(SETTINGS_SCHEMA_VERSION)
  expect(settings.chatModels).toHaveLength(DEFAULT_CHAT_MODELS.length)
  expect(settings.chatModels).toEqual(
    expect.arrayContaining(DEFAULT_CHAT_MODELS),
  )
  expect(settings.chatModelId).toBe(chat)
  expect(settings.applyModelId).toBe(apply)
  expect(settings.embeddingModels).toHaveLength(DEFAULT_EMBEDDING_MODELS.length)
  expect(settings.embeddingModels).toEqual(
    expect.arrayContaining(DEFAULT_EMBEDDING_MODELS),
  )
  expect(settings.embeddingModelId).toBe('gemini/gemini-embedding-2')
  expect(JSON.stringify(initial)).toBe(before)
  expect(parseSmartComposerSettings(settings)).toEqual(settings)
  expect(migrateFrom21To22(settings)).toEqual({ ...settings, version: 22 })
})

it.each([
  { id: 'custom-model' },
  { providerType: 'openai-compatible' },
  { providerId: 'custom-provider' },
  { model: 'custom-model' },
])('preserves custom chat and embedding identities: %p', (change) => {
  const customChat = { ...oldModels[0], ...change }
  const customEmbedding = { ...oldEmbedding, ...change }
  const providers = [
    { type: 'openai', id: 'custom-provider', apiKey: 'test-key' },
  ]
  const result = migrateFrom21To22({
    chatModels: [customChat],
    embeddingModels: [customEmbedding],
    chatModelId: customChat.id,
    applyModelId: customChat.id,
    embeddingModelId: customEmbedding.id,
    providers,
  })
  expect(result.chatModels).toContain(customChat)
  expect(result.embeddingModels).toContain(customEmbedding)
  expect(result.chatModelId).toBe(customChat.id)
  expect(result.applyModelId).toBe(customChat.id)
  expect(result.embeddingModelId).toBe(customEmbedding.id)
  expect(result.providers).toBe(providers)
})

it('resolves collisions without overwriting custom bindings or selections', () => {
  const customChat = {
    ...oldModels[0],
    id: 'gpt-6.1-sol',
    providerId: 'custom',
  }
  const customApply = { ...customChat, id: 'gpt-6-luna' }
  const customEmbedding = {
    ...oldEmbedding,
    id: 'gemini/gemini-embedding-2',
    providerId: 'custom',
  }
  const initial = {
    chatModels: [
      ...oldModels,
      customChat,
      { ...customChat, id: 'gpt-6.1-sol-2' },
      customApply,
    ],
    embeddingModels: [oldEmbedding, customEmbedding],
    chatModelId: 'gpt-6-astra',
    applyModelId: 'gpt-6-astra',
    embeddingModelId: oldEmbedding.id,
  }
  const result = migrateFrom21To22(initial)
  expect(result.chatModelId).toBe('gpt-6.1-sol-3')
  expect(result.applyModelId).toBe('gpt-6-luna-2')
  expect(result.embeddingModelId).toBe('gemini/gemini-embedding-2-2')
  expect(result.chatModels).toContain(customChat)
  expect(result.chatModels).toContain(customApply)
  expect(result.embeddingModels).toContain(customEmbedding)
  expect(migrateFrom21To22(result)).toEqual(result)
  expect(
    migrateFrom21To22({ ...initial, chatModelId: customChat.id }).chatModelId,
  ).toBe(customChat.id)
})

it('reuses existing replacements and refreshes the default embedding dimension', () => {
  const chat = { ...DEFAULT_CHAT_MODELS[1], enable: false }
  const embedding = {
    ...DEFAULT_EMBEDDING_MODELS.find((m) => m.providerType === 'gemini'),
    dimension: 768,
  }
  const result = migrateFrom21To22({
    chatModels: [chat],
    embeddingModels: [embedding],
  })
  expect(result.chatModels).toContain(chat)
  expect(result.embeddingModels).toEqual([{ ...embedding, dimension: 3072 }])
})

it.each([undefined, { invalid: true }])(
  'recovers missing catalogs: %p',
  (catalog) => {
    const settings = parseSmartComposerSettings({
      version: 21,
      chatModels: catalog,
      embeddingModels: catalog,
      chatModelId: 'gpt-6-astra',
      applyModelId: 'gpt-6-astra (plan)',
      embeddingModelId: oldEmbedding.id,
    })
    expect(settings.chatModels).toEqual(DEFAULT_CHAT_MODELS)
    expect(settings.embeddingModels).toEqual(DEFAULT_EMBEDDING_MODELS)
    expect(settings.chatModelId).toBe('gpt-6.1-sol')
    expect(settings.applyModelId).toBe('gpt-6-luna (plan)')
    expect(settings.embeddingModelId).toBe('gemini/gemini-embedding-2')
  },
)
