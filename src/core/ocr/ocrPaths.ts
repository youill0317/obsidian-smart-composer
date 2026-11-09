export const OCR_ASSET_FOLDER = 'assets'

export function joinVaultPath(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split('/'))
    .filter((segment) => segment.length > 0)
    .join('/')
}

export function getParentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

export function getBaseName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export type OcrOutputPaths = {
  /** Folder that holds the markdown file. */
  outputDir: string
  markdownPath: string
  /** Folder that holds extracted images and the original PDF. */
  assetDir: string
  /** Where the PDF is moved after conversion. */
  movedPdfPath: string
}

export function getOcrOutputPaths(pdfPath: string): OcrOutputPaths {
  const dir = getParentPath(pdfPath)
  // A PDF already moved into the assets folder by an earlier conversion
  // writes next to that folder instead of nesting another one.
  const outputDir =
    dir.slice(dir.lastIndexOf('/') + 1) === OCR_ASSET_FOLDER
      ? getParentPath(dir)
      : dir
  const assetDir = joinVaultPath(outputDir, OCR_ASSET_FOLDER)
  return {
    outputDir,
    markdownPath: joinVaultPath(outputDir, `${getBaseName(pdfPath)}.md`),
    assetDir,
    movedPdfPath: joinVaultPath(
      assetDir,
      pdfPath.slice(pdfPath.lastIndexOf('/') + 1),
    ),
  }
}
