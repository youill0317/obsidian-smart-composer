import { Check, CircleMinus } from 'lucide-react'
import { App, Notice } from 'obsidian'

import { CODEX_USAGE_URL, PROVIDER_TYPES_INFO } from '../../../constants'
import { useSettings } from '../../../contexts/settings-context'
import {
  hasCodexPlanUsageScope,
  revokeCodexRefreshToken,
} from '../../../core/llm/codexAuth'
import { waitForCodexRefresh } from '../../../core/llm/openaiCodexProvider'
import SmartComposerPlugin from '../../../main'
import { LLMProvider } from '../../../types/provider.types'
import { ConfirmModal } from '../../modals/ConfirmModal'
import { CredentialStorageStatus } from '../CredentialStorageStatus'
import { ConnectClaudePlanModal } from '../modals/ConnectClaudePlanModal'
import { ConnectGeminiPlanModal } from '../modals/ConnectGeminiPlanModal'
import { ConnectOpenAIPlanModal } from '../modals/ConnectOpenAIPlanModal'

type PlanConnectionsSectionProps = {
  app: App
  plugin: SmartComposerPlugin
}

const CLAUDE_PLAN_PROVIDER_ID = PROVIDER_TYPES_INFO['anthropic-plan']
  .defaultProviderId as string
const OPENAI_PLAN_PROVIDER_ID = PROVIDER_TYPES_INFO['openai-plan']
  .defaultProviderId as string
const GEMINI_PLAN_PROVIDER_ID = PROVIDER_TYPES_INFO['gemini-plan']
  .defaultProviderId as string

