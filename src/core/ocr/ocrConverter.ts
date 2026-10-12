import {
  App,
  Notice,
  TAbstractFile,
  TFile,
  TFolder,
  base64ToArrayBuffer,
} from 'obsidian'

import { confirmAsync } from '../../components/modals/ConfirmModal'
import {
  OcrOptions,
  SmartComposerSettings,
} from '../../settings/schema/setting.types'

import { MistralOcrClient, OcrProgressStage } from './mistralOcrClient'
import {
  OcrOutputPaths,
  getOcrOutputPaths,
  getParentPath,
  joinVaultPath,
} from './ocrPaths'
import { combineOcrPages } from './ocrResult'

export const OCR_FRONTMATTER_KEY = 'smtcmp_ocr'

export type OcrFrontmatter = {
  source: string
  source_mtime: number
  model: string
  pages: number
  converted_at: string
}

export function isPdf(file: TAbstractFile | null | undefined): file is TFile {
  return file instanceof TFile && file.extension.toLowerCase() === 'pdf'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Converts PDFs in the vault to markdown with Mistral OCR. Used by the file
 * menu and the command palette; it has no React dependencies.
 */
export class OcrConverter {
  // PDFs currently being converted, so the same PDF never runs twice at once.
  private inFlight = new Map<string, Promise<TFile | null>>()

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SmartComposerSettings,
  ) {}

  /**
   * Converts a PDF and returns the markdown file. Asks before overwriting an
   * existing file and returns null when the user declines or the PDF is
   * already being converted. Applies the move/delete options for the original
   * PDF. Errors are shown as a Notice and rethrown.
   */
  convertFile(pdf: TFile): Promise<TFile | null> {
    const key = pdf.path
    if (this.inFlight.has(key)) {
      new Notice(`${pdf.name} is already being converted.`)
      return Promise.resolve(null)
    }
    const promise = this.convert(pdf).finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, promise)
    return promise
  }

  private async convert(pdf: TFile): Promise<TFile | null> {
    let progress: Notice | null = null
    try {
      const { ocr, providers } = this.getSettings()
      const provider = providers.find((p) => p.id === ocr.providerId)
      if (!provider || provider.type !== 'mistral') {
        throw new Error(
          `OCR provider "${ocr.providerId}" was not found. Add a Mistral provider in Settings > Providers and select it under Document OCR.`,
        )
      }
      if (!provider.apiKey) {
        throw new Error(
          `No API key is set for the "${provider.id}" provider. Add it in Settings > Providers.`,
        )
      }

      const paths = getOcrOutputPaths(pdf.path, ocr)
      this.checkOutputPaths(paths, ocr.includeImages)
      const target = this.app.vault.getAbstractFileByPath(paths.markdownPath)
      if (target && !(target instanceof TFile)) {
        throw new Error(`${paths.markdownPath} already exists as a folder.`)
      }
      if (target) {
        const overwrite = await confirmAsync(this.app, {
          title: 'Overwrite existing file?',
          message: `${target.path} already exists. Replace it with the OCR result of ${pdf.name}?`,
          ctaText: 'Overwrite',
        })
        if (!overwrite) return null
      }

      progress = new Notice(`Reading ${pdf.name}...`, 0)
      const data = await this.app.vault.readBinary(pdf)
      const client = new MistralOcrClient({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
      })
      const response = await client.process(
        data,
        pdf.name,
        {
          model: ocr.model,
          includeImages: ocr.includeImages,
          imageLimit: ocr.imageLimit,
          imageMinSize: ocr.imageMinSize,
          tableFormat: ocr.tableFormat,
        },
        (stage: OcrProgressStage) => {
          progress?.setMessage(
            stage === 'uploading'
              ? `Uploading ${pdf.name} to Mistral...`
              : `Running OCR on ${pdf.name}...`,
          )
        },
      )

      progress.setMessage(`Saving OCR result for ${pdf.name}...`)
      const result = combineOcrPages(response.pages, {
        includeImages: ocr.includeImages,
        paginate: ocr.paginate,
        pdfBaseName: pdf.basename,
        assetLinkDir: paths.assetLinkDir,
      })

      await this.ensureFolder(paths.outputDir)
      if (result.images.length > 0) await this.ensureFolder(paths.assetDir)
      // A leading rule would otherwise be parsed as a frontmatter fence.
      const md = await this.writeText(
        paths.markdownPath,
        result.markdown.startsWith('---')
          ? `\n${result.markdown}`
          : result.markdown,
      )

      let failedImages = 0
      for (const image of result.images) {
        try {
          await this.writeBinary(
            joinVaultPath(paths.assetDir, image.fileName),
            base64ToArrayBuffer(image.base64),
          )
        } catch (error) {
          failedImages++
          console.error(`Failed to save OCR image ${image.fileName}`, error)
        }
      }

      const sourceMtime = pdf.stat.mtime
      // Never delete the only full copy when the result is empty or incomplete.
      const keptReason = !result.hasContent
        ? 'no text was recognized'
        : failedImages > 0
          ? 'some images could not be saved'
          : null
      const keptOriginal = ocr.deleteOriginal && keptReason !== null
      await this.handleOriginal(pdf, paths.movedPdfPath, ocr, keptOriginal)

      if (ocr.writeMetadata) {
        const meta: OcrFrontmatter = {
          source: pdf.path,
          source_mtime: sourceMtime,
          model: response.model ?? ocr.model,
          pages: response.usage_info?.pages_processed ?? result.pageCount,
          converted_at: new Date().toISOString(),
        }
        try {
          await this.app.fileManager.processFrontMatter(
            md,
            (frontmatter: Record<string, unknown>) => {
              frontmatter[OCR_FRONTMATTER_KEY] = meta
            },
          )
        } catch (error) {
          // The note is already written; only the metadata is missing.
          console.error('Failed to write OCR frontmatter', error)
          new Notice(`Could not add OCR metadata to ${md.path}.`)
        }
      }

      progress.hide()
      progress = null
      new Notice(
        `Converted ${pdf.name} to ${md.path} (${result.pageCount} page${result.pageCount === 1 ? '' : 's'}${
          failedImages > 0
            ? `, ${failedImages} image(s) could not be saved`
            : ''
        })${
          keptOriginal
            ? `. ${pdf.name} was not deleted because ${keptReason}.`
            : !result.hasContent
              ? '. No text was recognized.'
              : ''
        }`,
        keptOriginal || !result.hasContent ? 10000 : 5000,
      )
      return md
    } catch (error) {
      new Notice(`OCR failed for ${pdf.name}: ${errorMessage(error)}`, 10000)
      throw error
    } finally {
      progress?.hide()
    }
  }

  /**
   * Fails before the paid API call when an output path cannot be written: a
   * file where a folder is needed, or a name that differs only in letter case
   * from an existing one (case-insensitive file systems reject it).
   */
  private checkOutputPaths(paths: OcrOutputPaths, includeImages: boolean) {
    const folders = includeImages
      ? [paths.outputDir, paths.assetDir]
      : [paths.outputDir]
    for (const folder of folders) {
      let current = ''
      for (const segment of folder.split('/').filter(Boolean)) {
        current = joinVaultPath(current, segment)
        const existing = this.app.vault.getAbstractFileByPath(current)
        if (existing instanceof TFolder) continue
        if (existing) throw new Error(`${current} already exists as a file.`)
        this.assertNoCaseConflict(current)
      }
    }
    if (!this.app.vault.getAbstractFileByPath(paths.markdownPath)) {
      this.assertNoCaseConflict(paths.markdownPath)
    }
  }

  // Call only for a path that does not exist exactly.
  private assertNoCaseConflict(path: string) {
    const parentPath = getParentPath(path)
    const parent = parentPath
      ? this.app.vault.getAbstractFileByPath(parentPath)
      : this.app.vault.getRoot()
    if (!(parent instanceof TFolder)) return
    const lowerPath = path.toLowerCase()
    const conflict = parent.children.find(
      (child) => child.path.toLowerCase() === lowerPath,
    )
    if (conflict) {
      throw new Error(
        `${conflict.path} already exists with different letter case. Rename it or the PDF and try again.`,
      )
    }
  }

  private async handleOriginal(
    pdf: TFile,
    movedPdfPath: string,
    ocr: OcrOptions,
    keepOriginal: boolean,
  ) {
    try {
      if (ocr.deleteOriginal) {
        if (keepOriginal) return
        if (typeof this.app.fileManager.trashFile === 'function') {
          await this.app.fileManager.trashFile(pdf)
        } else {
          await this.app.vault.trash(pdf, true)
        }
        return
      }
      if (
        ocr.movePdfToFolder &&
        ocr.outputLocation === 'subfolder' &&
        pdf.path !== movedPdfPath
      ) {
        if (this.app.vault.getAbstractFileByPath(movedPdfPath)) {
          new Notice(
            `Did not move ${pdf.name}: ${movedPdfPath} already exists.`,
          )
          return
        }
        await this.app.fileManager.renameFile(pdf, movedPdfPath)
      }
    } catch (error) {
      console.error('Failed to move or delete the original PDF', error)
      new Notice(
        `Converted, but the original PDF could not be ${ocr.deleteOriginal ? 'deleted' : 'moved'}: ${errorMessage(error)}`,
      )
    }
  }

  private async ensureFolder(path: string) {
    let current = ''
    for (const segment of path.split('/').filter(Boolean)) {
      current = joinVaultPath(current, segment)
      const existing = this.app.vault.getAbstractFileByPath(current)
      if (existing instanceof TFolder) continue
      if (existing) throw new Error(`${current} already exists as a file.`)
      try {
        await this.app.vault.createFolder(current)
      } catch (error) {
        // Another conversion may have created it in the meantime.
        if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder))
          throw error
      }
    }
  }

  private async writeText(path: string, content: string): Promise<TFile> {
    const existing = this.app.vault.getFileByPath(path)
    if (existing) {
      await this.app.vault.modify(existing, content)
      return existing
    }
    return this.app.vault.create(path, content)
  }

  private async writeBinary(path: string, data: ArrayBuffer) {
    const existing = this.app.vault.getAbstractFileByPath(path)
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, data)
    } else if (existing) {
      throw new Error(`${path} already exists as a folder.`)
    } else {
      await this.app.vault.createBinary(path, data)
    }
  }
}
