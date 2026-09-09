import { LLMProvider } from '../types/provider.types'

import { CredentialSettingsStore } from './credentialSettingsStore'
import { SETTINGS_SCHEMA_VERSION } from './schema/migrations'

const api = { id: 'openai', type: 'openai', apiKey: 'test-api-secret' } as const
const oauth = {
  accessToken: 'test-access-secret',
  refreshToken: 'test-refresh-secret',
  expiresAt: 1000,
}
const secretId = 'smart-composer-12345678-1234-1234-1234-123456789012'

function fixture(providers: LLMProvider[], available = true) {
  const secrets = new Map<string, string>()
  const storage = {
    getSecret: jest.fn((id: string) => secrets.get(id) ?? null),
    setSecret: jest.fn((id: string, value: string) => {
      secrets.set(id, value)
    }),
  }
  let disk: unknown = { version: 18, providers }
  const save = jest.fn(async (value: unknown) => {
    disk = JSON.parse(JSON.stringify(value))
  })
  const notice = jest.fn()
  const published = jest.fn()
  const createStore = () =>
    new CredentialSettingsStore(
      available ? storage : undefined,
      save,
      notice,
      published,
    )
  return {
    secrets,
    storage,
    save,
    notice,
    published,
    createStore,
    disk: () => disk,
  }
}

