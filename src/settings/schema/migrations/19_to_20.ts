import { SettingMigration } from '../setting.types'

// Fixed snapshot keeps this migration independent of future default changes.
export const CLI_DEFAULTS_ADDED_IN_V20 = {
  connections: [
    {
      id: 'obsidian',
      name: 'Obsidian',
      preset: 'obsidian',
      command: 'Obsidian.com',
      args: [],
      batchArgumentMode: 'direct',
      cwd: '',
      instructions:
        'Use help <command> to check syntax. Search with a limit, read relevant notes, and use exact vault-relative path= targets. The current vault is fixed. Verify changes by reading the result; exit code alone is not proof. Do not automatically retry a timed-out write. For content parameters use literal \\n and \\t as documented by Obsidian.',
      enabled: false,
      timeoutSeconds: 60,
    },
  ],
  maxAutoIterations: 10,
}

export const migrateFrom19To20: SettingMigration['migrate'] = (data) => ({
  ...data,
  version: 20,
  cli: data.cli ?? CLI_DEFAULTS_ADDED_IN_V20,
})
