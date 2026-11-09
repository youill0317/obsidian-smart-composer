import { SettingMigration } from '../setting.types'

/**
 * Replaces the Document OCR options with a single on/off switch. The OCR
 * provider is kept; everything else is now fixed.
 */
export const migrateFrom23To24: SettingMigration['migrate'] = (data) => {
  const ocr =
    typeof data.ocr === 'object' &&
    data.ocr !== null &&
    !Array.isArray(data.ocr)
      ? (data.ocr as Record<string, unknown>)
      : {}
  return {
    ...data,
    version: 24,
    ocr: {
      providerId:
        typeof ocr.providerId === 'string' ? ocr.providerId : 'mistral',
      enabled: true,
    },
  }
}
