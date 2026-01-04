// Search result from web search APIs
export interface SearchResult {
    title: string
    url: string
    content: string // snippet
    source: 'tavily' | 'perplexity' | 'brave'
    score?: number
}

// Tavily search depth options
export type TavilySearchDepth = 'basic' | 'advanced' | 'fast' | 'ultra-fast'

// Tavily provider options
export interface TavilyOptions {
    searchDepth: TavilySearchDepth
    maxResults: number
    chunksPerSource: number // Only used when searchDepth is 'advanced'
    startDate?: string // Date filter in YYYY-MM-DD format
}

// Perplexity provider options
export interface PerplexitySearchOptions {
    maxResults: number
    maxTokens: number
    maxTokensPerPage: number
    searchAfterDate?: string // Date filter in YYYY-MM-DD format
}

// Brave freshness options: 'pd' (24h), 'pw' (7d), 'pm' (31d), 'py' (365d), or 'YYYY-MM-DDtoYYYY-MM-DD'
export type BraveFreshness = 'pd' | 'pw' | 'pm' | 'py' | string

// Brave Search provider options
export interface BraveSearchOptions {
    count: number // Number of results (1-20, default: 10)
    country?: string // 2-letter country code (e.g., 'US', 'KR')
    searchLang?: string // Search language (e.g., 'en', 'ko')
    uiLang?: string // UI language (e.g., 'en-US', 'ko-KR')
    freshness?: BraveFreshness // Time filter for results
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

export interface BraveConfig {
    apiKey: string
    enabled: boolean
    options: BraveSearchOptions
}

export interface SearchEnginesConfig {
    tavily: TavilyConfig
    perplexity: PerplexitySearchConfig
    brave: BraveConfig
}

// Default values
export const DEFAULT_TAVILY_OPTIONS: TavilyOptions = {
    searchDepth: 'basic',
    maxResults: 5,
    chunksPerSource: 3,
    startDate: undefined,
}

export const DEFAULT_PERPLEXITY_OPTIONS: PerplexitySearchOptions = {
    maxResults: 10,
    maxTokens: 25000,
    maxTokensPerPage: 1000,
    searchAfterDate: undefined,
}

export const DEFAULT_BRAVE_OPTIONS: BraveSearchOptions = {
    count: 10,
    country: undefined,
    searchLang: 'en',
    uiLang: 'en-US',
    freshness: undefined,
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
    brave: {
        apiKey: '',
        enabled: false,
        options: DEFAULT_BRAVE_OPTIONS,
    },
}

// Common search provider interface
export interface SearchProvider {
    search(query: string): Promise<SearchResult[]>
}
