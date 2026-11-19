import { SettingMigration } from '../setting.types'

// Fixed snapshots keep this migration independent of future catalog changes.
export const CHAT_MODELS_ADDED_IN_V26 = [
  {
    providerType: 'openai-plan',
    providerId: 'openai-plan',
    id: 'gpt-6.2-sol (plan)',
    model: 'gpt-6.2-sol',
  },
  {
    providerType: 'openai',
    providerId: 'openai',
    id: 'gpt-6.2-sol',
    model: 'gpt-6.2-sol',
    reasoning: { reasoning_effort: 'medium' },
  },
  {
    providerType: 'gemini',
    providerId: 'gemini',
    id: 'gemini-4-carbon',
    model: 'gemini-4-carbon',
  },
] as const

// Built-in v25 entries whose selection moves to the successor.
const SUPERSEDED_CHAT_MODELS = [
  ['openai-plan', 'gpt-6.1-sol (plan)', 'gpt-6.1-sol', 'gpt-6.2-sol (plan)'],
  ['openai', 'gpt-6.1-sol', 'gpt-6.1-sol', 'gpt-6.2-sol'],
  ['gemini', 'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-4-carbon'],
].map(([providerType, id, model, successorId]) => ({
  providerType,
  providerId: providerType,
  id,
  model,
  successorId,
}))

// Values accepted at request time from v26 on
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const GEMINI_LEVELS = ['low', 'medium', 'high']

type ModelRecord = {
  id?: unknown
  providerType?: unknown
  providerId?: unknown
  model?: unknown
  reasoning?: Record<string, unknown>
  thinking?: Record<string, unknown>
} | null

const toEffort = (effort: unknown) =>
  effort === 'none' || effort === 'minimal'
    ? 'low'
    : EFFORTS.includes(effort as string)
      ? effort
      : undefined

/**
 * Converts each provider's reasoning settings to its single v26 set of
 * controls, keeping what requests sent as close as possible.
 */
const toV26Reasoning = (model: ModelRecord): ModelRecord => {
  if (!model || typeof model !== 'object') return model
  if (model.providerType === 'anthropic') {
    const { thinking: _, ...rest } = model
    return rest
  }
  if (model.providerType === 'openai' || model.providerType === 'openai-plan') {
    const { reasoning, ...rest } = model
    if (!reasoning) return rest
    // v25 OpenAI entries carried an on/off flag; v26 entries have none.
    if ('enabled' in reasoning && reasoning.enabled !== true) return rest
    const { enabled: _, reasoning_effort, ...kept } = reasoning
    const effort = toEffort(reasoning_effort)
    const converted = {
      ...(model.providerType === 'openai-plan' && kept),
      ...(effort !== undefined && { reasoning_effort: effort }),
    }
    return Object.keys(converted).length
      ? { ...rest, reasoning: converted }
      : rest
  }
  if (model.providerType === 'gemini') {
    const { thinking, ...rest } = model
    if (!thinking || ('enabled' in thinking && thinking.enabled !== true)) {
      return rest
    }
    const level =
      thinking.control_mode === 'budget'
        ? undefined
        : thinking.thinking_level === 'minimal'
          ? 'low'
          : thinking.thinking_level === 'xhigh'
            ? 'high'
            : GEMINI_LEVELS.includes(thinking.thinking_level as string)
              ? thinking.thinking_level
              : undefined
    const converted = {
      ...(level !== undefined && { thinking_level: level }),
      ...(thinking.include_thoughts === true && { include_thoughts: true }),
    }
    return Object.keys(converted).length
      ? { ...rest, thinking: converted }
      : rest
  }
  return model
}

export const migrateFrom25To26: SettingMigration['migrate'] = (data) => {
  const newData: Record<string, unknown> = { ...data, version: 26 }
  const hasCatalog = Array.isArray(data.chatModels)
  const models: ModelRecord[] = hasCatalog
    ? (data.chatModels as ModelRecord[]).map(toV26Reasoning)
    : SUPERSEDED_CHAT_MODELS
  const added: ModelRecord[] = []
  const addedIds = new Map<string, string>()
  for (const model of CHAT_MODELS_ADDED_IN_V26) {
    let id: string = model.id
    let suffix = 1
    let existing = models.find((candidate) => candidate?.id === id)
    // Keep a custom entry that reuses the id; the built-in gets its own id.
    while (
      existing &&
      (existing.providerType !== model.providerType ||
        existing.providerId !== model.providerId ||
        existing.model !== model.model)
    ) {
      id = `${model.id}-${++suffix}`
      existing = models.find((candidate) => candidate?.id === id)
    }
    addedIds.set(model.id, id)
    if (!existing) added.push({ ...model, id })
  }
  // Let the settings schema supply the full catalog when none was saved.
  newData.chatModels = hasCatalog ? [...added, ...models] : undefined

  for (const key of ['chatModelId', 'applyModelId']) {
    const selected = models.find((model) => model?.id === data[key])
    const superseded = SUPERSEDED_CHAT_MODELS.find(
      (old) =>
        selected?.id === old.id &&
        selected.providerType === old.providerType &&
        selected.providerId === old.providerId &&
        selected.model === old.model,
    )
    if (superseded) newData[key] = addedIds.get(superseded.successorId)
  }

  // The CLI round limit applied whenever a CLI connection was enabled; it is
  // now the single limit in chatOptions.
  const cli = data.cli as {
    connections?: unknown
    maxAutoIterations?: unknown
  } | null
  if (cli && typeof cli === 'object') {
    const { maxAutoIterations, ...rest } = cli
    newData.cli = rest
    if (
      typeof maxAutoIterations === 'number' &&
      Array.isArray(cli.connections) &&
      cli.connections.some(
        (connection) =>
          (connection as { enabled?: unknown } | null)?.enabled === true,
      )
    ) {
      newData.chatOptions = {
        ...(data.chatOptions as Record<string, unknown> | undefined),
        maxAutoIterations,
      }
    }
  }
  return newData
}
