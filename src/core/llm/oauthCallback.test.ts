import { once } from 'events'
import * as http from 'http'
import { AddressInfo, connect } from 'net'

import { startCodexCallbackServer } from './codexAuth'
import { startGeminiCallbackServer } from './geminiAuth'

jest.mock('obsidian', () => ({ Platform: { isDesktop: true } }), {
  virtual: true,
})

describe.each([
  ['OpenAI', startCodexCallbackServer],
  ['Gemini', startGeminiCallbackServer],
] as const)('%s OAuth callback', (_name, start) => {
  it.each(['success', 'invalid state', 'timeout'])(
    'settles %s without waiting for an unfinished HTTP connection',
    async (outcome) => {
      const createServer = jest.spyOn(http, 'createServer')
      const callback = start({
        state: 'expected-state',
        redirectUri: 'http://127.0.0.1:0/callback',
        timeoutMs: outcome === 'timeout' ? 100 : 5000,
      }).then(
        (result) => (typeof result === 'string' ? result : result.code),
        (error: Error) => error.message,
      )
      // start() first awaits cleanup of the previous callback server.
      await new Promise<void>((resolve) => setImmediate(resolve))
      const server = createServer.mock.results[0].value as http.Server
      createServer.mockRestore()
      if (!server.listening) await once(server, 'listening')
      const { port } = server.address() as AddressInfo
      const held = connect(port, '127.0.0.1')
      const serverClosed = once(server, 'close')
      let deadline: ReturnType<typeof setTimeout> | undefined
      try {
        await once(held, 'connect')
        held.write('GET /unfinished HTTP/1.1\r\nHost: localhost\r\n')
        const states =
          outcome === 'success'
            ? ['expected-state']
            : outcome === 'invalid state'
              ? ['wrong', 'expected-state']
              : []
        for (const state of states) {
          await new Promise<void>((resolve, reject) => {
            http
              .get(
                {
                  host: '127.0.0.1',
                  port,
                  path: `/callback?state=${state}&code=fake-code`,
                  agent: false,
                },
                (response) => {
                  response.resume()
                  response.on('end', resolve)
                  response.on('error', reject)
                },
              )
              .on('error', reject)
          })
        }
        const result = await Promise.race([
          callback,
          new Promise<string>((resolve) => {
            deadline = setTimeout(() => resolve('still waiting'), 500)
          }),
        ])
        expect(result).toBe(
          outcome === 'timeout'
            ? 'OAuth callback timeout - authorization took too long'
            : 'fake-code',
        )
      } finally {
        clearTimeout(deadline)
        held.destroy()
        await serverClosed
        await callback
      }
    },
  )
})
