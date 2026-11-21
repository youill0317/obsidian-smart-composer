import {
  DEFAULT_APPLY_MODEL_ID,
  DEFAULT_CHAT_MODELS,
  DEFAULT_CHAT_MODEL_ID,
} from '../../../constants'
import { parseSmartComposerSettings } from '../settings'

import { CHAT_MODELS_ADDED_IN_V26, migrateFrom25To26 } from './25_to_26'

import { SETTINGS_SCHEMA_VERSION } from '.'

const [solPlan62, sol62, carbon] = CHAT_MODELS_ADDED_IN_V26
const solPlan = {
  providerType: 'openai-plan',
  providerId: 'openai-plan',
  id: 'gpt-6.1-sol (plan)',
  model: 'gpt-6.1-sol',
}
const sol = {
  providerType: 'openai',
  providerId: 'openai',
  id: 'gpt-6.1-sol',
  model: 'gpt-6.1-sol',
  reasoning: { reasoning_effort: 'medium' },
}
const lunaPlan = {
  providerType: 'openai-plan',
  providerId: 'openai-plan',
  id: 'gpt-6-luna (plan)',
  model: 'gpt-6-luna',
}
const luna = {
  providerType: 'openai',
  providerId: 'openai',
  id: 'gpt-6-luna',
  model: 'gpt-6-luna',
}
const claude = {
  providerType: 'anthropic',
  providerId: 'anthropic',
  id: 'claude-opus-5-5',
  model: 'claude-opus-5-5',
}
const flash = {
  providerType: 'gemini',
  providerId: 'gemini',
  id: 'gemini-3.8-flash',
  model: 'gemini-3.8-flash',
}
const deepseek = {
  providerType: 'deepseek',
  providerId: 'deepseek',
  id: 'deepseek-v4-pro',
  model: 'deepseek-v4-pro',
}
const grok = {
  providerType: 'xai',
  providerId: 'xai',
  id: 'grok-4.7',
  model: 'grok-4.7',
}
const custom = {
  providerType: 'openai-compatible',
  providerId: 'my-provider',
  id: 'my-model',
  model: 'my-model',
}
const v25Catalog = [solPlan, sol, lunaPlan, luna, claude, flash, deepseek, grok]

