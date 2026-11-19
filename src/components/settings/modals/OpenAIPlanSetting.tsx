import { Notice } from 'obsidian'
import { useEffect, useState } from 'react'

import { CODEX_USAGE_URL, PROVIDER_TYPES_INFO } from '../../../constants'
import {
  hasCodexPlanUsageScope,
  revokeCodexRefreshToken,
} from '../../../core/llm/codexAuth'
import { waitForCodexRefresh } from '../../../core/llm/openaiCodexProvider'
import SmartComposerPlugin from '../../../main'
import { LLMProvider } from '../../../types/provider.types'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ConfirmModal } from '../../modals/ConfirmModal'

import { ConnectOpenAIPlanModal } from './ConnectOpenAIPlanModal'

const OPENAI_PLAN_PROVIDER_ID = PROVIDER_TYPES_INFO['openai-plan']
  .defaultProviderId as string

const findPlanProvider = (providers: LLMProvider[]) =>
  providers.find(
    (p): p is Extract<LLMProvider, { type: 'openai-plan' }> =>
      p.id === OPENAI_PLAN_PROVIDER_ID && p.type === 'openai-plan',
  )

export function OpenAIPlanSetting({ plugin }: { plugin: SmartComposerPlugin }) {
  const [settings, setSettings] = useState(plugin.settings)
  useEffect(() => plugin.addSettingsChangeListener(setSettings), [plugin])

  const provider = findPlanProvider(settings.providers)
  const isConnected = !!provider?.oauth?.accessToken
  const isPlanUsageAllowed = hasCodexPlanUsageScope(provider?.oauth?.scopes)

  // Ends the ChatGPT session remotely. Local tokens are cleared regardless.
  const revokeSession = async () => {
    await waitForCodexRefresh(OPENAI_PLAN_PROVIDER_ID)
    const current = findPlanProvider(plugin.settings.providers)
    const refreshToken = current?.oauth?.refreshToken
    const clientId = current?.registration?.clientId
    if (!refreshToken || !clientId) return
    try {
      await revokeCodexRefreshToken(refreshToken, clientId)
    } catch {
      new Notice('Could not confirm ChatGPT sign-out.')
    }
  }

  const disconnect = () => {
    new ConfirmModal(plugin.app, {
      title: 'Disconnect subscription',
      message: 'Disconnect OpenAI from Smart Composer?',
      ctaText: 'Disconnect',
      onConfirm: async () => {
        await revokeSession()
        await plugin.setSettings((current) => ({
          ...current,
          providers: current.providers.map((p) => {
            if (p.id !== OPENAI_PLAN_PROVIDER_ID || p.type !== 'openai-plan')
              return p
            return {
              ...p,
              oauth: undefined,
              credentialsSecretId: undefined,
              // ponytail: single-account UI, so drop the ChatGPT registration
              // to allow a different account next time. Add an account picker
              // to reuse registrations as the SIWC docs recommend.
              registration: undefined,
            }
          }),
        }))
      },
    }).open()
  }

  return (
    <ObsidianSetting
      name="ChatGPT plan"
      desc={isConnected ? 'Connected' : 'Disconnected'}
    >
      {!isConnected && (
        <ObsidianButton
          text="Connect"
          cta
          onClick={() => new ConnectOpenAIPlanModal(plugin.app, plugin).open()}
        />
      )}
      {isConnected && !isPlanUsageAllowed && (
        <ObsidianButton
          text="Allow plan usage"
          cta
          onClick={() =>
            new ConnectOpenAIPlanModal(plugin.app, plugin, true).open()
          }
        />
      )}
      {isConnected && (
        <ObsidianButton
          text="Usage"
          onClick={() => window.open(CODEX_USAGE_URL)}
        />
      )}
      {(isConnected ||
        provider?.credentialsSecretId ||
        provider?.registration) && (
        <ObsidianButton text="Disconnect" onClick={disconnect} />
      )}
    </ObsidianSetting>
  )
}
