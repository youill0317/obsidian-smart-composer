import { z } from 'zod'

export const CLI_TOOL_NAME = 'sc_cli_execute'
const text = z
  .string()
  .refine((value) => !value.includes('\0'), 'NUL is not allowed')

export const cliConnectionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(1),
  preset: z.enum(['custom', 'obsidian']).default('custom'),
  command: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !value.includes('\0'), 'NUL is not allowed'),
  args: z.array(text).default([]),
  // Preserve the argument handling of connections saved before this option existed.
  batchArgumentMode: z.enum(['direct', 'forwarded']).default('forwarded'),
  cwd: text.default(''),
  instructions: z.string().default(''),
  enabled: z.boolean().default(false),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
})
export type CliConnection = z.infer<typeof cliConnectionSchema>

export const DEFAULT_OBSIDIAN_CLI: CliConnection = {
  id: 'obsidian',
  name: 'Obsidian',
  preset: 'obsidian',
  command: 'Obsidian.com',
  args: [],
  batchArgumentMode: 'direct',
  cwd: '',
  instructions:
    'Use help <command> to check syntax. Search with a limit, read relevant notes, and use exact vault-relative path= targets. The current vault is fixed. Verify changes by reading the result; exit code alone is not proof. Do not automatically retry a timed-out write. For content parameters use literal \\n and \\t as documented by Obsidian.',
  enabled: false,
  timeoutSeconds: 60,
}

export const cliSettingsSchema = z
  .object({
    connections: z.array(cliConnectionSchema).default([DEFAULT_OBSIDIAN_CLI]),
    maxAutoIterations: z.number().int().min(1).max(50).default(10),
  })
  .catch(() => ({
    connections: [{ ...DEFAULT_OBSIDIAN_CLI, args: [] }],
    maxAutoIterations: 10,
  }))

export const cliRequestSchema = z
  .object({
    cliId: z.string(),
    args: z.array(text),
    stdin: text.optional(),
  })
  .strict()

export type CliExecution = {
  cliId: string
  name: string
  command: string
  args: string[]
  cwd: string
  stdin?: string
  timeoutSeconds: number
  batchArgumentMode?: 'direct' | 'forwarded'
  automatic: boolean
  configuration: string
}
