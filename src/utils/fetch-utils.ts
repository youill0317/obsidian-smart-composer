import { RequestUrlParam, RequestUrlResponse, requestUrl } from 'obsidian'

export const MAX_FETCHED_TEXT_LENGTH = 500_000
const REQUEST_TIMEOUT_MS = 30_000

const isPrivateIPv4 = (host: string) => {
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p)))
    return false
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

// URLs from user mentions and model output must not reach the local machine
// or private network through the plugin.
// ponytail: checks the literal host only; a public name that resolves or
// redirects to a private address still passes. Resolve via dns on desktop if
// that matters.
export function isPublicHttpUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  // URL normalizes numeric IPv4 forms (e.g. 2130706433) to dotted quads.
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (host.startsWith('[')) return false // IPv6 literals
  if (!host.includes('.')) return false // localhost and intranet names
  if (/\.(localhost|local|internal|home\.arpa)$/.test(host)) return false
  return !isPrivateIPv4(host)
}

export async function requestPublicUrl(
  request: RequestUrlParam,
): Promise<RequestUrlResponse> {
  if (!isPublicHttpUrl(request.url)) {
    throw new Error(`Refusing to fetch non-public URL: ${request.url}`)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // ponytail: requestUrl cannot be aborted, so the timeout only stops waiting.
    return await Promise.race([
      requestUrl(request),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Request timed out: ${request.url}`)),
          REQUEST_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchUrlTitle(url: string): Promise<string | null> {
  try {
    const headResponse = await requestPublicUrl({
      url,
      method: 'HEAD',
    })

    const contentType = headResponse.headers['content-type']
    if (!contentType?.includes('text/html')) {
      return null
    }

    const rangeSizes: (number | null)[] = [8192, 16384, 32768, null] // null is the full page
    let title: string | null = null

    for (const range of rangeSizes) {
      const response = await requestPublicUrl({
        url,
        method: 'GET',
        headers: range
          ? {
              Range: `bytes=0-${range}`,
            }
          : undefined,
      })

      const titleMatch = response.text
        .slice(0, MAX_FETCHED_TEXT_LENGTH)
        .match(/<title[^>]*>([^<]+)<\/title>/i)
      if (titleMatch) {
        title = titleMatch[1].trim()
        break
      }
    }

    return title
  } catch (error) {
    console.warn(`Failed to fetch title for ${url}:`, error)
    return null
  }
}
