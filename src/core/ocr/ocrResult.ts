import { MistralOcrPage } from './ocrTypes'

export type OcrImageFile = {
  /** Image id as returned by the API (unique within the document). */
  id: string
  /** File name written to the vault. */
  fileName: string
  /** Base64 data without any data: URI prefix. */
  base64: string
}

export type CombinedOcrResult = {
  markdown: string
  images: OcrImageFile[]
  pageCount: number
}

export type CombineOcrOptions = {
  includeImages: boolean
  paginate: boolean
  pdfBaseName: string
  /** Image folder relative to the markdown file ('' when beside it). */
  assetLinkDir: string
}

export const PAGE_SEPARATOR = '\n\n---\n\n'

const IMAGE_REF_PATTERN = /!\[([^\]]*)\]\(([^)]*)\)/g
// Image ids the API uses in markdown, e.g. img-0.jpeg
const API_IMAGE_ID_PATTERN = /^img-\d+\.[a-z0-9]+$/i

export function stripDataUriPrefix(data: string): string {
  if (!data.startsWith('data:')) return data
  const comma = data.indexOf(',')
  return comma === -1 ? '' : data.slice(comma + 1)
}

// Characters that would break a markdown link target or be read as an
// Obsidian heading/block reference.
export function encodeMarkdownLinkPath(path: string): string {
  return path.replace(
    /[% \t\r\n()<>#^[\]|]/g,
    (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  )
}

function sanitizeFileNamePart(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '_')
}

export function getImageFileName(pdfBaseName: string, imageId: string) {
  return `${sanitizeFileNamePart(pdfBaseName)}_${sanitizeFileNamePart(imageId)}`
}

function inlineTables(page: MistralOcrPage): string {
  let markdown = page.markdown ?? ''
  for (const table of page.tables ?? []) {
    if (!table?.id) continue
    const placeholder = `[${table.id}](${table.id})`
    markdown = markdown.split(placeholder).join(table.content ?? '')
  }
  return markdown
}

/**
 * Combines OCR pages into one markdown document, collects extracted images and
 * rewrites image references to the files that will be written next to it.
 */
export function combineOcrPages(
  pages: MistralOcrPage[],
  options: CombineOcrOptions,
): CombinedOcrResult {
  const images: OcrImageFile[] = []
  const usedIds = new Set<string>()
  const sortedPages = [...pages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

  const pageMarkdowns = sortedPages.map((page) => {
    // id in this page's markdown -> link target to use instead
    const links = new Map<string, string>()
    const pageImageIds = new Set<string>()
    for (const image of page.images ?? []) {
      if (!image?.id) continue
      pageImageIds.add(image.id)
      const base64 = stripDataUriPrefix(image.image_base64 ?? '')
      if (!options.includeImages || !base64) continue
      const uniqueId = usedIds.has(image.id)
        ? `p${page.index}-${image.id}`
        : image.id
      usedIds.add(uniqueId)
      const fileName = getImageFileName(options.pdfBaseName, uniqueId)
      images.push({ id: uniqueId, fileName, base64 })
      links.set(
        image.id,
        encodeMarkdownLinkPath(
          options.assetLinkDir
            ? `${options.assetLinkDir}/${fileName}`
            : fileName,
        ),
      )
    }

    return inlineTables(page).replace(
      IMAGE_REF_PATTERN,
      (match, alt: string, rawTarget: string) => {
        const target = rawTarget.trim()
        const link = links.get(target)
        if (link) return `![${alt}](${link})`
        // References to images we do not write would be broken links.
        if (pageImageIds.has(target) || API_IMAGE_ID_PATTERN.test(target)) {
          return ''
        }
        return match
      },
    )
  })

  const separator = options.paginate ? PAGE_SEPARATOR : '\n\n'
  const markdown = pageMarkdowns.map((page) => page.trim()).join(separator)
  return {
    markdown: markdown.length > 0 ? `${markdown}\n` : '',
    images,
    pageCount: sortedPages.length,
  }
}
