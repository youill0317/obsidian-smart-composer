import { ChevronDown, ChevronRight } from 'lucide-react'
import { ReactNode, useState } from 'react'

import { InvalidToolNameException } from '../../core/mcp/exception'
import { parseToolName } from '../../core/mcp/tool-name-utils'
import { ChatAssistantMessage, ChatToolMessage } from '../../types/chat'
import { ToolCallResponseStatus } from '../../types/tool-call.types'

import AssistantMessageReasoning from './AssistantMessageReasoning'
import { formatDuration } from './StreamStats'
import ToolMessage, { StatusIcon } from './ToolMessage'

export type WorkEntry =
  | { type: 'reasoning'; message: ChatAssistantMessage }
  | { type: 'tool'; message: ChatToolMessage }

// Status shown for the whole group, by priority
const GROUP_STATUS_ORDER: ToolCallResponseStatus[] = [
  ToolCallResponseStatus.PendingApproval,
  ToolCallResponseStatus.Running,
  ToolCallResponseStatus.Error,
  ToolCallResponseStatus.Rejected,
  ToolCallResponseStatus.Aborted,
  ToolCallResponseStatus.Success,
]

const getToolDisplayName = (name: string): string => {
  try {
    const { serverName, toolName } = parseToolName(name)
    return `${serverName}:${toolName}`
  } catch (error) {
    if (error instanceof InvalidToolNameException) return name
    throw error
  }
}

// Reasoning and tool calls between answer texts, folded into one toggle
export default function AssistantWorkGroup({
  entries,
  conversationId,
  onToolMessageUpdate,
  stats,
  isActive,
  durationMs,
}: {
  entries: WorkEntry[]
  conversationId: string
  onToolMessageUpdate: (message: ChatToolMessage) => void
  // Shown while the response is generated
  stats?: ReactNode
  // The agent is still working in this group (no answer text after it yet)
  isActive: boolean
  durationMs?: number
}) {
  const [isOpen, setIsOpen] = useState(false)
  const toolCalls = entries.flatMap((entry) =>
    entry.type === 'tool' ? entry.message.toolCalls : [],
  )
  const statuses = toolCalls.map((toolCall) => toolCall.response.status)
  const status = GROUP_STATUS_ORDER.find((s) => statuses.includes(s))
  const runningCall = [...toolCalls]
    .reverse()
    .find(
      (toolCall) => toolCall.response.status === ToolCallResponseStatus.Running,
    )

  const toolCallCount = `${toolCalls.length} tool call${toolCalls.length === 1 ? '' : 's'}`
  const label =
    status === ToolCallResponseStatus.PendingApproval
      ? 'Waiting for approval'
      : runningCall
        ? `Running ${getToolDisplayName(runningCall.request.name)}`
        : stats && isActive
          ? 'Reasoning…'
          : durationMs
            ? `Worked for ${formatDuration(Math.round(durationMs / 1000))} · ${toolCallCount}`
            : toolCallCount

  // While collapsed, tool calls waiting for approval are still shown and
  // fold back once the user approves or rejects them. Hidden entries stay
  // mounted so an approved call still receives its result.
  const isVisible = (entry: WorkEntry) =>
    isOpen ||
    (entry.type === 'tool' &&
      entry.message.toolCalls.some(
        (toolCall) =>
          toolCall.response.status === ToolCallResponseStatus.PendingApproval,
      ))

  return (
    <div className="smtcmp-toolcall-container">
      <div className="smtcmp-toolcall">
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="smtcmp-toolcall-header"
        >
          <div className="smtcmp-toolcall-header-icon">
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </div>
          <div className="smtcmp-toolcall-header-content">{label}</div>
          <div className="smtcmp-toolcall-header-icon smtcmp-toolcall-header-icon--status">
            {stats ?? (status && <StatusIcon status={status} />)}
          </div>
        </div>
        <div
          className="smtcmp-work-group-content"
          hidden={!entries.some(isVisible)}
        >
          {entries.map((entry) => (
            <div key={entry.message.id} hidden={!isVisible(entry)}>
              {entry.type === 'reasoning' ? (
                <AssistantMessageReasoning
                  reasoning={entry.message.reasoning ?? ''}
                />
              ) : (
                <ToolMessage
                  message={entry.message}
                  conversationId={conversationId}
                  onMessageUpdate={onToolMessageUpdate}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
