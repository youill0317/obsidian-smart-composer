import { App } from 'obsidian'
import { useEffect } from 'react'

import {
  SettingsProvider,
  useSettings,
} from '../../../contexts/settings-context'
import SmartComposerPlugin from '../../../main'
import { OcrOptions } from '../../../settings/schema/setting.types'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import {
  ObsidianSetting,
  useObsidianSetting,
} from '../../common/ObsidianSetting'
import { ObsidianTextInput } from '../../common/ObsidianTextInput'
import { ObsidianToggle } from '../../common/ObsidianToggle'
import { ReactModal } from '../../common/ReactModal'

type OcrOptionsModalProps = {
  plugin: SmartComposerPlugin
  onClose: () => void
}

export class OcrOptionsModal extends ReactModal<OcrOptionsModalProps> {
  constructor(app: App, plugin: SmartComposerPlugin) {
    super({
      app,
      Component: OcrOptionsModalWrapper,
      props: { plugin },
      options: { title: 'Document OCR options' },
    })
  }
}

function OcrOptionsModalWrapper({ plugin, onClose }: OcrOptionsModalProps) {
  return (
    <SettingsProvider
      settings={plugin.settings}
      setSettings={(newSettings) => plugin.setSettings(newSettings)}
      addSettingsChangeListener={(listener) =>
        plugin.addSettingsChangeListener(listener)
      }
    >
      <OcrOptionsForm onClose={onClose} />
    </SettingsProvider>
  )
}

/**
 * Short label inside a setting's control area, so several controls can share
 * one row. It must be rendered right before the control it describes.
 */
function ControlLabel({ text, warning }: { text: string; warning?: boolean }) {
  const { setting } = useObsidianSetting()
  useEffect(() => {
    if (!setting) return
    const label = document.createElement('span')
    label.className = warning
      ? 'smtcmp-settings-ocr-label smtcmp-settings-ocr-label--warning'
      : 'smtcmp-settings-ocr-label'
    label.textContent = text
    setting.controlEl.appendChild(label)
    return () => label.remove()
  }, [setting, text, warning])
  return null
}

// Empty or invalid input leaves the stored value unchanged.
function parseNonNegative(value: string, integer: boolean): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const clamped = Math.max(0, parsed)
  return integer ? Math.floor(clamped) : clamped
}

