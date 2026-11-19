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

const defaultConnections = () => [{ ...DEFAULT_OBSIDIAN_CLI, args: [] }]

// Keeps what is valid in a broken connection and disables it; null if no
// valid connection can be built (id, name or command invalid or missing).
function salvageConnection(raw: unknown): CliConnection | null {
  const valid = cliConnectionSchema.safeParse(raw)
  if (valid.success) return valid.data
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const salvaged: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(cliConnectionSchema.shape)) {
    const own = field.safeParse(record[key])
    const result = own.success ? own : field.safeParse(undefined)
    if (!result.success) return null
    salvaged[key] = result.data
  }
  const result = cliConnectionSchema.safeParse({ ...salvaged, enabled: false })
  return result.success ? result.data : null
}

export const cliSettingsSchema = z
  .object({
    connections: z
      .array(z.unknown())
      .transform((items) =>
        items.flatMap((item) => salvageConnection(item) ?? []),
      )
      .default(defaultConnections())
      .catch(defaultConnections),
  })
  .catch(() => ({ connections: defaultConnections() }))

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
