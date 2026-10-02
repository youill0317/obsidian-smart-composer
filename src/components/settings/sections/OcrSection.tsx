import { App } from 'obsidian'
import { useMemo } from 'react'

import { useSettings } from '../../../contexts/settings-context'
import SmartComposerPlugin from '../../../main'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
import { ObsidianToggle } from '../../common/ObsidianToggle'
import { OcrOptionsModal } from '../modals/OcrOptionsModal'

type OcrSectionProps = {
  app: App
  plugin: SmartComposerPlugin
}

export function OcrSection({ app, plugin }: OcrSectionProps) {
  const { settings, setSettings } = useSettings()
  const { providerId, chatAutoOcr } = settings.ocr

  const mistralProviders = useMemo(
    () => settings.providers.filter((provider) => provider.type === 'mistral'),
    [settings.providers],
  )
  const providerOptions = useMemo(() => {
    const options: Record<string, string> = Object.fromEntries(
      mistralProviders.map((provider) => [provider.id, provider.id]),
    )
    if (!Object.prototype.hasOwnProperty.call(options, providerId)) {
      options[providerId] = `${providerId} (missing)`
    }
    return options
  }, [mistralProviders, providerId])
  const hasProviders = mistralProviders.length > 0

  return (
    <div className="smtcmp-settings-section">
      <div className="smtcmp-settings-header">Document OCR</div>

      <ObsidianSetting
        // Remount so the dropdown stays before the button when it appears.
        key={hasProviders ? 'with-providers' : 'no-providers'}
        name="OCR provider"
        desc={
          hasProviders
            ? 'Mistral provider used to convert PDFs to Markdown (file menu, command palette and chat mentions). Uses its API key and base URL.'
            : 'No Mistral provider found. Add a Mistral provider in the Providers section to use OCR.'
        }
      >
        {hasProviders && (
          <ObsidianDropdown
            value={providerId}
            options={providerOptions}
            onChange={async (value) => {
              await setSettings((current) => ({
                ...current,
                ocr: { ...current.ocr, providerId: value },
              }))
            }}
          />
        )}
        <ObsidianButton
          text="Options"
          onClick={() => new OcrOptionsModal(app, plugin).open()}
        />
      </ObsidianSetting>

      <ObsidianSetting
        name="Auto OCR for PDF mentions in chat"
        desc="Convert mentioned PDFs to Markdown with Mistral OCR when the message is sent. OCR is billed per page."
      >
        <ObsidianToggle
          value={chatAutoOcr}
          onChange={async (value) => {
            await setSettings((current) => ({
              ...current,
              ocr: { ...current.ocr, chatAutoOcr: value },
            }))
          }}
        />
      </ObsidianSetting>
    </div>
  )
}
