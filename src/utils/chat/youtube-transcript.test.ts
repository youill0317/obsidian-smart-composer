import { fetchPublicText } from '../fetch-utils'

import { YoutubeTranscript } from './youtube-transcript'

jest.mock('../fetch-utils', () => ({ fetchPublicText: jest.fn() }))

const mockedFetchPublicText = jest.mocked(fetchPublicText)
const videoPage = `<title>Test - YouTube</title>"captions":${JSON.stringify({
  playerCaptionsTracklistRenderer: {
    captionTracks: [
      {
        languageCode: 'en',
        baseUrl: 'https://www.youtube.com/api/timedtext',
      },
    ],
  },
})},"videoDetails":{}`

describe('YoutubeTranscript', () => {
  beforeEach(() => mockedFetchPublicText.mockReset())

  it('bounds both response bytes and parsed transcript entries', async () => {
    mockedFetchPublicText
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: videoPage,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        text: '<text start="0" dur="1">word</text>'.repeat(25_001),
        url: 'https://www.youtube.com/api/timedtext',
      })
    const signal = new AbortController().signal

    await expect(
      YoutubeTranscript.fetchTranscriptAndMetadata('abcdefghijk', { signal }),
    ).rejects.toThrow('too many entries')
    expect(mockedFetchPublicText.mock.calls[0][1]).toMatchObject({
      maxBytes: 2 * 1024 * 1024,
      signal,
    })
    expect(mockedFetchPublicText.mock.calls[1][1]).toMatchObject({
      maxBytes: 5 * 1024 * 1024,
      signal,
    })
  })
})
