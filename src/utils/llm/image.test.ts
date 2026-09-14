import {
  filesToMentionableImages,
  isSafeImageDataUrl,
  parseImageDataUrl,
} from './image'

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

describe('image attachment validation', () => {
  it('accepts a supported MIME type with a matching signature', () => {
    expect(isSafeImageDataUrl(PNG_DATA_URL)).toBe(true)
  })

  it('rejects MIME/signature mismatches and trailing data', () => {
    expect(isSafeImageDataUrl('data:image/jpeg;base64,iVBORw0KGgo=')).toBe(
      false,
    )
    expect(() => parseImageDataUrl(`${PNG_DATA_URL}anything`)).toThrow()
  })

  it('rejects a batch before reading when it exceeds the image count', async () => {
    await expect(
      filesToMentionableImages(new Array(6).fill({}) as File[]),
    ).rejects.toThrow('up to 5 images')
  })
})
