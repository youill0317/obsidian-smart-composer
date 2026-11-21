import { SettingMigration } from '../setting.types'

// Reasoning summaries are always requested from v27 on, so their per-model
// options are removed.
const REMOVED_OPTIONS = [
  ['reasoning', 'reasoning_summary'],
  ['adaptive_thinking', 'show_summaries'],
  ['thinking', 'include_thoughts'],
] as const

const removeSummaryOptions = (model: unknown): unknown => {
  if (!model || typeof model !== 'object') return model
  let result = model as Record<string, unknown>
  for (const [group, option] of REMOVED_OPTIONS) {
    const value = result[group]
    if (!value || typeof value !== 'object' || !(option in value)) continue
    const { [option]: _, ...rest } = value as Record<string, unknown>
    const { [group]: _group, ...others } = result
    result = Object.keys(rest).length ? { ...others, [group]: rest } : others
  }
  return result
}

export const migrateFrom26To27: SettingMigration['migrate'] = (data) => ({
  ...data,
  version: 27,
  ...(Array.isArray(data.chatModels) && {
    chatModels: data.chatModels.map(removeSummaryOptions),
  }),
})
