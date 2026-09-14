import clsx from 'clsx'
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useSettings } from '../../contexts/settings-context'
import { useTools } from '../../contexts/tools-context'
import { InvalidToolNameException } from '../../core/mcp/exception'
import { parseToolName } from '../../core/mcp/tool-name-utils'
import { ChatToolMessage } from '../../types/chat'
import { CLI_TOOL_NAME, CliExecution } from '../../types/cli.types'
import {
  ToolCallRequest,
  ToolCallResponse,
  ToolCallResponseStatus,
} from '../../types/tool-call.types'
import { SplitButton } from '../common/SplitButton'

import { ObsidianCodeBlock } from './ObsidianMarkdown'

const STATUS_LABELS: Record<ToolCallResponseStatus, string> = {
  [ToolCallResponseStatus.PendingApproval]: 'Call',
  [ToolCallResponseStatus.Rejected]: 'Rejected',
  [ToolCallResponseStatus.Running]: 'Running',
  [ToolCallResponseStatus.Success]: 'Called',
  [ToolCallResponseStatus.Error]: 'Failed',
  [ToolCallResponseStatus.Aborted]: 'Aborted',
}

export const getToolMessageContent = (message: ChatToolMessage): string => {
  return message.toolCalls
    ?.map((toolCall) => {
      const { serverName, toolName } = (() => {
        try {
          return parseToolName(toolCall.request.name)
        } catch (error) {
          if (error instanceof InvalidToolNameException) {
            return { serverName: null, toolName: toolCall.request.name }
          }
          throw error
        }
      })()
      return [
        `${STATUS_LABELS[toolCall.response.status]} ${serverName ? `${serverName}:${toolName}` : toolName}`,
        ...(toolCall.request.arguments
          ? [`Parameters: ${toolCall.request.arguments}`]
          : []),
      ].join('\n')
    })
    .join('\n')
}

const ToolMessage = memo(function ToolMessage({
  message,
  conversationId,
  onMessageUpdate,
}: {
  message: ChatToolMessage
  conversationId: string
  onMessageUpdate: (message: ChatToolMessage) => void
}) {
  const latest = useRef({ message, onMessageUpdate })
  latest.current = { message, onMessageUpdate }
  return (
    <div className="smtcmp-toolcall-container">
      {message.toolCalls.map((toolCall, index) => (
        <div
          key={toolCall.request.id}
          className={clsx(index > 0 && 'smtcmp-toolcall-border-top')}
        >
          <ToolCallItem
            request={toolCall.request}
            response={toolCall.response}
            conversationId={conversationId}
            onResponseUpdate={(response) => {
              const updated = {
                ...latest.current.message,
                toolCalls: latest.current.message.toolCalls.map((t) =>
                  t.request.id === toolCall.request.id ? { ...t, response } : t,
                ),
              }
              latest.current.message = updated
              latest.current.onMessageUpdate(updated)
            }}
          />
        </div>
      ))}
    </div>
  )
})

