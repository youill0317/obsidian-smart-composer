import {
  App,
  Notice,
  TAbstractFile,
  TFile,
  TFolder,
  base64ToArrayBuffer,
} from 'obsidian'

import { confirmAsync } from '../../components/modals/ConfirmModal'
import { SmartComposerSettings } from '../../settings/schema/setting.types'

import { MistralOcrClient, OcrProgressStage } from './mistralOcrClient'
import {
  getCandidateMarkdownPaths,
  getOcrOutputPaths,
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
 * menu, the command palette and chat mentions; it has no React or chat
 * dependencies.
 */
export class OcrConverter {
  // Concurrent requests for the same PDF share one API call.
  private inFlight = new Map<string, Promise<TFile | null>>()

  constructor(
    private readonly app: App,
    private readonly getSettings: () => SmartComposerSettings,
  ) {}

  /**
   * Returns the markdown produced by an earlier conversion of this PDF, if
   * any. A file whose frontmatter names this PDF as its source wins over a
   * plain path match.
   */
  findExistingMarkdown(pdf: TFile): TFile | null {
    const { ocr } = this.getSettings()
    let fallback: TFile | null = null
    for (const path of getCandidateMarkdownPaths(pdf.path, ocr)) {
      const md = this.app.vault.getFileByPath(path)
      if (!md) continue
      const meta = this.readOcrFrontmatter(md)
      if (meta?.source === pdf.path) return md
      if (fallback) continue
      // A conversion of a different PDF that still exists is not a match.
      const otherSource =
        typeof meta?.source === 'string' &&
        this.app.vault.getFileByPath(meta.source)
      if (!otherSource) fallback = md
    }
    return fallback
  }

  /**
   * Markdown for a PDF mentioned in chat: reuses an earlier conversion when
   * allowed, otherwise converts without prompting.
   */
  async getMarkdownForPdf(pdf: TFile): Promise<TFile | null> {
    if (this.getSettings().ocr.chatReuseExisting) {
      const existing = this.findExistingMarkdown(pdf)
      if (existing) return existing
    }
    return this.convertFile(pdf, { interactive: false })
  }

  /**
   * Converts a PDF and returns the markdown file. Returns null only when the
   * user declines to overwrite an existing file (interactive mode). Errors
   * are shown as a Notice and rethrown.
   *
   * Interactive conversions (file menu, command) ask before overwriting and
   * apply the move/delete options for the original PDF. Non-interactive ones
   * (chat) overwrite only earlier OCR output and never touch the PDF.
   */
  convertFile(
    pdf: TFile,
    { interactive }: { interactive: boolean },
  ): Promise<TFile | null> {
    const key = pdf.path
    const running = this.inFlight.get(key)
    if (running) return running
    const promise = this.convert(pdf, interactive).finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, promise)
    return promise
  }

  private async convert(
    pdf: TFile,
    interactive: boolean,
  ): Promise<TFile | null> {
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
      const target = this.app.vault.getAbstractFileByPath(paths.markdownPath)
      if (target && !(target instanceof TFile)) {
        throw new Error(`${paths.markdownPath} already exists as a folder.`)
      }
      if (target) {
        if (interactive) {
          const overwrite = await confirmAsync(this.app, {
            title: 'Overwrite existing file?',
            message: `${target.path} already exists. Replace it with the OCR result of ${pdf.name}?`,
            ctaText: 'Overwrite',
          })
          if (!overwrite) return null
        } else if (!this.readOcrFrontmatter(target)) {
          // Never silently replace a note that OCR did not create.
          throw new Error(
            `${target.path} already exists and was not created by OCR. Convert the PDF from the file menu to overwrite it.`,
          )
        }
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
      // A leading rule would otherwise be parsed as a frontmatter fence.
      const md = await this.writeText(
        paths.markdownPath,
        result.markdown.startsWith('---')
          ? `\n${result.markdown}`
          : result.markdown,
      )

      let failedImages = 0
      if (result.images.length > 0) {
        await this.ensureFolder(paths.assetDir)
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
      }

      const sourceMtime = pdf.stat.mtime
      if (interactive) await this.handleOriginal(pdf, paths.movedPdfPath)

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
          // The note is already written; missing metadata only affects reuse.
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
        })`,
        5000,
      )
      return md
    } catch (error) {
      new Notice(`OCR failed for ${pdf.name}: ${errorMessage(error)}`, 10000)
      throw error
    } finally {
      progress?.hide()
    }
  }

  private async handleOriginal(pdf: TFile, movedPdfPath: string) {
    const { ocr } = this.getSettings()
    try {
      if (ocr.deleteOriginal) {
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

  private readOcrFrontmatter(md: TFile): Partial<OcrFrontmatter> | null {
    const value: unknown =
      this.app.metadataCache.getFileCache(md)?.frontmatter?.[
        OCR_FRONTMATTER_KEY
      ]
    return value && typeof value === 'object'
      ? (value as Partial<OcrFrontmatter>)
      : null
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
