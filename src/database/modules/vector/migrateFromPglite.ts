import { sql } from 'drizzle-orm'
import { PgliteDatabase } from 'drizzle-orm/pglite'
import { App, Notice, normalizePath } from 'obsidian'

import { PGLITE_DB_PATH, VECTOR_STORE_DIR } from '../../../constants'
import { VectorMetaData } from '../../schema'

import { EmbeddedChunk, VectorStore } from './VectorStore'

const MIGRATION_MARKER = '.migrated_from_pglite'
const BATCH_SIZE = 500

type LegacyRow = {
  id: number
  path: string
  mtime: number | string
  content: string
  model: string
  dimension: number
  embedding: string | null
  metadata: VectorMetaData
}

type LegacyFile = { mtime: number; chunks: EmbeddedChunk[]; invalid: boolean }

// Copies embeddings from the legacy PGlite database into the vector store
// once, so existing notes are not re-embedded. The legacy file is left in
// place untouched.
export async function migrateVectorsFromPglite(
  app: App,
  store: VectorStore,
  getDb: () => Promise<PgliteDatabase | null>,
): Promise<void> {
  const adapter = app.vault.adapter
  const markerPath = normalizePath(`${VECTOR_STORE_DIR}/${MIGRATION_MARKER}`)
  if (
    (await adapter.exists(markerPath)) ||
    !(await adapter.exists(normalizePath(PGLITE_DB_PATH)))
  ) {
    return
  }

  const notice = new Notice('Migrating embeddings to the new storage...', 0)
  try {
    const db = await getDb()
    if (!db) {
      throw new Error('Legacy database is not initialized')
    }
    const counts = await copyLegacyEmbeddings(db, store)
    if (!(await adapter.exists(normalizePath(VECTOR_STORE_DIR)))) {
      await adapter.mkdir(normalizePath(VECTOR_STORE_DIR))
    }
    await adapter.write(
      markerPath,
      `Migrated ${counts.migrated} of ${counts.total} embeddings on ${new Date().toISOString()}`,
    )
    notice.setMessage('Embeddings migrated to the new storage')
  } catch (error) {
    notice.setMessage(
      'Failed to migrate embeddings. Vault search is unavailable until it succeeds; see the console for details.',
    )
    throw error
  } finally {
    setTimeout(() => notice.hide(), 5000)
  }
}

export async function copyLegacyEmbeddings(
  db: PgliteDatabase,
  store: VectorStore,
): Promise<{ total: number; migrated: number }> {
  // model -> dimension and path -> file, chunks in id (= chunk) order
  const models = new Map<
    string,
    { dimension: number; files: Map<string, LegacyFile> }
  >()
  let total = 0
  let lastId = 0
  for (;;) {
    const { rows } = await db.execute<LegacyRow>(
      sql`select id, path, mtime, content, model, dimension, embedding::text as embedding, metadata
          from embeddings where id > ${lastId} order by id limit ${BATCH_SIZE}`,
    )
    if (rows.length === 0) break
    lastId = rows[rows.length - 1].id
    total += rows.length

    for (const row of rows) {
      const model = models.get(row.model) ?? {
        dimension: row.dimension,
        files: new Map<string, LegacyFile>(),
      }
      models.set(row.model, model)
      const file = model.files.get(row.path) ?? {
        mtime: Number(row.mtime),
        chunks: [],
        invalid: false,
      }
      model.files.set(row.path, file)
      // Rows of one file share an mtime; the oldest keeps it out of date
      // if they ever differ.
      file.mtime = Math.min(file.mtime, Number(row.mtime))

      const embedding = row.embedding
        ? Float32Array.from(JSON.parse(row.embedding) as number[])
        : null
      if (
        !embedding ||
        embedding.length !== model.dimension ||
        row.dimension !== model.dimension
      ) {
        // Leave the whole file out so it is re-indexed.
        file.invalid = true
        continue
      }
      file.chunks.push({
        content: row.content,
        metadata: row.metadata,
        embedding,
      })
    }
  }

  let migrated = 0
  for (const [modelId, { dimension, files }] of models) {
    const index = await store.getIndex({ id: modelId, dimension })
    // Drops whatever an earlier, interrupted migration left behind.
    index.clear()
    let expected = 0
    for (const [path, file] of files) {
      if (file.invalid) continue
      index.setFile(path, file.mtime, file.chunks)
      expected += file.chunks.length
    }
    await index.flush()
    // Check what reads back from disk; the marker must not be written if
    // the next session would discard the shards.
    const stored = (await store.readFromDisk({ id: modelId, dimension }))
      .chunkCount
    if (stored !== expected) {
      throw new Error(
        `Embedding migration for ${modelId} stored ${stored} of ${expected} chunks`,
      )
    }
    migrated += expected
  }
  return { total, migrated }
}
