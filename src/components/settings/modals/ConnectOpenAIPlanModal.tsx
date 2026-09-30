import { App, Notice } from 'obsidian'
import { useEffect, useRef, useState } from 'react'

import { PROVIDER_TYPES_INFO } from '../../../constants'
import {
  buildCodexAuthorizeUrl,
  exchangeCodexCodeForTokens,
  generateCodexPkce,
  generateCodexState,
  hasCodexPlanUsageScope,
  startCodexCallbackServer,
  stopCodexCallbackServer,
  verifyCodexIdToken,
} from '../../../core/llm/codexAuth'
import SmartComposerPlugin from '../../../main'
import { LLMProvider } from '../../../types/provider.types'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ReactModal } from '../../common/ReactModal'

type ConnectOpenAIPlanModalProps = {
  plugin: SmartComposerPlugin
  onClose: () => void
  // Ask again for ChatGPT plan usage after the user declined it.
  forceConsent?: boolean
}

type OpenAIPlanProvider = Extract<LLMProvider, { type: 'openai-plan' }>

type AuthAttempt = {
  state: string
  nonce: string
  pkceVerifier: string
  authorizeUrl: string
  // Issued client id when reauthorizing an existing registration.
  clientId?: string
}

const OPENAI_PLAN_PROVIDER_ID = PROVIDER_TYPES_INFO['openai-plan']
  .defaultProviderId as string

// Identifies this installation (not the user). Stored per device, never synced.
const HOST_ID_STORAGE_KEY = 'smtcmp-openai-plan-host-id'

function getHostId(plugin: SmartComposerPlugin): string {
  const saved: unknown = plugin.app.loadLocalStorage(HOST_ID_STORAGE_KEY)
  if (typeof saved === 'string' && saved) return saved
  const hostId = `urn:uuid:${crypto.randomUUID()}`
  plugin.app.saveLocalStorage(HOST_ID_STORAGE_KEY, hostId)
  return hostId
}

function getOpenAIPlanProvider(plugin: SmartComposerPlugin) {
  return plugin.settings.providers.find(
    (p): p is OpenAIPlanProvider =>
      p.type === 'openai-plan' && p.id === OPENAI_PLAN_PROVIDER_ID,
  )
}

export class ConnectOpenAIPlanModal extends ReactModal<ConnectOpenAIPlanModalProps> {
  constructor(app: App, plugin: SmartComposerPlugin, forceConsent = false) {
    super({
      app: app,
      Component: ConnectOpenAIPlanModalComponent,
      props: { plugin, forceConsent },
      options: {
        title: 'Connect ChatGPT subscription',
      },
    })
  }
}

