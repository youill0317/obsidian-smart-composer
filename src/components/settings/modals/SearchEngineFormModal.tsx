import { App } from 'obsidian'
import { useState } from 'react'

import { TavilySearchDepth } from '../../../types/search.types'
import SmartComposerPlugin from '../../../main'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ReactModal } from '../../common/ReactModal'

export type SearchEngineType = 'tavily' | 'perplexity'

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
        const title = engineType === 'tavily' ? 'Tavily Settings' : 'Perplexity Settings'
        super({
            app: app,
            Component: SearchEngineFormComponent,
            props: { plugin, engineType },
            options: {
                title,
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
                        },
                    },
                },
            })
        } else {
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
                </>
            )}

            <ObsidianSetting>
                <ObsidianButton text="Save" onClick={handleSubmit} cta />
                <ObsidianButton text="Cancel" onClick={onClose} />
            </ObsidianSetting>
        </>
    )
}
