import { useSettings } from '../../../contexts/settings-context'
import { MISTRAL_OCR_MODEL } from '../../../core/ocr/ocrRequest'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianToggle } from '../../common/ObsidianToggle'

export function OcrSection() {
  const { settings, setSettings } = useSettings()

  return (
    <div className="smtcmp-settings-section">
      <div className="smtcmp-settings-header">Document OCR</div>

      <ObsidianSetting name="Mistral OCR" desc={MISTRAL_OCR_MODEL}>
        <ObsidianToggle
          value={settings.ocr.enabled}
          onChange={async (value) => {
            await setSettings((current) => ({
              ...current,
              ocr: { ...current.ocr, enabled: value },
            }))
          }}
        />
      </ObsidianSetting>
    </div>
  )
}
