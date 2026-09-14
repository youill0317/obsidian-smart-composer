import clsx from 'clsx'
import { Eye, EyeOff, Wrench } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { useApp } from '../../../contexts/app-context'
import { usePlugin } from '../../../contexts/plugin-context'
import { useSettings } from '../../../contexts/settings-context'
import { useTools } from '../../../contexts/tools-context'
import { McpSectionModal } from '../../modals/McpSectionModal'

export default function ToolBadge() {
  const plugin = usePlugin()
  const app = useApp()
  const { settings, setSettings } = useSettings()
  const toolManager = useTools()

  const [toolCount, setToolCount] = useState(0)

  const handleBadgeClick = useCallback(() => {
    new McpSectionModal(app, plugin).open()
  }, [plugin, app])

  const handleToolToggle = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      setSettings((current) => ({
        ...current,
        chatOptions: {
          ...current.chatOptions,
          enableTools: !current.chatOptions.enableTools,
        },
      }))
    },
    [setSettings],
  )

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const tools = await toolManager.listAvailableTools()
        if (!cancelled) setToolCount(tools.length)
      } catch {
        if (!cancelled) setToolCount(0)
      }
    }
    void refresh()
    let unsubscribe: (() => void) | undefined
    void plugin
      .getMcpManager()
      .then((manager) => {
        if (!cancelled)
          unsubscribe = manager.subscribeServersChange(() => {
            void refresh()
          })
      })
      .catch(() => {})
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [toolManager, plugin, settings.cli, settings.mcp])

  return (
    <div
      className="smtcmp-chat-user-input-file-badge"
      onClick={handleBadgeClick}
    >
      <div className="smtcmp-chat-user-input-file-badge-name">
        <Wrench
          size={12}
          className="smtcmp-chat-user-input-file-badge-name-icon"
        />
        <span
          className={clsx(
            !settings.chatOptions.enableTools && 'smtcmp-excluded-content',
          )}
        >
          Tools ({toolCount})
        </span>
      </div>
      <div
        className="smtcmp-chat-user-input-file-badge-eye"
        onClick={handleToolToggle}
      >
        {settings.chatOptions.enableTools ? (
          <Eye size={12} />
        ) : (
          <EyeOff size={12} />
        )}
      </div>
    </div>
  )
}