function ConnectOpenAIPlanModalComponent({
  plugin,
  onClose,
  forceConsent,
}: ConnectOpenAIPlanModalProps) {
  const extractParamFromRedirectUrl = (input: string, key: string) => {
    const trimmed = input.trim()
    if (!trimmed) return ''
    try {
      const parsed = new URL(trimmed)
      return parsed.searchParams.get(key) ?? ''
    } catch {
      const match = trimmed.match(new RegExp(`[?&]${key}=([^&]+)`))
      if (match?.[1]) return decodeURIComponent(match[1])
      return ''
    }
  }

  const attemptRef = useRef<AuthAttempt>()
  const [redirectUrl, setRedirectUrl] = useState('')
  const [isWaitingForCallback, setIsWaitingForCallback] = useState(false)
  const [isManualConnecting, setIsManualConnecting] = useState(false)
  const [autoError, setAutoError] = useState('')
  const [manualError, setManualError] = useState('')

  const redirectCode = extractParamFromRedirectUrl(redirectUrl, 'code')
  const isBusy = isWaitingForCallback || isManualConnecting

  useEffect(() => {
    return () => {
      void stopCodexCallbackServer()
    }
  }, [])

  // Each attempt gets fresh state, nonce and PKCE values.
  const createAttempt = async (): Promise<AuthAttempt> => {
    const provider = getOpenAIPlanProvider(plugin)
    const registration = provider?.registration
    // An issued client from a failed earlier attempt must be reused.
    const clientId = registration?.clientId ?? attemptRef.current?.clientId
    const pkce = await generateCodexPkce()
    const state = generateCodexState()
    const nonce = generateCodexState()
    const authorizeUrl = buildCodexAuthorizeUrl({
      pkce,
      state,
      nonce,
      hostId: getHostId(plugin),
      clientId,
      idTokenHint: registration && provider?.oauth?.idToken,
      loginHint: registration?.email,
      forceConsent,
    })
    const attempt = {
      state,
      nonce,
      pkceVerifier: pkce.verifier,
      authorizeUrl,
      clientId,
    }
    attemptRef.current = attempt
    return attempt
  }

  const completeAuthorization = async (
    attempt: AuthAttempt,
    code: string,
    callbackClientId: string | undefined,
  ) => {
    if (
      attempt.clientId &&
      callbackClientId &&
      callbackClientId !== attempt.clientId
    ) {
      throw new Error('ChatGPT returned a different client registration.')
    }
    const clientId = attempt.clientId ?? callbackClientId
    if (!clientId) {
      throw new Error('ChatGPT did not return a client registration.')
    }
    // Keep a new registration even if the code exchange below fails.
    attempt.clientId = clientId

    const tokens = await exchangeCodexCodeForTokens({
      code,
      pkceVerifier: attempt.pkceVerifier,
      clientId,
    })
    const identity = await verifyCodexIdToken(tokens.id_token, {
      clientId,
      nonce: attempt.nonce,
    })
    const previous = getOpenAIPlanProvider(plugin)?.registration
    if (
      previous?.clientId === clientId &&
      previous.subject !== identity.subject
    ) {
      throw new Error('Signed in with a different ChatGPT account.')
    }

    const scopes = tokens.scope?.split(' ') ?? []
    if (!getOpenAIPlanProvider(plugin)) {
      throw new Error('OpenAI Plan provider not found.')
    }
    await plugin.setSettings((current) => ({
      ...current,
      providers: current.providers.map((p) => {
        if (p.type === 'openai-plan' && p.id === OPENAI_PLAN_PROVIDER_ID) {
          return {
            ...p,
            registration: {
              clientId,
              subject: identity.subject,
              email: identity.email,
            },
            oauth: {
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
              idToken: tokens.id_token,
              scopes,
            },
          }
        }
        return p
      }),
    }))
    if (!getOpenAIPlanProvider(plugin)?.oauth) {
      // The credential store refused to save the tokens (no Keychain).
      throw new Error('ChatGPT sign-in could not be saved securely.')
    }

    if (hasCodexPlanUsageScope(scopes)) {
      new Notice('ChatGPT subscription connected')
    } else {
      new Notice(
        'Signed in, but ChatGPT plan usage was not allowed. Use "Allow plan usage" in settings to enable it.',
      )
    }
    onClose()
  }

  const openLogin = async () => {
    if (isBusy) return
    setAutoError('')
    setManualError('')
    if (!plugin.hasKeychain) {
      setAutoError(
        'ChatGPT sign-in requires Obsidian Keychain (Obsidian 1.11.5 or later).',
      )
      return
    }

    const attempt = await createAttempt()
    setIsWaitingForCallback(true)
    try {
      const callback = startCodexCallbackServer({ state: attempt.state })
      // Give the listener a chance to bind before the browser redirects.
      await new Promise((resolve) => setTimeout(resolve, 0))
      window.open(attempt.authorizeUrl, '_blank')
      const result = await callback
      await completeAuthorization(attempt, result.code, result.clientId)
    } catch (error) {
      setAutoError(
        `${error instanceof Error ? error.message : 'Automatic connect failed.'} If the browser shows the redirect URL, paste it below and click "Connect with URL".`,
      )
    } finally {
      setIsWaitingForCallback(false)
    }
  }

  const connectWithRedirectUrl = async () => {
    if (isBusy) return
    setAutoError('')
    const attempt = attemptRef.current
    if (!attempt) {
      setManualError('Click "Continue with ChatGPT" first.')
      return
    }
    const error = extractParamFromRedirectUrl(redirectUrl, 'error')
    const redirectState = extractParamFromRedirectUrl(redirectUrl, 'state')
    if (!redirectState || redirectState !== attempt.state) {
      setManualError(
        'OAuth state mismatch. Start login again and paste the newest redirect URL.',
      )
      return
    }
    if (error) {
      setManualError(`ChatGPT sign-in failed: ${error}`)
      return
    }
    if (!redirectCode) {
      setManualError(
        'No authorization code found. Paste the full redirect URL from your browser address bar.',
      )
      return
    }

    setManualError('')
    setIsManualConnecting(true)
    try {
      await stopCodexCallbackServer()
      await completeAuthorization(
        attempt,
        redirectCode,
        extractParamFromRedirectUrl(redirectUrl, 'client_id') || undefined,
      )
    } catch (error) {
      setManualError(
        `${error instanceof Error ? error.message : 'Manual connect failed.'} Start login again and paste the newest redirect URL.`,
      )
    } finally {
      setIsManualConnecting(false)
    }
  }

  return (
    <div>
      <div className="smtcmp-plan-connect-steps">
        <div className="smtcmp-plan-connect-steps-title">How it works</div>
        <ol>
          <li>Sign in to ChatGPT in your browser and allow plan usage</li>
          <li>Smart Composer connects automatically when you return</li>
          <li>
            If automatic connect fails, paste the full redirect URL below and
            click &quot;Connect with URL&quot;
          </li>
        </ol>
      </div>

      <ObsidianSetting
        name="ChatGPT sign-in"
        desc="Sign in to ChatGPT in your browser. Smart Composer connects automatically when you return."
      >
        <ObsidianButton
          text="Continue with ChatGPT"
          disabled={isBusy}
          onClick={() => void openLogin()}
          cta
        />
        {isWaitingForCallback && (
          <div className="smtcmp-plan-connect-waiting">
            <div className="smtcmp-plan-connect-waiting-content">
              <div className="smtcmp-plan-connect-waiting-spinner" />
              <div className="smtcmp-plan-connect-waiting-text">
                <strong>Waiting for authorization</strong>
                <span>
                  Complete the login in your browser, then return here
                </span>
              </div>
            </div>
          </div>
        )}
      </ObsidianSetting>

      <ObsidianSetting
        name="Redirect URL (fallback)"
        desc="Use this only if automatic connect fails. Paste the full redirect URL from your browser address bar."
        className="smtcmp-plan-connect-fallback"
      >
        <div className="smtcmp-plan-connect-fallback-controls">
          {autoError && (
            <div className="smtcmp-plan-connect-error">{autoError}</div>
          )}
          <ObsidianTextInput
            value={redirectUrl}
            placeholder="http://127.0.0.1:1455/auth/..."
            onChange={(value) => {
              setRedirectUrl(value)
              if (manualError) setManualError('')
            }}
          />
          <ObsidianButton
            text="Connect with URL"
            disabled={!redirectCode || isBusy}
            onClick={() => void connectWithRedirectUrl()}
          />
          {manualError && (
            <div className="smtcmp-plan-connect-error">{manualError}</div>
          )}
        </div>
      </ObsidianSetting>

      <ObsidianSetting>
        <ObsidianButton text="Cancel" onClick={onClose} />
      </ObsidianSetting>
    </div>
  )
}
