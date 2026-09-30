import { migrateFrom20To21 } from './20_to_21'

const oauth = { accessToken: 'a', refreshToken: 'r', expiresAt: 1 }

it('drops Codex CLI tokens and the retired Spark plan model', () => {
  const previous = {
    version: 20,
    chatModelId: 'claude-opus-5',
    applyModelId: 'gpt-5.3-codex-spark (plan)',
    providers: [
      {
        type: 'openai-plan',
        id: 'openai-plan',
        oauth,
        credentialsSecretId: 'smart-composer-x',
      },
      { type: 'anthropic-plan', id: 'anthropic-plan', oauth },
    ],
    chatModels: [
      { id: 'gpt-6-astra (plan)' },
      { id: 'gpt-5.3-codex-spark (plan)' },
    ],
  }
  const next = migrateFrom20To21(previous)
  expect(next).toEqual({
    version: 21,
    chatModelId: 'claude-opus-5',
    applyModelId: 'gpt-6-astra (plan)',
    providers: [
      { type: 'openai-plan', id: 'openai-plan' },
      { type: 'anthropic-plan', id: 'anthropic-plan', oauth },
    ],
    chatModels: [{ id: 'gpt-6-astra (plan)' }],
  })
  expect(previous.providers[0].oauth).toBe(oauth)
  expect(migrateFrom20To21(next)).toEqual(next)
})

it('falls back to default models when the plan replacement was removed', () => {
  const next = migrateFrom20To21({
    version: 20,
    chatModelId: 'gpt-5.3-codex-spark (plan)',
    applyModelId: 'gpt-5.3-codex-spark (plan)',
    providers: [],
    chatModels: [{ id: 'gpt-5.3-codex-spark (plan)' }],
  })
  expect(next.chatModelId).toBe('claude-opus-5')
  expect(next.applyModelId).toBe('gpt-6-astra')
  expect(next.chatModels).toEqual([])
})

it('picks a remaining model when the defaults were removed too', () => {
  const next = migrateFrom20To21({
    version: 20,
    chatModelId: 'gpt-5.3-codex-spark (plan)',
    applyModelId: 'gpt-5.3-codex-spark (plan)',
    providers: [],
    chatModels: [
      { id: 'gpt-5.3-codex-spark (plan)' },
      { id: 'claude-opus-5' },
      { id: 'my-model' },
    ],
  })
  expect(next.chatModelId).toBe('claude-opus-5')
  expect(next.applyModelId).toBe('claude-opus-5')
})
