import fs from 'fs/promises'
import path from 'path'

const projectRoot = process.cwd()
const srcDir = path.join(
  projectRoot,
  'node_modules',
  '@electric-sql',
  'pglite',
  'dist',
)

const destDir = path.join(projectRoot, 'pglite')

const filesToCopy = ['postgres.wasm', 'postgres.data', 'vector.tar.gz']

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function main() {
  await fs.mkdir(destDir, { recursive: true })

  for (const filename of filesToCopy) {
    const srcPath = path.join(srcDir, filename)
    const destPath = path.join(destDir, filename)

    if (!(await fileExists(srcPath))) {
      throw new Error(
        `Missing PGlite asset: ${srcPath}. Did you run npm install?`,
      )
    }

    await fs.copyFile(srcPath, destPath)
  }

  // eslint-disable-next-line no-console
  console.log(`Copied PGlite assets to ${destDir}`)
}

await main()