function OcrOptionsForm({ onClose }: { onClose: () => void }) {
  const { settings, setSettings } = useSettings()
  const { ocr } = settings

  const update = async (patch: Partial<OcrOptions>) => {
    await setSettings((current) => ({
      ...current,
      ocr: { ...current.ocr, ...patch },
    }))
  }

  return (
    <div className="smtcmp-settings-ocr-options">
      <ObsidianSetting name="Model" heading />
      <ObsidianSetting
        name="OCR model"
        desc="Mistral OCR model, and whether tables are written as Markdown or HTML."
      >
        <ObsidianTextInput
          value={ocr.model}
          placeholder="mistral-ocr-latest"
          tooltip="OCR model"
          onChange={(value) => void update({ model: value.trim() })}
        />
        <ControlLabel text="Tables" />
        <ObsidianDropdown
          value={ocr.tableFormat}
          options={{ markdown: 'Markdown', html: 'HTML' }}
          tooltip="Table format"
          onChange={(value) =>
            void update({ tableFormat: value === 'html' ? 'html' : 'markdown' })
          }
        />
      </ObsidianSetting>

      <ObsidianSetting name="Images" heading />
      <ObsidianSetting
        name="Extract images"
        desc="Save images found in the PDF and link them from the note. Max: number of images to keep. Min size: smallest width or height in pixels."
      >
        <ObsidianToggle
          value={ocr.includeImages}
          tooltip="Extract images"
          onChange={(value) => update({ includeImages: value })}
        />
        <ControlLabel text="Max" />
        <ObsidianTextInput
          type="number"
          value={ocr.imageLimit.toString()}
          placeholder="0 = unlimited"
          tooltip="Max images (0 = unlimited)"
          disabled={!ocr.includeImages}
          onChange={(value) => {
            const parsed = parseNonNegative(value, true)
            if (parsed !== null) void update({ imageLimit: parsed })
          }}
        />
        <ControlLabel text="Min size (px)" />
        <ObsidianTextInput
          type="number"
          value={ocr.imageMinSize.toString()}
          placeholder="0 = any"
          tooltip="Min image size in px (0 = any)"
          disabled={!ocr.includeImages}
          onChange={(value) => {
            const parsed = parseNonNegative(value, true)
            if (parsed !== null) void update({ imageMinSize: parsed })
          }}
        />
      </ObsidianSetting>

      <ObsidianSetting name="Output" heading />
      <ObsidianSetting
        name="Output location"
        desc="Same folder: <name>.md next to the PDF. Subfolder: <name>/<name>.md. Assets: put images in an assets folder next to the note instead of beside it."
      >
        <ObsidianDropdown
          value={ocr.outputLocation}
          options={{
            'same-folder': 'Same folder as PDF',
            subfolder: 'Subfolder named after PDF',
          }}
          tooltip="Where the markdown file is written"
          onChange={(value) =>
            void update({
              outputLocation:
                value === 'subfolder' ? 'subfolder' : 'same-folder',
            })
          }
        />
        <ControlLabel text="Assets folder" />
        <ObsidianToggle
          value={ocr.createAssetSubfolder}
          tooltip="Put images in an assets folder"
          onChange={(value) => update({ createAssetSubfolder: value })}
        />
      </ObsidianSetting>
      <ObsidianSetting
        name="Page separators"
        desc="Insert a horizontal rule between pages."
      >
        <ObsidianToggle
          value={ocr.paginate}
          onChange={(value) => update({ paginate: value })}
        />
      </ObsidianSetting>
      <ObsidianSetting
        name="Frontmatter metadata"
        desc="Record the source PDF, model and page count in the note's frontmatter. Used to find earlier conversions."
      >
        <ObsidianToggle
          value={ocr.writeMetadata}
          onChange={(value) => update({ writeMetadata: value })}
        />
      </ObsidianSetting>
      <ObsidianSetting
        name="Original PDF"
        desc="Applies to conversions from the file menu or command; chat never moves or deletes PDFs. Moving requires the subfolder location. Deleted PDFs go to the trash."
      >
        <ControlLabel text="Move into output folder" />
        <ObsidianToggle
          value={ocr.movePdfToFolder}
          tooltip="Move the PDF into the output subfolder"
          disabled={ocr.outputLocation !== 'subfolder' || ocr.deleteOriginal}
          onChange={(value) => update({ movePdfToFolder: value })}
        />
        <ControlLabel text="Delete after conversion" warning />
        <ObsidianToggle
          value={ocr.deleteOriginal}
          tooltip="Move the PDF to the trash after conversion"
          onChange={(value) => update({ deleteOriginal: value })}
        />
      </ObsidianSetting>

      <ObsidianSetting name="Chat" heading />
      <ObsidianSetting
        name="Reuse existing conversion"
        desc="When a mentioned PDF was already converted, send that note instead of calling the API again."
      >
        <ObsidianToggle
          value={ocr.chatReuseExisting}
          onChange={(value) => update({ chatReuseExisting: value })}
        />
      </ObsidianSetting>
      <ObsidianSetting
        name="Confirm before OCR above (MB)"
        desc="Ask before running OCR on a mentioned PDF larger than this. 0 = never ask."
      >
        <ObsidianTextInput
          type="number"
          value={ocr.chatConfirmAboveMb.toString()}
          placeholder="0 = never ask"
          onChange={(value) => {
            const parsed = parseNonNegative(value, false)
            if (parsed !== null) void update({ chatConfirmAboveMb: parsed })
          }}
        />
      </ObsidianSetting>

      <div className="modal-button-container">
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