export function PlanConnectionsSection({
  app,
  plugin,
}: PlanConnectionsSectionProps) {
  const { settings, setSettings } = useSettings()

  const claudePlanProvider = settings.providers.find(
    (p): p is Extract<LLMProvider, { type: 'anthropic-plan' }> =>
      p.id === CLAUDE_PLAN_PROVIDER_ID && p.type === 'anthropic-plan',
  )
  const openAIPlanProvider = settings.providers.find(
    (p): p is Extract<LLMProvider, { type: 'openai-plan' }> =>
      p.id === OPENAI_PLAN_PROVIDER_ID && p.type === 'openai-plan',
  )
  const geminiPlanProvider = settings.providers.find(
    (p): p is Extract<LLMProvider, { type: 'gemini-plan' }> =>
      p.id === GEMINI_PLAN_PROVIDER_ID && p.type === 'gemini-plan',
  )

  const isClaudeConnected = !!claudePlanProvider?.oauth?.accessToken
  const isOpenAIConnected = !!openAIPlanProvider?.oauth?.accessToken
  const isGeminiConnected = !!geminiPlanProvider?.oauth?.accessToken
  const isOpenAIPlanUsageAllowed = hasCodexPlanUsageScope(
    openAIPlanProvider?.oauth?.scopes,
  )

  const disconnect = (
    providerType: 'anthropic-plan' | 'openai-plan' | 'gemini-plan',
  ) => {
    const providerId =
      providerType === 'anthropic-plan'
        ? CLAUDE_PLAN_PROVIDER_ID
        : providerType === 'openai-plan'
          ? OPENAI_PLAN_PROVIDER_ID
          : GEMINI_PLAN_PROVIDER_ID

    new ConfirmModal(app, {
      title: 'Disconnect subscription',
      message:
        providerType === 'anthropic-plan'
          ? 'Disconnect Claude from Smart Composer?'
          : providerType === 'openai-plan'
            ? 'Disconnect OpenAI from Smart Composer?'
            : 'Disconnect Gemini from Smart Composer?',
      ctaText: 'Disconnect',
      onConfirm: async () => {
        if (providerType === 'openai-plan') {
          await revokeOpenAIPlanSession()
        }
        await setSettings((current) => ({
          ...current,
          providers: current.providers.map((p) => {
            if (p.id !== providerId || p.type !== providerType) return p
            return {
              ...p,
              oauth: undefined,
              credentialsSecretId: undefined,
              // ponytail: single-account UI, so drop the ChatGPT registration
              // to allow a different account next time. Add an account picker
              // to reuse registrations as the SIWC docs recommend.
              ...(p.type === 'openai-plan' && { registration: undefined }),
            }
          }),
        }))
      },
    }).open()
  }

  // Ends the ChatGPT session remotely. Local tokens are cleared regardless.
  const revokeOpenAIPlanSession = async () => {
    await waitForCodexRefresh(OPENAI_PLAN_PROVIDER_ID)
    const provider = plugin.settings.providers.find(
      (p): p is Extract<LLMProvider, { type: 'openai-plan' }> =>
        p.id === OPENAI_PLAN_PROVIDER_ID && p.type === 'openai-plan',
    )
    const refreshToken = provider?.oauth?.refreshToken
    const clientId = provider?.registration?.clientId
    if (!refreshToken || !clientId) return
    try {
      await revokeCodexRefreshToken(refreshToken, clientId)
    } catch {
      new Notice(
        'Could not confirm ChatGPT sign-out. You can disconnect Smart Composer in ChatGPT settings.',
      )
    }
  }

  return (
    <div className="smtcmp-settings-section">
      <div className="smtcmp-settings-header">Connect your subscription</div>

      <div className="smtcmp-settings-desc">
        <div className="smtcmp-settings-desc-warning">
          <strong className="smtcmp-settings-desc-warning-title">
            Warning:
          </strong>{' '}
          Anthropic has restricted third-party OAuth access, and there are
          reports of account bans when using subscription OAuth via third-party
          clients. See the{' '}
          <a href="https://github.com/glowingjade/obsidian-smart-composer?tab=readme-ov-file">
            README
          </a>{' '}
          for full details and use at your own risk.
        </div>
        Use a subscription instead of API-key billing. Connected subscriptions
        consume your plan&apos;s included usage (ChatGPT plan for OpenAI, Claude
        Code for Anthropic, Gemini Code Assist for Gemini). Subscriptions
        aren&apos;t supported on mobile environments.
        <br />
      </div>

      <div className="smtcmp-plan-connection-grid">
        <div className="smtcmp-plan-connection-card">
          <div className="smtcmp-plan-connection-card-header">
            <div className="smtcmp-plan-connection-card-title">Claude</div>
            <PlanConnectionStatusBadge connected={isClaudeConnected} />
          </div>
          <CredentialStorageStatus
            plugin={plugin}
            providerId={CLAUDE_PLAN_PROVIDER_ID}
          />

          <div className="smtcmp-plan-connection-card-desc">
            Uses your Claude Code usage from your Claude plan.
            <br />
            Check your limit in Claude Code with <code>/usage</code>.
          </div>

          <div className="smtcmp-plan-connection-card-actions">
            {!isClaudeConnected && (
              <button
                className="mod-cta"
                onClick={() => new ConnectClaudePlanModal(app, plugin).open()}
              >
                Connect
              </button>
            )}
            {(isClaudeConnected || claudePlanProvider?.credentialsSecretId) && (
              <button onClick={() => disconnect('anthropic-plan')}>
                Disconnect
              </button>
            )}
          </div>
        </div>

        <div className="smtcmp-plan-connection-card">
          <div className="smtcmp-plan-connection-card-header">
            <div className="smtcmp-plan-connection-card-title">OpenAI</div>
            <PlanConnectionStatusBadge connected={isOpenAIConnected} />
          </div>
          <CredentialStorageStatus
            plugin={plugin}
            providerId={OPENAI_PLAN_PROVIDER_ID}
          />

          <div className="smtcmp-plan-connection-card-desc">
            Uses your ChatGPT plan through Sign in with ChatGPT.
            <br />
            <a href={CODEX_USAGE_URL} target="_blank" rel="noopener noreferrer">
              Check ChatGPT usage and limits
            </a>
            {isOpenAIConnected && !isOpenAIPlanUsageAllowed && (
              <div className="smtcmp-plan-connect-error">
                ChatGPT plan usage is not allowed for Smart Composer.
              </div>
            )}
          </div>

          <div className="smtcmp-plan-connection-card-actions">
            {!isOpenAIConnected && (
              <button
                className="mod-cta"
                onClick={() => new ConnectOpenAIPlanModal(app, plugin).open()}
              >
                Connect
              </button>
            )}
            {isOpenAIConnected && !isOpenAIPlanUsageAllowed && (
              <button
                className="mod-cta"
                onClick={() =>
                  new ConnectOpenAIPlanModal(app, plugin, true).open()
                }
              >
                Allow plan usage
              </button>
            )}
            {(isOpenAIConnected ||
              openAIPlanProvider?.credentialsSecretId ||
              openAIPlanProvider?.registration) && (
              <button onClick={() => disconnect('openai-plan')}>
                Disconnect
              </button>
            )}
          </div>
        </div>

        <div className="smtcmp-plan-connection-card">
          <div className="smtcmp-plan-connection-card-header">
            <div className="smtcmp-plan-connection-card-title">Gemini</div>
            <PlanConnectionStatusBadge connected={isGeminiConnected} />
          </div>
          <CredentialStorageStatus
            plugin={plugin}
            providerId={GEMINI_PLAN_PROVIDER_ID}
          />

          <div className="smtcmp-plan-connection-card-desc">
            Uses your Gemini Code Assist usage from your Google AI Plan.
            <br />
            Check your limit in Gemini CLI with <code>/stats</code>.
          </div>

          <div className="smtcmp-plan-connection-card-actions">
            {!isGeminiConnected && (
              <button
                className="mod-cta"
                onClick={() => new ConnectGeminiPlanModal(app, plugin).open()}
              >
                Connect
              </button>
            )}
            {(isGeminiConnected || geminiPlanProvider?.credentialsSecretId) && (
              <button onClick={() => disconnect('gemini-plan')}>
                Disconnect
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PlanConnectionStatusBadge({ connected }: { connected: boolean }) {
  const statusConfig = connected
    ? {
        icon: <Check size={16} />,
        label: 'Connected',
        statusClass: 'smtcmp-mcp-server-status-badge--connected',
      }
    : {
        icon: <CircleMinus size={14} />,
        label: 'Disconnected',
        statusClass: 'smtcmp-mcp-server-status-badge--disconnected',
      }

  return (
    <div
      className={`smtcmp-mcp-server-status-badge ${statusConfig.statusClass}`}
    >
      {statusConfig.icon}
      <div className="smtcmp-mcp-server-status-badge-label">
        {statusConfig.label}
      </div>
    </div>
  )
}
