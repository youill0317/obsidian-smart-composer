import { migrateFrom26To27 } from './26_to_27'

describe('Migration from v26 to v27', () => {
  it('removes reasoning summary options and keeps other settings', () => {
    const result = migrateFrom26To27({
      version: 26,
      chatModelId: 'gemini-4-carbon',
      chatModels: [
        {
          providerType: 'openai-plan',
          id: 'plan',
          reasoning: { reasoning_effort: 'high', reasoning_summary: 'auto' },
        },
        {
          providerType: 'anthropic',
          id: 'claude',
          adaptive_thinking: { show_summaries: true },
        },
        {
          providerType: 'gemini',
          id: 'gemini-4-carbon',
          thinking: { thinking_level: 'high', include_thoughts: true },
        },
        { providerType: 'xai', id: 'grok' },
      ],
    })

    expect(result).toEqual({
      version: 27,
      chatModelId: 'gemini-4-carbon',
      chatModels: [
        {
          providerType: 'openai-plan',
          id: 'plan',
          reasoning: { reasoning_effort: 'high' },
        },
        { providerType: 'anthropic', id: 'claude' },
        {
          providerType: 'gemini',
          id: 'gemini-4-carbon',
          thinking: { thinking_level: 'high' },
        },
        { providerType: 'xai', id: 'grok' },
      ],
    })
  })

  it('leaves settings without a model list unchanged', () => {
    expect(migrateFrom26To27({ version: 26 })).toEqual({ version: 27 })
  })
})
