import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { runCli } from './runner'

const windowsTest = process.platform === 'win32' ? it : it.skip
windowsTest(
  'passes ordinary batch parameters without extra quotes',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'smart-composer-script-'))
    try {
      const command = join(directory, 'direct.cmd')
      writeFileSync(
        command,
        '@echo off\r\nchcp 65001 >nul\r\nset "value=%~1"\r\nset value\r\n',
      )
      for (const argument of [
        'plain',
        '한글 path',
        'a&b',
        '%PATH%',
        '!value!',
        'tail\\',
        'a"b',
        '^',
        '|',
      ]) {
        const result = await runCli(
          {
            cliId: 'test',
            name: 'Test',
            command,
            args: [argument],
            cwd: directory,
            timeoutSeconds: 5,
            automatic: false,
            configuration: '',
            batchArgumentMode: 'direct',
          },
          new AbortController().signal,
        )
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe(`value=${argument}`)
        expect(result.stderr).toBe('')
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

windowsTest(
  'executes batch and npm-style shims with literal arguments',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'smart-composer-cli-'))
    try {
      const script = join(directory, 'args.js')
      writeFileSync(
        script,
        'console.log(JSON.stringify(process.argv.slice(2)))',
      )
      const bin = join(directory, 'node_modules', '.bin')
      mkdirSync(bin, { recursive: true })
      const args = [
        '한글 path',
        'a"b',
        '& echo unexpected',
        '|',
        '%PATH%',
        '!value!',
        '^',
        'tail\\',
      ]
      for (const command of [
        join(directory, 'test.cmd'),
        join(directory, 'test.bat'),
        join(bin, 'test.cmd'),
      ]) {
        writeFileSync(
          command,
          `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`,
        )
        const result = await runCli(
          {
            cliId: 'test',
            name: 'Test',
            command,
            args,
            cwd: directory,
            timeoutSeconds: 5,
            automatic: false,
            configuration: '',
            batchArgumentMode: 'forwarded',
          },
          new AbortController().signal,
        )
        expect({
          command,
          exitCode: result.exitCode,
          stderr: result.stderr,
        }).toEqual({ command, exitCode: 0, stderr: '' })
        expect(JSON.parse(result.stdout)).toEqual(args)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)
