import { z } from 'zod'

import {
  DEFAULT_APPLY_MODEL_ID,
  DEFAULT_CHAT_MODELS,
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_EMBEDDING_MODELS,
  DEFAULT_PROVIDERS,
} from '../../constants'
import { chatModelSchema } from '../../types/chat-model.types'
import { cliSettingsSchema } from '../../types/cli.types'
import { embeddingModelSchema } from '../../types/embedding-model.types'
import { mcpServerConfigSchema } from '../../types/mcp.types'
import { llmProviderSchema } from '../../types/provider.types'

import { SETTINGS_SCHEMA_VERSION } from './migrations'

const ragOptionsSchema = z.object({
  chunkSize: z.number().catch(1000),
  thresholdTokens: z.number().catch(8192),
  minSimilarity: z.number().catch(0.0),
  limit: z.number().catch(10),
  excludePatterns: z.array(z.string()).catch([]),
  includePatterns: z.array(z.string()).catch([]),
})

export const DEFAULT_OCR_OPTIONS = {
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

// Each field falls back on its own, so one invalid or missing value never
// resets the other OCR options.
const ocrOptionsSchema = z.object({
  providerId: z.string().catch(DEFAULT_OCR_OPTIONS.providerId), // id of a provider whose type is 'mistral'
  model: z.string().catch(DEFAULT_OCR_OPTIONS.model),
  includeImages: z.boolean().catch(DEFAULT_OCR_OPTIONS.includeImages),
  imageLimit: z.number().catch(DEFAULT_OCR_OPTIONS.imageLimit), // 0 = no limit
  imageMinSize: z.number().catch(DEFAULT_OCR_OPTIONS.imageMinSize), // 0 = no minimum
  tableFormat: z
    .enum(['markdown', 'html'])
    .catch(DEFAULT_OCR_OPTIONS.tableFormat),
  paginate: z.boolean().catch(DEFAULT_OCR_OPTIONS.paginate), // insert a horizontal rule between pages
  outputLocation: z
    .enum(['same-folder', 'subfolder'])
    .catch(DEFAULT_OCR_OPTIONS.outputLocation),
  createAssetSubfolder: z
    .boolean()
    .catch(DEFAULT_OCR_OPTIONS.createAssetSubfolder),
  writeMetadata: z.boolean().catch(DEFAULT_OCR_OPTIONS.writeMetadata),
  movePdfToFolder: z.boolean().catch(DEFAULT_OCR_OPTIONS.movePdfToFolder), // only used with 'subfolder'
  deleteOriginal: z.boolean().catch(DEFAULT_OCR_OPTIONS.deleteOriginal),
  chatAutoOcr: z.boolean().catch(DEFAULT_OCR_OPTIONS.chatAutoOcr), // run OCR when a PDF is mentioned in chat
  chatReuseExisting: z.boolean().catch(DEFAULT_OCR_OPTIONS.chatReuseExisting),
  chatConfirmAboveMb: z.number().catch(DEFAULT_OCR_OPTIONS.chatConfirmAboveMb), // 0 = never ask
})
export type OcrOptions = z.infer<typeof ocrOptionsSchema>

/**
 * Settings
 */

export const smartComposerSettingsSchema = z.object({
  // Version
  version: z.literal(SETTINGS_SCHEMA_VERSION).catch(SETTINGS_SCHEMA_VERSION),

  providers: z.array(llmProviderSchema).catch([...DEFAULT_PROVIDERS]),

  chatModels: z.array(chatModelSchema).catch([...DEFAULT_CHAT_MODELS]),

  embeddingModels: z
    .array(embeddingModelSchema)
    .catch([...DEFAULT_EMBEDDING_MODELS]),

  chatModelId: z
    .string()
    .catch(
      DEFAULT_CHAT_MODELS.find((v) => v.id === DEFAULT_CHAT_MODEL_ID)?.id ??
        DEFAULT_CHAT_MODELS[0].id,
    ), // model for default chat feature
  applyModelId: z
    .string()
    .catch(
      DEFAULT_CHAT_MODELS.find((v) => v.id === DEFAULT_APPLY_MODEL_ID)?.id ??
        DEFAULT_CHAT_MODELS[0].id,
    ), // model for apply feature
  embeddingModelId: z.string().catch(DEFAULT_EMBEDDING_MODELS[0].id), // model for embedding

  // System Prompt
  systemPrompt: z.string().catch(''),

  // RAG Options
  ragOptions: ragOptionsSchema.catch({
    chunkSize: 1000,
    thresholdTokens: 8192,
    minSimilarity: 0.0,
    limit: 10,
    excludePatterns: [],
    includePatterns: [],
  }),

  cli: cliSettingsSchema,

  // MCP configuration
  mcp: z
    .object({
      servers: z.array(mcpServerConfigSchema).catch([]),
    })
    .catch({
      servers: [],
    }),

  // Chat options
  chatOptions: z
    .object({
      includeCurrentFileContent: z.boolean(),
      enableTools: z.boolean(),
      maxAutoIterations: z.number(),
    })
    .catch({
      includeCurrentFileContent: true,
      enableTools: true,
      maxAutoIterations: 1,
    }),

  // Document OCR options
  ocr: ocrOptionsSchema.catch({ ...DEFAULT_OCR_OPTIONS }),
})
export type SmartComposerSettings = z.infer<typeof smartComposerSettingsSchema>

export type SettingMigration = {
  fromVersion: number
  toVersion: number
  migrate: (data: Record<string, unknown>) => Record<string, unknown>
}

export type SettingsUpdate =
  | SmartComposerSettings
  | ((current: SmartComposerSettings) => SmartComposerSettings)
export type SettingsSetter = (update: SettingsUpdate) => void | Promise<void>
