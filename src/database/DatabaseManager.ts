import { PgliteDatabase, drizzle } from 'drizzle-orm/pglite'
import { App, Plugin, normalizePath, requestUrl } from 'obsidian'

import { PGLITE_DB_PATH } from '../constants'

import { PGLiteAbortedException } from './exception'
import migrations from './migrations.json'
import { LegacyTemplateManager } from './modules/template/TemplateManager'
import { VectorManager } from './modules/vector/VectorManager'

export class DatabaseManager {
  private app: App
  private plugin: Plugin
  private dbPath: string
  private pgClient: import('@electric-sql/pglite').PGlite | null = null
  private db: PgliteDatabase | null = null
  // WeakMap to prevent circular references
  private static managers = new WeakMap<
    DatabaseManager,
    {
      templateManager?: LegacyTemplateManager
      vectorManager?: VectorManager
    }
  >()

  constructor(app: App, plugin: Plugin, dbPath: string) {
    this.app = app
    this.plugin = plugin
    this.dbPath = dbPath
  }

  static async create(app: App, plugin: Plugin): Promise<DatabaseManager> {
    const dbManager = new DatabaseManager(app, plugin, normalizePath(PGLITE_DB_PATH))
    dbManager.db = await dbManager.loadExistingDatabase()
    if (!dbManager.db) {
      dbManager.db = await dbManager.createNewDatabase()
    }
    await dbManager.migrateDatabase()
    await dbManager.save()

    // WeakMap setup
    const managers = {
      vectorManager: new VectorManager(app, dbManager.db),
      templateManager: new LegacyTemplateManager(app, dbManager.db),
    }

    // save, vacuum callback setup
    const saveCallback = dbManager.save.bind(dbManager) as () => Promise<void>
    const vacuumCallback = dbManager.vacuum.bind(
      dbManager,
    ) as () => Promise<void>

    managers.vectorManager.setSaveCallback(saveCallback)
    managers.vectorManager.setVacuumCallback(vacuumCallback)
    managers.templateManager.setSaveCallback(saveCallback)
    managers.templateManager.setVacuumCallback(vacuumCallback)

    DatabaseManager.managers.set(dbManager, managers)

    console.log('Smart composer database initialized.', dbManager)

    return dbManager
  }

  getDb() {
    return this.db
  }

  getVectorManager(): VectorManager {
    const managers = DatabaseManager.managers.get(this) ?? {}
    if (!managers.vectorManager) {
      if (this.db) {
        managers.vectorManager = new VectorManager(this.app, this.db)
        DatabaseManager.managers.set(this, managers)
      } else {
        throw new Error('Database is not initialized')
      }
    }
    return managers.vectorManager
  }

  getTemplateManager(): LegacyTemplateManager {
    const managers = DatabaseManager.managers.get(this) ?? {}
    if (!managers.templateManager) {
      if (this.db) {
        managers.templateManager = new LegacyTemplateManager(this.app, this.db)
        DatabaseManager.managers.set(this, managers)
      } else {
        throw new Error('Database is not initialized')
      }
    }
    return managers.templateManager
  }

  // vacuum the database to release unused space
  async vacuum() {
    if (!this.pgClient) {
      return
    }
    await this.pgClient.query('VACUUM FULL;')
  }

  private async createNewDatabase() {
    try {
      const PGlite = await this.loadPGliteBrowserOnly()
      const { fsBundle, wasmModule, vectorExtensionBundlePath } =
        await this.loadPGliteResources()
      this.pgClient = await PGlite.create({
        fsBundle: fsBundle,
        wasmModule: wasmModule,
        extensions: {
          vector: vectorExtensionBundlePath,
        },
      })
      const db = drizzle(this.pgClient)
      return db
    } catch (error) {
      console.log('createNewDatabase error', error)
      if (
        error instanceof Error &&
        error.message.includes(
          'Aborted(). Build with -sASSERTIONS for more info.',
        )
      ) {
        // This error occurs when using an outdated Obsidian installer version
        throw new PGLiteAbortedException()
      }
      throw error
    }
  }

