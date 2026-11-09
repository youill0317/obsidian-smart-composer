import { getBaseName, getOcrOutputPaths } from './ocrPaths'

describe('getOcrOutputPaths', () => {
  it('writes next to the PDF and moves the PDF into assets', () => {
    expect(getOcrOutputPaths('docs/My report.pdf')).toEqual({
      outputDir: 'docs',
      markdownPath: 'docs/My report.md',
      assetDir: 'docs/assets',
      movedPdfPath: 'docs/assets/My report.pdf',
    })
  })

  it('writes next to the assets folder when the PDF is already inside it', () => {
    expect(getOcrOutputPaths('docs/assets/a.b.pdf')).toEqual({
      outputDir: 'docs',
      markdownPath: 'docs/a.b.md',
      assetDir: 'docs/assets',
      movedPdfPath: 'docs/assets/a.b.pdf',
    })
    expect(getOcrOutputPaths('assets/scan.pdf').markdownPath).toBe('scan.md')
  })

  it('handles PDFs at the vault root', () => {
    const paths = getOcrOutputPaths('scan.PDF')
    expect(paths.markdownPath).toBe('scan.md')
    expect(paths.assetDir).toBe('assets')
    expect(paths.movedPdfPath).toBe('assets/scan.PDF')
  })
})

it('getBaseName strips only the last extension', () => {
  expect(getBaseName('a/b.c.pdf')).toBe('b.c')
  expect(getBaseName('.pdf')).toBe('.pdf')
})
