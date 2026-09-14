import { App } from 'obsidian'

import { TemplateManager } from './TemplateManager'
import { TEMPLATE_SCHEMA_VERSION, Template } from './types'

jest.mock('fuzzysort', () => ({
  default: jest.requireActual('fuzzysort'),
}))

const mockAdapter = {
  exists: jest.fn().mockResolvedValue(true),
  mkdir: jest.fn().mockResolvedValue(undefined),
  read: jest.fn().mockResolvedValue(''),
  write: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
}

const mockVault = {
  adapter: mockAdapter,
}

const mockApp = {
  vault: mockVault,
} as unknown as App

describe('TemplateManager', () => {
  let templateManager: TemplateManager

  beforeEach(() => {
    jest.clearAllMocks()
    templateManager = new TemplateManager(mockApp)
  })

  describe('filename generation and parsing roundtrip', () => {
    const testNames = [
      'Simple Name',
      'Special & Characters! #$%^',
      'Unicode 中文 日本語 한국어',
      'Extremely long name that might cause issues with file systems',
      'Name with trailing spaces   ',
      '   Name with leading spaces',
      'Name with _ underscores_and_special_chars',
      'Name with.dots.and-dashes',
      'Name with / slashes \\ and \\ backslashes',
      'Name with "quotes" and \'apostrophes\'',
      'Name with <html> tags',
      'Name with newlines\nand\ttabs',
      '🔥 Name with emojis 🚀',
      ' ',
      'Name-with-123e4567-e89b-12d3-a456-426614174000-uuid-like-substring',
      '_Name_starting_with_underscore',
      'Name+with+plus+signs',
      'Name%20with%20encoded%20characters',
      'Name ending with .json',
      'v1_Name_starting_like_a_versioned_file',
      '..Name with leading dots',
      'Name with trailing dots..',
    ]

    test.each(testNames)('should correctly roundtrip name: %s', (name) => {
      const template: Template = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name,
        content: { nodes: [] },
        createdAt: 1620000000000,
        updatedAt: 1620000000000,
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
      }

      const fileName = (
        templateManager as unknown as {
          generateFileName: (template: Template) => string
        }
      ).generateFileName(template)
      const metadata = (
        templateManager as unknown as {
          parseFileName: (
            fileName: string,
          ) => { id: string; name: string; schemaVersion: number } | null
        }
      ).parseFileName(fileName)

      expect(metadata).not.toBeNull()
      if (metadata) {
        expect(metadata.id).toBe(template.id)
        expect(metadata.name).toBe(template.name)
        expect(metadata.schemaVersion).toBe(template.schemaVersion)
      }
    })
  })

  it('does not overwrite another JSON file when the stored body ID is poisoned', async () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    const fileName = `v1_Template_${id}.json`
    mockAdapter.list.mockResolvedValue({
      files: [`.smtcmp_json_db/templates/${fileName}`],
      folders: [],
    })
    mockAdapter.exists.mockResolvedValue(true)
    mockAdapter.read.mockResolvedValue(
      JSON.stringify({
        id: '../../../.obsidian/plugins/example/data',
        name: 'Template',
        content: { nodes: [] },
        createdAt: 1,
        updatedAt: 1,
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
      }),
    )
    jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      templateManager.updateTemplate(id, { name: 'Changed' }),
    ).resolves.toBeNull()
    await expect(templateManager.deleteTemplate(id)).resolves.toBe(false)
    expect(mockAdapter.write).not.toHaveBeenCalled()
    expect(mockAdapter.remove).not.toHaveBeenCalled()
  })

  it('skips corrupt template records without breaking search results', async () => {
    const validId = '123e4567-e89b-12d3-a456-426614174000'
    const corruptId = '223e4567-e89b-12d3-a456-426614174000'
    const validFile = `v1_Valid_${validId}.json`
    const corruptFile = `v1_Corrupt_${corruptId}.json`
    mockAdapter.list.mockResolvedValue({
      files: [
        `.smtcmp_json_db/templates/${validFile}`,
        `.smtcmp_json_db/templates/${corruptFile}`,
      ],
      folders: [],
    })
    mockAdapter.exists.mockResolvedValue(true)
    mockAdapter.read.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith(validFile)) {
        return JSON.stringify({
          id: validId,
          name: 'Valid',
          content: { nodes: [] },
          createdAt: 1,
          updatedAt: 1,
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
        })
      }
      return '{'
    })
    jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(templateManager.searchTemplates('')).resolves.toEqual([
      expect.objectContaining({ id: validId, name: 'Valid' }),
    ])
  })
})
