import { parseSmartComposerSettings } from '../settings'

import { CHAT_MODELS_ADDED_IN_V22 } from './21_to_22'
import { migrateFrom24To25 } from './24_to_25'
import { CHAT_MODELS_ADDED_IN_V26 } from './25_to_26'

import { SETTINGS_SCHEMA_VERSION } from '.'

const oauth = { accessToken: 'a', refreshToken: 'r', expiresAt: 1 }
const claudePlan = {
  providerType: 'anthropic-plan',
  providerId: 'anthropic-plan',
  id: 'claude-opus-5-5 (plan)',
  model: 'claude-opus-5-5',
}
const geminiPlan = {
  providerType: 'gemini-plan',
  providerId: 'gemini-plan',
  id: 'gemini-3.8-flash (plan)',
  model: 'gemini-3.8-flash',
}
const openAIPlan = {
  providerType: 'openai-plan',
  providerId: 'openai-plan',
  id: 'gpt-6-luna (plan)',
  model: 'gpt-6-luna',
}
const claude = {
  providerType: 'anthropic',
  providerId: 'anthropic',
  id: 'claude-opus-5-5',
  model: 'claude-opus-5-5',
}
const luna = {
  providerType: 'openai',
  providerId: 'openai',
  id: 'gpt-6-luna',
  model: 'gpt-6-luna',
}
const custom = {
  providerType: 'openai-compatible',
  providerId: 'my-provider',
  id: 'my-model',
  model: 'my-model',
}
const voyage = {
  providerType: 'voyage',
  providerId: 'voyage',
  id: 'voyage/voyage-4',
  model: 'voyage-4',
  dimension: 1024,
}
const providers = [
  { type: 'anthropic-plan', id: 'anthropic-plan', oauth },
  { type: 'openai-plan', id: 'openai-plan', credentialsSecretId: 'smart-x' },
  {
    type: 'gemini-plan',
    id: 'gemini-plan',
    credentialsSecretId: 'smart-composer-gemini-plan',
  },
  { type: 'anthropic-plan', id: 'my-claude-plan' },
  { type: 'anthropic', id: 'anthropic', apiKey: 'key' },
  {
    type: 'openai-compatible',
    id: 'my-provider',
    baseUrl: 'http://localhost',
  },
]

describe('migrateFrom24To25', () => {
  it('removes the Claude and Gemini plan providers and models', () => {
    const previous = {
      version: 24,
      providers,
      chatModels: [openAIPlan, claudePlan, claude, geminiPlan, luna, custom],
      embeddingModels: [
        voyage,
        { ...geminiPlan, id: 'gemini-plan/embedding', dimension: 768 },
      ],
      chatModelId: 'my-model',
      applyModelId: 'gpt-6-luna (plan)',
      embeddingModelId: 'voyage/voyage-4',
    }
    const before = JSON.stringify(previous)
    const next = migrateFrom24To25(previous)
    expect(next).toEqual({
      version: 25,
      providers: [providers[1], providers[4], providers[5]],
      chatModels: [openAIPlan, claude, luna, custom],
      embeddingModels: [voyage],
      chatModelId: 'my-model',
      applyModelId: 'gpt-6-luna (plan)',
      embeddingModelId: 'voyage/voyage-4',
    })
    expect(JSON.stringify(previous)).toBe(before)
    expect(migrateFrom24To25(next)).toEqual(next)
  })

  it('falls back to the defaults when a removed model was selected', () => {
    const next = migrateFrom24To25({
      version: 24,
      chatModels: [claudePlan, geminiPlan, luna, claude],
      chatModelId: claudePlan.id,
      applyModelId: geminiPlan.id,
    })
    expect(next.chatModelId).toBe('claude-opus-5-5')
    expect(next.applyModelId).toBe('gpt-6-luna')
  })

  it('picks a remaining model when the defaults were removed too', () => {
    const next = migrateFrom24To25({
      version: 24,
      chatModels: [claudePlan, custom, geminiPlan],
      chatModelId: claudePlan.id,
      applyModelId: geminiPlan.id,
    })
    expect(next.chatModelId).toBe('my-model')
    expect(next.applyModelId).toBe('my-model')
  })

  it('does not fall back to a plan model', () => {
    const next = migrateFrom24To25({
      version: 24,
      chatModels: CHAT_MODELS_ADDED_IN_V22.filter(
        (model) => model.id !== 'gpt-6-luna',
      ),
      chatModelId: 'claude-opus-5-5',
      applyModelId: 'claude-opus-5-5 (plan)',
    })
    expect(next.applyModelId).toBe('gpt-6.1-sol')
  })

  it('only bumps the version when nothing was removed', () => {
    const previous = {
      version: 24,
      providers: [providers[1], providers[4], providers[5]],
      chatModels: [openAIPlan, claude, custom],
      embeddingModels: [voyage],
      chatModelId: openAIPlan.id,
      applyModelId: custom.id,
      embeddingModelId: voyage.id,
      systemPrompt: 'Be brief.',
    }
    expect(migrateFrom24To25(previous)).toEqual({ ...previous, version: 25 })
  })

  it('keeps the rest of v24 settings when parsing', () => {
    const settings = parseSmartComposerSettings({
      version: 24,
      providers,
      chatModels: [openAIPlan, claudePlan, geminiPlan, claude, custom],
      embeddingModels: [voyage],
      chatModelId: geminiPlan.id,
      applyModelId: custom.id,
      embeddingModelId: voyage.id,
      systemPrompt: 'Be brief.',
      ragOptions: {
        chunkSize: 500,
        thresholdTokens: 4096,
        minSimilarity: 0.5,
        limit: 5,
        excludePatterns: ['private/**'],
        includePatterns: [],
      },
      chatOptions: {
        includeCurrentFileContent: false,
        enableTools: false,
        maxAutoIterations: 3,
      },
      ocr: { providerId: 'my-mistral', enabled: false },
    })
    expect(settings).toMatchObject({
      version: SETTINGS_SCHEMA_VERSION,
      providers: [providers[1], providers[4], providers[5]],
      chatModels: [...CHAT_MODELS_ADDED_IN_V26, openAIPlan, claude, custom],
      embeddingModels: [voyage],
      chatModelId: 'claude-opus-5-5',
      applyModelId: 'my-model',
      embeddingModelId: voyage.id,
      systemPrompt: 'Be brief.',
      ragOptions: { chunkSize: 500, excludePatterns: ['private/**'] },
      chatOptions: { includeCurrentFileContent: false, maxAutoIterations: 3 },
      ocr: { providerId: 'my-mistral', enabled: false },
    })
    expect(parseSmartComposerSettings(settings)).toEqual(settings)
  })
})
