import { App } from 'obsidian'
import { renderToStaticMarkup } from 'react-dom/server'

import { useSettings } from '../../../contexts/settings-context'
import SmartComposerPlugin from '../../../main'
import { CredentialSettingsStore } from '../../../settings/credentialSettingsStore'
import { SettingsUpdate } from '../../../settings/schema/setting.types'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ObsidianToggle } from '../../common/ObsidianToggle'

import { CliSection } from './CliSection'

jest.mock('obsidian', () => ({ Modal: class {} }))
jest.mock('../../../contexts/settings-context', () => ({
  useSettings: jest.fn(),
}))
jest.mock('../../common/ObsidianToggle', () => ({
  ObsidianToggle: jest.fn(() => null),
}))
jest.mock('../../common/ObsidianTextInput', () => ({
  ObsidianTextInput: jest.fn(() => null),
}))

it('preserves rotated credentials and consecutive CLI edits from an older render', async () => {
  let block = false
  let started!: () => void
  let release!: () => void
  const saving = new Promise<void>((resolve) => {
    started = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const store = new CredentialSettingsStore(
    undefined,
    async () => {
      if (block) {
        block = false
        started()
        await gate
      }
    },
    () => {},
  )
  await store.load({
    version: 20,
    providers: [
      {
        id: 'plan',
        type: 'openai-plan',
        oauth: {
          accessToken: 'test-access',
          refreshToken: 'test-old',
          expiresAt: 1000,
        },
      },
    ],
  })
  await store.update((current) => ({
    ...current,
    cli: {
      ...current.cli,
      connections: [
        current.cli.connections[0],
        { ...current.cli.connections[0], id: 'second' },
      ],
    },
  }))
  const updates: Promise<void>[] = []
  jest.mocked(useSettings).mockReturnValue({
    settings: store.settings,
    setSettings: (update: SettingsUpdate) => {
      const pending = store.update(update)
      updates.push(pending)
      return pending
    },
  })
  renderToStaticMarkup(
    <CliSection
      app={{} as App}
      plugin={
        {
          toolManager: { cli: { disabled: false } },
        } as unknown as SmartComposerPlugin
      }
    />,
  )
  block = true
  const refresh = store.update((current) => ({
    ...current,
    providers: current.providers.map((provider) =>
      provider.type === 'openai-plan' && provider.oauth
        ? {
            ...provider,
            oauth: { ...provider.oauth, refreshToken: 'test-new' },
          }
        : provider,
    ),
  }))
  await saving
  for (const [props] of jest.mocked(ObsidianToggle).mock.calls)
    props.onChange(true)
  jest.mocked(ObsidianTextInput).mock.calls[0][0].onChange('12')
  release()
  await Promise.all([refresh, ...updates])
  const provider = store.settings.providers[0]
  expect(provider.type === 'openai-plan' && provider.oauth?.refreshToken).toBe(
    'test-new',
  )
  expect(
    store.settings.cli.connections.map((connection) => connection.enabled),
  ).toEqual([true, true])
  expect(store.settings.cli.maxAutoIterations).toBe(12)
})
