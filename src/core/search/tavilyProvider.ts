import { requestUrl } from 'obsidian'

import {
    SearchProvider,
    SearchResult,
    TavilyOptions,
} from '../../types/search.types'

const REQUEST_TIMEOUT_MS = 30000 // 30 seconds

const timeout = (ms: number): Promise<never> =>
    new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), ms),
    )

interface TavilySearchResponse {
    query: string
    results: Array<{
        title: string
        url: string
        content: string
        score: number
    }>
}

export class TavilyProvider implements SearchProvider {
    private apiKey: string
    private options: TavilyOptions

    constructor(apiKey: string, options: TavilyOptions) {
        this.apiKey = apiKey
        this.options = options
    }

    async search(query: string): Promise<SearchResult[]> {
        if (!this.apiKey) {
            throw new Error('Tavily API key is not set')
        }

        const response = await Promise.race([
            requestUrl({
                url: 'https://api.tavily.com/search',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    query,
                    search_depth: this.options.searchDepth,
                    max_results: this.options.maxResults,
                    ...(this.options.searchDepth === 'advanced' && {
                        chunks_per_source: this.options.chunksPerSource,
                    }),
                }),
            }),
            timeout(REQUEST_TIMEOUT_MS),
        ])

        if (response.status !== 200) {
            throw new Error(`Tavily API error: ${response.status}`)
        }

        const data: TavilySearchResponse = response.json

        return data.results.map((result) => ({
            title: result.title,
            url: result.url,
            content: result.content,
            source: 'tavily' as const,
            score: result.score,
        }))
    }
}
