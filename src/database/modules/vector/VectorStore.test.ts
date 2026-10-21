import { createMemoryAdapter } from './memoryAdapter.testutil'
import { VectorStore, modelDirName } from './VectorStore'

const model = { id: 'provider/model', dimension: 3 }
const dir = `.smtcmp_vector_store/${modelDirName(model.id)}`

function chunk(content: string, embedding: number[], startLine = 1) {
  return { content, metadata: { startLine, endLine: startLine }, embedding }
}

function cosine(a: number[], b: number[]) {
  const dot = a.reduce((acc, x, i) => acc + x * b[i], 0)
  return dot / (Math.hypot(...a) * Math.hypot(...b))
}

it('encodes model ids as safe directory names', () => {
  expect(modelDirName('voyage/voyage-4')).toBe('voyage%2Fvoyage-4')
  expect(modelDirName('nomic:latest*..')).toBe('nomic%3Alatest%2A%2E%2E')
})

it('reloads what it flushed', async () => {
  const { adapter } = createMemoryAdapter()
  const index = await new VectorStore(adapter).getIndex(model)
  index.setFile('notes/a.md', 10, [
    chunk('first', [1, 0, 0], 1),
    chunk('second', [0, 1, 0], 5),
  ])
  index.setFile('b.md', 20, [chunk('third', [0, 0, 1])])
  await index.flush()

  const reloaded = await new VectorStore(adapter).getIndex(model)
  expect(reloaded.paths().sort()).toEqual(['b.md', 'notes/a.md'])
  expect(reloaded.getMtime('notes/a.md')).toBe(10)
  expect(reloaded.search([0, 1, 0], { minSimilarity: 0.5, limit: 10 })).toEqual(
    [
      {
        id: expect.any(Number),
        path: 'notes/a.md',
        mtime: 10,
        content: 'second',
        model: model.id,
        dimension: 3,
        metadata: { startLine: 5, endLine: 5 },
        similarity: 1,
      },
    ],
  )
})

it('ranks like a brute-force cosine search with a strict threshold', async () => {
  const { adapter } = createMemoryAdapter()
  const index = await new VectorStore(adapter).getIndex(model)
  const vectors = Array.from({ length: 40 }, (_, i) => [
    Math.sin(i),
    Math.cos(i * 3),
    (i % 7) - 3,
  ])
  vectors.forEach((v, i) => index.setFile(`f${i}.md`, 1, [chunk(`c${i}`, v)]))
  const query = [0.3, -0.8, 0.5]

  // Float32 storage rounds the vectors, so compare against rounded ones.
  const expected = vectors
    .map((v, i) => ({
      path: `f${i}.md`,
      similarity: cosine(Array.from(Float32Array.from(v)), query),
    }))
    .filter((r) => r.similarity > 0.1)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5)
  const results = index.search(query, { minSimilarity: 0.1, limit: 5 })
  expect(results.map((r) => r.path)).toEqual(expected.map((r) => r.path))
  results.forEach((r, i) =>
    expect(r.similarity).toBeCloseTo(expected[i].similarity, 6),
  )

  index.setFile('orthogonal.md', 1, [chunk('o', [0, 0, 1])])
  expect(
    index
      .search([1, 0, 0], { minSimilarity: 0, limit: 100 })
      .map((r) => r.path),
  ).not.toContain('orthogonal.md')
})

it('limits search to the scope', async () => {
  const { adapter } = createMemoryAdapter()
  const index = await new VectorStore(adapter).getIndex(model)
  for (const path of ['a/x.md', 'ab/y.md', 'c.md']) {
    index.setFile(path, 1, [chunk(path, [1, 0, 0])])
  }
  const search = (scope: { files: string[]; folders: string[] }) =>
    index
      .search([1, 0, 0], { minSimilarity: 0, limit: 10, scope })
      .map((r) => r.path)
      .sort()

  expect(search({ files: [], folders: ['a'] })).toEqual(['a/x.md'])
  expect(search({ files: ['c.md'], folders: ['a'] })).toEqual([
    'a/x.md',
    'c.md',
  ])
  expect(search({ files: [], folders: [] })).toEqual([
    'a/x.md',
    'ab/y.md',
    'c.md',
  ])
})

it('rewrites only the shards that changed', async () => {
  const { adapter } = createMemoryAdapter()
  const index = await new VectorStore(adapter).getIndex(model)
  for (let i = 0; i < 50; i++) {
    index.setFile(`n${i}.md`, 1, [chunk('c', [1, 1, 1])])
  }
  await index.flush()
  adapter.writeBinary.mockClear()

  index.setFile('n7.md', 2, [chunk('changed', [1, 0, 0])])
  await index.flush()
  expect(adapter.writeBinary).toHaveBeenCalledTimes(1)

  await index.flush()
  expect(adapter.writeBinary).toHaveBeenCalledTimes(1)
})

it('discards a damaged shard and replaces it on the next flush', async () => {
  const { adapter, files } = createMemoryAdapter()
  const index = await new VectorStore(adapter).getIndex(model)
  index.setFile('a.md', 1, [chunk('a', [1, 0, 0])])
  await index.flush()
  const [[shardPath, data]] = [...files]
  files.set(shardPath, data.slice(0, 20))
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

  const reloaded = await new VectorStore(adapter).getIndex(model)
  expect(reloaded.paths()).toEqual([])
  expect(warn).toHaveBeenCalled()

  await reloaded.flush()
  expect(files.has(shardPath)).toBe(false)
  warn.mockRestore()
})

it('discards stored vectors when the configured dimension changes', async () => {
  const { adapter } = createMemoryAdapter()
  const store = new VectorStore(adapter)
  const index = await store.getIndex(model)
  index.setFile('a.md', 1, [chunk('a', [1, 0, 0])])
  await index.flush()
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)

  const resized = await store.getIndex({ id: model.id, dimension: 2 })
  expect(resized.dimension).toBe(2)
  expect(resized.paths()).toEqual([])
  expect(() => resized.setFile('a.md', 1, [chunk('a', [1, 0, 0])])).toThrow(
    'expected 2',
  )
  jest.restoreAllMocks()
})

it('clears every shard of the model', async () => {
  const { adapter, files } = createMemoryAdapter()
  const index = await new VectorStore(adapter).getIndex(model)
  for (let i = 0; i < 10; i++) {
    index.setFile(`n${i}.md`, 1, [chunk('c', [1, 1, 1])])
  }
  await index.flush()
  expect(files.size).toBeGreaterThan(1)

  index.clear()
  await index.flush()
  expect(files.size).toBe(0)
})

it('reports stats per model from disk', async () => {
  const { adapter, files } = createMemoryAdapter()
  const store = new VectorStore(adapter)
  const index = await store.getIndex(model)
  index.setFile('a.md', 1, [chunk('a', [1, 0, 0]), chunk('b', [0, 1, 0])])
  index.setFile('b.md', 1, [chunk('c', [0, 0, 1])])
  await index.flush()
  const other = await store.getIndex({ id: 'other', dimension: 2 })
  other.setFile('a.md', 1, [chunk('a', [1, 0])])
  await other.flush()

  const bytes = (prefix: string) =>
    [...files]
      .filter(([path]) => path.startsWith(prefix))
      .reduce((acc, [, data]) => acc + data.byteLength, 0)
  expect(await store.getStats()).toEqual([
    {
      model: 'other',
      rowCount: 1,
      totalDataBytes: bytes('.smtcmp_vector_store/other/'),
    },
    { model: model.id, rowCount: 3, totalDataBytes: bytes(`${dir}/`) },
  ])
})
