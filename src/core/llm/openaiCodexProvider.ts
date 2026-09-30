import { Reasoning, ReasoningEffort } from 'openai/resources/shared'

import { CODEX_USAGE_URL } from '../../constants'
import { ChatModel } from '../../types/chat-model.types'
import {
  LLMOptions,
  LLMRequestNonStreaming,
  LLMRequestStreaming,
} from '../../types/llm/request'
import {
  LLMResponseNonStreaming,
  LLMResponseStreaming,
} from '../../types/llm/response'
import { LLMProvider } from '../../types/provider.types'
import { HttpRequestError } from '../../utils/llm/httpTransport'

import { BaseLLMProvider } from './base'
import {
  hasCodexPlanUsageScope,
  isTerminalCodexRefreshError,
  refreshCodexAccessToken,
} from './codexAuth'
import { CodexMessageAdapter, ResponseStreamError } from './codexMessageAdapter'
import {
  LLMAPIKeyInvalidException,
  LLMAPIKeyNotSetException,
} from './exception'

type CodexOAuth = NonNullable<
  Extract<LLMProvider, { type: 'openai-plan' }>['oauth']
>

// Refresh tokens rotate, and the manager creates a provider per request, so
// concurrent refreshes are shared per provider id across instances.
const inFlightRefreshes = new Map<string, Promise<CodexOAuth>>()
// Consumed refresh token -> the tokens that replaced it. A client that still
// holds a consumed token adopts the replacement instead of reusing the token.
// ponytail: grows by one entry per refresh for the app session; tiny.
const replacedTokens = new Map<string, CodexOAuth>()
const REFRESH_MARGIN_MS = 60 * 1000

export const CODEX_TOOL_NAMESPACE = 'smart_composer'

/** Waits for a running token refresh so callers see the latest tokens. */
export async function waitForCodexRefresh(providerId: string) {
  await inFlightRefreshes.get(providerId)?.catch(() => undefined)
}

export class OpenAICodexProvider extends BaseLLMProvider<
  Extract<LLMProvider, { type: 'openai-plan' }>
