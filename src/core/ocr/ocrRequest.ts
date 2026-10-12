import { OcrRequestOptions } from './ocrTypes'

// Above this size the PDF is uploaded through the files API instead of being
// inlined as a data URI in the JSON request.
export const MAX_INLINE_PDF_BYTES = 20 * 1024 * 1024

export const DEFAULT_MISTRAL_BASE_URL = 'https://api.mistral.ai/v1'

export function resolveMistralBaseUrl(baseUrl?: string): string {
  const trimmed = baseUrl?.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : DEFAULT_MISTRAL_BASE_URL
}

function positiveInteger(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

/**
 * Builds the JSON body for `POST /ocr`. Optional fields are only sent when
 * they differ from the API defaults.
 */
export function buildOcrRequestBody(
  documentUrl: string,
  options: OcrRequestOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model.trim() || 'mistral-ocr-latest',
    document: { type: 'document_url', document_url: documentUrl },
    include_image_base64: options.includeImages,
  }
  if (options.includeImages) {
    const imageLimit = positiveInteger(options.imageLimit)
    const imageMinSize = positiveInteger(options.imageMinSize)
    if (imageLimit !== undefined) body.image_limit = imageLimit
    if (imageMinSize !== undefined) body.image_min_size = imageMinSize
  }
  // Without table_format, tables stay inline in the page markdown.
  if (options.tableFormat === 'html') body.table_format = 'html'
  return body
}

export type MultipartField = { name: string; value: string }
export type MultipartFile = {
  name: string
  fileName: string
  contentType: string
  data: ArrayBuffer
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, ' ').replace(/"/g, '%22')
}

/**
 * Builds a multipart/form-data body as an ArrayBuffer, so it can be sent with
 * Obsidian's requestUrl (which does not accept FormData).
 */
export function buildMultipartBody(
  boundary: string,
  fields: MultipartField[],
  file: MultipartFile,
): ArrayBuffer {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  for (const field of fields) {
    parts.push(
      encoder.encode(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${sanitizeHeaderValue(field.name)}"\r\n\r\n` +
          `${field.value}\r\n`,
      ),
    )
  }
  parts.push(
    encoder.encode(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${sanitizeHeaderValue(file.name)}"; filename="${sanitizeHeaderValue(file.fileName)}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
    ),
  )
  parts.push(new Uint8Array(file.data))
  parts.push(encoder.encode(`\r\n--${boundary}--\r\n`))

  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const body = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    body.set(part, offset)
    offset += part.byteLength
  }
  return body.buffer
}
