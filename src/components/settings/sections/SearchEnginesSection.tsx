import { Settings } from 'lucide-react'
import { App } from 'obsidian'

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
}

export function SearchEnginesSection({ app, plugin }: SearchEnginesSectionProps) {
    const { settings, setSettings } = useSettings()

    const searchEngines: SearchEngineType[] = ['perplexity', 'tavily']

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

    return (
        <div className="smtcmp-settings-section">
            <div className="smtcmp-settings-header">Search Engines</div>

            <div className="smtcmp-settings-desc">
                <span>Configure search engines for web search functionality</span>
            </div>

            <div className="smtcmp-settings-table-container">
                <table className="smtcmp-settings-table">
                    <colgroup>
                        <col />
                        <col />
                        <col width={80} />
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
                                    <td
                                        className="smtcmp-settings-table-api-key"
                                        onClick={() => {
                                            new EditSearchEngineModal(
                                                app,
                                                plugin,
                                                engineType,
                                            ).open()
                                        }}
                                    >
                                        {engineConfig.apiKey ? '••••••••' : 'Set API key'}
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
