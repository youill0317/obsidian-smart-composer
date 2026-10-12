import {
  Notice,
  RequestUrlParam,
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
// Uploads and OCR of long documents can take minutes.
export const LONG_REQUEST_TIMEOUT_MS = 10 * 60 * 1000
export const SHORT_REQUEST_TIMEOUT_MS = 60 * 1000

/**
 * requestUrl cannot be cancelled, so this only stops waiting: the request may
 * still finish (and be billed) on Mistral's side.
 */
async function requestWithTimeout(
  action: string,
  params: RequestUrlParam,
  timeoutMs: number,
): Promise<RequestUrlResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Mistral ${action} timed out after ${Math.round(timeoutMs / 1000)} seconds. Mistral may still process (and bill) the request.`,
        ),
      )
    }, timeoutMs)
  })
  try {
    return await Promise.race([requestUrl(params), timeout])
  } finally {
    clearTimeout(timer)
  }
}

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

function leftoverUploadMessage(fileId: string) {
  return `Could not delete the uploaded PDF (${fileId}) from Mistral. You can remove it in the Mistral console.`
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
    let result: MistralOcrResponse
    try {
      const url = await this.getSignedUrl(fileId)
      onProgress?.('processing')
      result = await this.runOcr(url, options)
    } catch (error) {
      if (!(await this.deleteFile(fileId)) && error instanceof Error) {
        // One message for both failures instead of two stacked Notices.
        error.message += ` ${leftoverUploadMessage(fileId)}`
      }
      throw error
    }
    if (!(await this.deleteFile(fileId))) {
      new Notice(leftoverUploadMessage(fileId))
    }
    return result
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
    const response = await requestWithTimeout(
      'OCR request',
      {
        url: `${this.baseUrl}/ocr`,
        method: 'POST',
        contentType: 'application/json',
        headers: this.headers(),
        body: JSON.stringify(buildOcrRequestBody(documentUrl, options)),
        throw: false,
      },
      LONG_REQUEST_TIMEOUT_MS,
    )
    if (!isOk(response)) throw describeFailure('OCR request', response)
    const result = parseJson<MistralOcrResponse | null>('OCR request', response)
    if (!result || !Array.isArray(result.pages) || result.pages.length === 0) {
      throw new Error('Mistral OCR response did not contain any pages')
    }
    return result
  }

  private async uploadFile(pdf: ArrayBuffer, fileName: string) {
    const boundary = `----smtcmp-ocr-${uuidv4().replace(/-/g, '')}`
    const response = await requestWithTimeout(
      'file upload',
      {
        url: `${this.baseUrl}/files`,
        method: 'POST',
        contentType: `multipart/form-data; boundary=${boundary}`,
        headers: this.headers(),
        body: buildMultipartBody(
          boundary,
          [{ name: 'purpose', value: 'ocr' }],
          {
            name: 'file',
            fileName,
            contentType: 'application/pdf',
            data: pdf,
          },
        ),
        throw: false,
      },
      LONG_REQUEST_TIMEOUT_MS,
    )
    if (!isOk(response)) throw describeFailure('file upload', response)
    let id: unknown
    try {
      id = parseJson<{ id?: unknown } | null>('file upload', response)?.id
    } catch {
      id = undefined
    }
    if (typeof id !== 'string' || !id) {
      // The upload succeeded, so the file may be stored without a known id.
      throw new Error(
        'Mistral file upload did not return a file id. The PDF may remain in your Mistral account; you can remove it in the Mistral console.',
      )
    }
    return id
  }

  private async getSignedUrl(fileId: string) {
    const response = await requestWithTimeout(
      'signed URL request',
      {
        url: `${this.baseUrl}/files/${encodeURIComponent(fileId)}/url?expiry=1`,
        method: 'GET',
        headers: this.headers(),
        throw: false,
      },
      SHORT_REQUEST_TIMEOUT_MS,
    )
    if (!isOk(response)) throw describeFailure('signed URL request', response)
    const url = parseJson<{ url?: unknown } | null>(
      'signed URL request',
      response,
    )?.url
    if (typeof url !== 'string' || !url) {
      throw new Error('Mistral did not return a signed URL for the upload')
    }
    return url
  }

  /** Returns false when the uploaded file could not be deleted. */
  private async deleteFile(fileId: string): Promise<boolean> {
    try {
      const response = await requestWithTimeout(
        'file deletion',
        {
          url: `${this.baseUrl}/files/${encodeURIComponent(fileId)}`,
          method: 'DELETE',
          headers: this.headers(),
          throw: false,
        },
        SHORT_REQUEST_TIMEOUT_MS,
      )
      if (isOk(response)) return true
      console.warn(describeFailure('file deletion', response).message)
    } catch (error) {
      // Cleanup must not hide the OCR result or the original error.
      console.warn('Failed to delete uploaded file from Mistral', error)
    }
    return false
  }
}
