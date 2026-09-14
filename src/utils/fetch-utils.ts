import type { IncomingHttpHeaders, IncomingMessage } from 'http'

import { Platform } from 'obsidian'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 1024 * 1024
const MAX_REDIRECTS = 5
export const MAX_URL_ATTACHMENTS = 10
export const MAX_TOTAL_URL_CONTENT_BYTES = 5 * 1024 * 1024
const MAX_URL_TITLE_LENGTH = 512
let nonPublicIpv4BlockList: import('net').BlockList | undefined
let nonPublicIpv6BlockList: import('net').BlockList | undefined

export type BoundedTextResponse = {
  status: number
  headers: IncomingHttpHeaders
  text: string
  url: string
}

type PublicTextRequestOptions = {
  method?: 'GET' | 'HEAD'
  headers?: Record<string, string>
  maxBytes?: number
  timeoutMs?: number
  signal?: AbortSignal
  truncate?: boolean
}

type BoundedFetchOptions = {
  maxBytes: number
  timeoutMs?: number
  signal?: AbortSignal
}

export class ResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(
      `The remote response exceeds the ${formatBytes(maxBytes)} safety limit.`,
    )
  }
}

export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The remote request timed out after ${timeoutMs} ms.`)
  }
}

export class UnsafeUrlError extends Error {
  constructor() {
    super(
      'This URL is blocked because it does not resolve to a public address.',
    )
  }
}

/** Fetches an untrusted public URL without buffering an unbounded response. */
export async function fetchPublicText(
  input: string,
  options: PublicTextRequestOptions = {},
): Promise<BoundedTextResponse> {
  if (!Platform.isDesktop) {
    throw new Error(
      'Web URL attachments are available in Obsidian desktop only. Remove the attachment or paste its content instead.',
    )
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const abortScope = createAbortScope(options.signal, timeoutMs)

  try {
    let url = parseHttpUrl(input)
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const address = await resolvePublicAddress(url.hostname, abortScope)
      const response = await requestPublicUrl(
        url,
        address,
        options.method ?? 'GET',
        options.headers,
        abortScope,
      )
      const status = response.statusCode ?? 0
      const location = getHeader(response.headers, 'location')

      if (isRedirect(status) && location) {
        response.destroy()
        if (redirects === MAX_REDIRECTS) {
          throw new Error('The remote URL redirected too many times.')
        }
        url = parseHttpUrl(new URL(location, url).toString())
        continue
      }

      const contentEncoding = getHeader(response.headers, 'content-encoding')
      if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
        response.destroy()
        throw new Error(
          'The remote server returned unsupported compressed content.',
        )
      }
      const text =
        options.method === 'HEAD'
          ? (response.destroy(), '')
          : await readNodeText(
              response,
              maxBytes,
              abortScope,
              options.truncate ?? false,
            )
      return { status, headers: response.headers, text, url: url.toString() }
    }
    throw new Error('The remote URL redirected too many times.')
  } finally {
    abortScope.cleanup()
  }
}

/** Fetches a configured endpoint with a deadline and streaming body limit. */
export async function fetchBoundedText(
  input: RequestInfo | URL,
  init: RequestInit,
  options: BoundedFetchOptions,
): Promise<{ response: Response; text: string }> {
  const abortScope = createAbortScope(
    options.signal,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  try {
    if (abortScope.signal.aborted) throw abortScope.error()
    const response = await fetch(input, { ...init, signal: abortScope.signal })
    const text = await readWebText(response, options.maxBytes, abortScope)
    return { response, text }
  } catch (error) {
    if (abortScope.signal.aborted) throw abortScope.error()
    throw error
  } finally {
    abortScope.cleanup()
  }
}

export async function fetchUrlTitle(
  url: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetchPublicText(url, {
      headers: { Range: 'bytes=0-65535' },
      maxBytes: 64 * 1024,
      signal,
      truncate: true,
    })
    const contentType = getHeader(response.headers, 'content-type')
    if (response.status < 200 || response.status >= 300) return null
    if (contentType && !contentType.toLowerCase().includes('text/html'))
      return null
    return (
      response.text
        .match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
        .trim()
        .slice(0, MAX_URL_TITLE_LENGTH) ?? null
    )
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw error
    console.warn(`Failed to fetch title for ${url}:`, error)
    return null
  }
}

export function isPublicIpAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '')
  if (normalized.includes('%')) return false

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const net = require('net') as typeof import('net')
  const family = net.isIP(normalized)
  if (!family) return false
  const [ipv4BlockList, ipv6BlockList] = getNonPublicAddressBlockLists(net)
  return family === 4
    ? !ipv4BlockList.check(normalized, 'ipv4')
    : !ipv6BlockList.check(normalized, 'ipv6')
}

function getNonPublicAddressBlockLists(
  net: typeof import('net'),
): [import('net').BlockList, import('net').BlockList] {
  if (nonPublicIpv4BlockList && nonPublicIpv6BlockList) {
    return [nonPublicIpv4BlockList, nonPublicIpv6BlockList]
  }
  const ipv4BlockList = new net.BlockList()
  const ipv6BlockList = new net.BlockList()
  const ipv4Subnets: [string, number][] = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ]
  const ipv6Subnets: [string, number][] = [
    ['::', 3],
    ['4000::', 2],
    ['8000::', 1],
    ['2001::', 32],
    ['2001:2::', 48],
    ['2001:10::', 28],
    ['2001:20::', 28],
    ['2001:db8::', 32],
    ['2002::', 16],
  ]
  ipv4Subnets.forEach(([network, prefix]) =>
    ipv4BlockList.addSubnet(network, prefix, 'ipv4'),
  )
  ipv6Subnets.forEach(([network, prefix]) =>
    ipv6BlockList.addSubnet(network, prefix, 'ipv6'),
  )
  nonPublicIpv4BlockList = ipv4BlockList
  nonPublicIpv6BlockList = ipv6BlockList
  return [ipv4BlockList, ipv6BlockList]
}

type AbortScope = {
  signal: AbortSignal
  error: () => Error
  cleanup: () => void
}

function createAbortScope(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortScope {
  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = () => controller.abort()
  if (parentSignal?.aborted) controller.abort()
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  return {
    signal: controller.signal,
    error: () =>
      timedOut
        ? new RequestTimeoutError(timeoutMs)
        : new DOMException('The operation was aborted.', 'AbortError'),
    cleanup: () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', abortFromParent)
    },
  }
}

async function resolvePublicAddress(
  hostname: string,
  abortScope: AbortScope,
): Promise<{ address: string; family: number }> {
  const normalized = hostname.replace(/^\[|\]$/g, '')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isIP } = require('net') as typeof import('net')
  const family = isIP(normalized)
  if (family) {
    if (!isPublicIpAddress(normalized)) throw new UnsafeUrlError()
    return { address: normalized, family }
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dns = require('dns') as typeof import('dns')
  const addresses = await raceAbort(
    dns.promises.lookup(normalized, { all: true, verbatim: true }),
    abortScope,
  )
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIpAddress(address))
  ) {
    throw new UnsafeUrlError()
  }
  return addresses[0]
}

function requestPublicUrl(
  url: URL,
  address: { address: string; family: number },
  method: 'GET' | 'HEAD',
  headers: Record<string, string> | undefined,
  abortScope: AbortScope,
): Promise<IncomingMessage> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('http') as typeof import('http')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const https = require('https') as typeof import('https')
  const client = url.protocol === 'https:' ? https : http
  const requestHeaders = { ...(headers ?? {}) }
  if (
    !Object.keys(requestHeaders).some(
      (header) => header.toLowerCase() === 'user-agent',
    ) &&
    typeof navigator !== 'undefined'
  ) {
    requestHeaders['User-Agent'] = navigator.userAgent
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const request = client.request(
      {
        protocol: url.protocol,
        hostname: address.address,
        family: address.family,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          ...requestHeaders,
          Host: url.host,
          'Accept-Encoding': 'identity',
        },
        servername: url.hostname.replace(/^\[|\]$/g, ''),
      },
      (response) => {
        settled = true
        abortScope.signal.removeEventListener('abort', abortRequest)
        resolve(response)
      },
    )
    const abortRequest = () => request.destroy(abortScope.error())
    request.once('error', (error) => {
      abortScope.signal.removeEventListener('abort', abortRequest)
      if (!settled) reject(error)
    })
    if (abortScope.signal.aborted) abortRequest()
    else
      abortScope.signal.addEventListener('abort', abortRequest, { once: true })
    request.end()
  })
}

function readNodeText(
  response: IncomingMessage,
  maxBytes: number,
  abortScope: AbortScope,
  truncate: boolean,
): Promise<string> {
  const contentLength = Number(getHeader(response.headers, 'content-length'))
  if (!truncate && Number.isFinite(contentLength) && contentLength > maxBytes) {
    response.destroy()
    return Promise.reject(new ResponseTooLargeError(maxBytes))
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let byteLength = 0
    let settled = false
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      abortScope.signal.removeEventListener('abort', abortResponse)
      action()
    }
    const abortResponse = () => {
      const error = abortScope.error()
      response.destroy(error)
      finish(() => reject(error))
    }

    response.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      byteLength += buffer.length
      if (truncate && byteLength >= maxBytes) {
        chunks.push(buffer.subarray(0, buffer.length - (byteLength - maxBytes)))
        response.destroy()
        finish(() => resolve(Buffer.concat(chunks).toString('utf8')))
        return
      }
      if (byteLength > maxBytes) {
        const error = new ResponseTooLargeError(maxBytes)
        response.destroy(error)
        finish(() => reject(error))
      } else {
        chunks.push(buffer)
      }
    })
    response.once('end', () =>
      finish(() => resolve(Buffer.concat(chunks).toString('utf8'))),
    )
    response.once('error', (error) => finish(() => reject(error)))
    if (abortScope.signal.aborted) abortResponse()
    else
      abortScope.signal.addEventListener('abort', abortResponse, { once: true })
  })
}

async function readWebText(
  response: Response,
  maxBytes: number,
  abortScope: AbortScope,
): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel()
    throw new ResponseTooLargeError(maxBytes)
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  const abortRead = () => void reader.cancel(abortScope.error())
  abortScope.signal.addEventListener('abort', abortRead, { once: true })
  try {
    for (;;) {
      if (abortScope.signal.aborted) throw abortScope.error()
      const { done, value } = await reader.read()
      if (abortScope.signal.aborted) throw abortScope.error()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maxBytes) {
        await reader.cancel()
        throw new ResponseTooLargeError(maxBytes)
      }
      chunks.push(value)
    }
  } finally {
    abortScope.signal.removeEventListener('abort', abortRead)
  }
  const body = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

function raceAbort<T>(promise: Promise<T>, abortScope: AbortScope): Promise<T> {
  if (abortScope.signal.aborted) return Promise.reject(abortScope.error())
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortScope.error())
    abortScope.signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        abortScope.signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error) => {
        abortScope.signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

function parseHttpUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('The URL is invalid.')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('Only public HTTP and HTTPS URLs are supported.')
  }
  return url
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status)
}

function getHeader(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

function formatBytes(bytes: number): string {
  return bytes % (1024 * 1024) === 0
    ? `${bytes / (1024 * 1024)} MB`
    : `${Math.ceil(bytes / 1024)} KB`
}
