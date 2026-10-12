import { App } from 'obsidian'

import {
  SettingsProvider,
  useSettings,
} from '../../../contexts/settings-context'
import SmartComposerPlugin from '../../../main'
import { OcrOptions } from '../../../settings/schema/setting.types'
import { ObsidianButton } from '../../common/ObsidianButton'
import { ObsidianDropdown } from '../../common/ObsidianDropdown'
import { ObsidianSetting } from '../../common/ObsidianSetting'
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

// Empty or invalid input leaves the stored value unchanged.
function parseNonNegativeInt(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.floor(Math.max(0, parsed))
}

function OcrOptionsForm({ onClose }: { onClose: () => void }) {
  const { settings, setSettings } = useSettings()
  const { ocr } = settings
  const canMovePdf = ocr.outputLocation === 'subfolder' && !ocr.deleteOriginal

  const update = async (patch: Partial<OcrOptions>) => {
    await setSettings((current) => ({
      ...current,
      ocr: { ...current.ocr, ...patch },
    }))
  }

  return (
    <div>
      <ObsidianSetting name="Model" heading />
      <ObsidianSetting name="OCR model" desc="Mistral OCR model name.">
        <ObsidianTextInput
          value={ocr.model}
          placeholder="mistral-ocr-latest"
          onChange={(value) => void update({ model: value.trim() })}
        />
      </ObsidianSetting>
      <ObsidianSetting
        name="Table format"
        desc="How tables are written in the note."
      >
        <ObsidianDropdown
          value={ocr.tableFormat}
          options={{ markdown: 'Markdown', html: 'HTML' }}
          onChange={(value) =>
            void update({ tableFormat: value === 'html' ? 'html' : 'markdown' })
          }
        />
      </ObsidianSetting>

      <ObsidianSetting name="Images" heading />
      <ObsidianSetting
        name="Extract images"
        desc="Save images found in the PDF and link them from the note."
      >
        <ObsidianToggle
          value={ocr.includeImages}
          onChange={(value) => update({ includeImages: value })}
        />
      </ObsidianSetting>
      {ocr.includeImages && (
        <>
          <ObsidianSetting
            name="Max images"
            desc="Number of images to keep. 0 means no limit."
            className="smtcmp-setting-item--nested"
          >
            <ObsidianTextInput
              type="number"
              value={ocr.imageLimit.toString()}
              onChange={(value) => {
                const parsed = parseNonNegativeInt(value)
                if (parsed !== null) void update({ imageLimit: parsed })
              }}
            />
          </ObsidianSetting>
          <ObsidianSetting
            name="Min image size"
            desc="Smallest width or height in pixels. 0 means any size."
            className="smtcmp-setting-item--nested"
          >
            <ObsidianTextInput
              type="number"
              value={ocr.imageMinSize.toString()}
              onChange={(value) => {
                const parsed = parseNonNegativeInt(value)
                if (parsed !== null) void update({ imageMinSize: parsed })
              }}
            />
          </ObsidianSetting>
          <ObsidianSetting
            name="Assets folder"
            desc="Put images in an assets folder next to the note instead of beside it."
            className="smtcmp-setting-item--nested"
          >
            <ObsidianToggle
              value={ocr.createAssetSubfolder}
              onChange={(value) => update({ createAssetSubfolder: value })}
            />
          </ObsidianSetting>
        </>
      )}

      <ObsidianSetting name="Output" heading />
      <ObsidianSetting
        name="Output location"
        desc="Same folder: <name>.md next to the PDF. Subfolder: <name>/<name>.md."
      >
        <ObsidianDropdown
          value={ocr.outputLocation}
          options={{
            'same-folder': 'Same folder as PDF',
            subfolder: 'Subfolder named after PDF',
          }}
          onChange={(value) =>
            void update({
              outputLocation:
                value === 'subfolder' ? 'subfolder' : 'same-folder',
            })
          }
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
        desc="Record the source PDF, model and page count in the note's frontmatter."
      >
        <ObsidianToggle
          value={ocr.writeMetadata}
          onChange={(value) => update({ writeMetadata: value })}
        />
      </ObsidianSetting>

      <ObsidianSetting name="Original PDF" heading />
      <ObsidianSetting
        name="Move into output folder"
        desc="Move the PDF into the output subfolder. Requires the subfolder output location; ignored when delete is on."
      >
        <ObsidianToggle
          // Shown off while it has no effect; the stored choice is kept.
          value={canMovePdf && ocr.movePdfToFolder}
          disabled={!canMovePdf}
          onChange={(value) => update({ movePdfToFolder: value })}
        />
      </ObsidianSetting>
      <ObsidianSetting
        name="Delete after conversion"
        desc="Move the PDF to the trash, following Obsidian's 'Deleted files' setting. The PDF is kept when no text was recognized or some images could not be saved."
      >
        <ObsidianToggle
          value={ocr.deleteOriginal}
          onChange={(value) => update({ deleteOriginal: value })}
        />
      </ObsidianSetting>

      <ObsidianSetting>
        <ObsidianButton text="Close" onClick={onClose} />
      </ObsidianSetting>
    </div>
  )
}