> {
  private adapter: CodexMessageAdapter
  private onProviderUpdate?: (
    providerId: string,
    update: Partial<LLMProvider>,
  ) => void | Promise<void>

  constructor(
    provider: Extract<LLMProvider, { type: 'openai-plan' }>,
    onProviderUpdate?: (
      providerId: string,
      update: Partial<LLMProvider>,
    ) => void | Promise<void>,
  ) {
    super(provider)
    this.adapter = new CodexMessageAdapter({
      toolNamespace: CODEX_TOOL_NAMESPACE,
    })
    this.onProviderUpdate = onProviderUpdate
  }

  async generateResponse(
    model: ChatModel,
    request: LLMRequestNonStreaming,
    options?: LLMOptions,
  ): Promise<LLMResponseNonStreaming> {
    if (model.providerType !== 'openai-plan') {
      throw new Error('Model is not an OpenAI Codex model')
    }

    const authHeaders = await this.getAuthHeaders()
    const normalizedRequest = this.normalizeRequest(model, request)
    try {
      return await this.adapter.generateResponse(
        normalizedRequest,
        options,
        authHeaders,
      )
    } catch (error) {
      throw describePlanUsageError(error)
    }
  }

  async streamResponse(
    model: ChatModel,
    request: LLMRequestStreaming,
    options?: LLMOptions,
  ): Promise<AsyncIterable<LLMResponseStreaming>> {
    if (model.providerType !== 'openai-plan') {
      throw new Error('Model is not an OpenAI Codex model')
    }

    const authHeaders = await this.getAuthHeaders()
    const normalizedRequest = this.normalizeRequest(model, request)
    try {
      const stream = await this.adapter.streamResponse(
        normalizedRequest,
        options,
        authHeaders,
      )
      return mapStreamErrors(stream)
    } catch (error) {
      throw describePlanUsageError(error)
    }
  }

  async getEmbedding(
    _model: string,
    _text: string,
    _options?: { dimensions?: number },
  ): Promise<number[]> {
    throw new Error(
      `Provider ${this.provider.id} does not support embeddings. Please use a different provider.`,
    )
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const oauth = this.provider.oauth
    const clientId = this.provider.registration?.clientId
    if (!oauth?.refreshToken || !clientId) {
      throw new LLMAPIKeyNotSetException(
        `Provider ${this.provider.id} OAuth credentials are missing. Please connect your ChatGPT account.`,
      )
    }
    if (!hasCodexPlanUsageScope(oauth.scopes)) {
      throw new LLMAPIKeyInvalidException(
        'ChatGPT plan usage is not allowed for Smart Composer. Allow it in Settings > Connect your subscription.',
      )
    }

    let current = oauth
    for (
      let next = replacedTokens.get(current.refreshToken);
      next;
      next = replacedTokens.get(current.refreshToken)
    ) {
      current = next
    }
    if (current !== oauth) {
      await this.onProviderUpdate?.(this.provider.id, { oauth: current })
      this.provider.oauth = current
    }
    if (
      !current.accessToken ||
      current.expiresAt - REFRESH_MARGIN_MS <= Date.now()
    ) {
      current = await this.refreshShared(current, clientId)
      this.provider.oauth = current
    }

    return { authorization: `Bearer ${current.accessToken}` }
  }

  private refreshShared(oauth: CodexOAuth, clientId: string) {
    const providerId = this.provider.id
    const existing = inFlightRefreshes.get(providerId)
    if (existing) {
      // Record the shared result so this client's next refresh can be saved.
      return existing.then(async (updated) => {
        await this.onProviderUpdate?.(providerId, { oauth: updated })
        return updated
      })
    }

    const refresh = (async () => {
      try {
        const tokens = await refreshCodexAccessToken(
          oauth.refreshToken,
          clientId,
        )
        const updatedOauth: CodexOAuth = {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? oauth.refreshToken,
          expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          idToken: tokens.id_token ?? oauth.idToken,
          scopes: tokens.scope ? tokens.scope.split(' ') : oauth.scopes,
        }
        if (updatedOauth.refreshToken !== oauth.refreshToken) {
          replacedTokens.set(oauth.refreshToken, updatedOauth)
        }
        await this.onProviderUpdate?.(providerId, { oauth: updatedOauth })
        return updatedOauth
      } catch (error) {
        if (isTerminalCodexRefreshError(error)) {
          // The token set is unusable; keep the registration for reconnecting.
          await this.onProviderUpdate?.(providerId, {
            oauth: undefined,
            credentialsSecretId: undefined,
          })
          throw new LLMAPIKeyInvalidException(
            'Your ChatGPT session has expired. Please connect your ChatGPT account again.',
            error instanceof Error ? error : undefined,
          )
        }
        throw new LLMAPIKeyInvalidException(
          'ChatGPT token refresh failed. Please try again.',
          error instanceof Error ? error : undefined,
        )
      } finally {
        inFlightRefreshes.delete(providerId)
      }
    })()
    inFlightRefreshes.set(providerId, refresh)
    return refresh
  }

  private normalizeRequest<
    T extends LLMRequestNonStreaming | LLMRequestStreaming,
  >(model: Extract<ChatModel, { providerType: 'openai-plan' }>, request: T): T {
    const reasoningEffort = model.reasoning?.reasoning_effort
    const reasoningSummary = model.reasoning?.reasoning_summary
    return {
      ...request,
      reasoning_effort: reasoningEffort
        ? (reasoningEffort as ReasoningEffort)
        : undefined,
      reasoning_summary: reasoningSummary
        ? (reasoningSummary as Reasoning['summary'])
        : undefined,
    }
  }
}

async function* mapStreamErrors<T>(stream: AsyncIterable<T>) {
  try {
    yield* stream
  } catch (error) {
    throw describePlanUsageError(error)
  }
}

// https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
const PLAN_USAGE_ERROR_MESSAGES: Record<string, string> = {
  subscription_sharing_user_not_eligible:
    'ChatGPT plan usage is not available for this account or workspace.',
  subscription_sharing_usage_limit_exceeded: `ChatGPT plan usage limit reached. Check ${CODEX_USAGE_URL}`,
  subscription_sharing_usage_unavailable:
    'ChatGPT plan usage could not be checked. Please try again later.',
  subscription_sharing_unsupported_capability:
    'This request uses a feature that ChatGPT plan usage does not support',
  subscription_sharing_invalid_user:
    'ChatGPT could not validate your account. Please connect your ChatGPT account again.',
  subscription_sharing_user_unavailable:
    'ChatGPT account information is temporarily unavailable. Please try again later.',
}

function describePlanUsageError(error: unknown): unknown {
  if (
    !(error instanceof HttpRequestError || error instanceof ResponseStreamError)
  ) {
    return error
  }
  const message = error.code && PLAN_USAGE_ERROR_MESSAGES[error.code]
  if (!message) return error
  const details = [
    error.param && `param: ${error.param}`,
    error instanceof HttpRequestError &&
      error.requestId &&
      `request id: ${error.requestId}`,
  ].filter(Boolean)
  return new Error(
    details.length ? `${message} (${details.join(', ')})` : message,
  )
}