describe('Keychain credential settings', () => {
  it.each(['anthropic-plan', 'openai-plan', 'gemini-plan'] as const)(
    'migrates and reloads API and %s credentials without plaintext copies',
    async (type) => {
      const auth = {
        ...oauth,
        accountId: 'account',
        projectId: 'project',
        managedProjectId: 'managed',
        email: 'test@example.com',
      }
      const f = fixture([api, { id: type, type, oauth: auth }])
      const store = f.createStore()
      await store.load(f.disk())
      expect(store.settings.version).toBe(SETTINGS_SCHEMA_VERSION)
      expect(store.settings.providers[0].apiKey).toBe(api.apiKey)
      expect(store.getStatus(api.id).label).toBe('Keychain')
      const disk = JSON.stringify(f.disk())
      for (const secret of [api.apiKey, oauth.accessToken, oauth.refreshToken])
        expect(disk).not.toContain(secret)
      expect(disk).not.toContain('"oauth"')
      expect(f.secrets.size).toBe(2)
      const reloaded = f.createStore()
      await reloaded.load(f.disk())
      expect(reloaded.settings).toEqual(store.settings)
      expect(f.secrets.size).toBe(2)
      const restored = reloaded.settings.providers[1]
      if (restored.type === 'gemini-plan')
        expect(restored.oauth).toEqual({
          ...oauth,
          projectId: 'project',
          managedProjectId: 'managed',
          email: 'test@example.com',
        })
    },
  )

  it('keeps legacy storage when the API is unavailable and warns once per provider', async () => {
    const f = fixture([api], false),
      store = f.createStore()
    await store.load(f.disk())
    await store.update((s) => ({ ...s, systemPrompt: 'changed' }))
    expect(JSON.stringify(f.disk())).toContain(api.apiKey)
    expect(store.getStatus(api.id).label).toBe('Plaintext')
    expect(f.notice).toHaveBeenCalledTimes(1)
    expect(f.storage.setSecret).not.toHaveBeenCalled()
  })

  it.each(['write', 'read', 'mismatch'] as const)(
    'falls back after %s failure without losing credentials',
    async (failure) => {
      const f = fixture([api]),
        store = f.createStore()
      if (failure === 'write')
        f.storage.setSecret.mockImplementation(() => {
          throw new Error('sensitive upstream detail')
        })
      if (failure === 'read')
        f.storage.getSecret.mockImplementation(() => {
          throw new Error('sensitive upstream detail')
        })
      if (failure === 'mismatch') f.storage.getSecret.mockReturnValue('wrong')
      await store.load(f.disk())
      expect(JSON.stringify(f.disk())).toContain(api.apiKey)
      expect(store.settings.providers[0].apiKey).toBe(api.apiKey)
      expect(store.getStatus(api.id).label).toBe('Plaintext')
      expect(JSON.stringify(f.notice.mock.calls)).not.toContain(
        'sensitive upstream detail',
      )
    },
  )

  it('isolates a provider failure and retries migration when storage recovers', async () => {
    const f = fixture([api, { ...api, id: 'second' }]),
      store = f.createStore()
    f.storage.setSecret.mockImplementationOnce(() => {
      throw new Error()
    })
    await store.load(f.disk())
    expect(store.getStatus(api.id).label).toBe('Plaintext')
    expect(store.getStatus('second').label).toBe('Keychain')
    await store.update((s) => ({ ...s, systemPrompt: 'changed' }))
    expect(store.getStatus(api.id).label).toBe('Keychain')
    expect(JSON.stringify(f.disk())).not.toContain(api.apiKey)
  })

  it.each([
    null,
    '',
    '{broken',
    '{"oauth":{"accessToken":"incomplete"}}',
    '{}',
  ])(
    'preserves missing or malformed references through unrelated saves: %s',
    async (value) => {
      const f = fixture([
        { id: api.id, type: api.type, credentialsSecretId: secretId },
      ])
      if (value !== null) f.secrets.set(secretId, value)
      const store = f.createStore()
      await store.load(f.disk())
      await store.update((s) => ({ ...s, systemPrompt: 'changed' }))
      expect(store.settings.providers[0].credentialsSecretId).toBe(secretId)
      expect(store.getStatus(api.id).label).toBe('Needs attention')
      expect(f.storage.setSecret).not.toHaveBeenCalled()
      expect(JSON.stringify(f.disk())).toContain(secretId)
    },
  )

  it('preserves unresolved references without the API', async () => {
    const f = fixture(
      [{ id: api.id, type: api.type, credentialsSecretId: secretId }],
      false,
    )
    const store = f.createStore()
    await store.load(f.disk())
    expect(store.settings.providers[0].credentialsSecretId).toBe(secretId)
    expect(store.getStatus(api.id).label).toBe('Needs attention')
  })

  it('does not restore stale Keychain values over plaintext fallback credentials', async () => {
    const f = fixture([{ ...api, credentialsSecretId: secretId }])
    f.secrets.set(secretId, JSON.stringify({ apiKey: 'old-value' }))
    const store = f.createStore()
    await store.load(f.disk())
    expect(store.settings.providers[0].apiKey).toBe(api.apiKey)
    expect(f.secrets.get(secretId)).toContain(api.apiKey)
  })

  it('preserves the previous file and secrets if settings persistence fails, then retries', async () => {
    const f = fixture([api]),
      store = f.createStore()
    await store.load(f.disk())
    const before = f.disk()
    const id = store.settings.providers[0].credentialsSecretId
    if (!id) throw new Error('Missing test credential reference')
    f.save.mockRejectedValueOnce(new Error('disk full'))
    await expect(
      store.update((s) => ({ ...s, providers: [] })),
    ).rejects.toThrow()
    expect(f.disk()).toEqual(before)
    expect(f.secrets.get(id)).toContain(api.apiKey)
    expect(store.settings.providers).toHaveLength(1)
    await store.update((s) => ({ ...s, providers: [] }))
    expect(f.secrets.get(id)).toBe('')
    expect(store.settings.providers).toEqual([])
  })

  it('retains legacy credentials if initial migration cannot write the settings file', async () => {
    const f = fixture([api]),
      store = f.createStore()
    f.save.mockRejectedValueOnce(new Error('disk full'))
    await store.load(f.disk())
    expect(JSON.stringify(f.disk())).toContain(api.apiKey)
    expect(store.settings.providers[0].apiKey).toBe(api.apiKey)
    expect(f.notice).not.toHaveBeenCalledWith(
      expect.stringContaining('moved credentials'),
    )
  })

  it('serializes functional changes without losing a rotated token or general settings', async () => {
    const f = fixture([{ id: 'plan', type: 'openai-plan', oauth }]),
      store = f.createStore()
    await store.load(f.disk())
    await Promise.all([
      store.update((s) => ({ ...s, systemPrompt: 'keep this' })),
      store.update((s) => ({
        ...s,
        providers: s.providers.map((p) =>
          p.type === 'openai-plan'
            ? { ...p, oauth: { ...oauth, refreshToken: 'rotated-secret' } }
            : p,
        ),
      })),
    ])
    expect(store.settings.systemPrompt).toBe('keep this')
    expect(JSON.stringify(f.disk())).not.toContain('rotated-secret')
    const reloaded = f.createStore()
    await reloaded.load(f.disk())
    expect(JSON.stringify(reloaded.settings)).toContain('rotated-secret')
  })

  it('retains rotated credentials for retry after the settings file write fails', async () => {
    const f = fixture([{ id: 'plan', type: 'openai-plan', oauth }]),
      store = f.createStore()
    await store.load(f.disk())
    f.save.mockRejectedValueOnce(new Error('disk full'))
    await expect(
      store.update((s) => ({
        ...s,
        providers: s.providers.map((p) =>
          p.type === 'openai-plan'
            ? {
                ...p,
                oauth: { ...oauth, refreshToken: 'rotated-after-failure' },
              }
            : p,
        ),
      })),
    ).rejects.toThrow()
    await store.update((s) => ({ ...s, systemPrompt: 'retry' }))
    const reloaded = f.createStore()
    await reloaded.load(f.disk())
    expect(JSON.stringify(reloaded.settings)).toContain('rotated-after-failure')
    expect(JSON.stringify(f.disk())).not.toContain('rotated-after-failure')
  })

  it('clears explicitly disconnected credentials without touching other secrets', async () => {
    const f = fixture([{ id: 'plan', type: 'openai-plan', oauth }]),
      store = f.createStore()
    f.secrets.set('another-plugin', 'untouched')
    await store.load(f.disk())
    const id = store.settings.providers[0].credentialsSecretId
    if (!id) throw new Error('Missing test credential reference')
    await store.update((s) => ({
      ...s,
      providers: [{ id: 'plan', type: 'openai-plan' }],
    }))
    expect(f.secrets.get(id)).toBe('')
    expect(f.secrets.get('another-plugin')).toBe('untouched')
    const reloaded = f.createStore()
    await reloaded.load(f.disk())
    expect(reloaded.getStatus('plan').label).toBe('Not configured')
    expect(JSON.stringify(reloaded.settings)).not.toContain(oauth.refreshToken)
  })

  it('reports failed cleanup without restoring the disconnected reference', async () => {
    const f = fixture([api]),
      store = f.createStore()
    await store.load(f.disk())
    f.storage.setSecret.mockImplementationOnce(() => {
      throw new Error()
    })
    await store.update((s) => ({ ...s, providers: [] }))
    expect(store.settings.providers).toEqual([])
    expect(f.notice).toHaveBeenCalledWith(
      expect.stringContaining('could not clear'),
    )
  })

  it('does not read or clear another plugin reference', async () => {
    const f = fixture([
      { id: api.id, type: api.type, credentialsSecretId: 'other-plugin' },
    ])
    const store = f.createStore()
    await store.load(f.disk())
    await store.update((s) => ({ ...s, providers: [] }))
    expect(f.storage.getSecret).not.toHaveBeenCalled()
    expect(f.storage.setSecret).not.toHaveBeenCalled()
  })

  it('preserves model choices and unrelated settings during schema migration', async () => {
    const f = fixture([api]),
      store = f.createStore()
    await store.load({
      ...(f.disk() as object),
      systemPrompt: 'retain',
      chatModelId: 'custom-chat',
      applyModelId: 'custom-apply',
      embeddingModelId: 'custom-embedding',
    })
    expect(store.settings).toMatchObject({
      systemPrompt: 'retain',
      chatModelId: 'custom-chat',
      applyModelId: 'custom-apply',
      embeddingModelId: 'custom-embedding',
    })
  })
})
