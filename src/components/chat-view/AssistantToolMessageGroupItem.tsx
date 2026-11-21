import {
  AssistantToolMessageGroup,
  ChatAssistantMessage,
  ChatMessage,
  ChatToolMessage,
} from '../../types/chat'

import AssistantMessageAnnotations from './AssistantMessageAnnotations'
import AssistantMessageContent from './AssistantMessageContent'
import AssistantMessageReasoning from './AssistantMessageReasoning'
import AssistantToolMessageGroupActions from './AssistantToolMessageGroupActions'
import AssistantWorkGroup, { WorkEntry } from './AssistantWorkGroup'
import StreamStats from './StreamStats'
import ToolMessage from './ToolMessage'

export type AssistantToolMessageGroupItemProps = {
  messages: AssistantToolMessageGroup
  contextMessages: ChatMessage[]
  conversationId: string
  isApplying: boolean // TODO: isApplying should be a boolean for each assistant message
  onApply: (blockToApply: string, chatMessages: ChatMessage[]) => void
  onToolMessageUpdate: (message: ChatToolMessage) => void
  // Set while this group is being generated
  streamStartedAt?: number
}

type Item =
  | { type: 'text'; message: ChatAssistantMessage }
  | { type: 'work'; entries: WorkEntry[] }

export default function AssistantToolMessageGroupItem({
  messages,
  contextMessages,
  conversationId,
  isApplying,
  onApply,
  onToolMessageUpdate,
  streamStartedAt,
}: AssistantToolMessageGroupItemProps) {
  // Reasoning and tool calls are gathered into work items; answer text
  // (with its annotations) stays outside and splits them.
  const items: Item[] = []
  for (const message of messages) {
    const entry: WorkEntry | null =
      message.role === 'tool'
        ? { type: 'tool', message }
        : message.reasoning
          ? { type: 'reasoning', message }
          : null
    if (entry) {
      const last = items.at(-1)
      if (last?.type === 'work') {
        last.entries.push(entry)
      } else {
        items.push({ type: 'work', entries: [entry] })
      }
    }
    if (
      message.role === 'assistant' &&
      (message.content || message.annotations)
    ) {
      items.push({ type: 'text', message })
    }
  }

  const lastWorkIndex = items.map((item) => item.type).lastIndexOf('work')
  const stats =
    streamStartedAt !== undefined ? (
      <StreamStats
        startedAt={streamStartedAt}
        text={messages
          .map((m) =>
            m.role === 'assistant' ? (m.reasoning ?? '') + m.content : '',
          )
          .join('')}
      />
    ) : undefined
  const durationMs = messages.reduce(
    (sum, m) =>
      sum + (m.role === 'assistant' ? (m.metadata?.durationMs ?? 0) : 0),
    0,
  )

  return (
    <div className="smtcmp-assistant-tool-message-group">
      {items.map((item, index) => {
        if (item.type === 'text') {
          const { message } = item
          return (
            <div key={message.id} className="smtcmp-chat-messages-assistant">
              {message.annotations && (
                <AssistantMessageAnnotations
                  annotations={message.annotations}
                />
              )}
              <AssistantMessageContent
                content={message.content}
                contextMessages={contextMessages}
                handleApply={onApply}
                isApplying={isApplying}
              />
            </div>
          )
        }

        const { entries } = item
        const key = entries[0].message.id
        const isLastWork = index === lastWorkIndex
        const toolCallCount = entries.reduce(
          (count, entry) =>
            count +
            (entry.type === 'tool' ? entry.message.toolCalls.length : 0),
          0,
        )

        if (toolCallCount === 0) {
          return (
            <div key={key} className="smtcmp-chat-messages-assistant">
              {entries.map((entry, entryIndex) => (
                <AssistantMessageReasoning
                  key={entry.message.id}
                  reasoning={
                    entry.type === 'reasoning'
                      ? (entry.message.reasoning ?? '')
                      : ''
                  }
                  stats={
                    isLastWork && entryIndex === entries.length - 1
                      ? stats
                      : undefined
                  }
                />
              ))}
            </div>
          )
        }

        if (
          entries.length === 1 &&
          entries[0].type === 'tool' &&
          toolCallCount === 1
        ) {
          return (
            <div key={key}>
              <ToolMessage
                message={entries[0].message}
                conversationId={conversationId}
                onMessageUpdate={onToolMessageUpdate}
              />
            </div>
          )
        }

        return (
          <AssistantWorkGroup
            key={key}
            entries={entries}
            conversationId={conversationId}
            onToolMessageUpdate={onToolMessageUpdate}
            stats={isLastWork ? stats : undefined}
            isActive={index === items.length - 1}
            durationMs={
              isLastWork && !stats && durationMs > 0 ? durationMs : undefined
            }
          />
        )
      })}
      {messages.length > 0 && (
        <AssistantToolMessageGroupActions messages={messages} />
      )}
    </div>
  )
}
