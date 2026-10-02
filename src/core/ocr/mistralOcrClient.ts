import {
  Notice,
  RequestUrlResponse,
  arrayBufferToBase64,
  requestUrl,
} from 'obsidian'
import { v4 as uuidv4 } from 'uuid'

import {
  MAX_INLINE_PDF_BYTES,
  buildMultipartBody,
  buildOcrRequestBody,
  resolveMistralBaseUrl,
} from './ocrRequest'
import { MistralOcrResponse, OcrRequestOptions } from './ocrTypes'

export type OcrProgressStage = 'uploading' | 'processing'

const MAX_ERROR_BODY_LENGTH = 500

function describeFailure(action: string, response: RequestUrlResponse): Error {
  let body = ''
  try {
    body = response.text ?? ''
  } catch {
    body = ''
  }
  const detail = body.trim().slice(0, MAX_ERROR_BODY_LENGTH)
  return new Error(
    `Mistral ${action} failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`,
  )
}

function parseJson<T>(action: string, response: RequestUrlResponse): T {
  try {
    return JSON.parse(response.text) as T
  } catch {
    throw new Error(`Mistral ${action} returned an invalid response`)
  }
}

function isOk(response: RequestUrlResponse) {
  return response.status >= 200 && response.status < 300
}

/**
 * Minimal Mistral OCR client over Obsidian's requestUrl (no CORS issues, works
 * on mobile).
 */
export class MistralOcrClient {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor({ apiKey, baseUrl }: { apiKey: string; baseUrl?: string }) {
    this.apiKey = apiKey
    this.baseUrl = resolveMistralBaseUrl(baseUrl)
  }

  async process(
    pdf: ArrayBuffer,
    fileName: string,
    options: OcrRequestOptions,
    onProgress?: (stage: OcrProgressStage) => void,
  ): Promise<MistralOcrResponse> {
    if (pdf.byteLength <= MAX_INLINE_PDF_BYTES) {
      onProgress?.('processing')
      return this.runOcr(
        `data:application/pdf;base64,${arrayBufferToBase64(pdf)}`,
        options,
      )
    }

    onProgress?.('uploading')
    const fileId = await this.uploadFile(pdf, fileName)
    try {
      const url = await this.getSignedUrl(fileId)
      onProgress?.('processing')
      return await this.runOcr(url, options)
    } finally {
      await this.deleteFile(fileId)
    }
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...extra,
    }
  }

  private async runOcr(
    documentUrl: string,
    options: OcrRequestOptions,
  ): Promise<MistralOcrResponse> {
    const response = await requestUrl({
      url: `${this.baseUrl}/ocr`,
      method: 'POST',
      contentType: 'application/json',
      headers: this.headers(),
      body: JSON.stringify(buildOcrRequestBody(documentUrl, options)),
      throw: false,
    })
    if (!isOk(response)) throw describeFailure('OCR request', response)
    const result = parseJson<MistralOcrResponse>('OCR request', response)
    if (!result || !Array.isArray(result.pages)) {
      throw new Error('Mistral OCR response did not contain any pages')
    }
    return result
  }

  private async uploadFile(pdf: ArrayBuffer, fileName: string) {
    const boundary = `----smtcmp-ocr-${uuidv4().replace(/-/g, '')}`
    const response = await requestUrl({
      url: `${this.baseUrl}/files`,
      method: 'POST',
      contentType: `multipart/form-data; boundary=${boundary}`,
      headers: this.headers(),
      body: buildMultipartBody(boundary, [{ name: 'purpose', value: 'ocr' }], {
        name: 'file',
        fileName,
        contentType: 'application/pdf',
        data: pdf,
      }),
      throw: false,
    })
    if (!isOk(response)) throw describeFailure('file upload', response)
    const { id } = parseJson<{ id?: unknown }>('file upload', response)
    if (typeof id !== 'string' || !id) {
      throw new Error('Mistral file upload did not return a file id')
    }
    return id
  }

  private async getSignedUrl(fileId: string) {
    const response = await requestUrl({
      url: `${this.baseUrl}/files/${encodeURIComponent(fileId)}/url?expiry=1`,
      method: 'GET',
      headers: this.headers(),
      throw: false,
    })
    if (!isOk(response)) throw describeFailure('signed URL request', response)
    const { url } = parseJson<{ url?: unknown }>('signed URL request', response)
    if (typeof url !== 'string' || !url) {
      throw new Error('Mistral did not return a signed URL for the upload')
    }
    return url
  }

  private async deleteFile(fileId: string) {
    try {
      const response = await requestUrl({
        url: `${this.baseUrl}/files/${encodeURIComponent(fileId)}`,
        method: 'DELETE',
        headers: this.headers(),
        throw: false,
      })
      if (isOk(response)) return
      console.warn(describeFailure('file deletion', response).message)
    } catch (error) {
      // Cleanup must not hide the OCR result or the original error.
      console.warn('Failed to delete uploaded file from Mistral', error)
    }
    new Notice(
      `Could not delete the uploaded PDF (${fileId}) from Mistral. You can remove it in the Mistral console.`,
    )
  }
}
