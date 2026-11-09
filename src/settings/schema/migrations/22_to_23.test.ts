import { DEFAULT_PROVIDERS } from '../../../constants'
import { DEFAULT_OCR_OPTIONS } from '../setting.types'
import { parseSmartComposerSettings } from '../settings'

import { OCR_DEFAULTS_ADDED_IN_V23, migrateFrom22To23 } from './22_to_23'

import { SETTINGS_SCHEMA_VERSION } from '.'

describe('migrateFrom22To23', () => {
  it('adds OCR defaults when missing', () => {
    const initial = { version: 22, systemPrompt: 'keep me' }
    const result = migrateFrom22To23(initial)
    expect(result).toEqual({
      version: 23,
      systemPrompt: 'keep me',
      ocr: OCR_DEFAULTS_ADDED_IN_V23,
    })
    expect(initial).toEqual({ version: 22, systemPrompt: 'keep me' })
  })

  it('never overwrites an existing ocr object', () => {
    const ocr = { ...OCR_DEFAULTS_ADDED_IN_V23, providerId: 'my-mistral' }
    const result = migrateFrom22To23({ version: 22, ocr })
    expect(result.ocr).toBe(ocr)
  })

  it.each([null, 'invalid', [1, 2]])('replaces a non-object ocr: %p', (ocr) => {
    expect(migrateFrom22To23({ version: 22, ocr }).ocr).toEqual(
      OCR_DEFAULTS_ADDED_IN_V23,
    )
  })

  it('gives each fallback its own copy of the defaults', () => {
    const a = parseSmartComposerSettings({ version: 23 }).ocr
    const b = parseSmartComposerSettings({ version: 23 }).ocr
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })

  it('is idempotent', () => {
    const once = migrateFrom22To23({ version: 22 })
    expect(migrateFrom22To23(once)).toEqual(once)
  })

  it('parses v22 settings and leaves user data untouched', () => {
    const providers = [
      ...DEFAULT_PROVIDERS.filter((p) => p.type !== 'mistral'),
      { type: 'mistral', id: 'mistral', apiKey: 'test-key' },
    ]
    const initial = {
      version: 22,
      providers,
      systemPrompt: 'Be brief.',
      chatOptions: {
        includeCurrentFileContent: false,
        enableTools: false,
        maxAutoIterations: 3,
      },
    }
    const before = JSON.stringify(initial)
    const settings = parseSmartComposerSettings(initial)
    expect(settings.version).toBe(SETTINGS_SCHEMA_VERSION)
    expect(settings.ocr).toEqual(DEFAULT_OCR_OPTIONS)
    expect(settings.providers).toEqual(providers)
    expect(settings.systemPrompt).toBe('Be brief.')
    expect(settings.chatOptions).toEqual(initial.chatOptions)
    expect(JSON.stringify(initial)).toBe(before)
    expect(parseSmartComposerSettings(settings)).toEqual(settings)
  })
})
