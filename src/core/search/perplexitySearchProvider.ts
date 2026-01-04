import { requestUrl } from 'obsidian'

import {
    PerplexitySearchOptions,
    SearchProvider,
    SearchResult,
} from '../../types/search.types'

const REQUEST_TIMEOUT_MS = 30000 // 30 seconds

const timeout = (ms: number): Promise<never> =>
    new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), ms),
    )

interface PerplexitySearchResponse {
    results: Array<{
        title: string
        url: string
        snippet: string
    }>
}

export class PerplexitySearchProvider implements SearchProvider {
    private apiKey: string
    private options: PerplexitySearchOptions

    constructor(apiKey: string, options: PerplexitySearchOptions) {
        this.apiKey = apiKey
        this.options = options
    }

    async search(query: string): Promise<SearchResult[]> {
        if (!this.apiKey) {
            throw new Error('Perplexity API key is not set')
        }

        const response = await Promise.race([
            requestUrl({
                url: 'https://api.perplexity.ai/search',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    query,
                    max_results: this.options.maxResults,
                    max_tokens: this.options.maxTokens,
                    max_tokens_per_page: this.options.maxTokensPerPage,
                    ...(this.options.searchAfterDate && {
                        search_after_date: this.options.searchAfterDate,
                    }),
                }),
            }),
            timeout(REQUEST_TIMEOUT_MS),
        ])

        if (response.status !== 200) {
            throw new Error(`Perplexity API error: ${response.status}`)
        }

        const data: PerplexitySearchResponse = response.json

        return data.results.map((result) => ({
            title: result.title,
            url: result.url,
            content: result.snippet,
            source: 'perplexity' as const,
        }))
    }
}
