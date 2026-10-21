import { DataAdapter, normalizePath } from 'obsidian'

import { VECTOR_STORE_DIR } from '../../../constants'
import { EmbeddingDbStats } from '../../../types/embedding'
import { SelectEmbedding, VectorMetaData } from '../../schema'

// Embeddings live in per-model directories, split into a fixed number of
// shard files by path hash, so an update rewrites only the shards that hold
// changed notes. Everything is kept in memory for exact cosine search.
//
// Shard file layout (little endian):
//   u32 magic | u32 version | u32 header byte length | header JSON (UTF-8)
//   | zero padding to a 4-byte boundary | float32 vectors in header order
const SHARD_MAGIC = 0x53435653
// Bump when the layout or SHARD_COUNT changes; older shards are then
// discarded and their notes re-indexed.
const SHARD_VERSION = 1
const SHARD_COUNT = 64
const PREAMBLE_BYTES = 12

export type VectorStorageAdapter = Pick<
  DataAdapter,
  'exists' | 'mkdir' | 'list' | 'readBinary' | 'writeBinary' | 'remove'
>

export type EmbeddingSearchResult = Omit<SelectEmbedding, 'embedding'> & {
  similarity: number
}

export type SearchScope = { files: string[]; folders: string[] }

export type EmbeddedChunk = {
  content: string
  metadata: VectorMetaData
  embedding: ArrayLike<number>
}

type ShardHeader = {
  model: string
  dimension: number
  files: {
    path: string
    mtime: number
    chunks: { content: string; metadata: VectorMetaData }[]
  }[]
}

type IndexedFile = {
  path: string
  mtime: number
  shard: number
  chunks: { id: number; content: string; metadata: VectorMetaData }[]
  // chunks.length * dimension floats, chunk i at [i * dimension, ...)
  vectors: Float32Array
  norms: Float32Array
}

// Search results need an id that is unique within a session (React key).
let nextChunkId = 1

// Empty scope lists mean the whole vault.
export function isInScope(path: string, scope?: SearchScope): boolean {
  return (
    !scope ||
    (scope.files.length === 0 && scope.folders.length === 0) ||
    scope.files.includes(path) ||
    scope.folders.some((folder) => path.startsWith(`${folder}/`))
  )
}

function shardOf(path: string): number {
  // FNV-1a
  let hash = 0x811c9dc5
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % SHARD_COUNT
}

function shardFileName(shard: number): string {
  return `${String(shard).padStart(2, '0')}.bin`
}