  private async loadExistingDatabase(): Promise<PgliteDatabase | null> {
    try {
      const databaseFileExists = await this.app.vault.adapter.exists(
        this.dbPath,
      )
      if (!databaseFileExists) {
        return null
      }
      const fileBuffer = await this.app.vault.adapter.readBinary(this.dbPath)
      const fileBlob = new Blob([fileBuffer], { type: 'application/x-gzip' })
      const PGlite = await this.loadPGliteBrowserOnly()
      const { fsBundle, wasmModule, vectorExtensionBundlePath } =
        await this.loadPGliteResources()
      this.pgClient = await PGlite.create({
        loadDataDir: fileBlob,
        fsBundle: fsBundle,
        wasmModule: wasmModule,
        extensions: {
          vector: vectorExtensionBundlePath,
        },
      })
      return drizzle(this.pgClient)
    } catch (error) {
      console.log('loadExistingDatabase error', error)
      if (
        error instanceof Error &&
        error.message.includes(
          'Aborted(). Build with -sASSERTIONS for more info.',
        )
      ) {
        // This error occurs when using an outdated Obsidian installer version
        throw new PGLiteAbortedException()
      }
      return null
    }
  }

  private async migrateDatabase(): Promise<void> {
    try {
      // Workaround for running Drizzle migrations in a browser environment
      // This method uses an undocumented API to perform migrations
      // See: https://github.com/drizzle-team/drizzle-orm/discussions/2532#discussioncomment-10780523
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      await this.db.dialect.migrate(migrations, this.db.session, {
        migrationsTable: 'drizzle_migrations',
      })
    } catch (error) {
      console.error('Error migrating database:', error)
      throw error
    }
  }

  async save(): Promise<void> {
    if (!this.pgClient) {
      return
    }
    try {
      const blob: Blob = await this.pgClient.dumpDataDir('gzip')
      await this.app.vault.adapter.writeBinary(
        this.dbPath,
        Buffer.from(await blob.arrayBuffer()),
      )
    } catch (error) {
      console.error('Error saving database:', error)
    }
  }

  async cleanup() {
    // save before cleanup
    await this.save()
    // WeakMap cleanup
    DatabaseManager.managers.delete(this)
    await this.pgClient?.close()
    this.pgClient = null
    this.db = null
  }

  private async loadPGliteBrowserOnly() {
    // Obsidian plugins run in a browser-like environment. Even on desktop, Node globals
    // (e.g. process.versions.node) exist and can cause PGlite to choose fs-based loaders
    // for bundles/extensions. We temporarily neutralize node detection for the module
    // evaluation step.
    const previousProcess = (globalThis as unknown as { process?: unknown }).process
    try {
      ;(globalThis as unknown as { process?: unknown }).process = { env: {} }
      const mod = await import('@electric-sql/pglite')
      return mod.PGlite
    } finally {
      ;(globalThis as unknown as { process?: unknown }).process = previousProcess
    }
  }

  // Load PGlite resources from bundled plugin assets (fetchable via app:// URLs).
  private async loadPGliteResources(): Promise<{
    fsBundle: Blob
    wasmModule: WebAssembly.Module
    vectorExtensionBundlePath: URL
  }> {
    try {
      const baseDir = this.plugin.manifest?.dir
      if (!baseDir) {
        throw new Error('Plugin manifest dir is unavailable; cannot locate PGlite assets')
      }

      const resolveResourceUrl = (relativePath: string): URL => {
        const vaultRelative = normalizePath(`${baseDir}/${relativePath}`)
        const resourcePath = this.app.vault.adapter.getResourcePath(vaultRelative)
        return new URL(resourcePath)
      }

      const postgresDataUrl = resolveResourceUrl('pglite/postgres.data')
      const postgresWasmUrl = resolveResourceUrl('pglite/postgres.wasm')
      const vectorTarGzUrl = resolveResourceUrl('pglite/vector.tar.gz')

      // Prefer fetch for app:// resources; fallback to requestUrl in case of environment quirks.
      const fetchArrayBuffer = async (url: URL): Promise<ArrayBuffer> => {
        try {
          const res = await fetch(url.toString())
          if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
          return await res.arrayBuffer()
        } catch {
          const res = await requestUrl(url.toString())
          return res.arrayBuffer
        }
      }

      const [fsBundleBytes, wasmBytes] = await Promise.all([
        fetchArrayBuffer(postgresDataUrl),
        fetchArrayBuffer(postgresWasmUrl),
      ])

      const fsBundle = new Blob([fsBundleBytes], {
        type: 'application/octet-stream',
      })
      const wasmModule = await WebAssembly.compile(wasmBytes)

      return {
        fsBundle,
        wasmModule,
        vectorExtensionBundlePath: vectorTarGzUrl,
      }
    } catch (error) {
      console.error('Error loading PGlite resources:', error)
      throw error
    }
  }
}
