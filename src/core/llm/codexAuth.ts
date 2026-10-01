import type { Server } from 'http'

import { Platform, requestUrl } from 'obsidian'

import {
  CODEX_AGENT_NAME,
  CODEX_DYNAMIC_CLIENT_ID,
  CODEX_ISSUER,
  CODEX_PLAN_USAGE_SCOPE,
  CODEX_REDIRECT_URI,
  CODEX_RESOURCE,
} from '../../constants'

type CodexPkceCodes = {
  verifier: string
  challenge: string
}

export type CodexTokenResponse = {
  id_token: string
  access_token: string
  refresh_token: string
  expires_in?: number
  scope?: string
}

export type CodexCallbackResult = {
  code: string
  clientId?: string
}

type CodexIdTokenClaims = {
  iss?: string
  aud?: string | string[]
  sub?: string
  exp?: number
  nonce?: string
}

type CodexCallbackConfig = {
  hostname: string
  port: number
  path: string
  origin: string
}

type OpenIdConfiguration = {
  jwks_uri: string
  revocation_endpoint?: string
}

type Jwk = JsonWebKey & { kid?: string; alg?: string }

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

let codexCallbackServer: Server | undefined
let openIdConfiguration: Promise<OpenIdConfiguration> | undefined

export class CodexOAuthError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
    this.name = 'CodexOAuthError'
  }
}

// Refresh errors that mean the stored token set can never be used again.
const TERMINAL_REFRESH_ERRORS = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
])

export function isTerminalCodexRefreshError(error: unknown): boolean {
  return (
    error instanceof CodexOAuthError &&
    !!error.code &&
    TERMINAL_REFRESH_ERRORS.has(error.code)
  )
}

export function hasCodexPlanUsageScope(scopes: string[] | undefined) {
  return !!scopes?.includes(CODEX_PLAN_USAGE_SCOPE)
}

export function buildCodexAuthorizeUrl(params: {
  redirectUri?: string
  pkce: CodexPkceCodes
  state: string
  nonce: string
  hostId: string
  // Issued client id for reauthorization; omit for first-time registration.
  clientId?: string
  idTokenHint?: string
  forceConsent?: boolean
}): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: params.clientId ?? CODEX_DYNAMIC_CLIENT_ID,
    redirect_uri: params.redirectUri ?? CODEX_REDIRECT_URI,
    scope: `openid profile email offline_access resource.invoke ${CODEX_PLAN_USAGE_SCOPE}`,
    resource: CODEX_RESOURCE,
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.pkce.challenge,
    code_challenge_method: 'S256',
    ext_agent_host_id: params.hostId,
  })
  if (!params.clientId) query.set('agent_name_hint', CODEX_AGENT_NAME)
  if (params.idTokenHint) query.set('id_token_hint', params.idTokenHint)
  if (params.forceConsent) query.set('prompt', 'consent')
  return `${CODEX_ISSUER}/api/accounts/authorize?${query.toString()}`
}

export function generateCodexState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

export async function generateCodexPkce(): Promise<CodexPkceCodes> {
  const verifier = generateRandomString(43)
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const challenge = base64UrlEncode(hash)
  return { verifier, challenge }
}

// auth.openai.com does not send CORS headers to app://obsidian.md, so OAuth
// requests go through requestUrl instead of fetch.
async function postTokenEndpoint(
  body: Record<string, string>,
): Promise<CodexTokenResponse> {
  const response = await requestUrl({
    url: `${CODEX_ISSUER}/api/accounts/oauth/token`,
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    body: new URLSearchParams({ ...body, resource: CODEX_RESOURCE }).toString(),
    throw: false,
  })
  if (response.status >= 400) {
    let code: string | undefined
    try {
      const parsed = JSON.parse(response.text) as {
        error?: string | { code?: string }
      }
      code =
        typeof parsed.error === 'string' ? parsed.error : parsed.error?.code
    } catch {
      // Non-JSON error body.
    }
    throw new CodexOAuthError(
      `ChatGPT token request failed: ${response.status}${code ? ` ${code}` : ''}`,
      response.status,
      code,
    )
  }
  return response.json as CodexTokenResponse
}

export async function exchangeCodexCodeForTokens(params: {
  code: string
  redirectUri?: string
  pkceVerifier: string
  clientId: string
}): Promise<CodexTokenResponse> {
  return postTokenEndpoint({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri ?? CODEX_REDIRECT_URI,
    client_id: params.clientId,
    code_verifier: params.pkceVerifier,
  })
}

export async function refreshCodexAccessToken(
  refreshToken: string,
  clientId: string,
): Promise<CodexTokenResponse> {
  return postTokenEndpoint({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  })
}

function getOpenIdConfiguration(): Promise<OpenIdConfiguration> {
  openIdConfiguration ??= requestUrl({
    url: `${CODEX_ISSUER}/.well-known/openid-configuration`,
    throw: false,
  }).then((response) => {
    if (response.status >= 400) {
      throw new Error(`OpenID configuration request failed: ${response.status}`)
    }
    return response.json as OpenIdConfiguration
  })
  openIdConfiguration.catch(() => {
    openIdConfiguration = undefined
  })
  return openIdConfiguration
}

/**
 * Verifies the ID token signature against OpenAI's JWKS and checks the
 * issuer, audience, expiry and nonce. Returns the verified identity.
 */
