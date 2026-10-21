import { VectorStorageAdapter } from './VectorStore'

// In-memory stand-in for the vault adapter, for tests.
export function createMemoryAdapter() {
  const files = new Map<string, ArrayBuffer>()
  const folders = new Set<string>()
  const parentOf = (path: string) =>
    path.slice(0, Math.max(path.lastIndexOf('/'), 0))
  const addFolder = (path: string) => {
    for (let p = path; p; p = parentOf(p)) folders.add(p)
  }
  const adapter = {
    exists: jest.fn(
      async (path: string) => files.has(path) || folders.has(path),
    ),
    mkdir: jest.fn(async (path: string) => addFolder(path)),
    list: jest.fn(async (path: string) => ({
      files: [...files.keys()].filter((p) => parentOf(p) === path),
      folders: [...folders].filter((p) => parentOf(p) === path),
    })),
    readBinary: jest.fn(async (path: string) => {
      const data = files.get(path)
      if (!data) throw new Error(`ENOENT: ${path}`)
      return data.slice(0)
    }),
    writeBinary: jest.fn(async (path: string, data: ArrayBuffer) => {
      addFolder(parentOf(path))
      files.set(path, data.slice(0))
    }),
    remove: jest.fn(async (path: string) => {
      files.delete(path)
    }),
  }
  return { adapter: adapter as typeof adapter & VectorStorageAdapter, files }
}
