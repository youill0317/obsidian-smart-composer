import { DEFAULT_OCR_OPTIONS } from '../setting.types'
import { parseSmartComposerSettings } from '../settings'

import { OCR_DEFAULTS_ADDED_IN_V23 } from './22_to_23'
import { migrateFrom23To24 } from './23_to_24'

describe('migrateFrom23To24', () => {
  it('keeps the OCR provider and drops the removed options', () => {
    const ocr = {
      ...OCR_DEFAULTS_ADDED_IN_V23,
      providerId: 'my-mistral',
      paginate: true,
      writeMetadata: false,
    }
    expect(migrateFrom23To24({ version: 23, ocr })).toEqual({
      version: 24,
      ocr: { providerId: 'my-mistral', enabled: true },
    })
  })

  it.each([undefined, null, 'invalid', [1, 2]])(
    'uses the defaults for a missing or non-object ocr: %p',
    (ocr) => {
      expect(migrateFrom23To24({ version: 23, ocr }).ocr).toEqual(
        DEFAULT_OCR_OPTIONS,
      )
    },
  )

  it('parses v23 settings into the new shape', () => {
    const settings = parseSmartComposerSettings({
      version: 23,
      ocr: { ...OCR_DEFAULTS_ADDED_IN_V23, providerId: 'other' },
    })
    expect(settings.ocr).toEqual({ providerId: 'other', enabled: true })
    expect(parseSmartComposerSettings(settings)).toEqual(settings)
  })
})
