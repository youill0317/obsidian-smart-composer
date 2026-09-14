import { cliSettingsSchema } from '../../../types/cli.types'
import { SettingMigration } from '../setting.types'

export const migrateFrom19To20: SettingMigration['migrate'] = (data) => ({
  ...data,
  version: 20,
  cli: cliSettingsSchema.parse(data.cli),
})
