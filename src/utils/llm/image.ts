import { Notice } from 'obsidian'

import { MentionableImage } from '../../types/mentionable'

// Larger files are read fully into memory as base64 and stored in chat
// history; providers reject images this big anyway.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export function parseImageDataUrl(dataUrl: string): {
  mimeType: string
  base64Data: string
} {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)/)
  if (!matches) {
    throw new Error('Invalid image data URL format')
  }
  const [, mimeType, base64Data] = matches
  return { mimeType, base64Data }
}

export async function filesToMentionableImages(
  files: File[],
): Promise<MentionableImage[]> {
  const accepted = files.filter((file) => file.size <= MAX_IMAGE_BYTES)
  if (accepted.length < files.length) {
    new Notice('Skipped images larger than 20 MB.')
  }
  return Promise.all(accepted.map(fileToMentionableImage))
}

async function fileToMentionableImage(file: File): Promise<MentionableImage> {
  const base64Data = await fileToBase64(file)
  return {
    type: 'image',
    name: file.name,
    mimeType: file.type,
    data: base64Data,
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
  })
}
