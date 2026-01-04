import { ExternalLink, FileDown, FileCheck } from 'lucide-react'

import { ChatWebSearchResultMessage, ChatMessage } from '../../types/chat'

type WebSearchResultMessageProps = {
    message: ChatWebSearchResultMessage
    contextMessages: ChatMessage[]
    onApply: (blockToApply: string, chatMessages: ChatMessage[]) => void
    isApplying: boolean
}

export default function WebSearchResultMessage({
    message,
    contextMessages,
    onApply,
    isApplying,
}: WebSearchResultMessageProps) {
    const formatResultAsMarkdown = (result: typeof message.results[0]) => {
        return `## ${result.title}

URL: ${result.url}

${result.content}
`
    }

    const formatAllResultsAsMarkdown = () => {
        return message.results
            .map((result) => formatResultAsMarkdown(result))
            .join('\n---\n\n')
    }

    const handleApplySingle = (result: typeof message.results[0]) => {
        onApply(formatResultAsMarkdown(result), contextMessages)
    }

    const handleApplyAll = () => {
        onApply(formatAllResultsAsMarkdown(), contextMessages)
    }

    return (
        <div className="smtcmp-web-search-result-message">
            <div className="smtcmp-web-search-result-header">
                <span className="smtcmp-web-search-result-query">
                    🔍 Web Search: "{message.query}"
                </span>
                <span className="smtcmp-web-search-result-count">
                    {message.results.length} results
                </span>
            </div>

            <div className="smtcmp-web-search-results">
                {message.results.map((result, index) => (
                    <div key={index} className="smtcmp-web-search-result-item">
                        <div className="smtcmp-web-search-result-item-header">
                            <a
                                href={result.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="smtcmp-web-search-result-title"
                            >
                                {result.title}
                                <ExternalLink size={12} />
                            </a>
                            <button
                                className="smtcmp-web-search-result-apply-btn clickable-icon"
                                onClick={() => handleApplySingle(result)}
                                disabled={isApplying}
                                title="Apply this result"
                            >
                                <FileDown size={14} />
                            </button>
                        </div>
                        <div className="smtcmp-web-search-result-url">
                            {result.url}
                        </div>
                        <div className="smtcmp-web-search-result-content">
                            {result.content}
                        </div>
                    </div>
                ))}
            </div>

            {message.results.length > 1 && (
                <div className="smtcmp-web-search-result-actions">
                    <button
                        className="smtcmp-web-search-result-apply-all-btn"
                        onClick={handleApplyAll}
                        disabled={isApplying}
                    >
                        <FileCheck size={14} />
                        Apply All Results
                    </button>
                </div>
            )}
        </div>
    )
}
