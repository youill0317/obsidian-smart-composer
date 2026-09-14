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
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ObsidianToggle } from '../../common/ObsidianToggle'
import { ReactModal } from '../../common/ReactModal'

export function CliSection({
  app,
  plugin,
}: {
  app: App
  plugin: SmartComposerPlugin
}) {
  const { settings, setSettings } = useSettings()
  const [status, setStatus] = useState<Record<string, string>>({})
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
    setStatus((s) => ({ ...s, [connection.id]: 'Testing…' }))
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
          throw new Error(
            'Obsidian CLI returned no output. Check installer 1.12.7+ and CLI activation.',
          )
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
      setStatus((s) => ({ ...s, [connection.id]: 'Test passed' }))
    } catch (error) {
      setStatus((s) => ({
        ...s,
        [connection.id]: error instanceof Error ? error.message : String(error),
      }))
    }
  }
  return (
    <div className="smtcmp-settings-section">
      <div className="smtcmp-settings-header">CLI connections</div>
      <div className="smtcmp-settings-desc">
        Use installed command-line tools directly. Install and sign in from your
        terminal first. Reviewed Obsidian queries run automatically; other
        commands require approval. Enabling the Obsidian preset lets the model
        search and read any note in this vault, and sends the results to your
        selected model provider. A test runs help (and checks the vault for
        Obsidian).
      </div>
      {disabled ? (
        <p>
          CLI execution is currently supported on Windows desktop only. Saved
          connections are preserved.
        </p>
      ) : (
        <>
          <ObsidianSetting
            name="CLI automatic rounds"
            desc="Model responses per task, including approval resumptions. Continue starts a new round budget."
          >
            <ObsidianTextInput
              type="number"
              value={String(settings.cli.maxAutoIterations)}
              onChange={(value) => {
                const n = Number(value)
                if (Number.isInteger(n) && n >= 1 && n <= 50)
                  void setSettings((current) => ({
                    ...current,
                    cli: { ...current.cli, maxAutoIterations: n },
                  }))
              }}
            />
          </ObsidianSetting>
          <ObsidianSetting>
            <ObsidianButton text="Add CLI" onClick={() => edit()} />
            {!settings.cli.connections.some((c) => c.preset === 'obsidian') && (
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
          </ObsidianSetting>
          {settings.cli.connections.map((connection) => (
            <div key={connection.id}>
              <ObsidianSetting name={connection.name} desc={connection.command}>
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
                <ObsidianButton text="Edit" onClick={() => edit(connection)} />
                <ObsidianButton
                  text="Test"
                  onClick={() => {
                    void test(connection)
                  }}
                />
                <ObsidianButton
                  text="Remove"
                  onClick={() => {
                    void saveConnections((connections) =>
                      connections.filter((c) => c.id !== connection.id),
                    )
                  }}
                />
              </ObsidianSetting>
              <p role="status">{status[connection.id] ?? 'Not tested'}</p>
            </div>
          ))}
        </>
      )}
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
      <ObsidianSetting
        name="Executable"
        desc="Executable path or installed command name. Windows .exe, .com, .cmd and .bat are supported."
        required
      >
        <ObsidianTextInput
          value={draft.command}
          onChange={(command) => setDraft({ ...draft, command })}
        />
      </ObsidianSetting>
      {draft.preset !== 'obsidian' && (
        <>
          <ObsidianSetting
            name="Fixed arguments"
            desc={'JSON array, for example ["--no-color"].'}
          >
            <ObsidianTextInput value={args} onChange={setArgs} />
          </ObsidianSetting>
          <ObsidianSetting
            name="Batch file arguments"
            desc="For .cmd/.bat only: choose Forwarded for npm commands or wrappers that pass %* to another program."
          >
            <ObsidianDropdown
              value={draft.batchArgumentMode}
              options={{
                direct: 'Direct (ordinary script)',
                forwarded: 'Forwarded (npm / wrapper)',
              }}
              onChange={(value) => {
                if (value === 'direct' || value === 'forwarded')
                  setDraft({ ...draft, batchArgumentMode: value })
              }}
            />
          </ObsidianSetting>
          <ObsidianSetting
            name="Working folder"
            desc="Leave empty to use the current vault."
          >
            <ObsidianTextInput
              value={draft.cwd}
              onChange={(cwd) => setDraft({ ...draft, cwd })}
            />
          </ObsidianSetting>
        </>
      )}
      <ObsidianSetting
        name="Timeout (seconds)"
        desc="1–300 seconds. Stopping the CLI does not undo changes."
      >
        <ObsidianTextInput
          type="number"
          value={String(draft.timeoutSeconds)}
          onChange={(value) =>
            setDraft({ ...draft, timeoutSeconds: Number(value) })
          }
        />
      </ObsidianSetting>
      <label>
        Instructions for the assistant
        <textarea
          className="smtcmp-mcp-server-modal-textarea"
          value={draft.instructions}
          rows={5}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
        />
      </label>
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