describe('migrateFrom25To26', () => {
  it('lets the schema supply the catalog for a fresh-shape input', () => {
    expect(migrateFrom25To26({ version: 25 })).toEqual({
      version: 26,
      chatModels: undefined,
    })
  })

  it('adds the new defaults and keeps every existing model', () => {
    const result = migrateFrom25To26({
      version: 25,
      chatModels: [...v25Catalog, custom],
      chatModelId: 'claude-opus-5-5',
      applyModelId: 'gpt-6-luna',
    })
    expect(result.chatModels).toEqual([
      solPlan62,
      sol62,
      carbon,
      ...v25Catalog,
      custom,
    ])
    expect(result.chatModelId).toBe('claude-opus-5-5')
    expect(result.applyModelId).toBe('gpt-6-luna')
  })

  it.each([
    ['gpt-6.1-sol', 'gpt-6.2-sol'],
    ['gpt-6.1-sol (plan)', 'gpt-6.2-sol (plan)'],
    ['gemini-3.8-flash', 'gemini-4-carbon'],
  ])('moves a %s selection to %s', (from, to) => {
    const result = migrateFrom25To26({
      version: 25,
      chatModels: v25Catalog,
      chatModelId: from,
      applyModelId: from,
    })
    expect(result.chatModelId).toBe(to)
    expect(result.applyModelId).toBe(to)
  })

  it.each(['gpt-6-luna', 'gpt-6-luna (plan)'])('keeps a %s selection', (id) => {
    const result = migrateFrom25To26({
      version: 25,
      chatModels: v25Catalog,
      chatModelId: id,
      applyModelId: id,
    })
    expect(result.chatModelId).toBe(id)
    expect(result.applyModelId).toBe(id)
  })

  it('moves selections of the old defaults when no catalog was saved', () => {
    const result = migrateFrom25To26({
      version: 25,
      chatModelId: 'gemini-3.8-flash',
      applyModelId: 'gpt-6.1-sol',
    })
    expect(result.chatModelId).toBe('gemini-4-carbon')
    expect(result.applyModelId).toBe('gpt-6.2-sol')
  })

  it('leaves a custom entry that reuses an old default id selected', () => {
    const customSol = { ...custom, id: 'gpt-6.1-sol' }
    const result = migrateFrom25To26({
      version: 25,
      chatModels: [customSol, claude],
      chatModelId: 'gpt-6.1-sol',
      applyModelId: 'gpt-6.1-sol',
    })
    expect(result.chatModelId).toBe('gpt-6.1-sol')
    expect(result.applyModelId).toBe('gpt-6.1-sol')
  })

  it('gives the built-in its own id when a custom entry uses the new id', () => {
    const customCarbon = { ...custom, id: 'gemini-4-carbon' }
    const result = migrateFrom25To26({
      version: 25,
      chatModels: [flash, customCarbon],
      chatModelId: 'gemini-3.8-flash',
      applyModelId: 'gemini-4-carbon',
    })
    expect(result.chatModels).toEqual([
      solPlan62,
      sol62,
      { ...carbon, id: 'gemini-4-carbon-2' },
      flash,
      customCarbon,
    ])
    expect(result.chatModelId).toBe('gemini-4-carbon-2')
    expect(result.applyModelId).toBe('gemini-4-carbon')
  })

  it('moves to the new default as shipped, without old reasoning values', () => {
    const result = migrateFrom25To26({
      version: 25,
      chatModels: [
        {
          ...flash,
          thinking: { enabled: true, thinking_level: 'minimal' },
        },
      ],
      chatModelId: 'gemini-3.8-flash',
      applyModelId: 'gemini-3.8-flash',
    })
    const chatModels = result.chatModels as { id: string }[]
    expect(chatModels.find((m) => m.id === result.chatModelId)).toEqual(carbon)
  })

  describe('converts reasoning settings to the v26 controls', () => {
    const migrateModel = (model: Record<string, unknown>) =>
      (
        migrateFrom25To26({ version: 25, chatModels: [model] })
          .chatModels as unknown[]
      )[3]

    it.each([
      [{ enabled: true, budget_tokens: 8192 }],
      [{ enabled: false, budget_tokens: 1024 }],
      [undefined],
    ])('drops Anthropic thinking %j', (thinking) => {
      expect(
        migrateModel({ ...claude, model: 'claude-opus-4-5', thinking }),
      ).toEqual({ ...claude, model: 'claude-opus-4-5' })
    })

    it.each([
      [{ enabled: false, reasoning_effort: 'high' }, undefined],
      [{ enabled: true }, undefined],
      [
        { enabled: true, reasoning_effort: 'none' },
        { reasoning_effort: 'low' },
      ],
      [
        { enabled: true, reasoning_effort: 'minimal' },
        { reasoning_effort: 'low' },
      ],
      [{ enabled: true, reasoning_effort: 'max' }, { reasoning_effort: 'max' }],
      [{ enabled: true, reasoning_effort: 'turbo' }, undefined],
      [{ reasoning_effort: 'xhigh' }, { reasoning_effort: 'xhigh' }],
    ])('OpenAI reasoning %j becomes %j', (reasoning, expected) => {
      expect(migrateModel({ ...luna, model: 'gpt-5', reasoning })).toEqual({
        ...luna,
        model: 'gpt-5',
        ...(expected && { reasoning: expected }),
      })
    })

    it.each([
      [{ reasoning_effort: 'none' }, { reasoning_effort: 'low' }],
      [
        { reasoning_effort: 'minimal', reasoning_summary: 'auto' },
        { reasoning_effort: 'low', reasoning_summary: 'auto' },
      ],
      [{ reasoning_effort: 'high' }, { reasoning_effort: 'high' }],
      [
        { reasoning_effort: 'turbo', reasoning_summary: 'detailed' },
        { reasoning_summary: 'detailed' },
      ],
      [{ reasoning_effort: 'turbo' }, undefined],
    ])('OpenAI plan reasoning %j becomes %j', (reasoning, expected) => {
      expect(migrateModel({ ...lunaPlan, model: 'gpt-5', reasoning })).toEqual({
        ...lunaPlan,
        model: 'gpt-5',
        ...(expected && { reasoning: expected }),
      })
    })

    it.each([
      [
        { enabled: false, thinking_level: 'high', include_thoughts: true },
        undefined,
      ],
      [
        { enabled: true, control_mode: 'budget', thinking_budget: 1024 },
        undefined,
      ],
      [
        {
          enabled: true,
          control_mode: 'budget',
          thinking_level: 'high',
          thinking_budget: 0,
          include_thoughts: true,
        },
        { include_thoughts: true },
      ],
      [{ enabled: true, thinking_level: 'minimal' }, { thinking_level: 'low' }],
      [
        { enabled: true, control_mode: 'level', thinking_level: 'xhigh' },
        { thinking_level: 'high' },
      ],
      [
        { enabled: true, thinking_level: 'medium', include_thoughts: false },
        { thinking_level: 'medium' },
      ],
      [{ enabled: true, thinking_level: 'turbo' }, undefined],
      [
        { thinking_level: 'high', include_thoughts: true },
        { thinking_level: 'high', include_thoughts: true },
      ],
    ])('Gemini thinking %j becomes %j', (thinking, expected) => {
      expect(
        migrateModel({ ...flash, model: 'gemini-2.5-pro', thinking }),
      ).toEqual({
        ...flash,
        model: 'gemini-2.5-pro',
        ...(expected && { thinking: expected }),
      })
    })

    it('leaves other providers and non-object entries untouched', () => {
      const tunedGrok = { ...grok, reasoning: { enabled: true } }
      const result = migrateFrom25To26({
        version: 25,
        chatModels: [tunedGrok, null, 'broken'],
      })
      expect((result.chatModels as unknown[]).slice(3)).toEqual([
        tunedGrok,
        null,
        'broken',
      ])
    })
  })

  it('changes only the version when there is nothing to do', () => {
    const input = {
      version: 25,
      chatModels: [solPlan62, sol62, carbon, claude, custom],
      chatModelId: 'my-model',
      applyModelId: 'gpt-6.2-sol',
    }
    expect(migrateFrom25To26(input)).toEqual({ ...input, version: 26 })
  })

  it('does not mutate the input and is idempotent', () => {
    const input = {
      version: 25,
      chatModels: [
        sol,
        { ...flash, thinking: { enabled: true, thinking_level: 'minimal' } },
        { ...sol, id: 'my-sol', reasoning: { enabled: false } },
        { ...claude, thinking: { enabled: true, budget_tokens: 2048 } },
        {
          ...flash,
          model: 'gemini-2.5-flash',
          thinking: {
            enabled: true,
            control_mode: 'budget',
            thinking_budget: 0,
          },
        },
        {
          ...lunaPlan,
          reasoning: { reasoning_effort: 'minimal', reasoning_summary: 'auto' },
        },
      ],
      chatModelId: 'gpt-6.1-sol',
      applyModelId: 'gemini-3.8-flash',
    }
    const snapshot = structuredClone(input)
    const once = migrateFrom25To26(input)
    expect(input).toEqual(snapshot)
    expect(migrateFrom25To26({ ...once, version: 25 })).toEqual(once)
  })

  it('parses a realistic v25 settings object end to end', () => {
    const settings = parseSmartComposerSettings({
      version: 25,
      providers: [
        { type: 'openai-plan', id: 'openai-plan' },
        { type: 'openai', id: 'openai', apiKey: 'key' },
        { type: 'anthropic', id: 'anthropic', apiKey: 'key' },
        { type: 'gemini', id: 'gemini', apiKey: 'key' },
      ],
      chatModels: [
        solPlan,
        { ...sol, reasoning: { enabled: true, reasoning_effort: 'none' } },
        lunaPlan,
        luna,
        { ...claude, thinking: { enabled: true, budget_tokens: 8192 } },
        {
          ...flash,
          thinking: {
            enabled: true,
            control_mode: 'level',
            thinking_level: 'minimal',
            thinking_budget: 1024,
            include_thoughts: true,
          },
        },
        deepseek,
        grok,
      ],
      chatModelId: 'gpt-6.1-sol (plan)',
      applyModelId: 'gpt-6-luna',
      systemPrompt: 'keep me',
    })
    expect(settings.version).toBe(SETTINGS_SCHEMA_VERSION)
    expect(settings.systemPrompt).toBe('keep me')
    expect(settings.chatModelId).toBe('gpt-6.2-sol (plan)')
    expect(settings.applyModelId).toBe('gpt-6-luna')
    expect(settings.chatModels.map((m) => m.id)).toEqual([
      'gpt-6.2-sol (plan)',
      'gpt-6.2-sol',
      'gemini-4-carbon',
      'gpt-6.1-sol (plan)',
      'gpt-6.1-sol',
      'gpt-6-luna (plan)',
      'gpt-6-luna',
      'claude-opus-5-5',
      'gemini-3.8-flash',
      'deepseek-v4-pro',
      'grok-4.7',
    ])
    expect(settings.chatModels[4]).toEqual({
      ...sol,
      reasoning: { reasoning_effort: 'low' },
    })
    expect(settings.chatModels[7]).toEqual(claude)
    expect(settings.chatModels[8]).toEqual({
      ...flash,
      thinking: { thinking_level: 'low' },
    })
  })

  it('carries the CLI round limit over when a CLI connection is enabled', () => {
    const cli = (enabled: boolean) => ({
      connections: [{ id: 'obsidian', enabled }],
      maxAutoIterations: 10,
    })
    const chatOptions = { enableTools: true, maxAutoIterations: 3 }
    const on = migrateFrom25To26({ version: 25, chatOptions, cli: cli(true) })
    expect(on.chatOptions).toEqual({ enableTools: true, maxAutoIterations: 10 })
    expect(on.cli).toEqual({ connections: [{ id: 'obsidian', enabled: true }] })
    const off = migrateFrom25To26({ version: 25, chatOptions, cli: cli(false) })
    expect(off.chatOptions).toEqual(chatOptions)
    expect(off.cli).toEqual({
      connections: [{ id: 'obsidian', enabled: false }],
    })
  })

  it('gives fresh installs only the flagship catalog', () => {
    const settings = parseSmartComposerSettings({})
    expect(settings.chatModels).toEqual(DEFAULT_CHAT_MODELS)
    expect(settings.chatModelId).toBe(DEFAULT_CHAT_MODEL_ID)
    expect(settings.applyModelId).toBe(DEFAULT_APPLY_MODEL_ID)
  })
})