// Model ids such as "voyage/voyage-4" are not valid directory names.
export function modelDirName(modelId: string): string {
  return Array.from(new TextEncoder().encode(modelId), (byte) =>
    /[A-Za-z0-9_-]/.test(String.fromCharCode(byte))
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`,
  ).join('')
}

function computeNorms(vectors: Float32Array, dimension: number): Float32Array {
  const norms = new Float32Array(vectors.length / dimension)
  for (let c = 0; c < norms.length; c++) {
    let sum = 0
    for (let j = c * dimension; j < (c + 1) * dimension; j++) {
      sum += vectors[j] * vectors[j]
    }
    norms[c] = Math.sqrt(sum)
  }
  return norms
}

function encodeShard(
  model: string,
  dimension: number,
  files: IndexedFile[],
): ArrayBuffer {
  const header: ShardHeader = {
    model,
    dimension,
    files: files.map((file) => ({
      path: file.path,
      mtime: file.mtime,
      chunks: file.chunks.map(({ content, metadata }) => ({
        content,
        metadata,
      })),
    })),
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const vectorOffset = Math.ceil((PREAMBLE_BYTES + headerBytes.length) / 4) * 4
  const floatCount = files.reduce((acc, file) => acc + file.vectors.length, 0)

  const buffer = new ArrayBuffer(vectorOffset + floatCount * 4)
  const view = new DataView(buffer)
  view.setUint32(0, SHARD_MAGIC, true)
  view.setUint32(4, SHARD_VERSION, true)
  view.setUint32(8, headerBytes.length, true)
  new Uint8Array(buffer, PREAMBLE_BYTES, headerBytes.length).set(headerBytes)
  const floats = new Float32Array(buffer, vectorOffset, floatCount)
  let offset = 0
  for (const file of files) {
    floats.set(file.vectors, offset)
    offset += file.vectors.length
  }
  return buffer
}

// Returns null for anything that is not a complete shard of this format,
// e.g. a file cut short by a crash during a write.
function parseShard(
  data: ArrayBuffer,
): { header: ShardHeader; floats: Float32Array } | null {
  // A view into a larger buffer (e.g. a Node Buffer) would misplace offsets.
  const buffer = ArrayBuffer.isView(data)
    ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    : data
  if (buffer.byteLength < PREAMBLE_BYTES) return null
  const view = new DataView(buffer)
  if (
    view.getUint32(0, true) !== SHARD_MAGIC ||
    view.getUint32(4, true) !== SHARD_VERSION
  ) {
    return null
  }
  const headerLength = view.getUint32(8, true)
  if (PREAMBLE_BYTES + headerLength > buffer.byteLength) return null

  let header: ShardHeader
  try {
    header = JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(buffer, PREAMBLE_BYTES, headerLength),
      ),
    ) as ShardHeader
  } catch {
    return null
  }
  if (
    typeof header?.model !== 'string' ||
    !Number.isInteger(header.dimension) ||
    header.dimension <= 0 ||
    !Array.isArray(header.files) ||
    !header.files.every(
      (file) =>
        typeof file?.path === 'string' &&
        typeof file.mtime === 'number' &&
        Array.isArray(file.chunks),
    )
  ) {
    return null
  }

  const vectorOffset = Math.ceil((PREAMBLE_BYTES + headerLength) / 4) * 4
  const chunkCount = header.files.reduce(
    (acc, file) => acc + file.chunks.length,
    0,
  )
  if (buffer.byteLength - vectorOffset !== chunkCount * header.dimension * 4) {
    return null
  }
  return {
    header,
    floats: new Float32Array(
      buffer,
      vectorOffset,
      chunkCount * header.dimension,
    ),
  }
}

function decodeShard(
  buffer: ArrayBuffer,
  model: string,
  dimension: number,
): IndexedFile[] | null {
  const parsed = parseShard(buffer)
  if (
    !parsed ||
    parsed.header.model !== model ||
    parsed.header.dimension !== dimension
  ) {
    return null
  }
  let offset = 0
  return parsed.header.files.map((file) => {
    const vectors = parsed.floats.subarray(
      offset,
      offset + file.chunks.length * dimension,
    )
    offset += vectors.length
    return {
      path: file.path,
      mtime: file.mtime,
      shard: shardOf(file.path),
      chunks: file.chunks.map(({ content, metadata }) => ({
        id: nextChunkId++,
        content,
        metadata,
      })),
      vectors,
      norms: computeNorms(vectors, dimension),
    }
  })
}

export class ModelVectorIndex {
  readonly model: string
  readonly dimension: number
  private adapter: VectorStorageAdapter
  private dir: string
  private files = new Map<string, IndexedFile>()
  private dirtyShards = new Set<number>()
  private flushQueue: Promise<void> = Promise.resolve()

  private constructor(
    adapter: VectorStorageAdapter,
    rootDir: string,
    model: string,
    dimension: number,
  ) {
    this.adapter = adapter
    this.model = model
    this.dimension = dimension
    this.dir = normalizePath(`${rootDir}/${modelDirName(model)}`)
  }

  static async load(
    adapter: VectorStorageAdapter,
    rootDir: string,
    model: string,
    dimension: number,
  ): Promise<ModelVectorIndex> {
    const index = new ModelVectorIndex(adapter, rootDir, model, dimension)
    if (!(await adapter.exists(index.dir))) {
      return index
    }
    const shardFiles = (await adapter.list(index.dir)).files.flatMap(
      (filePath) => {
        const match = /(?:^|\/)(\d{2})\.bin$/.exec(filePath)
        const shard = match ? Number(match[1]) : NaN
        return shard < SHARD_COUNT ? [{ filePath, shard }] : []
      },
    )
    await Promise.all(
      shardFiles.map(async ({ filePath, shard }) => {
        const files = decodeShard(
          await adapter.readBinary(filePath),
          model,
          dimension,
        )
        if (!files) {
          // Rewrite or remove it on the next flush; its notes get re-indexed.
          console.warn(`Discarding unreadable embedding shard ${filePath}`)
          index.dirtyShards.add(shard)
          return
        }
        for (const file of files) {
          index.files.set(file.path, file)
          if (file.shard !== shard) {
            index.dirtyShards.add(shard)
            index.dirtyShards.add(file.shard)
          }
        }
      }),
    )
    return index
  }

  get chunkCount(): number {
    let count = 0
    for (const file of this.files.values()) count += file.chunks.length
    return count
  }

  paths(): string[] {
    return [...this.files.keys()]
  }

  getMtime(path: string): number | undefined {
    return this.files.get(path)?.mtime
  }

  // Replaces every chunk of the file.
  setFile(path: string, mtime: number, chunks: EmbeddedChunk[]) {
    if (chunks.length === 0) {
      this.deleteFiles([path])
      return
    }
    const vectors = new Float32Array(chunks.length * this.dimension)
    chunks.forEach((chunk, i) => {
      if (chunk.embedding.length !== this.dimension) {
        throw new Error(
          `Embedding has ${chunk.embedding.length} dimensions, expected ${this.dimension}`,
        )
      }
      vectors.set(chunk.embedding, i * this.dimension)
    })
    const file: IndexedFile = {
      path,
      mtime,
      shard: shardOf(path),
      chunks: chunks.map(({ content, metadata }) => ({
        id: nextChunkId++,
        content,
        metadata,
      })),
      vectors,
      norms: computeNorms(vectors, this.dimension),
    }
    this.files.set(path, file)
    this.dirtyShards.add(file.shard)
  }

  deleteFiles(paths: string[]) {
    for (const path of paths) {
      const file = this.files.get(path)
      if (file) {
        this.files.delete(path)
        this.dirtyShards.add(file.shard)
      }
    }
  }

  clear() {
    this.files.clear()
    for (let shard = 0; shard < SHARD_COUNT; shard++) {
      this.dirtyShards.add(shard)
    }
  }

  search(
    queryVector: number[],
    options: { minSimilarity: number; limit: number; scope?: SearchScope },
  ): EmbeddingSearchResult[] {
    const dimension = this.dimension
    if (queryVector.length !== dimension) {
      throw new Error(
        `Query embedding has ${queryVector.length} dimensions, expected ${dimension}`,
      )
    }
    let queryNorm = 0
    for (const value of queryVector) queryNorm += value * value
    queryNorm = Math.sqrt(queryNorm)

    const matches: { file: IndexedFile; chunk: number; similarity: number }[] =
      []
    for (const file of this.files.values()) {
      if (!isInScope(file.path, options.scope)) continue
      const { vectors, norms } = file
      for (let c = 0; c < norms.length; c++) {
        let dot = 0
        const offset = c * dimension
        for (let j = 0; j < dimension; j++) {
          dot += vectors[offset + j] * queryVector[j]
        }
        // Zero vectors give NaN, which never passes the threshold.
        const similarity = dot / (norms[c] * queryNorm)
        if (similarity > options.minSimilarity) {
          matches.push({ file, chunk: c, similarity })
        }
      }
    }
    matches.sort((a, b) => b.similarity - a.similarity)

    return matches
      .slice(0, options.limit)
      .map(({ file, chunk, similarity }) => ({
        id: file.chunks[chunk].id,
        path: file.path,
        mtime: file.mtime,
        content: file.chunks[chunk].content,
        model: this.model,
        dimension,
        metadata: file.chunks[chunk].metadata,
        similarity,
      }))
  }

  // Writes the shards changed since the last flush. Flushes run one at a
  // time and each writes the current state, so the last one always wins.
  flush(): Promise<void> {
    const run = this.flushQueue.then(() => this.writeDirtyShards())
    this.flushQueue = run.catch(() => undefined)
    return run
  }

  private async writeDirtyShards() {
    const shards = [...this.dirtyShards].sort((a, b) => a - b)
    this.dirtyShards.clear()
    try {
      for (const shard of shards) {
        const filePath = normalizePath(`${this.dir}/${shardFileName(shard)}`)
        const files = [...this.files.values()].filter(
          (file) => file.shard === shard,
        )
        if (files.length === 0) {
          if (await this.adapter.exists(filePath)) {
            await this.adapter.remove(filePath)
          }
          continue
        }
        if (!(await this.adapter.exists(this.dir))) {
          await this.adapter.mkdir(this.dir)
        }
        await this.adapter.writeBinary(
          filePath,
          encodeShard(this.model, this.dimension, files),
        )
      }
    } catch (error) {
      shards.forEach((shard) => this.dirtyShards.add(shard))
      throw error
    }
  }
}

export class VectorStore {
  private adapter: VectorStorageAdapter
  private rootDir: string
  private indexes = new Map<string, Promise<ModelVectorIndex>>()

  constructor(adapter: VectorStorageAdapter, rootDir = VECTOR_STORE_DIR) {
    this.adapter = adapter
    this.rootDir = normalizePath(rootDir)
  }

  // Loads the model's embeddings on first use. Stored vectors of another
  // dimension are discarded, as the model's configured dimension changed.
  async getIndex(model: {
    id: string
    dimension: number
  }): Promise<ModelVectorIndex> {
    const cached = this.indexes.get(model.id)
    if (cached) {
      const index = await cached
      if (index.dimension === model.dimension) {
        return index
      }
      // Pending writes of the old dimension must land before reloading.
      await index.flush().catch(() => undefined)
      if (this.indexes.get(model.id) !== cached) {
        return this.getIndex(model)
      }
    }
    const loading = ModelVectorIndex.load(
      this.adapter,
      this.rootDir,
      model.id,
      model.dimension,
    )
    this.indexes.set(model.id, loading)
    loading.catch(() => {
      if (this.indexes.get(model.id) === loading) {
        this.indexes.delete(model.id)
      }
    })
    return loading
  }

  // Reads the model from disk, bypassing the loaded index.
  async readFromDisk(model: {
    id: string
    dimension: number
  }): Promise<ModelVectorIndex> {
    return ModelVectorIndex.load(
      this.adapter,
      this.rootDir,
      model.id,
      model.dimension,
    )
  }

  // Reads what is on disk, including models that are not loaded.
  async getStats(): Promise<EmbeddingDbStats[]> {
    if (!(await this.adapter.exists(this.rootDir))) {
      return []
    }
    const statsByModel = new Map<string, EmbeddingDbStats>()
    for (const dir of (await this.adapter.list(this.rootDir)).folders) {
      for (const filePath of (await this.adapter.list(dir)).files) {
        if (!filePath.endsWith('.bin')) continue
        const buffer = await this.adapter.readBinary(filePath)
        const parsed = parseShard(buffer)
        if (!parsed) continue
        const { model, files } = parsed.header
        const stats = statsByModel.get(model) ?? {
          model,
          rowCount: 0,
          totalDataBytes: 0,
        }
        stats.rowCount += files.reduce(
          (acc, file) => acc + file.chunks.length,
          0,
        )
        stats.totalDataBytes += buffer.byteLength
        statsByModel.set(model, stats)
      }
    }
    return [...statsByModel.values()].sort((a, b) =>
      a.model.localeCompare(b.model),
    )
  }
}
