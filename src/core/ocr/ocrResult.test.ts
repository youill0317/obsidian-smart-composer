import {
  PAGE_SEPARATOR,
  combineOcrPages,
  encodeMarkdownLinkPath,
  stripDataUriPrefix,
} from './ocrResult'
import { MistralOcrPage } from './ocrTypes'

const page = (
  index: number,
  markdown: string,
  images: MistralOcrPage['images'] = [],
): MistralOcrPage => ({ index, markdown, images, dimensions: null })

const baseOptions = {
  includeImages: true,
  paginate: false,
  pdfBaseName: 'report',
  assetLinkDir: 'assets',
}

describe('combineOcrPages', () => {
  it('joins pages in index order', () => {
    const result = combineOcrPages(
      [page(1, 'Second'), page(0, '# First\n')],
      baseOptions,
    )
    expect(result.markdown).toBe('# First\n\nSecond\n')
    expect(result.pageCount).toBe(2)
    expect(result.images).toEqual([])
  })

  it('inserts page separators when paginating', () => {
    const result = combineOcrPages([page(0, 'A'), page(1, 'B'), page(2, 'C')], {
      ...baseOptions,
      paginate: true,
    })
    expect(result.markdown).toBe(`A${PAGE_SEPARATOR}B${PAGE_SEPARATOR}C\n`)
  })

  it('returns empty markdown for no pages', () => {
    expect(combineOcrPages([], baseOptions)).toEqual({
      markdown: '',
      images: [],
      pageCount: 0,
    })
  })

  it('rewrites image references into the asset folder', () => {
    const result = combineOcrPages(
      [
        page(0, 'Intro\n\n![img-0.jpeg](img-0.jpeg)', [
          { id: 'img-0.jpeg', image_base64: 'data:image/jpeg;base64,AAAA' },
        ]),
        page(1, '![chart](img-1.png) and ![web](https://example.com/x.png)', [
          { id: 'img-1.png', image_base64: 'BBBB' },
        ]),
      ],
      baseOptions,
    )
    expect(result.markdown).toBe(
      'Intro\n\n![img-0.jpeg](assets/report_img-0.jpeg)\n\n' +
        '![chart](assets/report_img-1.png) and ![web](https://example.com/x.png)\n',
    )
    expect(result.images).toEqual([
      { id: 'img-0.jpeg', fileName: 'report_img-0.jpeg', base64: 'AAAA' },
      { id: 'img-1.png', fileName: 'report_img-1.png', base64: 'BBBB' },
    ])
  })

  it('places images beside the markdown without an asset folder', () => {
    const result = combineOcrPages(
      [
        page(0, '![img-0.jpeg](img-0.jpeg)', [
          { id: 'img-0.jpeg', image_base64: 'AAAA' },
        ]),
      ],
      { ...baseOptions, assetLinkDir: '', pdfBaseName: 'My report (v2)' },
    )
    expect(result.markdown).toBe(
      '![img-0.jpeg](My%20report%20%28v2%29_img-0.jpeg)\n',
    )
    expect(result.images[0].fileName).toBe('My report (v2)_img-0.jpeg')
  })

  it('strips image references when images are excluded', () => {
    const result = combineOcrPages(
      [
        page(0, 'Text ![img-0.jpeg](img-0.jpeg) more ![x](https://a.b/c.png)', [
          { id: 'img-0.jpeg', image_base64: 'AAAA' },
        ]),
      ],
      { ...baseOptions, includeImages: false },
    )
    expect(result.markdown).toBe('Text  more ![x](https://a.b/c.png)\n')
    expect(result.images).toEqual([])
  })

  it('strips references to images without data', () => {
    const result = combineOcrPages(
      [page(0, 'A ![img-3.jpeg](img-3.jpeg) B', [{ id: 'img-3.jpeg' }])],
      baseOptions,
    )
    expect(result.markdown).toBe('A  B\n')
    expect(result.images).toEqual([])
  })

  it('keeps file names unique when ids repeat across pages', () => {
    const result = combineOcrPages(
      [
        page(0, '![a](img-0.jpeg)', [{ id: 'img-0.jpeg', image_base64: 'A' }]),
        page(1, '![b](img-0.jpeg)', [{ id: 'img-0.jpeg', image_base64: 'B' }]),
      ],
      baseOptions,
    )
    expect(result.images.map((i) => i.fileName)).toEqual([
      'report_img-0.jpeg',
      'report_p1-img-0.jpeg',
    ])
    expect(result.markdown).toBe(
      '![a](assets/report_img-0.jpeg)\n\n![b](assets/report_p1-img-0.jpeg)\n',
    )
  })

  it('inlines extracted tables', () => {
    const result = combineOcrPages(
      [
        {
          ...page(0, 'Before\n\n[tbl-0.html](tbl-0.html)\n\nAfter'),
          tables: [
            { id: 'tbl-0.html', content: '<table></table>', format: 'html' },
          ],
        },
      ],
      baseOptions,
    )
    expect(result.markdown).toBe('Before\n\n<table></table>\n\nAfter\n')
  })
})

describe('stripDataUriPrefix', () => {
  it.each([
    ['data:image/png;base64,QUJD', 'QUJD'],
    ['QUJD', 'QUJD'],
    ['data:broken', ''],
  ])('%s -> %s', (input, expected) => {
    expect(stripDataUriPrefix(input)).toBe(expected)
  })
})

describe('encodeMarkdownLinkPath', () => {
  it('encodes characters that break links', () => {
    expect(encodeMarkdownLinkPath('a b/c#1^(x)%.png')).toBe(
      'a%20b/c%231%5E%28x%29%25.png',
    )
    expect(encodeMarkdownLinkPath('보고서_img-0.jpeg')).toBe(
      '보고서_img-0.jpeg',
    )
  })
})
