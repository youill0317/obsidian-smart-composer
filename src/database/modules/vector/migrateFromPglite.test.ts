import { PgliteDatabase } from 'drizzle-orm/pglite'

import { createMemoryAdapter } from './memoryAdapter.testutil'
import { copyLegacyEmbeddings } from './migrateFromPglite'
import { VectorStore } from './VectorStore'

function row(
  id: number,
  path: string,
  model: string,
  dimension: number,
  embedding: number[] | null,
  mtime = 5,
) {
  return {
    id,
    path,
    mtime: String(mtime),
    content: `${path}#${id}`,
    model,
    dimension,
    embedding: embedding && JSON.stringify(embedding),
    metadata: { startLine: id, endLine: id },
  }
}

// Returns the rows once, then an empty batch.
function legacyDb(rows: ReturnType<typeof row>[]) {
  const batches = [rows, []]
  return {
    execute: jest.fn(async () => ({ rows: batches.shift() ?? [] })),
  } as unknown as PgliteDatabase
}

const rows = [
  row(1, 'a.md', 'small', 2, [1, 0], 7),
  row(2, 'b.md', 'small', 2, null),
  row(3, 'a.md', 'small', 2, [0, 1], 5),
  row(4, 'c.md', 'large', 3, [1, 0]),
  row(5, 'd.md', 'large', 3, [0, 0, 1]),
]

it('copies valid files per model and leaves broken ones to re-indexing', async () => {
  const { adapter } = createMemoryAdapter()
  const store = new VectorStore(adapter)

  expect(await copyLegacyEmbeddings(legacyDb(rows), store)).toEqual({
    total: 5,
    migrated: 3,
  })

  const small = await store.readFromDisk({ id: 'small', dimension: 2 })
  expect(small.paths()).toEqual(['a.md'])
  expect(small.getMtime('a.md')).toBe(5)
  expect(
    small
      .search([1, 1], { minSimilarity: 0, limit: 10 })
      .map((r) => r.content)
      .sort(),
  ).toEqual(['a.md#1', 'a.md#3'])
  const large = await store.readFromDisk({ id: 'large', dimension: 3 })
  expect(large.paths()).toEqual(['d.md'])
})

it('fails when the written store does not read back', async () => {
  const { adapter } = createMemoryAdapter()
  adapter.writeBinary.mockImplementation(async () => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)

  await expect(
    copyLegacyEmbeddings(legacyDb(rows), new VectorStore(adapter)),
  ).rejects.toThrow('stored 0 of')
  jest.restoreAllMocks()
})
