export function isSafeRecordId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f-]+$/i.test(id)
}

export function assertSafeRecordId(id: unknown): asserts id is string {
  if (!isSafeRecordId(id)) {
    throw new Error('Invalid record ID')
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
