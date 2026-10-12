/**
 * Mistral OCR REST API shapes (snake_case, as returned on the wire).
 * Only the fields this plugin uses are typed.
 */
export type MistralOcrImage = {
  id: string
  image_base64?: string | null
}

export type MistralOcrTable = {
  id: string
  content: string
  format?: string
}

export type MistralOcrPage = {
  index: number
  markdown: string
  images?: MistralOcrImage[] | null
  tables?: MistralOcrTable[] | null
  dimensions?: { dpi?: number; height?: number; width?: number } | null
}

export type MistralOcrResponse = {
  pages: MistralOcrPage[]
  model?: string
  usage_info?: {
    pages_processed?: number
    doc_size_bytes?: number | null
  } | null
}

export type OcrRequestOptions = {
  model: string
  includeImages: boolean
  imageLimit: number
  imageMinSize: number
  tableFormat: 'markdown' | 'html'
}
