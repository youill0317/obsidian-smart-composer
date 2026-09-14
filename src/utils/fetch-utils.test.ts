import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

import { Platform } from 'obsidian'

import {
  ResponseTooLargeError,
  UnsafeUrlError,
  fetchBoundedText,
  fetchPublicText,
  fetchUrlTitle,
  isPublicIpAddress,
} from './fetch-utils'

const mockLookup = jest.fn()
const mockRequest = jest.fn()

jest.mock('obsidian', () => ({ Platform: { isDesktop: true } }))
jest.mock('dns', () => ({
  promises: { lookup: mockLookup },
}))
jest.mock('http', () => ({
  request: mockRequest,
}))
jest.mock('https', () => ({
  request: mockRequest,
}))

function queueResponse(
  status: number,
  headers: Record<string, string>,
  body = '',
): void {
  mockRequest.mockImplementationOnce(
    (
      _options: unknown,
      onResponse: (
        response: PassThrough & { statusCode?: number; headers: object },
      ) => void,
    ) => {
      const request = new EventEmitter() as EventEmitter & {
        end: () => void
        destroy: (error?: Error) => void
      }
      request.destroy = (error) => error && request.emit('error', error)
      request.end = () => {
        const response = new PassThrough() as PassThrough & {
          statusCode?: number
          headers: object
        }
        response.statusCode = status
        response.headers = headers
        onResponse(response)
        response.end(body)
      }
      return request
    },
  )
}

describe('bounded HTTP helpers', () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
  )

  beforeEach(() => {
    mockLookup.mockReset()
    mockRequest.mockReset()
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'Smart Composer test browser' },
    })
  })

  afterEach(() => {
    Platform.isDesktop = true
    jest.restoreAllMocks()
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator)
    } else {
      Reflect.deleteProperty(globalThis, 'navigator')
    }
  })

  it('gives mobile users an actionable attachment error', async () => {
    Platform.isDesktop = false

    await expect(fetchPublicText('https://example.com')).rejects.toThrow(
      'Remove the attachment or paste its content instead',
    )
  })

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('blocks non-public address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false)
  })

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'allows public address %s',
    (address) => {
      expect(isPublicIpAddress(address)).toBe(true)
    },
  )

  it('blocks a hostname when any DNS answer is private', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])

    await expect(fetchPublicText('https://example.com')).rejects.toBeInstanceOf(
      UnsafeUrlError,
    )
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('pins a public DNS answer and blocks a redirect to loopback', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    queueResponse(302, { location: 'http://127.0.0.1/private' })

    await expect(fetchPublicText('https://example.com')).rejects.toBeInstanceOf(
      UnsafeUrlError,
    )
    expect(mockRequest.mock.calls[0][0]).toMatchObject({
      hostname: '93.184.216.34',
      servername: 'example.com',
      headers: {
        'Accept-Encoding': 'identity',
        'User-Agent': 'Smart Composer test browser',
      },
    })
  })

  it('supports a runtime without browser user agent information', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: undefined })
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    queueResponse(200, {}, 'public page')

    await expect(fetchPublicText('https://example.com')).resolves.toMatchObject(
      {
        text: 'public page',
      },
    )
    expect(mockRequest.mock.calls[0][0].headers).not.toHaveProperty(
      'User-Agent',
    )
  })

  it('stops reading a public response at the byte limit', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    queueResponse(200, {}, '12345')

    await expect(
      fetchPublicText('https://example.com', { maxBytes: 4 }),
    ).rejects.toBeInstanceOf(ResponseTooLargeError)
  })

  it('can safely return a bounded prefix for title extraction', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    queueResponse(200, { 'content-length': '1000' }, '12345')

    await expect(
      fetchPublicText('https://example.com', { maxBytes: 4, truncate: true }),
    ).resolves.toMatchObject({ text: '1234' })
  })

  it('limits extracted citation titles', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    queueResponse(
      200,
      { 'content-type': 'text/html' },
      `<title>${'x'.repeat(1000)}</title>`,
    )

    await expect(fetchUrlTitle('https://example.com')).resolves.toHaveLength(
      512,
    )
  })

  it('rejects compressed public content instead of parsing encoded bytes', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    queueResponse(200, { 'content-encoding': 'gzip' }, 'encoded')

    await expect(fetchPublicText('https://example.com')).rejects.toThrow(
      'unsupported compressed content',
    )
  })

  it('aborts while DNS resolution is pending', async () => {
    mockLookup.mockReturnValue(new Promise(() => undefined))
    const controller = new AbortController()
    const request = fetchPublicText('https://example.com', {
      signal: controller.signal,
    })
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('applies a deadline while DNS resolution is pending', async () => {
    mockLookup.mockReturnValue(new Promise(() => undefined))

    await expect(
      fetchPublicText('https://example.com', { timeoutMs: 1 }),
    ).rejects.toThrow('timed out')
  })

  it('bounds configured endpoint responses without applying the SSRF policy', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('12345', { status: 200 }))

    await expect(
      fetchBoundedText('http://127.0.0.1/provider', {}, { maxBytes: 4 }),
    ).rejects.toBeInstanceOf(ResponseTooLargeError)
  })
})
