import {
    SearchEnginesConfig,
    SearchResult,
} from '../../types/search.types'

import { BraveSearchProvider } from './braveSearchProvider'
import { PerplexitySearchProvider } from './perplexitySearchProvider'
import { TavilyProvider } from './tavilyProvider'

export class SearchManager {
    private config: SearchEnginesConfig

    constructor(config: SearchEnginesConfig) {
        this.config = config
    }

    updateConfig(config: SearchEnginesConfig) {
        this.config = config
    }

    async search(query: string): Promise<SearchResult[]> {
        const results: SearchResult[] = []
        const errors: string[] = []

        // Run enabled search providers in parallel
        const searchPromises: Promise<SearchResult[]>[] = []

        if (this.config.tavily.enabled && this.config.tavily.apiKey) {
            const tavilyProvider = new TavilyProvider(
                this.config.tavily.apiKey,
                this.config.tavily.options,
            )
            searchPromises.push(
                tavilyProvider.search(query).catch((error) => {
                    errors.push(`Tavily: ${error.message}`)
                    return []
                }),
            )
        }

        if (this.config.perplexity.enabled && this.config.perplexity.apiKey) {
            const perplexityProvider = new PerplexitySearchProvider(
                this.config.perplexity.apiKey,
                this.config.perplexity.options,
            )
            searchPromises.push(
                perplexityProvider.search(query).catch((error) => {
                    errors.push(`Perplexity: ${error.message}`)
                    return []
                }),
            )
        }

        if (this.config.brave.enabled && this.config.brave.apiKey) {
            const braveProvider = new BraveSearchProvider(
                this.config.brave.apiKey,
                this.config.brave.options,
            )
            searchPromises.push(
                braveProvider.search(query).catch((error) => {
                    errors.push(`Brave: ${error.message}`)
                    return []
                }),
            )
        }

        if (searchPromises.length === 0) {
            throw new Error(
                'No search engines enabled. Please enable at least one search engine in settings.',
            )
        }

        const allResults = await Promise.all(searchPromises)
        for (const providerResults of allResults) {
            results.push(...providerResults)
        }

        // Deduplicate by URL
        const uniqueResults = this.deduplicateResults(results)

        if (uniqueResults.length === 0 && errors.length > 0) {
            throw new Error(`Search failed: ${errors.join(', ')}`)
        }

        return uniqueResults
    }

    private deduplicateResults(results: SearchResult[]): SearchResult[] {
        const urlMap = new Map<string, SearchResult>()

        results.forEach((result) => {
            const existing = urlMap.get(result.url)
            if (!existing) {
                urlMap.set(result.url, result)
            } else if (
                result.score !== undefined &&
                (existing.score === undefined || result.score > existing.score)
            ) {
                // Keep the result with the higher score
                urlMap.set(result.url, result)
            }
        })

        // Sort by score (highest first), results without score go to the end
        return Array.from(urlMap.values()).sort((a, b) => {
            if (a.score === undefined && b.score === undefined) return 0
            if (a.score === undefined) return 1
            if (b.score === undefined) return -1
            return b.score - a.score
        })
    }

    hasEnabledEngines(): boolean {
        return (
            (this.config.tavily.enabled && !!this.config.tavily.apiKey) ||
            (this.config.perplexity.enabled && !!this.config.perplexity.apiKey) ||
            (this.config.brave.enabled && !!this.config.brave.apiKey)
        )
    }
}

