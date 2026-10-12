import { Notice, RequestUrlParam, requestUrl } from 'obsidian'

import { LONG_REQUEST_TIMEOUT_MS, MistralOcrClient } from './mistralOcrClient'
import { MAX_INLINE_PDF_BYTES } from './ocrRequest'

jest.mock('obsidian', () => ({
  Notice: jest.fn(),
  requestUrl: jest.fn(),
  arrayBufferToBase64: (buffer: ArrayBuffer) =>
    Buffer.from(buffer).toString('base64'),
}))

const mockRequestUrl = requestUrl as unknown as jest.Mock

const options = {
  model: 'mistral-ocr-latest',
  includeImages: false,
  imageLimit: 0,
  imageMinSize: 0,
  tableFormat: 'markdown' as const,
}

const ocrPages = { pages: [{ index: 0, markdown: 'Hello' }] }

function respond(status: number, body: unknown) {
  return {
    status,
    text: typeof body === 'string' ? body : JSON.stringify(body),
  }
}

function calls(): RequestUrlParam[] {
  return mockRequestUrl.mock.calls.map(([params]) => params as RequestUrlParam)
}

const client = new MistralOcrClient({ apiKey: 'key' })
const smallPdf = new ArrayBuffer(10)
const largePdf = new ArrayBuffer(MAX_INLINE_PDF_BYTES + 1)

beforeEach(() => {
  mockRequestUrl.mockReset()
  ;(Notice as unknown as jest.Mock).mockClear()
})

describe('MistralOcrClient', () => {
  it('inlines small PDFs as a data URI', async () => {
    mockRequestUrl.mockResolvedValueOnce(respond(200, ocrPages))
    await expect(client.process(smallPdf, 'a.pdf', options)).resolves.toEqual(
      ocrPages,
    )
    expect(calls()).toHaveLength(1)
    expect(calls()[0].url).toBe('https://api.mistral.ai/v1/ocr')
    const body = JSON.parse(calls()[0].body as string)
    expect(body.document.document_url).toMatch(/^data:application\/pdf;base64,/)
  })

  it('uploads large PDFs and deletes them afterwards', async () => {
    mockRequestUrl
      .mockResolvedValueOnce(respond(200, { id: 'file-1' }))
      .mockResolvedValueOnce(respond(200, { url: 'https://signed' }))
      .mockResolvedValueOnce(respond(200, ocrPages))
      .mockResolvedValueOnce(respond(200, {}))
    await client.process(largePdf, 'a.pdf', options)
    expect(calls().map((c) => `${c.method ?? 'GET'} ${c.url}`)).toEqual([
      'POST https://api.mistral.ai/v1/files',
      'GET https://api.mistral.ai/v1/files/file-1/url?expiry=1',
      'POST https://api.mistral.ai/v1/ocr',
      'DELETE https://api.mistral.ai/v1/files/file-1',
    ])
    expect(JSON.parse(calls()[2].body as string).document.document_url).toBe(
      'https://signed',
    )
  })

  it('deletes the upload when OCR fails', async () => {
    mockRequestUrl
      .mockResolvedValueOnce(respond(200, { id: 'file-1' }))
      .mockResolvedValueOnce(respond(200, { url: 'https://signed' }))
      .mockResolvedValueOnce(respond(500, 'server error'))
      .mockResolvedValueOnce(respond(200, {}))
    await expect(client.process(largePdf, 'a.pdf', options)).rejects.toThrow(
      'Mistral OCR request failed (HTTP 500): server error',
    )
    expect(calls()[3].method).toBe('DELETE')
    expect(Notice).not.toHaveBeenCalled()
  })

  it('rejects a response without pages', async () => {
    mockRequestUrl.mockResolvedValueOnce(respond(200, { pages: [] }))
    await expect(client.process(smallPdf, 'a.pdf', options)).rejects.toThrow(
      'did not contain any pages',
    )
  })

  it.each([null, 'not json', { id: '' }])(
    'explains a possible leftover upload when the id is missing: %p',
    async (body) => {
      mockRequestUrl.mockResolvedValueOnce(
        respond(200, body === null ? 'null' : body),
      )
      await expect(client.process(largePdf, 'a.pdf', options)).rejects.toThrow(
        'The PDF may remain in your Mistral account',
      )
      expect(calls()).toHaveLength(1)
    },
  )

  it('stops waiting when a request hangs', async () => {
    jest.useFakeTimers()
    try {
      mockRequestUrl.mockReturnValueOnce(new Promise(() => undefined))
      const result = client.process(smallPdf, 'a.pdf', options)
      const assertion = expect(result).rejects.toThrow(
        'Mistral OCR request timed out',
      )
      await jest.advanceTimersByTimeAsync(LONG_REQUEST_TIMEOUT_MS)
      await assertion
    } finally {
      jest.useRealTimers()
    }
  })
})
