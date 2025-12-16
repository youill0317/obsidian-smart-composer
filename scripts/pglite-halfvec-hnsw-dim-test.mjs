import { PGlite } from '@electric-sql/pglite'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

async function run(label, fn) {
  try {
    await fn()
    console.log(`✅ ${label}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`❌ ${label}`)
    console.log(`   ${msg.split('\n').join('\n   ')}`)
  }
}

async function main() {
  console.log('PGlite+pgvector dimension test')

  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const vectorBundlePath = path.resolve(
    scriptDir,
    '..',
    'node_modules',
    '@electric-sql',
    'pglite',
    'dist',
    'vector.tar.gz',
  )
  if (!existsSync(vectorBundlePath)) {
    throw new Error(`Missing local vector bundle at: ${vectorBundlePath}`)
  }

  const pg = await PGlite.create({
    extensions: {
      vector: pathToFileURL(vectorBundlePath),
    },
  })

  await pg.query('CREATE EXTENSION IF NOT EXISTS vector;')

  await pg.query('DROP TABLE IF EXISTS t;')
  await pg.query('CREATE TABLE t (id serial primary key, embedding vector);')

  // Vector HNSW – should fail above the max-dimension for vector.
  await run('HNSW vector(1999) index', async () => {
    await pg.query(
      'CREATE INDEX t_vec_hnsw_1999 ON t USING hnsw ((embedding::vector(1999)) vector_cosine_ops);',
    )
  })

  await run('HNSW vector(2001) index (expected to fail)', async () => {
    await pg.query(
      'CREATE INDEX t_vec_hnsw_2001 ON t USING hnsw ((embedding::vector(2001)) vector_cosine_ops);',
    )
  })

  // Halfvec HNSW – expected to allow larger dimensions (e.g., 3072) if supported.
  await run('HNSW halfvec(3072) index', async () => {
    await pg.query(
      'CREATE INDEX t_half_hnsw_3072 ON t USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);',
    )
  })

  await run('HNSW halfvec(4096) index (limit probe)', async () => {
    await pg.query(
      'CREATE INDEX t_half_hnsw_4096 ON t USING hnsw ((embedding::halfvec(4096)) halfvec_cosine_ops);',
    )
  })

  await run('EXPLAIN uses halfvec index shape', async () => {
    await pg.query('SET enable_seqscan = off;')
    const explain = await pg.query(
      `EXPLAIN (COSTS OFF)
       SELECT id
       FROM t
       ORDER BY (embedding::halfvec(3072)) <=> (array_fill(0.0::real, ARRAY[3072])::halfvec(3072))
       LIMIT 5;`,
    )
    console.log(explain.rows.map((r) => r['QUERY PLAN']).join('\n'))
  })

  await pg.close()
}

await main()
