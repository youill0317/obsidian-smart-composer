import { Annotation } from '../../types/llm/response'
import { fetchUrlTitle } from '../fetch-utils'

const MAX_AUTO_TITLE_REQUESTS = 10
const MAX_TITLE_CACHE_ENTRIES = 256

type CachedUrlTitle =
  | { status: 'pending' }
  | { status: 'fetched'; title: string | null }
  | { status: 'error' }

// global cache for URL titles
const urlTitleCache = new Map<string, CachedUrlTitle>()

// Fetches the titles of the URLs in the annotations
export function fetchAnnotationTitles(
  annotations: Annotation[],
  onFetchUrlTitle: (url: string, title: string | null) => void,
  signal?: AbortSignal,
  requestedUrls = new Set<string>(),
) {
  annotations
    .filter(
      (annotation) =>
        annotation.type === 'url_citation' && !annotation.url_citation.title,
    )
    .forEach((annotation) => {
      const url = annotation.url_citation.url
      if (urlTitleCache.has(url)) {
        const cached = urlTitleCache.get(url)
        if (cached?.status === 'fetched') {
          annotation.url_citation.title = cached.title ?? undefined
        }
      } else {
        if (
          requestedUrls.has(url) ||
          requestedUrls.size >= MAX_AUTO_TITLE_REQUESTS
        ) {
          return
        }
        requestedUrls.add(url)
        setCachedTitle(url, { status: 'pending' })
        fetchUrlTitle(url, signal)
          .then((title) => {
            setCachedTitle(url, { status: 'fetched', title })
            onFetchUrlTitle(url, title)
          })
          .catch(() => {
            setCachedTitle(url, { status: 'error' })
          })
      }
    })
}

function setCachedTitle(url: string, value: CachedUrlTitle): void {
  if (
    !urlTitleCache.has(url) &&
    urlTitleCache.size >= MAX_TITLE_CACHE_ENTRIES
  ) {
    const oldest = urlTitleCache.keys().next()
    if (!oldest.done) urlTitleCache.delete(oldest.value)
  }
  urlTitleCache.set(url, value)
}
