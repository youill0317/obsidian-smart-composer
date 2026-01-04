import { App } from 'obsidian'
import { useState } from 'react'

import { BraveFreshness, TavilySearchDepth } from '../../../types/search.types'
import SmartComposerPlugin from '../../../main'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ReactModal } from '../../common/ReactModal'

export type SearchEngineType = 'tavily' | 'perplexity' | 'brave'

type SearchEngineFormComponentProps = {
    plugin: SmartComposerPlugin
    engineType: SearchEngineType
    onClose: () => void
}

export class EditSearchEngineModal extends ReactModal<SearchEngineFormComponentProps> {
    constructor(
        app: App,
        plugin: SmartComposerPlugin,
        engineType: SearchEngineType,
    ) {
        const titles: Record<SearchEngineType, string> = {
            tavily: 'Tavily Settings',
            perplexity: 'Perplexity Settings',
            brave: 'Brave Search Settings',
        }
        super({
            app: app,
            Component: SearchEngineFormComponent,
            props: { plugin, engineType },
            options: {
                title: titles[engineType],
            },
        })
    }
}

function SearchEngineFormComponent({
    plugin,
    engineType,
    onClose,
}: SearchEngineFormComponentProps) {
    const settings = plugin.settings

    // Tavily-specific state
    const [searchDepth, setSearchDepth] = useState<TavilySearchDepth>(
        engineType === 'tavily' ? settings.searchEngines.tavily.options.searchDepth : 'basic',
    )
    const [tavilyMaxResults, setTavilyMaxResults] = useState(
        engineType === 'tavily' ? settings.searchEngines.tavily.options.maxResults : 5,
    )
    const [chunksPerSource, setChunksPerSource] = useState(
        engineType === 'tavily' ? settings.searchEngines.tavily.options.chunksPerSource : 3,
    )
    const [tavilyStartDate, setTavilyStartDate] = useState(
        engineType === 'tavily' ? settings.searchEngines.tavily.options.startDate || '' : '',
    )

    // Perplexity-specific state
    const [perplexityMaxResults, setPerplexityMaxResults] = useState(
        engineType === 'perplexity' ? settings.searchEngines.perplexity.options.maxResults : 10,
    )
    const [maxTokens, setMaxTokens] = useState(
        engineType === 'perplexity' ? settings.searchEngines.perplexity.options.maxTokens : 25000,
    )
    const [maxTokensPerPage, setMaxTokensPerPage] = useState(
        engineType === 'perplexity' ? settings.searchEngines.perplexity.options.maxTokensPerPage : 1000,
    )
    const [perplexitySearchAfterDate, setPerplexitySearchAfterDate] = useState(
        engineType === 'perplexity' ? settings.searchEngines.perplexity.options.searchAfterDate || '' : '',
    )

    // Brave-specific state
    const [braveCount, setBraveCount] = useState(
        engineType === 'brave' ? settings.searchEngines.brave.options.count : 10,
    )
    const [braveCountry, setBraveCountry] = useState(
        engineType === 'brave' ? settings.searchEngines.brave.options.country || '' : '',
    )
    const [braveSearchLang, setBraveSearchLang] = useState(
        engineType === 'brave' ? settings.searchEngines.brave.options.searchLang || 'en' : 'en',
    )
    const [braveUiLang, setBraveUiLang] = useState(
        engineType === 'brave' ? settings.searchEngines.brave.options.uiLang || 'en-US' : 'en-US',
    )
    const [braveFreshness, setBraveFreshness] = useState<BraveFreshness | ''>(
        engineType === 'brave' ? settings.searchEngines.brave.options.freshness || '' : '',
    )

    const handleSubmit = async () => {
        if (engineType === 'tavily') {
            await plugin.setSettings({
                ...settings,
                searchEngines: {
                    ...settings.searchEngines,
                    tavily: {
                        ...settings.searchEngines.tavily,
                        options: {
                            searchDepth,
                            maxResults: tavilyMaxResults,
                            chunksPerSource,
                            startDate: tavilyStartDate || undefined,
                        },
                    },
                },
            })
        } else if (engineType === 'perplexity') {
            await plugin.setSettings({
                ...settings,
                searchEngines: {
                    ...settings.searchEngines,
                    perplexity: {
                        ...settings.searchEngines.perplexity,
                        options: {
                            maxResults: perplexityMaxResults,
                            maxTokens,
                            maxTokensPerPage,
                            searchAfterDate: perplexitySearchAfterDate || undefined,
                        },
                    },
                },
            })
        } else if (engineType === 'brave') {
            await plugin.setSettings({
                ...settings,
                searchEngines: {
                    ...settings.searchEngines,
                    brave: {
                        ...settings.searchEngines.brave,
                        options: {
                            count: braveCount,
                            country: braveCountry || undefined,
                            searchLang: braveSearchLang || undefined,
                            uiLang: braveUiLang || undefined,
                            freshness: braveFreshness || undefined,
                        },
                    },
                },
            })
        }
        onClose()
    }

    return (
        <>
            {engineType === 'tavily' && (
                <>
                    <ObsidianSetting
                        name="Search Depth"
                        desc="How thorough the search should be."
                    >
                        <ObsidianDropdown
                            value={searchDepth}
                            options={{
                                basic: 'Basic',
                                advanced: 'Advanced',
                                fast: 'Fast',
                                'ultra-fast': 'Ultra Fast',
                            }}
                            onChange={(value: string) =>
                                setSearchDepth(value as TavilySearchDepth)
                            }
                        />
                    </ObsidianSetting>

                    <ObsidianSetting
                        name="Max Results"
                        desc="Maximum number of search results (1-20)."
                    >
                        <ObsidianTextInput
                            value={tavilyMaxResults.toString()}
                            onChange={(value: string) => {
                                const parsed = parseInt(value)
                                if (!isNaN(parsed) && parsed >= 1 && parsed <= 20) {
                                    setTavilyMaxResults(parsed)
                                }
                            }}
                        />
                    </ObsidianSetting>

                    {searchDepth === 'advanced' && (
                        <ObsidianSetting
                            name="Chunks Per Source"
                            desc="Number of content chunks per source (1-10). Only available for advanced search depth."
                        >
                            <ObsidianTextInput
                                value={chunksPerSource.toString()}
                                onChange={(value: string) => {
                                    const parsed = parseInt(value)
                                    if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
                                        setChunksPerSource(parsed)
                                    }
                                }}
                            />
                        </ObsidianSetting>
                    )}

                    <ObsidianSetting
                        name="Start Date"
                        desc="Filter results from this date (YYYY-MM-DD format). Leave empty for no filter."
                    >
                        <ObsidianTextInput
                            value={tavilyStartDate}
                            placeholder="YYYY-MM-DD"
                            onChange={(value: string) => setTavilyStartDate(value)}
                        />
                    </ObsidianSetting>
                </>
            )}

            {engineType === 'perplexity' && (
                <>
                    <ObsidianSetting
                        name="Max Results"
                        desc="Maximum number of search results (1-20)."
                    >
                        <ObsidianTextInput
                            value={perplexityMaxResults.toString()}
                            onChange={(value: string) => {
                                const parsed = parseInt(value)
                                if (!isNaN(parsed) && parsed >= 1 && parsed <= 20) {
                                    setPerplexityMaxResults(parsed)
                                }
                            }}
                        />
                    </ObsidianSetting>

                    <ObsidianSetting
                        name="Max Tokens"
                        desc="Maximum tokens for content retrieval."
                    >
                        <ObsidianTextInput
                            value={maxTokens.toString()}
                            onChange={(value: string) => {
                                const parsed = parseInt(value)
                                if (!isNaN(parsed) && parsed >= 1) {
                                    setMaxTokens(parsed)
                                }
                            }}
                        />
                    </ObsidianSetting>

                    <ObsidianSetting
                        name="Max Tokens Per Page"
                        desc="Maximum tokens per page for content retrieval."
                    >
                        <ObsidianTextInput
                            value={maxTokensPerPage.toString()}
                            onChange={(value: string) => {
                                const parsed = parseInt(value)
                                if (!isNaN(parsed) && parsed >= 1) {
                                    setMaxTokensPerPage(parsed)
                                }
                            }}
                        />
                    </ObsidianSetting>

                    <ObsidianSetting
                        name="Search After Date"
                        desc="Filter results from this date (YYYY-MM-DD format). Leave empty for no filter."
                    >
                        <ObsidianTextInput
                            value={perplexitySearchAfterDate}
                            placeholder="YYYY-MM-DD"
                            onChange={(value: string) => setPerplexitySearchAfterDate(value)}
                        />
                    </ObsidianSetting>
                </>
            )}

            {engineType === 'brave' && (
                <>
                    <ObsidianSetting
                        name="Result Count"
                        desc="Number of search results (1-20)."
                    >
                        <ObsidianTextInput
                            value={braveCount.toString()}
                            onChange={(value: string) => {
                                const parsed = parseInt(value)
                                if (!isNaN(parsed) && parsed >= 1 && parsed <= 20) {
                                    setBraveCount(parsed)
                                }
                            }}
                        />
                    </ObsidianSetting>

                    <ObsidianSetting
                        name="Country"
                        desc="2-letter country code (e.g., US, KR, JP). Leave empty for global."
                    >
                        <ObsidianTextInput
                            value={braveCountry}
                            placeholder="e.g., US"
                            onChange={(value: string) => setBraveCountry(value.toUpperCase().slice(0, 2))}
                        />
                    </ObsidianSetting>

                    <ObsidianSetting
                        name="Search Language"
                        desc="Language code for search results (e.g., en, ko, ja)."
                    >
                        <ObsidianTextInput
                            value={braveSearchLang}
                            placeholder="e.g., en"
                            onChange={(value: string) => setBraveSearchLang(value.toLowerCase())}
                        />
                    </ObsidianSetting>

                    <ObsidianSetting
                        name="UI Language"
                        desc="UI language code (e.g., en-US, ko-KR)."
                    >
                        <ObsidianTextInput
                            value={braveUiLang}
                            placeholder="e.g., en-US"
                            onChange={(value: string) => setBraveUiLang(value)}
                        />
                    </ObsidianSetting>

                    <ObsidianSetting
                        name="Freshness"
                        desc="Filter by when results were discovered."
                    >
                        <ObsidianDropdown
                            value={braveFreshness}
                            options={{
                                '': 'All Time',
                                'pd': 'Past Day (24h)',
                                'pw': 'Past Week (7d)',
                                'pm': 'Past Month (31d)',
                                'py': 'Past Year (365d)',
                            }}
                            onChange={(value: string) =>
                                setBraveFreshness(value as BraveFreshness | '')
                            }
                        />
                    </ObsidianSetting>
                </>
            )}

            <ObsidianSetting>
                <ObsidianButton text="Save" onClick={handleSubmit} cta />
                <ObsidianButton text="Cancel" onClick={onClose} />
            </ObsidianSetting>
        </>
    )
}

