// Search result from web search APIs
export interface SearchResult {
    title: string
    url: string
    content: string // snippet
    source: 'tavily' | 'perplexity'
    score?: number
}

// Tavily search depth options
export type TavilySearchDepth = 'basic' | 'advanced' | 'fast' | 'ultra-fast'

// Tavily provider options
export interface TavilyOptions {
    searchDepth: TavilySearchDepth
    maxResults: number
    chunksPerSource: number // Only used when searchDepth is 'advanced'
}

// Perplexity provider options
export interface PerplexitySearchOptions {
    maxResults: number
    maxTokens: number
    maxTokensPerPage: number
}

// Search engine configuration in settings
export interface TavilyConfig {
    apiKey: string
    enabled: boolean
    options: TavilyOptions
}

export interface PerplexitySearchConfig {
    apiKey: string
    enabled: boolean
    options: PerplexitySearchOptions
}

export interface SearchEnginesConfig {
    tavily: TavilyConfig
    perplexity: PerplexitySearchConfig
}

// Default values
export const DEFAULT_TAVILY_OPTIONS: TavilyOptions = {
    searchDepth: 'basic',
    maxResults: 5,
    chunksPerSource: 3,
}

export const DEFAULT_PERPLEXITY_OPTIONS: PerplexitySearchOptions = {
    maxResults: 10,
    maxTokens: 25000,
    maxTokensPerPage: 1000,
}

export const DEFAULT_SEARCH_ENGINES_CONFIG: SearchEnginesConfig = {
    tavily: {
        apiKey: '',
        enabled: false,
        options: DEFAULT_TAVILY_OPTIONS,
    },
    perplexity: {
        apiKey: '',
        enabled: false,
        options: DEFAULT_PERPLEXITY_OPTIONS,
    },
}

// Common search provider interface
export interface SearchProvider {
    search(query: string): Promise<SearchResult[]>
}
