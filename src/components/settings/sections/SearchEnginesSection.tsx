import { Settings } from 'lucide-react'
import { App } from 'obsidian'
import { useState } from 'react'

import { useSettings } from '../../../contexts/settings-context'
import SmartComposerPlugin from '../../../main'
import { ObsidianToggle } from '../../common/ObsidianToggle'
import { EditSearchEngineModal, SearchEngineType } from '../modals/SearchEngineFormModal'

type SearchEnginesSectionProps = {
    app: App
    plugin: SmartComposerPlugin
}

const SEARCH_ENGINE_INFO: Record<SearchEngineType, { name: string; description: string }> = {
    tavily: {
        name: 'Tavily',
        description: 'AI-powered search engine for accurate web results',
    },
    perplexity: {
        name: 'Perplexity',
        description: 'AI search engine with conversational answers',
    },
    brave: {
        name: 'Brave',
        description: 'Privacy-focused web search engine',
    },
}

export function SearchEnginesSection({ app, plugin }: SearchEnginesSectionProps) {
    const { settings, setSettings } = useSettings()

    const searchEngines: SearchEngineType[] = ['perplexity', 'tavily', 'brave']

    // Track which API key input is being edited
    const [editingApiKey, setEditingApiKey] = useState<SearchEngineType | null>(null)

    const handleToggleEnabled = async (engineType: SearchEngineType, enabled: boolean) => {
        await setSettings({
            ...settings,
            searchEngines: {
                ...settings.searchEngines,
                [engineType]: {
                    ...settings.searchEngines[engineType],
                    enabled,
                },
            },
        })
    }

    const handleApiKeyChange = async (engineType: SearchEngineType, apiKey: string) => {
        await setSettings({
            ...settings,
            searchEngines: {
                ...settings.searchEngines,
                [engineType]: {
                    ...settings.searchEngines[engineType],
                    apiKey,
                },
            },
        })
    }

    return (
        <div className="smtcmp-settings-section">
            <div className="smtcmp-settings-header">Search Engines</div>

            <div className="smtcmp-settings-desc">
                <span>Configure search engines for web search functionality</span>
            </div>

            <div className="smtcmp-settings-table-container">
                <table className="smtcmp-settings-table">
                    <colgroup>
                        <col width={120} />
                        <col />
                        <col width={70} />
                        <col width={60} />
                    </colgroup>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>API Key</th>
                            <th>Enabled</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {searchEngines.map((engineType) => {
                            const engineConfig = settings.searchEngines[engineType]
                            const engineInfo = SEARCH_ENGINE_INFO[engineType]

                            return (
                                <tr key={engineType}>
                                    <td>{engineInfo.name}</td>
                                    <td className="smtcmp-settings-table-api-key">
                                        {editingApiKey === engineType ? (
                                            <input
                                                type="text"
                                                className="smtcmp-settings-api-key-input"
                                                defaultValue={engineConfig.apiKey}
                                                placeholder="Enter API Key"
                                                autoFocus
                                                onBlur={(e) => {
                                                    handleApiKeyChange(engineType, e.target.value)
                                                    setEditingApiKey(null)
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        handleApiKeyChange(engineType, e.currentTarget.value)
                                                        setEditingApiKey(null)
                                                    } else if (e.key === 'Escape') {
                                                        setEditingApiKey(null)
                                                    }
                                                }}
                                            />
                                        ) : (
                                            <span
                                                className="smtcmp-settings-api-key-display"
                                                onClick={() => setEditingApiKey(engineType)}
                                            >
                                                {engineConfig.apiKey ? '••••••••' : 'Click to set API key'}
                                            </span>
                                        )}
                                    </td>
                                    <td>
                                        <ObsidianToggle
                                            value={engineConfig.enabled}
                                            onChange={(value) =>
                                                handleToggleEnabled(engineType, value)
                                            }
                                        />
                                    </td>
                                    <td>
                                        <div className="smtcmp-settings-actions">
                                            <button
                                                onClick={() => {
                                                    new EditSearchEngineModal(
                                                        app,
                                                        plugin,
                                                        engineType,
                                                    ).open()
                                                }}
                                                className="clickable-icon"
                                            >
                                                <Settings />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
