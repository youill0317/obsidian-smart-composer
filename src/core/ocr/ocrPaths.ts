import { OcrOptions } from '../../settings/schema/setting.types'

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
  /** Folder that holds extracted images. */
  assetDir: string
  /** Image folder relative to the markdown file ('' when beside it). */
  assetLinkDir: string
  /** Where the PDF goes when it is moved into the output folder. */
  movedPdfPath: string
}

export function getOcrOutputPaths(
  pdfPath: string,
  options: Pick<OcrOptions, 'outputLocation' | 'createAssetSubfolder'>,
): OcrOutputPaths {
  const dir = getParentPath(pdfPath)
  const baseName = getBaseName(pdfPath)
  const outputDir =
    options.outputLocation === 'subfolder'
      ? joinVaultPath(dir, baseName)
      : joinVaultPath(dir)
  const assetLinkDir = options.createAssetSubfolder ? OCR_ASSET_FOLDER : ''
  return {
    outputDir,
    markdownPath: joinVaultPath(outputDir, `${baseName}.md`),
    assetDir: joinVaultPath(outputDir, assetLinkDir),
    assetLinkDir,
    movedPdfPath: joinVaultPath(
      outputDir,
      pdfPath.slice(pdfPath.lastIndexOf('/') + 1),
    ),
  }
}

/** Markdown paths a previous conversion of this PDF may have produced. */
export function getCandidateMarkdownPaths(
  pdfPath: string,
  options: Pick<OcrOptions, 'outputLocation'>,
): string[] {
  const preferred = getOcrOutputPaths(pdfPath, {
    outputLocation: options.outputLocation,
    createAssetSubfolder: false,
  }).markdownPath
  const other = getOcrOutputPaths(pdfPath, {
    outputLocation:
      options.outputLocation === 'subfolder' ? 'same-folder' : 'subfolder',
    createAssetSubfolder: false,
  }).markdownPath
  return [preferred, other]
}
