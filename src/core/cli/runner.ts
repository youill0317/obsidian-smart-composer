import { spawn as nodeSpawn } from 'child_process'
import { join } from 'path'
import { StringDecoder } from 'string_decoder'

import { CliExecution } from '../../types/cli.types'

// cross-spawn is also used by the existing MCP SDK. Keep Windows quoting there.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const spawn: typeof nodeSpawn = require('cross-spawn')
const OUTPUT_LIMIT = 64 * 1024

export type CliResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  truncated: boolean
  error?: string
  aborted?: boolean
}

export function runCli(
  execution: CliExecution,
  signal: AbortSignal,
): Promise<CliResult> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({
        stdout: '',
        stderr: '',
        exitCode: null,
        signal: null,
        truncated: false,
        aborted: true,
      })
      return
    }
    const result: CliResult = {
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: null,
      truncated: false,
    }
    const decoders = {
      stdout: new StringDecoder('utf8'),
      stderr: new StringDecoder('utf8'),
    }
    const sizes = { stdout: 0, stderr: 0 }
    let finished = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let child: ReturnType<typeof nodeSpawn>
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      signal.removeEventListener('abort', abort)
      result.stdout += decoders.stdout.end()
      result.stderr += decoders.stderr.end()
      resolve(result)
    }
    const stop = () => {
      if (finished || killTimer) return
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') {
          const killer = nodeSpawn(
            'taskkill.exe',
            ['/pid', String(child.pid), '/t', '/f'],
            { windowsHide: true, stdio: 'ignore' },
          )
          killer.on('error', () => child.kill())
        } else {
          child.kill('SIGKILL')
        }
      }
      killTimer = setTimeout(() => {
        child?.stdout?.destroy()
        child?.stderr?.destroy()
        finish()
      }, 2000)
    }
    const abort = () => {
      result.aborted = true
      stop()
    }
    const timer = setTimeout(() => {
      result.error =
        'CLI timed out. The operation may already have taken effect; verify before retrying.'
      stop()
    }, execution.timeoutSeconds * 1000)
    try {
      const options = {
        cwd: execution.cwd,
        env: process.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
      }
      if (
        process.platform === 'win32' &&
        /\.(cmd|bat)$/i.test(execution.command)
      ) {
        // Batch files parse forwarded arguments twice. cross-spawn only applies
        // this protection to node_modules/.bin/*.cmd; global/custom shims need it too.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const escape = require('cross-spawn/lib/util/escape') as {
          command: (value: string) => string
          argument: (value: string, doubleEscape: boolean) => string
        }
        const commandLine = [
          escape.command(execution.command),
          ...execution.args.map((arg) => escape.argument(arg, true)),
        ].join(' ')
        child = nodeSpawn(
          join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'),
          ['/d', '/v:off', '/s', '/c', `"${commandLine}"`],
          { ...options, windowsVerbatimArguments: true },
        )
      } else {
        child = spawn(execution.command, execution.args, options)
      }
      for (const channel of ['stdout', 'stderr'] as const) {
        child[channel]?.on('data', (chunk: Buffer) => {
          const remaining = Math.max(0, OUTPUT_LIMIT - sizes[channel])
          const accepted = chunk.subarray(0, remaining)
          sizes[channel] += accepted.length
          result[channel] += decoders[channel].write(accepted)
          if (accepted.length < chunk.length) result.truncated = true
        })
      }
      child.on('error', (error) => {
        result.error = error.message
        finish()
      })
      child.on('close', (code, exitSignal) => {
        result.exitCode = code
        result.signal = exitSignal
        finish()
      })
      child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EPIPE') result.error = error.message
      })
      child.stdin?.end(execution.stdin)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
      finish()
    }
  })
}
