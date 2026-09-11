import { SettingMigration } from '../setting.types'

// Credential I/O happens after schema migration, when SecretStorage is available.
export const migrateFrom18To19: SettingMigration['migrate'] = (data) => ({
  ...data,
  version: 19,
})
