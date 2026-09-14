import fuzzysort from 'fuzzysort'
import { App } from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import { sanitizeSerializedNodes } from '../../../utils/chat/serialized-editor-state'
import { AbstractJsonRepository } from '../base'
import { ROOT_DIR, TEMPLATE_DIR } from '../constants'
import {
  DuplicateTemplateException,
  EmptyTemplateNameException,
} from '../exception'
import {
  assertSafeRecordId,
  isFiniteNumber,
  isRecord,
  isSafeRecordId,
} from '../validation'

import { TEMPLATE_SCHEMA_VERSION, Template, TemplateMetadata } from './types'

export class TemplateManager extends AbstractJsonRepository<
  Template,
  TemplateMetadata
> {
  constructor(app: App) {
    super(app, `${ROOT_DIR}/${TEMPLATE_DIR}`)
  }

  protected generateFileName(template: Template): string {
    assertSafeRecordId(template.id)
    // Format: v{schemaVersion}_name_id.json (with name encoded)
    const encodedName = encodeURIComponent(template.name)
    return `v${TEMPLATE_SCHEMA_VERSION}_${encodedName}_${template.id}.json`
  }

  protected parseFileName(fileName: string): TemplateMetadata | null {
    const match = fileName.match(
      new RegExp(`^v${TEMPLATE_SCHEMA_VERSION}_(.+)_([0-9a-f-]+)\\.json$`, 'i'),
    )
    if (!match) return null

    const encodedName = match[1]
    const id = match[2]
    const name = decodeURIComponent(encodedName)

    return { id, name, schemaVersion: TEMPLATE_SCHEMA_VERSION }
  }

  public async createTemplate(
    template: Omit<
      Template,
      'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'
    >,
  ): Promise<Template> {
    if (template.name !== undefined && template.name.length === 0) {
      throw new EmptyTemplateNameException()
    }

    const existingTemplate = await this.findByName(template.name)
    if (existingTemplate) {
      throw new DuplicateTemplateException(template.name)
    }

    const newTemplate: Template = {
      ...template,
      id: uuidv4(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
    }

    const nodes = sanitizeSerializedNodes(newTemplate.content.nodes)
    if (!nodes) throw new Error('Invalid template record')
    const validTemplate = { ...newTemplate, content: { nodes } }
    await this.create(validTemplate)
    return validTemplate
  }

  public async findById(id: string): Promise<Template | null> {
    assertSafeRecordId(id)
    const allMetadata = await this.listMetadata()
    const targetMetadata = allMetadata.find((meta) => meta.id === id)

    if (!targetMetadata) return null

    return this.readTemplate(targetMetadata)
  }

  public async findByName(name: string): Promise<Template | null> {
    const allMetadata = await this.listMetadata()
    const targetMetadata = allMetadata.find((meta) => meta.name === name)

    if (!targetMetadata) return null

    return this.readTemplate(targetMetadata)
  }

  public async updateTemplate(
    id: string,
    updates: Partial<
      Omit<Template, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>
    >,
  ): Promise<Template | null> {
    if (updates.name !== undefined && updates.name.length === 0) {
      throw new EmptyTemplateNameException()
    }

    const template = await this.findById(id)
    if (!template) return null

    if (updates.name && updates.name !== template.name) {
      const existingTemplate = await this.findByName(updates.name)
      if (existingTemplate) {
        throw new DuplicateTemplateException(updates.name)
      }
    }

    const updatedTemplate: Template = {
      ...template,
      ...updates,
      updatedAt: Date.now(),
    }

    const nodes = sanitizeSerializedNodes(updatedTemplate.content.nodes)
    if (!nodes) throw new Error('Invalid template record')
    const validTemplate = { ...updatedTemplate, content: { nodes } }
    await this.update(template, validTemplate)
    return validTemplate
  }

  public async deleteTemplate(id: string): Promise<boolean> {
    assertSafeRecordId(id)
    const template = await this.findById(id)
    if (!template) return false

    const fileName = this.generateFileName(template)
    await this.delete(fileName)
    return true
  }

  public async searchTemplates(query: string): Promise<Template[]> {
    const allMetadata = await this.listMetadata()
    const results = fuzzysort.go(query, allMetadata, {
      keys: ['name'],
      threshold: 0.2,
      limit: 20,
      all: true,
    })

    const templates = (
      await Promise.all(
        results.map(async (result) => this.readTemplate(result.obj)),
      )
    ).filter((template): template is Template => template !== null)

    return templates
  }

  private async readTemplate(metadata: {
    fileName: string
    id: string
    name: string
    schemaVersion: number
  }): Promise<Template | null> {
    const template = await this.read(metadata.fileName)
    if (!isValidTemplate(template, metadata)) {
      console.error(`Invalid template record: ${metadata.fileName}`)
      return null
    }
    const nodes = sanitizeSerializedNodes(template.content.nodes)
    if (!nodes) {
      console.error(`Invalid template record: ${metadata.fileName}`)
      return null
    }
    return { ...template, content: { nodes } }
  }
}

function isValidTemplate(
  value: unknown,
  metadata: TemplateMetadata,
): value is Template {
  return (
    isRecord(value) &&
    isSafeRecordId(value.id) &&
    value.id === metadata.id &&
    value.name === metadata.name &&
    value.schemaVersion === metadata.schemaVersion &&
    typeof value.name === 'string' &&
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.updatedAt) &&
    isRecord(value.content) &&
    Array.isArray(value.content.nodes)
  )
}
