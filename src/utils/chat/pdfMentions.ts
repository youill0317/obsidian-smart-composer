import { App, Notice, TFile } from 'obsidian'

import { confirmAsync } from '../../components/modals/ConfirmModal'
import { OcrConverter, isPdf } from '../../core/ocr/ocrConverter'
import { SmartComposerSettings } from '../../settings/schema/setting.types'

const BYTES_PER_MB = 1024 * 1024

/**
 * Replaces mentioned PDFs with their OCR markdown so the model reads text
 * instead of binary. Non-PDF files pass through unchanged. PDFs that cannot
 * be converted (declined, OCR disabled, failed) are dropped with a Notice.
 */
export async function resolvePdfMentions({
  files,
  app,
  settings,
  ocrConverter,
}: {
  files: TFile[]
  app: App
  settings: SmartComposerSettings
  ocrConverter?: OcrConverter
}): Promise<TFile[]> {
  const resolved: TFile[] = []
  // Sequential so that at most one confirmation dialog is open at a time.
  for (const file of files) {
    if (!isPdf(file)) {
      resolved.push(file)
      continue
    }
    const md = await resolvePdfMention(file, app, settings, ocrConverter)
    if (md) resolved.push(md)
  }
  // A PDF and its converted note may both be mentioned.
  return resolved.filter(
    (file, index) => resolved.findIndex((f) => f.path === file.path) === index,
  )
}

async function resolvePdfMention(
  pdf: TFile,
  app: App,
  settings: SmartComposerSettings,
  ocrConverter?: OcrConverter,
): Promise<TFile | null> {
  if (!ocrConverter) return null
  const { ocr } = settings

  if (!ocr.chatAutoOcr) {
    const existing = ocrConverter.findExistingMarkdown(pdf)
    if (!existing) {
      new Notice(
        `${pdf.name} was not included: convert it to Markdown (OCR) from the file menu first, or turn on auto OCR in settings.`,
        8000,
      )
    }
    return existing
  }

  const reusable = ocr.chatReuseExisting
    ? ocrConverter.findExistingMarkdown(pdf)
    : null
  if (reusable) return reusable

  if (
    ocr.chatConfirmAboveMb > 0 &&
    pdf.stat.size > ocr.chatConfirmAboveMb * BYTES_PER_MB
  ) {
    const confirmed = await confirmAsync(app, {
      title: 'Run OCR?',
      message: `Run OCR on ${pdf.name} (${(pdf.stat.size / BYTES_PER_MB).toFixed(1)} MB)? This calls the Mistral API and is billed per page.`,
      ctaText: 'Run OCR',
    })
    if (!confirmed) {
      new Notice(`${pdf.name} was not included in the message.`)
      return null
    }
  }

  try {
    return await ocrConverter.getMarkdownForPdf(pdf)
  } catch (error) {
    // The converter already showed a Notice; send the message without it.
    console.error(`OCR failed for mentioned PDF ${pdf.path}`, error)
    return null
  }
}

/**
 * Markdown for the active file when it is a PDF. Only reuses an earlier
 * conversion; the current file never triggers OCR on its own.
 */
export function resolveCurrentPdf(
  pdf: TFile,
  ocrConverter?: OcrConverter,
): TFile | null {
  return ocrConverter?.findExistingMarkdown(pdf) ?? null
}
