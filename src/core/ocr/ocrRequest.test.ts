import {
  buildMultipartBody,
  buildOcrRequestBody,
  resolveMistralBaseUrl,
} from './ocrRequest'

const options = {
  model: 'mistral-ocr-latest',
  includeImages: true,
  imageLimit: 0,
  imageMinSize: 0,
  tableFormat: 'markdown' as const,
}

describe('buildOcrRequestBody', () => {
  it('omits optional fields at their defaults', () => {
    expect(
      buildOcrRequestBody('data:application/pdf;base64,AA', options),
    ).toEqual({
      model: 'mistral-ocr-latest',
      document: {
        type: 'document_url',
        document_url: 'data:application/pdf;base64,AA',
      },
      include_image_base64: true,
    })
  })

  it('includes image limits and html tables when set', () => {
    expect(
      buildOcrRequestBody('https://x/y', {
        ...options,
        model: ' custom-ocr ',
        imageLimit: 5.7,
        imageMinSize: 100,
        tableFormat: 'html',
      }),
    ).toEqual({
      model: 'custom-ocr',
      document: { type: 'document_url', document_url: 'https://x/y' },
      include_image_base64: true,
      image_limit: 5,
      image_min_size: 100,
      table_format: 'html',
    })
  })

  it('drops image options when images are excluded', () => {
    const body = buildOcrRequestBody('u', {
      ...options,
      includeImages: false,
      imageLimit: 3,
      imageMinSize: -1,
      model: '',
    })
    expect(body).toEqual({
      model: 'mistral-ocr-latest',
      document: { type: 'document_url', document_url: 'u' },
      include_image_base64: false,
    })
  })
})

describe('buildMultipartBody', () => {
  it('encodes fields and the file', () => {
    const data = new Uint8Array([0, 1, 2, 255]).buffer
    const body = buildMultipartBody('B', [{ name: 'purpose', value: 'ocr' }], {
      name: 'file',
      fileName: 'a "b".pdf',
      contentType: 'application/pdf',
      data,
    })
    const bytes = new Uint8Array(body)
    const text = Buffer.from(bytes).toString('latin1')
    expect(text).toBe(
      '--B\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nocr\r\n' +
        '--B\r\nContent-Disposition: form-data; name="file"; filename="a %22b%22.pdf"\r\n' +
        'Content-Type: application/pdf\r\n\r\n' +
        '\u0000\u0001\u0002ÿ' +
        '\r\n--B--\r\n',
    )
    expect(body.byteLength).toBe(bytes.length)
  })
})

describe('resolveMistralBaseUrl', () => {
  it.each([
    [undefined, 'https://api.mistral.ai/v1'],
    ['  ', 'https://api.mistral.ai/v1'],
    ['https://proxy.example.com/v1/', 'https://proxy.example.com/v1'],
  ])('%p -> %s', (input, expected) => {
    expect(resolveMistralBaseUrl(input)).toBe(expected)
  })
})