export async function verifyCodexIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string },
): Promise<{ subject: string }> {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('Malformed ID token')
  const header = JSON.parse(decodeBase64Url(parts[0])) as {
    alg?: string
    kid?: string
  }
  const claims = JSON.parse(decodeBase64Url(parts[1])) as CodexIdTokenClaims

  const { jwks_uri } = await getOpenIdConfiguration()
  const jwksResponse = await requestUrl({ url: jwks_uri, throw: false })
  if (jwksResponse.status >= 400) {
    throw new Error(`JWKS request failed: ${jwksResponse.status}`)
  }
  const { keys } = jwksResponse.json as { keys: Jwk[] }
  const jwk = keys.find((key) => key.kid === header.kid)
  if (!jwk) throw new Error('ID token signing key not found')

  const alg = header.alg
  if (alg !== 'RS256' && alg !== 'ES256') {
    throw new Error(`Unsupported ID token algorithm: ${String(alg)}`)
  }
  const importParams =
    alg === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: 'P-256' }
  const verifyParams =
    alg === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5' }
      : { name: 'ECDSA', hash: 'SHA-256' }
  const key = await crypto.subtle.importKey('jwk', jwk, importParams, false, [
    'verify',
  ])
  const valid = await crypto.subtle.verify(
    verifyParams,
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  )
  if (!valid) throw new Error('Invalid ID token signature')

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (claims.iss !== CODEX_ISSUER) throw new Error('Invalid ID token issuer')
  if (!audiences.includes(expected.clientId)) {
    throw new Error('Invalid ID token audience')
  }
  if (!claims.exp || claims.exp * 1000 <= Date.now()) {
    throw new Error('ID token expired')
  }
  if (claims.nonce !== expected.nonce) throw new Error('Invalid ID token nonce')
  if (!claims.sub) throw new Error('ID token has no subject')
  return { subject: claims.sub }
}

export async function revokeCodexRefreshToken(
  refreshToken: string,
  clientId: string,
): Promise<void> {
  const { revocation_endpoint } = await getOpenIdConfiguration()
  if (!revocation_endpoint) throw new Error('No revocation endpoint')
  const response = await requestUrl({
    url: revocation_endpoint,
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    body: new URLSearchParams({
      token: refreshToken,
      token_type_hint: 'refresh_token',
      client_id: clientId,
    }).toString(),
    throw: false,
  })
  if (response.status >= 400) {
    throw new Error(`Token revocation failed: ${response.status}`)
  }
}

export async function startCodexCallbackServer(params: {
  state: string
  redirectUri?: string
  timeoutMs?: number
}): Promise<CodexCallbackResult> {
  if (!Platform.isDesktop) {
    throw new Error('Codex callback server is not supported on mobile')
  }

  const { state, redirectUri, timeoutMs } = params
  const { hostname, port, path, origin } = parseCodexRedirectUri(redirectUri)

  await stopCodexCallbackServer()

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('http') as typeof import('http')

  return new Promise((resolve, reject) => {
    let finalized = false
    const timeout = setTimeout(() => {
      finalize(
        new Error('OAuth callback timeout - authorization took too long'),
      )
    }, timeoutMs ?? CALLBACK_TIMEOUT_MS)

    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url ?? '/', origin)

      if (requestUrl.pathname !== path) {
        res.statusCode = 404
        res.end('Not found')
        return
      }

      const code = requestUrl.searchParams.get('code')
      const incomingState = requestUrl.searchParams.get('state')
      const error = requestUrl.searchParams.get('error')
      const errorDescription = requestUrl.searchParams.get('error_description')

      // Keep waiting: any local page can hit this port, and a stray request
      // must not cancel the real redirect.
      if (incomingState !== state) {
        res.statusCode = 400
        res.end('Invalid state parameter')
        return
      }

      if (error) {
        const errorMsg = errorDescription ?? error
        res.statusCode = 400
        res.end(`OAuth error: ${errorMsg}`)
        finalize(new Error(errorMsg))
        return
      }

      if (!code) {
        res.statusCode = 400
        res.end('Missing authorization code')
        finalize(new Error('Missing authorization code'))
        return
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html')
      res.end(
        '<!doctype html><html><head><title>Authorization Successful</title></head><body><p>You can close this window.</p><script>setTimeout(() => window.close(), 2000)</script></body></html>',
      )
      finalize(undefined, {
        code,
        clientId: requestUrl.searchParams.get('client_id') ?? undefined,
      })
    })

    const finalize = (error?: Error, result?: CodexCallbackResult) => {
      if (finalized) return
      finalized = true
      clearTimeout(timeout)
      if (codexCallbackServer === server) codexCallbackServer = undefined
      // Other HTTP connections must not delay the OAuth result.
      server.close()
      if (error) {
        reject(error)
      } else if (result) {
        resolve(result)
      } else {
        reject(new Error('OAuth callback failed'))
      }
    }

    server.on('error', (error) => {
      finalize(
        error instanceof Error
          ? error
          : new Error('OAuth callback server error'),
      )
    })

    server.listen(port, hostname, () => {
      codexCallbackServer = server
    })
  })
}

export async function stopCodexCallbackServer(): Promise<void> {
  if (!codexCallbackServer) return
  await new Promise<void>((resolve) => {
    codexCallbackServer?.close(() => resolve())
  })
  codexCallbackServer = undefined
}

function generateRandomString(length: number): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('')
}

function parseCodexRedirectUri(redirectUri?: string): CodexCallbackConfig {
  const url = new URL(redirectUri ?? CODEX_REDIRECT_URI)
  if (!url.port) {
    throw new Error('Codex redirect URI must include an explicit port')
  }
  const port = Number.parseInt(url.port, 10)
  return {
    hostname: url.hostname,
    port,
    path: url.pathname ?? '/',
    origin: `${url.protocol}//${url.host}`,
  }
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  )
  return atob(padded)
}

function base64UrlToBytes(value: string): Uint8Array {
  return Uint8Array.from(decodeBase64Url(value), (char) => char.charCodeAt(0))
}
