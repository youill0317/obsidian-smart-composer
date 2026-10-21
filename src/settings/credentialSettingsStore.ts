import type { SecretStorage } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

import { DEFAULT_PROVIDERS, PLAN_PROVIDER_TYPES } from '../constants'
import { LLMProvider, llmProviderSchema } from '../types/provider.types'

import {
  SettingsUpdate,
  SmartComposerSettings,
  smartComposerSettingsSchema,
} from './schema/setting.types'
import { parseSmartComposerSettings } from './schema/settings'

type Storage = Pick<SecretStorage, 'getSecret' | 'setSecret'>
export type CredentialStatus = {
  label: 'Keychain' | 'Plaintext' | 'Needs attention' | 'Not configured'
  detail: string
}

const payloadSchema = z.object({
  apiKey: z.string().optional(),
  oauth: z.unknown().optional(),
})

function credentials(provider: LLMProvider) {
  return {
    apiKey: provider.apiKey === '' ? undefined : provider.apiKey,
    oauth: 'oauth' in provider ? provider.oauth : undefined,
  }
}

function hasCredentials(provider: LLMProvider) {
  const value = credentials(provider)
  return !!value.apiKey || !!value.oauth
}

function ownsSecret(id: string) {
  return /^smart-composer-[a-z0-9-]+$/.test(id)
}

// Per-vault entries hold a JSON payload. Shared entries hold the raw API key.
function isVaultSecret(id: string) {
  return /^smart-composer-[0-9a-f-]{36}$/.test(id)
}

/**
 * Built-in API key providers share their key with other vaults on the device.
 * Custom providers may point anywhere, and subscription tokens rotate, so both
 * stay per vault.
 */
export function sharedSecretId(provider: LLMProvider) {
  if (PLAN_PROVIDER_TYPES.includes(provider.type)) return undefined
  const builtIn = DEFAULT_PROVIDERS.some(
    (p) => p.id === provider.id && p.type === provider.type,
  )
  return builtIn ? 'smart-composer-' + provider.id : undefined
}

// Only the openai-plan references removed by the v20 -> v21 migration.
function legacyReferences(data: unknown): string[] {
  const { providers, version } =
    (data as { providers?: unknown; version?: unknown } | null) ?? {}
  if (!Array.isArray(providers) || typeof version !== 'number' || version >= 21)
    return []
  return providers
    .filter(
      (provider) =>
        (provider as { type?: unknown } | null)?.type === 'openai-plan',
    )
    .map(
      (provider) =>
        (provider as { credentialsSecretId?: unknown } | null)
          ?.credentialsSecretId,
    )
    .filter((id): id is string => typeof id === 'string' && ownsSecret(id))
}

/**
 * Runtime settings contain resolved credentials; only persist() may serialize
 * them. The public SecretStorage API cannot acknowledge durable disk writes.
 */
