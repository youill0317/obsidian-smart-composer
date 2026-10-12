import { getBaseName, getOcrOutputPaths } from './ocrPaths'

describe('getOcrOutputPaths', () => {
  it('writes next to the PDF in same-folder mode', () => {
    expect(
      getOcrOutputPaths('docs/My report.pdf', {
        outputLocation: 'same-folder',
        createAssetSubfolder: true,
      }),
    ).toEqual({
      outputDir: 'docs',
      markdownPath: 'docs/My report.md',
      assetDir: 'docs/assets',
      assetLinkDir: 'assets',
      movedPdfPath: 'docs/My report.pdf',
    })
  })

  it('writes into a subfolder named after the PDF', () => {
    expect(
      getOcrOutputPaths('docs/a.b.pdf', {
        outputLocation: 'subfolder',
        createAssetSubfolder: false,
      }),
    ).toEqual({
      outputDir: 'docs/a.b',
      markdownPath: 'docs/a.b/a.b.md',
      assetDir: 'docs/a.b',
      assetLinkDir: '',
      movedPdfPath: 'docs/a.b/a.b.pdf',
    })
  })

  it('reuses the subfolder when the PDF is already inside it', () => {
    expect(
      getOcrOutputPaths('docs/report/report.pdf', {
        outputLocation: 'subfolder',
        createAssetSubfolder: true,
      }),
    ).toEqual({
      outputDir: 'docs/report',
      markdownPath: 'docs/report/report.md',
      assetDir: 'docs/report/assets',
      assetLinkDir: 'assets',
      movedPdfPath: 'docs/report/report.pdf',
    })
    expect(
      getOcrOutputPaths('docs/other/report.pdf', {
        outputLocation: 'subfolder',
        createAssetSubfolder: false,
      }).markdownPath,
    ).toBe('docs/other/report/report.md')
    expect(
      getOcrOutputPaths('report.pdf', {
        outputLocation: 'subfolder',
        createAssetSubfolder: false,
      }).markdownPath,
    ).toBe('report/report.md')
  })

  it('handles PDFs at the vault root', () => {
    const paths = getOcrOutputPaths('scan.PDF', {
      outputLocation: 'same-folder',
      createAssetSubfolder: true,
    })
    expect(paths.markdownPath).toBe('scan.md')
    expect(paths.assetDir).toBe('assets')
  })
})

it('getBaseName strips only the last extension', () => {
  expect(getBaseName('a/b.c.pdf')).toBe('b.c')
  expect(getBaseName('.pdf')).toBe('.pdf')
})
