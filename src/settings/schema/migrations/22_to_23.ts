import { SettingMigration } from '../setting.types'

// Fixed snapshot keeps this migration independent of future default changes.
export const OCR_DEFAULTS_ADDED_IN_V23 = {
  providerId: 'mistral',
  model: 'mistral-ocr-latest',
  includeImages: true,
  imageLimit: 0,
  imageMinSize: 0,
  tableFormat: 'markdown',
  paginate: false,
  outputLocation: 'same-folder',
  createAssetSubfolder: true,
  writeMetadata: true,
  movePdfToFolder: false,
  deleteOriginal: false,
  chatAutoOcr: true,
  chatReuseExisting: true,
  chatConfirmAboveMb: 10,
} as const

/**
 * Adds the Document OCR options. An existing `ocr` object is never replaced.
 */
export const migrateFrom22To23: SettingMigration['migrate'] = (data) => {
  const hasOcr =
    typeof data.ocr === 'object' &&
    data.ocr !== null &&
    !Array.isArray(data.ocr)
  return {
    ...data,
    version: 23,
    ocr: hasOcr ? data.ocr : { ...OCR_DEFAULTS_ADDED_IN_V23 },
  }
}
