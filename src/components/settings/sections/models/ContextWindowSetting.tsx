import { ObsidianSetting } from '../../../common/ObsidianSetting'
import { ObsidianTextInput } from '../../../common/ObsidianTextInput'

export function parseContextWindow(value: string): number | undefined {
  const tokens = Number(value)
  return Number.isInteger(tokens) && tokens > 0 ? tokens : undefined
}

export function ContextWindowSetting({
  value,
  onChange,
  required,
}: {
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  return (
    <ObsidianSetting name="Context Window" required={required}>
      <ObsidianTextInput
        type="number"
        value={value}
        placeholder="272000"
        onChange={onChange}
      />
    </ObsidianSetting>
  )
}
