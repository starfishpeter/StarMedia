const fs = require('node:fs/promises')
const path = require('node:path')

async function mapWithConcurrency(values, worker, concurrency = 8) {
  const list = Array.isArray(values) ? values : []
  if (list.length === 0) return []
  const results = new Array(list.length)
  let nextIndex = 0
  const workerCount = Math.min(Math.max(1, Number(concurrency) || 8), list.length)
  async function runWorker() {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= list.length) return
      results[index] = await worker(list[index], index)
    }
  }
  await Promise.all(Array.from({ length: workerCount }, runWorker))
  return results
}

function createLimiter(limit) {
  const max = Math.max(1, Number(limit) || 8)
  let active = 0
  const waiting = []
  return async function run(task) {
    if (active >= max) await new Promise((resolve) => waiting.push(resolve))
    active += 1
    try {
      return await task()
    } finally {
      active -= 1
      const next = waiting.shift()
      if (next) next()
    }
  }
}

async function measureDirectoryBytes(directoryPath, fileSystem = fs, concurrency = 8) {
  const root = String(directoryPath ?? '').trim()
  if (!path.isAbsolute(root)) return 0
  const limit = createLimiter(concurrency)
  let total = 0

  async function visit(entryPath) {
    const stat = await fileSystem.lstat(entryPath).catch(() => null)
    if (!stat || stat.isSymbolicLink()) return
    if (stat.isFile()) {
      total += stat.size
      return
    }
    if (!stat.isDirectory()) return
    const entries = await fileSystem.readdir(entryPath).catch(() => [])
    await Promise.all(entries.map((entry) => limit(() => visit(path.join(entryPath, entry)))))
  }

  await visit(root)
  return total
}

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
  mapWithConcurrency,
  measureDirectoryBytes,
  pruneCacheDirectory,
  touchCacheFile,
}
