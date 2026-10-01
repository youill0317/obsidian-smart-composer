import { isPublicHttpUrl } from './fetch-utils'

describe('isPublicHttpUrl', () => {
  it.each([
    'https://example.com/page',
    'http://www.youtube.com/watch?v=abc',
    'https://8.8.8.8/',
    'https://172.32.0.1/',
  ])('allows %s', (url) => {
    expect(isPublicHttpUrl(url)).toBe(true)
  })

  it.each([
    'http://127.0.0.1:8080/',
    'http://2130706433/',
    'http://10.0.0.1/',
    'http://172.16.5.4/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://localhost:3000/',
    'http://app.localhost/',
    'http://printer.local/',
    'http://router/',
    'file:///etc/passwd',
    'not a url',
  ])('blocks %s', (url) => {
    expect(isPublicHttpUrl(url)).toBe(false)
  })
})