export class CredentialSettingsStore {
  settings: SmartComposerSettings = smartComposerSettingsSchema.parse({})
  private statuses = new Map<string, CredentialStatus>()
  private knownRefs = new Set<string>()
  // Values this store last read or wrote, so unrelated saves do not overwrite
  // a shared entry another vault has changed since.
  private synced = new Map<string, string>()
  private warned = new Set<string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private storage: Storage | undefined,
    private saveData: (settings: SmartComposerSettings) => Promise<void>,
    private notify: (message: string) => void,
    private onSaved: (settings: SmartComposerSettings) => void = () => {},
  ) {}

  get hasKeychain() {
    return !!this.storage
  }

  getSharedApiKey(providerId: string): string | undefined {
    const provider = this.settings.providers.find((p) => p.id === providerId)
    const id = provider && sharedSecretId(provider)
    try {
      return (id && this.storage?.getSecret(id)) || undefined
    } catch {
      return undefined
    }
  }

  getStatus(providerId: string): CredentialStatus {
    return (
      this.statuses.get(providerId) ?? {
        label: 'Not configured',
        detail: 'No credentials configured.',
      }
    )
  }

  async load(data: unknown) {
    const parsed = parseSmartComposerSettings(data)
    // Migrations may drop references; keep them known so their secrets are
    // cleared after the migrated settings are saved.
    this.knownRefs = new Set([
      ...this.references(parsed),
      ...legacyReferences(data),
    ])
    this.settings = {
      ...parsed,
      providers: parsed.providers.map((provider) => {
        if (provider.apiKeySecretId) return this.resolveLinked(provider)
        // Plaintext is authoritative after a fallback, including interrupted
        // migrations. Never restore an older Keychain value over it.
        if (hasCredentials(provider)) return provider
        const ref = provider.credentialsSecretId
        if (ref && !ownsSecret(ref)) return provider
        // Fall back to a key another vault shares, e.g. when the reference
        // came from another device.
        for (const id of [ref, sharedSecretId(provider)]) {
          if (!id || !this.storage) continue
          try {
            const value = this.storage.getSecret(id)
            if (!value) continue
            const payload = isVaultSecret(id)
              ? payloadSchema.parse(JSON.parse(value))
              : { apiKey: value }
            const resolved = llmProviderSchema.parse({
              ...provider,
              ...payload,
              credentialsSecretId: id,
            })
            if (!hasCredentials(resolved)) continue
            this.synced.set(id, value)
            return resolved
          } catch {
            // Try the next entry.
          }
        }
        // Preserve an unresolved reference through unrelated settings saves.
        return provider
      }),
    }
    try {
      await this.persist(this.settings, true)
    } catch {
      this.notify(
        'Smart Composer settings could not be saved. Existing credentials were not removed.',
      )
    }
  }

  update(update: SettingsUpdate): Promise<void> {
    // Serialize the settings file and credential writes together. Evaluate
    // functional updates only when their turn starts, against the latest state.
    const operation = this.queue.then(async () => {
      const proposed =
        typeof update === 'function' ? update(this.settings) : update
      const result = smartComposerSettingsSchema.safeParse(proposed)
      if (!result.success) {
        throw new Error(
          'Invalid Smart Composer settings. Changes were not saved.',
        )
      }
      await this.persist(result.data)
    })
    this.queue = operation.catch(() => {})
    return operation
  }

  // Linked secrets belong to the user. Read them, never write or clear them.
  private resolveLinked(provider: LLMProvider): LLMProvider {
    const id = provider.apiKeySecretId ?? ''
    try {
      // Per-vault entries hold a JSON payload, not an API key.
      const value = isVaultSecret(id) ? null : this.storage?.getSecret(id)
      if (value) return { ...provider, apiKey: value }
    } catch {
      // Reported as needing attention by persist().
    }
    return { ...provider, apiKey: undefined }
  }

  // Adopt a shared key another vault replaced while this vault left it as is.
  private refreshShared(provider: LLMProvider): LLMProvider {
    const id = provider.credentialsSecretId
    if (!this.storage || !id || id !== sharedSecretId(provider)) return provider
    if (!provider.apiKey || this.synced.get(id) !== provider.apiKey)
      return provider
    try {
      const value = this.storage.getSecret(id)
      if (!value || value === provider.apiKey) return provider
      this.synced.set(id, value)
      return { ...provider, apiKey: value }
    } catch {
      return provider
    }
  }

  private references(settings: SmartComposerSettings) {
    return new Set(
      settings.providers
        .map((provider) => provider.credentialsSecretId)
        .filter((id): id is string => !!id && ownsSecret(id)),
    )
  }

  private warnOnce(id: string, message: string) {
    if (this.warned.has(id)) return
    this.warned.add(id)
    this.notify(message)
  }

  private async persist(next: SmartComposerSettings, migrating = false) {
    const previous = this.settings.providers
    next = {
      ...next,
      providers: next.providers.map((provider) =>
        provider.apiKeySecretId
          ? this.resolveLinked(provider)
          : this.refreshShared(provider),
      ),
    }
    const statuses = new Map<string, CredentialStatus>()
    let migrated = false
    const rejected = new Set<number>()
    const providers = next.providers.map((provider, index): LLMProvider => {
      if (provider.apiKeySecretId) {
        statuses.set(
          provider.id,
          provider.apiKey
            ? {
                label: 'Keychain',
                detail: `Uses the "${provider.apiKeySecretId}" secret from Obsidian Keychain.`,
              }
            : {
                label: 'Needs attention',
                detail: this.storage
                  ? `The "${provider.apiKeySecretId}" Keychain secret is missing.`
                  : `Linked to the "${provider.apiKeySecretId}" Keychain secret. Requires Obsidian 1.11.5+ with SecretStorage support.`,
              },
        )
        const stored = { ...provider }
        delete stored.apiKey
        delete stored.credentialsSecretId
        return stored
      }

      if (!hasCredentials(provider)) {
        statuses.set(
          provider.id,
          provider.credentialsSecretId
            ? {
                label: 'Needs attention',
                detail:
                  'Keychain credentials are unavailable on this device. Re-enter the API key or reconnect the subscription.',
              }
            : { label: 'Not configured', detail: 'No credentials configured.' },
        )
        return { ...provider }
      }

      let id =
        provider.credentialsSecretId && ownsSecret(provider.credentialsSecretId)
          ? provider.credentialsSecretId
          : 'smart-composer-' + uuidv4()
      const shared = sharedSecretId(provider)
      let reason = 'Requires Obsidian 1.11.5+ with SecretStorage support.'
      if (this.storage) {
        try {
          if (shared && id !== shared) {
            // Never replace a different key another vault shares.
            const existing = this.storage.getSecret(shared)
            if (!existing || existing === provider.apiKey) id = shared
          }
          const payload = isVaultSecret(id)
            ? JSON.stringify(credentials(provider))
            : (provider.apiKey ?? '')
          this.knownRefs.add(id)
          if (this.synced.get(id) !== payload) {
            this.storage.setSecret(id, payload)
            if (this.storage.getSecret(id) !== payload) throw new Error()
            this.synced.set(id, payload)
          }
          const stored = { ...provider, credentialsSecretId: id }
          delete stored.apiKey
          if ('oauth' in stored) delete stored.oauth
          statuses.set(provider.id, {
            label: 'Keychain',
            detail: isVaultSecret(id)
              ? 'Stored by Obsidian Keychain. Encryption depends on your operating system.'
              : `Stored by Obsidian Keychain as "${id}" and shared with other vaults.`,
          })
          migrated ||= migrating && !provider.credentialsSecretId
          return stored
        } catch {
          reason = 'Keychain storage or verification failed.'
        }
      }

      const fallback = { ...provider }
      delete fallback.credentialsSecretId
      if (fallback.type === 'openai-plan') {
        // Sign in with ChatGPT tokens must stay in protected storage.
        delete fallback.oauth
        rejected.add(index)
        statuses.set(provider.id, {
          label: 'Needs attention',
          detail:
            reason +
            ' ChatGPT sign-in requires Obsidian Keychain and was not saved.',
        })
        this.warnOnce(
          provider.id,
          'Smart Composer: ChatGPT sign-in was not saved because Obsidian Keychain is unavailable. ' +
            reason,
        )
        return fallback
      }
      statuses.set(provider.id, {
        label: 'Plaintext',
        detail:
          reason + ' Credentials are stored in the plugin data.json file.',
      })
      this.warnOnce(
        provider.id,
        'Smart Composer: ' +
          provider.id +
          ' is using plaintext credential storage. ' +
          reason,
      )
      return fallback
    })
    const diskSettings = { ...next, providers }
    // Do not publish success or clear any old secrets until this write succeeds.
    try {
      await this.saveData(diskSettings)
    } catch {
      // A refresh token may already have rotated remotely. Preserve the new
      // in-memory credentials for retry, while retaining the old configuration.
      this.settings = {
        ...this.settings,
        providers: this.settings.providers.map((previous) => {
          const index = next.providers.findIndex(
            (p) => p.id === previous.id && p.type === previous.type,
          )
          // A linked key must not stay behind as a plain API key.
          if (
            index < 0 ||
            next.providers[index].apiKeySecretId ||
            !hasCredentials(next.providers[index])
          )
            return previous
          return {
            ...previous,
            ...credentials(next.providers[index]),
            credentialsSecretId: providers[index].credentialsSecretId,
          } as LLMProvider
        }),
      }
      this.settings.providers.forEach((provider) => {
        this.statuses.set(provider.id, {
          label: 'Needs attention',
          detail:
            'Settings could not be saved. Please retry before closing Obsidian.',
        })
      })
      throw new Error('Smart Composer settings could not be saved.')
    }
    const refs = this.references(diskSettings)
    const removed = new Set([...this.knownRefs].filter((id) => !refs.has(id)))
    // A key cleared right after unlinking was never referenced in this vault.
    for (const provider of next.providers) {
      const before = previous.find((p) => p.id === provider.id)
      const id = sharedSecretId(provider)
      if (id && before?.apiKeySecretId && before.apiKey) removed.add(id)
    }
    this.knownRefs = refs
    this.settings = {
      ...next,
      providers: providers.map(
        (stored, index) =>
          (rejected.has(index)
            ? stored
            : {
                ...stored,
                ...credentials(next.providers[index]),
              }) as LLMProvider,
      ),
    }
    this.statuses = statuses
    this.onSaved(this.settings)

    for (const id of removed) {
      // Other vaults may still use a shared key. Clear it only when the user
      // cleared this provider's key, not when it was deleted or linked.
      const cleared = next.providers.some(
        (p) =>
          !p.apiKeySecretId && !hasCredentials(p) && sharedSecretId(p) === id,
      )
      if (!isVaultSecret(id) && !cleared) continue
      this.synced.delete(id)
      try {
        if (!this.storage) throw new Error()
        // There is no public delete API. Clear only our own referenced values.
        if (this.storage.getSecret(id)) this.storage.setSecret(id, '')
        if (this.storage.getSecret(id)) throw new Error()
      } catch {
        this.warnOnce(
          'cleanup-' + id,
          'Smart Composer disconnected the credentials, but could not clear an old Keychain entry. Remove it in Obsidian Keychain settings.',
        )
      }
    }
    if (migrated) {
      this.notify(
        'Smart Composer moved credentials to Keychain. Other devices may need API keys or subscription sign-in again.',
      )
    }
  }
}
