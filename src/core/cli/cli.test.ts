import {
  CliExecution,
  cliRequestSchema,
  cliSettingsSchema,
} from '../../types/cli.types'

import { isObsidianReadOnly } from './obsidian-policy'
import { runCli } from './runner'

const execution = (code: string): CliExecution => ({
  cliId: 'node',
  name: 'Node',
  command: process.execPath,
  args: ['-e', code],
  cwd: process.cwd(),
  timeoutSeconds: 5,
  automatic: false,
  configuration: '',
})

it('allows only documented read-only argument forms', () => {
  for (const args of [
    ['help'],
    ['help', 'read'],
    ['version'],
    ['vault', 'info=path'],
    ['search', 'query=a & b', 'limit=5', 'format=json'],
    ['read', 'path=한글 folder/note.md'],
    ['backlinks', 'path=x.md', 'counts'],
  ]) {
    expect(isObsidianReadOnly(args)).toBe(true)
  }
  for (const args of [
    ['read'],
    ['read', 'path=x', '--copy'],
    ['read', 'path=x', 'overwrite'],
    ['read', 'path=x', 'path=y'],
    ['search', 'query=x', 'case=true'],
    ['task', 'done'],
    ['eval', 'code=1'],
    ['command', 'id=x'],
    ['help', 'read', 'extra'],
    ['vault', 'info=name'],
    ['read', 'file=a', 'path=b'],
    ['property:read', 'path=x'],
    ['search'],
    ['delete', 'path=x'],
  ]) {
    expect(isObsidianReadOnly(args)).toBe(false)
  }
  expect(isObsidianReadOnly(['version'], '')).toBe(false)
  expect(
    cliRequestSchema.safeParse({ cliId: 'x', args: ['a\0b'] }).success,
  ).toBe(false)
  expect(
    cliRequestSchema.safeParse({ cliId: 'x', args: ['x'], command: 'other' })
      .success,
  ).toBe(false)
  const first = cliSettingsSchema.parse(undefined)
  first.connections[0].enabled = true
  expect(cliSettingsSchema.parse(undefined).connections[0].enabled).toBe(false)
})

it('round-trips stdin and arguments without shell interpolation', async () => {
  const data = '한글\nline two'
  const args = [
    'space value',
    'a"b',
    '& echo unwanted',
    '|',
    '%PATH%',
    '!x!',
    '^',
    'trailing\\',
  ]
  const input = execution(
    'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>console.log(JSON.stringify([s,process.argv.slice(1)])))',
  )
  const result = await runCli(
    { ...input, stdin: data, args: [...input.args, ...args] },
    new AbortController().signal,
  )
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual([data, args])
})

it('accepts empty success, preserves failure and limits output while draining', async () => {
  expect(
    (await runCli(execution(''), new AbortController().signal)).exitCode,
  ).toBe(0)
  const failed = await runCli(
    execution('console.error("failure");process.exitCode=3'),
    new AbortController().signal,
  )
  expect(failed.exitCode).toBe(3)
  expect(failed.stderr).toContain('failure')
  const large = await runCli(
    execution(
      'process.stdout.write("x".repeat(200000));process.stderr.write("y".repeat(200000))',
    ),
    new AbortController().signal,
  )
  expect(large.exitCode).toBe(0)
  expect(large.stdout.length).toBe(65536)
  expect(large.stderr.length).toBe(65536)
  expect(large.truncated).toBe(true)
})

it('handles spawn errors, timeout and cancellation', async () => {
  expect(
    (
      await runCli(
        { ...execution(''), command: '/missing/cli' },
        new AbortController().signal,
      )
    ).error,
  ).toBeTruthy()
  const timedOut = await runCli(
    { ...execution('setInterval(()=>{},1000)'), timeoutSeconds: 0.05 },
    new AbortController().signal,
  )
  expect(timedOut.error).toContain('timed out')
  const controller = new AbortController()
  const running = runCli(
    execution('setInterval(()=>{},1000)'),
    controller.signal,
  )
  controller.abort()
  expect((await running).aborted).toBe(true)
  expect(
    (await runCli(execution('throw Error("must not run")'), controller.signal))
      .aborted,
  ).toBe(true)
})
