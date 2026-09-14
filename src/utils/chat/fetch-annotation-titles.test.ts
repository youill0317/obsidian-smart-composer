import { Annotation } from '../../types/llm/response'
import { fetchUrlTitle } from '../fetch-utils'

import { fetchAnnotationTitles } from './fetch-annotation-titles'

jest.mock('../fetch-utils', () => ({
  fetchUrlTitle: jest.fn().mockResolvedValue(null),
}))

const mockedFetchUrlTitle = jest.mocked(fetchUrlTitle)

function annotations(first: number, count: number): Annotation[] {
  return Array.from({ length: count }, (_, index) => ({
    type: 'url_citation',
    url_citation: { url: `https://citation-${first + index}.example` },
  }))
}

describe('fetchAnnotationTitles', () => {
  beforeEach(() => mockedFetchUrlTitle.mockClear())

  it('keeps the cache bounded when its oldest URL is empty', () => {
    mockedFetchUrlTitle.mockReturnValue(new Promise(() => undefined))
    fetchAnnotationTitles(
      [{ type: 'url_citation', url_citation: { url: '' } }],
      jest.fn(),
    )
    for (let index = 0; index < 256; index++) {
      fetchAnnotationTitles(annotations(1000 + index, 1), jest.fn())
    }

    mockedFetchUrlTitle.mockClear()
    fetchAnnotationTitles(
      [{ type: 'url_citation', url_citation: { url: '' } }],
      jest.fn(),
    )

    expect(mockedFetchUrlTitle).toHaveBeenCalledTimes(1)
  })

  it('limits title requests across streamed chunks in one response', async () => {
    mockedFetchUrlTitle.mockResolvedValue(null)
    const requestedUrls = new Set<string>()
    fetchAnnotationTitles(
      annotations(0, 6),
      jest.fn(),
      undefined,
      requestedUrls,
    )
    fetchAnnotationTitles(
      annotations(6, 6),
      jest.fn(),
      undefined,
      requestedUrls,
    )
    await Promise.resolve()

    expect(mockedFetchUrlTitle).toHaveBeenCalledTimes(10)
    expect(requestedUrls.size).toBe(10)
  })
})