function ToolCallItem({
  request,
  response,
  conversationId,
  onResponseUpdate,
}: {
  request: ToolCallRequest
  response: ToolCallResponse
  conversationId: string
  onResponseUpdate: (response: ToolCallResponse) => void
}) {
  const {
    handleToolCall,
    handleAllowForConversation,
    handleAllowAutoExecution,
    handleReject,
    handleAbort,
  } = useToolCall(
    request,
    conversationId,
    onResponseUpdate,
    'execution' in response ? response.execution : undefined,
  )

  const [isOpen, setIsOpen] = useState(
    // Open by default if the tool call requires approval
    response.status === ToolCallResponseStatus.PendingApproval,
  )

  const { serverName, toolName } = useMemo(() => {
    try {
      return parseToolName(request.name)
    } catch (error) {
      if (error instanceof InvalidToolNameException) {
        return {
          serverName: null,
          toolName: request.name,
        }
      }
      throw error
    }
  }, [request.name])
  const parameters = useMemo(() => {
    if (!request.arguments) {
      return 'No parameters'
    }
    try {
      return JSON.stringify(JSON.parse(request.arguments), null, 2)
    } catch (error) {
      return request.arguments
    }
  }, [request.arguments])

  return (
    <div className="smtcmp-toolcall">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="smtcmp-toolcall-header"
      >
        <div className="smtcmp-toolcall-header-icon">
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
        <div className="smtcmp-toolcall-header-content">
          <span>{STATUS_LABELS[response.status] || 'Unknown'}</span>
          <span>&nbsp;&nbsp;</span>
          <span className="smtcmp-toolcall-header-tool-name">
            {serverName ? `${serverName}:${toolName}` : toolName}
          </span>
        </div>
        <div className="smtcmp-toolcall-header-icon smtcmp-toolcall-header-icon--status">
          <StatusIcon status={response.status} />
        </div>
      </div>
      {isOpen && (
        <div className="smtcmp-toolcall-content">
          <div className="smtcmp-toolcall-content-section">
            <div>Parameters:</div>
            <ObsidianCodeBlock
              language="json"
              content={
                'execution' in response && response.execution
                  ? JSON.stringify(
                      response.execution,
                      (key, value: unknown) =>
                        key === 'configuration' || key === 'automatic'
                          ? undefined
                          : value,
                      2,
                    )
                  : parameters
              }
            />
          </div>
          {response.status === ToolCallResponseStatus.Success && (
            <div className="smtcmp-toolcall-content-section">
              <div>Result:</div>
              <ObsidianCodeBlock content={response.data.text} />
            </div>
          )}
          {response.status === ToolCallResponseStatus.Error && (
            <div className="smtcmp-toolcall-content-section">
              <div>Error:</div>
              <ObsidianCodeBlock content={response.error} />
            </div>
          )}
        </div>
      )}
      {(response.status === ToolCallResponseStatus.PendingApproval ||
        response.status === ToolCallResponseStatus.Running) && (
        <div className="smtcmp-toolcall-footer">
          {response.status === ToolCallResponseStatus.PendingApproval && (
            <div className="smtcmp-toolcall-footer-actions">
              {request.name === CLI_TOOL_NAME ? (
                <button
                  onClick={() => {
                    void handleToolCall()
                  }}
                >
                  Allow this execution
                </button>
              ) : (
                <SplitButton
                  primaryText="Allow"
                  onPrimaryClick={() => {
                    handleToolCall()
                    setIsOpen(false)
                  }}
                  menuOptions={[
                    {
                      label: 'Always allow this tool',
                      onClick: () => {
                        handleToolCall()
                        handleAllowAutoExecution()
                        setIsOpen(false)
                      },
                    },
                    {
                      label: 'Allow for this chat',
                      onClick: () => {
                        handleToolCall()
                        handleAllowForConversation()
                        setIsOpen(false)
                      },
                    },
                  ]}
                />
              )}
              <button
                onClick={() => {
                  handleReject()
                  setIsOpen(false)
                }}
              >
                Reject
              </button>
            </div>
          )}
          {response.status === ToolCallResponseStatus.Running && (
            <div className="smtcmp-toolcall-footer-actions">
              <button onClick={handleAbort}>Abort</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function useToolCall(
  request: ToolCallRequest,
  conversationId: string,
  onResponseUpdate: (response: ToolCallResponse) => void,
  approved?: CliExecution,
) {
  const { settings, setSettings } = useSettings()
  const toolManager = useTools()

  const updateRef = useRef(onResponseUpdate)
  updateRef.current = onResponseUpdate
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [request.id])
  const running = useRef(false)
  const handleToolCall = useCallback(async () => {
    if (running.current) return
    running.current = true
    const manager = toolManager
    onResponseUpdate({
      status: ToolCallResponseStatus.Running,
      execution: approved,
    })
    try {
      const toolCallResponse = await manager.callTool({
        name: request.name,
        args: request.arguments,
        id: request.id,
        approved,
        conversationId,
      })
      if (mounted.current) updateRef.current(toolCallResponse)
    } catch (error) {
      if (mounted.current)
        updateRef.current({
          status: ToolCallResponseStatus.Error,
          error: error instanceof Error ? error.message : String(error),
        })
    } finally {
      running.current = false
    }
  }, [request, onResponseUpdate, toolManager, approved, conversationId])

  const handleAllowForConversation = useCallback(async () => {
    const manager = toolManager
    manager.allowToolForConversation(request.name, conversationId)
  }, [request, conversationId, toolManager])

  const handleAllowAutoExecution = useCallback(async () => {
    const { serverName, toolName } = parseToolName(request.name)
    const server = settings.mcp.servers.find((s) => s.id === serverName)
    if (!server) {
      throw new Error(`Server ${serverName} not found`)
    }
    const toolOptions = { ...server.toolOptions }
    if (!toolOptions[toolName]) {
      // If the tool is not in the toolOptions, add it with default values
      toolOptions[toolName] = {
        allowAutoExecution: false,
        disabled: false,
      }
    }
    toolOptions[toolName] = {
      ...toolOptions[toolName],
      allowAutoExecution: true,
    }

    setSettings((current) => ({
      ...current,
      mcp: {
        ...current.mcp,
        servers: current.mcp.servers.map((s) =>
          s.id === server.id
            ? {
                ...s,
                toolOptions: toolOptions,
              }
            : s,
        ),
      },
    }))
  }, [request, settings, setSettings])

  const handleReject = useCallback(async () => {
    onResponseUpdate({
      status: ToolCallResponseStatus.Rejected,
    })
  }, [onResponseUpdate])

  const handleAbort = useCallback(async () => {
    const manager = toolManager
    manager.abortToolCall(request.id)
    onResponseUpdate({
      status: ToolCallResponseStatus.Aborted,
    })
  }, [request, onResponseUpdate, toolManager])

  return {
    handleToolCall,
    handleAllowForConversation,
    handleAllowAutoExecution,
    handleReject,
    handleAbort,
  }
}

function StatusIcon({ status }: { status: ToolCallResponseStatus }) {
  switch (status) {
    case ToolCallResponseStatus.PendingApproval:
      return null
    case ToolCallResponseStatus.Rejected:
    case ToolCallResponseStatus.Aborted:
    case ToolCallResponseStatus.Error:
      return <X size={16} style={{ color: 'var(--text-error)' }} />
    case ToolCallResponseStatus.Running:
      return <Loader2 size={16} className="spinner" />
    case ToolCallResponseStatus.Success:
      return <Check size={16} style={{ color: 'var(--text-success)' }} />
    default:
      return null
  }
}

export default ToolMessage
