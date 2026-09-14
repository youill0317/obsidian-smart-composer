import type { SecretStorage } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

import { LLMProvider, llmProviderSchema } from '../types/provider.types'

import {
  SettingsUpdate,
  SmartComposerSettings,
  smartComposerSettingsSchema,
} from './schema/setting.types'
import { parseSmartComposerSettings } from './schema/settings'

type Storage = Pick<SecretStorage, 'getSecret' | 'setSecret'>
export type CredentialStatus = {
  label: 'Keychain' | 'Session only' | 'Needs attention' | 'Not configured'
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
  return /^smart-composer-[0-9a-f-]{36}$/.test(id)
}

/**
 * Runtime settings contain resolved credentials; only persist() may serialize
 * them. The public SecretStorage API cannot acknowledge durable disk writes.
 */
export class CredentialSettingsStore {
  settings: SmartComposerSettings = smartComposerSettingsSchema.parse({})
  private statuses = new Map<string, CredentialStatus>()
  private knownRefs = new Set<string>()
  private warned = new Set<string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private storage: Storage | undefined,
    private saveData: (settings: SmartComposerSettings) => Promise<void>,
    private notify: (message: string) => void,
    private onSaved: (settings: SmartComposerSettings) => void = () => {},
  ) {}

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
    this.knownRefs = this.references(parsed)
    this.settings = {
      ...parsed,
      providers: parsed.providers.map((provider) => {
        const id = provider.credentialsSecretId
        // A legacy plaintext value is authoritative during its one-time move.
        // Never restore an older Keychain value over it.
        if (!id || hasCredentials(provider)) return provider
        try {
          if (!this.storage || !ownsSecret(id)) throw new Error()
          const value = this.storage.getSecret(id)
          if (!value) throw new Error()
          const payload = payloadSchema.parse(JSON.parse(value))
          const resolved = llmProviderSchema.parse({ ...provider, ...payload })
          if (!hasCredentials(resolved)) throw new Error()
          return resolved
        } catch {
          // Preserve an unresolved reference through unrelated settings saves.
          return provider
        }
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
    const statuses = new Map<string, CredentialStatus>()
    let migrated = false
    const providers = next.providers.map((provider): LLMProvider => {
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

      const existingSecretId =
        provider.credentialsSecretId && ownsSecret(provider.credentialsSecretId)
          ? provider.credentialsSecretId
          : undefined
      const id = existingSecretId ?? 'smart-composer-' + uuidv4()
      let reason = 'Requires Obsidian 1.11.5+ with SecretStorage support.'
      if (this.storage) {
        try {
          const payload = JSON.stringify(credentials(provider))
          this.knownRefs.add(id)
          this.storage.setSecret(id, payload)
          if (this.storage.getSecret(id) !== payload) throw new Error()
          const stored = { ...provider, credentialsSecretId: id }
          delete stored.apiKey
          if ('oauth' in stored) delete stored.oauth
          statuses.set(provider.id, {
            label: 'Keychain',
            detail:
              'Stored by Obsidian Keychain. Encryption depends on your operating system.',
          })
          migrated ||= migrating && !provider.credentialsSecretId
          return stored
        } catch {
          reason = 'Keychain storage or verification failed.'
        }
      }

      const sessionOnly = { ...provider }
      delete sessionOnly.apiKey
      if ('oauth' in sessionOnly) delete sessionOnly.oauth
      if (!existingSecretId) delete sessionOnly.credentialsSecretId
      statuses.set(provider.id, {
        label: 'Session only',
        detail:
          reason +
          ' Credentials are available only until Obsidian closes; re-enter or reconnect after Keychain access is restored.',
      })
      this.warnOnce(
        provider.id,
        'Smart Composer: ' +
          provider.id +
          ' credentials are session-only and were not written to data.json. ' +
          reason,
      )
      return sessionOnly
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
          if (index < 0 || !hasCredentials(next.providers[index]))
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
    const removed = [...this.knownRefs].filter((id) => !refs.has(id))
    this.knownRefs = refs
    this.settings = {
      ...next,
      providers: providers.map(
        (stored, index) =>
          ({
            ...stored,
            ...credentials(next.providers[index]),
          }) as LLMProvider,
      ),
    }
    this.statuses = statuses
    this.onSaved(this.settings)

    for (const id of removed) {
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
