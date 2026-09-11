import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { runCli } from './runner'

const windowsTest = process.platform === 'win32' ? it : it.skip
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
