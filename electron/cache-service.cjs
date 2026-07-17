const fs = require('node:fs/promises')
const path = require('node:path')

async function collectFiles(directory) {
  const files = []

  async function visit(current) {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch (error) {
      if (error && error.code === 'ENOENT') return
      throw error
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
        continue
      }
      if (!entry.isFile()) continue
      const stat = await fs.stat(entryPath)
      files.push({ path: entryPath, size: stat.size, mtimeMs: stat.mtimeMs })
    }
  }

  await visit(directory)
  return files
}

async function removeEmptyDirectories(directory, keepDirectory = directory) {
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return
    throw error
  }

  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyDirectories(path.join(directory, entry.name), keepDirectory)
  }

  if (path.resolve(directory) === path.resolve(keepDirectory)) return
  await fs.rmdir(directory).catch((error) => {
    if (!error || !['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error
  })
}

async function pruneCacheDirectory(cacheDir, maxBytes, protectedPaths = []) {
  const safeLimit = Number.isFinite(maxBytes) && maxBytes >= 0 ? Math.floor(maxBytes) : 0
  const protectedSet = new Set(protectedPaths.map((filePath) => path.resolve(filePath)))
  const files = await collectFiles(cacheDir)
  let sizeBytes = files.reduce((total, file) => total + file.size, 0)
  let removedBytes = 0
  let removedFiles = 0

  for (const file of files.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (sizeBytes <= safeLimit) break
    if (protectedSet.has(path.resolve(file.path))) continue
    await fs.unlink(file.path).catch((error) => {
      if (!error || error.code !== 'ENOENT') throw error
    })
    sizeBytes -= file.size
    removedBytes += file.size
    removedFiles += 1
  }

  await removeEmptyDirectories(cacheDir)
  return { sizeBytes: Math.max(0, sizeBytes), removedBytes, removedFiles, withinLimit: sizeBytes <= safeLimit }
}

async function touchCacheFile(filePath) {
  const now = new Date()
  await fs.utimes(filePath, now, now)
}

async function clearCacheDirectory(cacheDir) {
  await fs.rm(cacheDir, { recursive: true, force: true })
}

module.exports = {
  clearCacheDirectory,
  collectFiles,
  pruneCacheDirectory,
  touchCacheFile,
}
