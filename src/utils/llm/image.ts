import { MentionableImage } from '../../types/mentionable'

export const MAX_IMAGE_COUNT = 5
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_TOTAL_IMAGE_BYTES = 25 * 1024 * 1024

const IMAGE_SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  'image/png': (bytes) =>
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
  'image/gif': (bytes) =>
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  'image/webp': (bytes) =>
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50]),
}

export function parseImageDataUrl(dataUrl: string): {
  mimeType: string
  base64Data: string
} {
  const matches = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!matches) {
    throw new Error('Invalid image data URL format')
  }
  const [, mimeType, base64Data] = matches
  return { mimeType, base64Data }
}

export function isSafeImageDataUrl(dataUrl: string): boolean {
  if (dataUrl.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64) return false

  try {
    const { mimeType, base64Data } = parseImageDataUrl(dataUrl)
    const signature = IMAGE_SIGNATURES[mimeType]
    if (!signature || base64ByteLength(base64Data) > MAX_IMAGE_BYTES) {
      return false
    }
    return signature(decodeBase64Prefix(base64Data, 16))
  } catch {
    return false
  }
}

export async function filesToMentionableImages(
  files: File[],
  existingImages: MentionableImage[] = [],
): Promise<MentionableImage[]> {
  if (files.length + existingImages.length > MAX_IMAGE_COUNT) {
    throw new Error(`You can attach up to ${MAX_IMAGE_COUNT} images.`)
  }

  const existingBytes = existingImages.reduce(
    (total, image) => total + imageDataUrlByteLength(image.data),
    0,
  )
  const newBytes = files.reduce((total, file) => total + file.size, 0)
  if (existingBytes + newBytes > MAX_TOTAL_IMAGE_BYTES) {
    throw new Error('Image attachments are limited to 25 MB in total.')
  }

  const images: MentionableImage[] = []
  for (const file of files) {
    images.push(await fileToMentionableImage(file))
  }
  return images
}

export async function fileToMentionableImage(
  file: File,
): Promise<MentionableImage> {
  const signature = IMAGE_SIGNATURES[file.type]
  if (!signature) {
    throw new Error('Only PNG, JPEG, GIF, and WebP images are supported.')
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Each image must be 10 MB or smaller.')
  }
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  if (!signature(header)) {
    throw new Error(`The contents of ${file.name} do not match its image type.`)
  }

  const base64Data = await fileToBase64(file)
  return {
    type: 'image',
    name: file.name,
    mimeType: file.type,
    data: base64Data,
  }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

function base64ByteLength(base64Data: string): number {
  const padding = base64Data.endsWith('==')
    ? 2
    : base64Data.endsWith('=')
      ? 1
      : 0
  return Math.floor((base64Data.length * 3) / 4) - padding
}

export function imageDataUrlByteLength(dataUrl: string): number {
  try {
    return base64ByteLength(parseImageDataUrl(dataUrl).base64Data)
  } catch {
    return MAX_TOTAL_IMAGE_BYTES + 1
  }
}

function decodeBase64Prefix(base64Data: string, byteCount: number): Uint8Array {
  const decoded = atob(base64Data.slice(0, Math.ceil(byteCount / 3) * 4))
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
  })
}
