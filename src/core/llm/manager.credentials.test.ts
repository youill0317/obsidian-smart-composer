import { CredentialSettingsStore } from '../../settings/credentialSettingsStore'
import { SmartComposerSettings } from '../../settings/schema/setting.types'
import { LLMProvider } from '../../types/provider.types'

import { getProviderClient } from './manager'

jest.mock('obsidian', () => ({ Platform: { isDesktop: false } }), {
  virtual: true,
})
jest.mock('./openaiCodexProvider', () => ({
  OpenAICodexProvider: jest
    .fn()
    .mockImplementation((provider, onUpdate) => ({ provider, onUpdate })),
}))
jest.mock('./anthropicClaudeCodeProvider', () => ({
  AnthropicClaudeCodeProvider: jest
    .fn()
    .mockImplementation((provider, onUpdate) => ({ provider, onUpdate })),
}))
jest.mock('./geminiPlanProvider', () => ({
  GeminiPlanProvider: jest
    .fn()
    .mockImplementation((provider, onUpdate) => ({ provider, onUpdate })),
}))

type PlanType = 'openai-plan' | 'anthropic-plan' | 'gemini-plan'
type Client = {
  provider: Extract<LLMProvider, { type: PlanType }>
  onUpdate: (id: string, update: Partial<LLMProvider>) => Promise<void>
}
const oauth = { accessToken: 'access', refreshToken: 'refresh', expiresAt: 1 }

async function setup(type: PlanType) {
  const values = new Map<string, string>()
  let disk: SmartComposerSettings | undefined
  const store = new CredentialSettingsStore(
    {
      getSecret: (id) => values.get(id) ?? null,
      setSecret: (id, value) => {
        values.set(id, value)
      },
    },
    async (settings) => {
      disk = settings
    },
    () => {},
  )
  await store.load({ version: 18, providers: [{ id: 'plan', type, oauth }] })
  const client = getProviderClient({
    providerId: 'plan',
    settings: store.settings,
    setSettings: (update) => store.update(update),
  }) as unknown as Client
  return { client, store, values, disk: () => disk }
}

describe('OAuth credential updates', () => {
  it.each(['openai-plan', 'anthropic-plan', 'gemini-plan'] as const)(
    '%s updates Keychain through the shared settings path without mutating a snapshot',
    async (type) => {
      const { client, store, values, disk } = await setup(type)
      const before = JSON.stringify(store.settings)
      const rotated = {
        ...oauth,
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      }
      client.provider.oauth = rotated
      expect(JSON.stringify(store.settings)).toBe(before)
      await store.update((s) => ({ ...s, systemPrompt: 'keep' }))
      await client.onUpdate('plan', { oauth: rotated })
      expect(store.settings.systemPrompt).toBe('keep')
      expect([...values.values()].join()).toContain('new-refresh')
      expect(JSON.stringify(disk())).not.toContain('new-refresh')
      // A second refresh from this client uses its last successfully saved state.
      await client.onUpdate('plan', {
        oauth: { ...rotated, accessToken: 'second' },
      })
      expect([...values.values()].join()).toContain('second')
    },
  )

  it.each(['disconnect', 'reconnect', 'delete', 'reset'] as const)(
    'rejects a late token update after %s',
    async (action) => {
      const { client, store, disk } = await setup('openai-plan')
      await store.update((s) => ({
        ...s,
        providers:
          action === 'delete' || action === 'reset'
            ? []
            : [
                {
                  id: 'plan',
                  type: 'openai-plan',
                  ...(action === 'reconnect'
                    ? { oauth: { ...oauth, refreshToken: 'new-login' } }
                    : {}),
                },
              ],
      }))
      const saved = JSON.stringify(disk())
      await expect(
        client.onUpdate('plan', { oauth: { ...oauth, accessToken: 'stale' } }),
      ).rejects.toThrow('Credentials changed')
      expect(JSON.stringify(disk())).toBe(saved)
    },
  )
})
