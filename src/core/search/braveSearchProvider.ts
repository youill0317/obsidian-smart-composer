import { requestUrl } from 'obsidian'

import {
    BraveSearchOptions,
    SearchProvider,
    SearchResult,
} from '../../types/search.types'

const REQUEST_TIMEOUT_MS = 30000 // 30 seconds

const timeout = (ms: number): Promise<never> =>
    new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), ms),
    )

interface BraveSearchResponse {
    web?: {
        results: Array<{
            title: string
            url: string
            description: string
        }>
    }
}

export class BraveSearchProvider implements SearchProvider {
    private apiKey: string
    private options: BraveSearchOptions

    constructor(apiKey: string, options: BraveSearchOptions) {
        this.apiKey = apiKey
        this.options = options
    }

    async search(query: string): Promise<SearchResult[]> {
        if (!this.apiKey) {
            throw new Error('Brave Search API key is not set')
        }

        // Build query parameters
        const params = new URLSearchParams()
        params.set('q', query)
        params.set('count', this.options.count.toString())

        if (this.options.country) {
            params.set('country', this.options.country)
        }
        if (this.options.searchLang) {
            params.set('search_lang', this.options.searchLang)
        }
        if (this.options.uiLang) {
            params.set('ui_lang', this.options.uiLang)
        }
        if (this.options.freshness) {
            params.set('freshness', this.options.freshness)
        }

        const response = await Promise.race([
            requestUrl({
                url: `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'X-Subscription-Token': this.apiKey,
                },
            }),
            timeout(REQUEST_TIMEOUT_MS),
        ])

        if (response.status !== 200) {
            const errorDetail = response.json?.error?.message || response.json?.message || ''
            throw new Error(`Brave Search API error (${response.status})${errorDetail ? `: ${errorDetail}` : ''}`)
        }

        const data: BraveSearchResponse = response.json

        if (!data.web?.results) {
            return []
        }

        return data.web.results.map((result) => ({
            title: result.title,
            url: result.url,
            content: result.description,
            source: 'brave' as const,
        }))
    }
}
