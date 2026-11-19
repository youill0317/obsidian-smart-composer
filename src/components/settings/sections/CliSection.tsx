import {
  Check,
  CircleMinus,
  Edit,
  Loader2,
  Play,
  Trash2,
  X,
} from 'lucide-react'
import { App, Notice } from 'obsidian'
import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import { useSettings } from '../../../contexts/settings-context'
import SmartComposerPlugin from '../../../main'
import {
  CliConnection,
  DEFAULT_OBSIDIAN_CLI,
  cliConnectionSchema,
} from '../../../types/cli.types'
import { ToolCallResponseStatus } from '../../../types/tool-call.types'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianTextArea } from '../../common/ObsidianTextArea'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ObsidianToggle } from '../../common/ObsidianToggle'
import { ReactModal } from '../../common/ReactModal'

type CliTestResult =
  | { state: 'testing' }
  | { state: 'passed' }
  | { state: 'error'; message: string }

export function CliSection({
  app,
  plugin,
}: {
  app: App
  plugin: SmartComposerPlugin
}) {
  const { settings, setSettings } = useSettings()
  const [status, setStatus] = useState<Record<string, CliTestResult>>({})
  useEffect(() => setStatus({}), [settings.cli.connections])
  const disabled = plugin.toolManager.cli.disabled
  const saveConnections = (
    update: (connections: CliConnection[]) => CliConnection[],
  ) =>
    setSettings((current) => ({
      ...current,
      cli: { ...current.cli, connections: update(current.cli.connections) },
    }))
  const edit = (connection?: CliConnection) =>
    new ReactModal({
      app,
      Component: CliForm,
      props: { plugin, connection },
      options: { title: connection ? 'Edit CLI' : 'Add CLI' },
    }).open()
  const test = async (connection: CliConnection) => {
    setStatus((s) => ({ ...s, [connection.id]: { state: 'testing' } }))
    try {
      const requests =
        connection.preset === 'obsidian'
          ? [['version'], ['help'], ['vault', 'info=path']]
          : [['--help']]
      for (const args of requests) {
        const request = { cliId: connection.id, args }
        const execution = await plugin.toolManager.cli.prepare(request, true)
        const response = await plugin.toolManager.cli.execute(
          uuidv4(),
          request,
          execution,
          undefined,
          true,
        )
        if (response.status !== ToolCallResponseStatus.Success)
          throw new Error(
            response.status === ToolCallResponseStatus.Error
              ? response.error
              : response.status,
          )
        const result = JSON.parse(response.data.text) as { stdout: string }
        if (connection.preset === 'obsidian' && !result.stdout.trim())
          throw new Error('Obsidian CLI returned no output.')
        if (args[0] === 'vault') {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { win32 } = require('path') as typeof import('path')
          if (
            win32.normalize(result.stdout.trim()).toLowerCase() !==
            win32.normalize(execution.cwd).toLowerCase()
          )
            throw new Error('CLI selected a different vault.')
        }
      }
      setStatus((s) => ({ ...s, [connection.id]: { state: 'passed' } }))
    } catch (error) {
      setStatus((s) => ({
        ...s,
        [connection.id]: {
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  }
  return (
    <div className="smtcmp-settings-section">
      <div className="smtcmp-settings-header">CLI</div>
      {disabled ? (
        <div className="smtcmp-settings-sub-header-container">
          <div className="smtcmp-settings-sub-header">
            CLI is supported on Windows desktop only
          </div>
        </div>
      ) : (
        <>
          <div className="smtcmp-settings-sub-header-container">
            <div className="smtcmp-settings-sub-header">CLI connections</div>
            <div className="smtcmp-settings-actions">
              {!settings.cli.connections.some(
                (c) => c.preset === 'obsidian',
              ) && (
                <ObsidianButton
                  text="Add Obsidian preset"
                  onClick={() => {
                    void saveConnections((connections) =>
                      connections.some((c) => c.preset === 'obsidian')
                        ? connections
                        : [
                            ...connections,
                            { ...DEFAULT_OBSIDIAN_CLI, id: uuidv4() },
                          ],
                    )
                  }}
                />
              )}
              <ObsidianButton text="Add CLI" onClick={() => edit()} />
            </div>
          </div>

          <div className="smtcmp-mcp-servers-container">
            <div className="smtcmp-mcp-servers-header">
              <div>CLI</div>
              <div>Status</div>
              <div>Enabled</div>
              <div>Actions</div>
            </div>
            {settings.cli.connections.map((connection) => {
              const result = status[connection.id]
              return (
                <div key={connection.id} className="smtcmp-mcp-server">
                  <div className="smtcmp-mcp-server-row">
                    <div className="smtcmp-mcp-server-name">
                      {connection.name}
                    </div>
                    <div className="smtcmp-mcp-server-status">
                      <CliTestStatusBadge result={result} />
                    </div>
                    <div className="smtcmp-mcp-server-toggle">
                      <ObsidianToggle
                        value={connection.enabled}
                        onChange={(enabled) => {
                          void saveConnections((connections) =>
                            connections.map((c) =>
                              c.id === connection.id ? { ...c, enabled } : c,
                            ),
                          )
                        }}
                      />
                    </div>
                    <div className="smtcmp-mcp-server-actions">
                      <button
                        onClick={() => {
                          void test(connection)
                        }}
                        className="clickable-icon"
                        aria-label="Test"
                      >
                        <Play size={16} />
                      </button>
                      <button
                        onClick={() => edit(connection)}
                        className="clickable-icon"
                        aria-label="Edit"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => {
                          void saveConnections((connections) =>
                            connections.filter((c) => c.id !== connection.id),
                          )
                        }}
                        className="clickable-icon"
                        aria-label="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {result?.state === 'error' && (
                    <div className="smtcmp-server-expanded-info">
                      <div className="smtcmp-server-expanded-info-header">
                        Error
                      </div>
                      <div className="smtcmp-server-error-message">
                        {result.message}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function CliTestStatusBadge({ result }: { result?: CliTestResult }) {
  const { icon, label, statusClass } =
    result?.state === 'testing'
      ? {
          icon: <Loader2 size={16} className="spinner" />,
          label: 'Testing…',
          statusClass: 'smtcmp-mcp-server-status-badge--connecting',
        }
      : result?.state === 'passed'
        ? {
            icon: <Check size={16} />,
            label: 'Test passed',
            statusClass: 'smtcmp-mcp-server-status-badge--connected',
          }
        : result?.state === 'error'
          ? {
              icon: <X size={16} />,
              label: 'Error',
              statusClass: 'smtcmp-mcp-server-status-badge--error',
            }
          : {
              icon: <CircleMinus size={14} />,
              label: 'Not tested',
              statusClass: 'smtcmp-mcp-server-status-badge--disconnected',
            }

  return (
    <div className={`smtcmp-mcp-server-status-badge ${statusClass}`}>
      {icon}
      <div className="smtcmp-mcp-server-status-badge-label">{label}</div>
    </div>
  )
}

function CliForm({
  plugin,
  connection,
  onClose,
}: {
  plugin: SmartComposerPlugin
  connection?: CliConnection
  onClose: () => void
}) {
  const [draft, setDraft] = useState<CliConnection>(
    connection ?? {
      ...DEFAULT_OBSIDIAN_CLI,
      id: uuidv4(),
      name: '',
      command: '',
      instructions: '',
      preset: 'custom',
      enabled: false,
    },
  )
  const [args, setArgs] = useState(JSON.stringify(draft.args))
  const save = async () => {
    try {
      const parsed = cliConnectionSchema.parse({
        ...draft,
        args: JSON.parse(args),
      })
      if (parsed.preset === 'obsidian' && parsed.args.length)
        throw new Error('Obsidian uses no fixed arguments.')
      await plugin.setSettings((current) => ({
        ...current,
        cli: {
          ...current.cli,
          connections: connection
            ? current.cli.connections.map((c) =>
                c.id === connection.id ? parsed : c,
              )
            : [...current.cli.connections, parsed],
        },
      }))
      onClose()
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <>
      <ObsidianSetting name="Name" required>
        <ObsidianTextInput
          value={draft.name}
          onChange={(name) => setDraft({ ...draft, name })}
        />
      </ObsidianSetting>
      <ObsidianSetting name="Executable" required>
        <ObsidianTextInput
          value={draft.command}
          onChange={(command) => setDraft({ ...draft, command })}
        />
      </ObsidianSetting>
      {draft.preset !== 'obsidian' && (
        <>
          <ObsidianSetting name="Fixed arguments">
            <ObsidianTextInput value={args} onChange={setArgs} />
          </ObsidianSetting>
          <ObsidianSetting name="Batch file arguments">
            <ObsidianDropdown
              value={draft.batchArgumentMode}
              options={{
                direct: 'Direct',
                forwarded: 'Forwarded',
              }}
              onChange={(value) => {
                if (value === 'direct' || value === 'forwarded')
                  setDraft({ ...draft, batchArgumentMode: value })
              }}
            />
          </ObsidianSetting>
          <ObsidianSetting name="Working folder">
            <ObsidianTextInput
              value={draft.cwd}
              onChange={(cwd) => setDraft({ ...draft, cwd })}
            />
          </ObsidianSetting>
        </>
      )}
      <ObsidianSetting name="Timeout (seconds)">
        <ObsidianTextInput
          type="number"
          value={String(draft.timeoutSeconds)}
          onChange={(value) =>
            setDraft({ ...draft, timeoutSeconds: Number(value) })
          }
        />
      </ObsidianSetting>
      <ObsidianSetting
        name="Instructions for the assistant"
        className="smtcmp-settings-textarea-header"
      />
      <ObsidianSetting className="smtcmp-settings-textarea">
        <ObsidianTextArea
          value={draft.instructions}
          onChange={(instructions) => setDraft({ ...draft, instructions })}
        />
      </ObsidianSetting>
      <ObsidianSetting>
        <ObsidianButton
          text="Save"
          cta
          onClick={() => {
            void save()
          }}
        />
        <ObsidianButton text="Cancel" onClick={onClose} />
      </ObsidianSetting>
    </>
  )
}
