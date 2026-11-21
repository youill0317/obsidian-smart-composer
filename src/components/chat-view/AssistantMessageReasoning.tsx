import { ChevronDown, ChevronUp } from 'lucide-react'
import { ReactNode, memo, useEffect, useRef, useState } from 'react'

import DotLoader from '../common/DotLoader'

import { ObsidianMarkdown } from './ObsidianMarkdown'

const AssistantMessageReasoning = memo(function AssistantMessageReasoning({
  reasoning,
  stats,
}: {
  reasoning: string
  // Shown next to the label while the response is generated
  stats?: ReactNode
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showLoader, setShowLoader] = useState(false)
  const previousReasoning = useRef(reasoning)

  useEffect(() => {
    if (
      previousReasoning.current !== reasoning &&
      previousReasoning.current !== ''
    ) {
      setShowLoader(true)
      const timer = setTimeout(() => {
        setShowLoader(false)
      }, 1000)
      return () => clearTimeout(timer)
    }
    previousReasoning.current = reasoning
  }, [reasoning])

  return (
    <div className="smtcmp-assistant-message-metadata">
      <div
        className="smtcmp-assistant-message-metadata-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span>
          Reasoning {showLoader && <DotLoader />}
          {stats}
        </span>
        {isExpanded ? (
          <ChevronUp className="smtcmp-assistant-message-metadata-toggle-icon" />
        ) : (
          <ChevronDown className="smtcmp-assistant-message-metadata-toggle-icon" />
        )}
      </div>
      {isExpanded && (
        <div className="smtcmp-assistant-message-metadata-content">
          <ObsidianMarkdown content={reasoning} scale="xs" />
        </div>
      )}
    </div>
  )
})

export default AssistantMessageReasoning
