const fs = require('node:fs/promises')
const path = require('node:path')

async function scanImportSources({ sourcePaths, maxFiles, maxErrors, fileSystem = fs }) {
  const scannedFiles = []
  const errors = []
  let totalFiles = 0
  let truncated = false

  function recordError(value) {
    if (errors.length < maxErrors) errors.push(value)
  }

  async function addFile(filePath, basePath, sourceIsFile = false) {
    totalFiles += 1
    if (totalFiles > maxFiles) {
      truncated = true
      return
    }
    try {
      const stat = await fileSystem.stat(filePath)
      if (!stat.isFile()) {
        recordError(`${filePath}: 来源文件不可用`)
        return
      }
      scannedFiles.push({
        filePath,
        sourcePath: basePath,
        fileName: path.basename(filePath),
        extension: path.extname(filePath).toLowerCase(),
        size: stat.size,
        sourceIsFile,
      })
    } catch (error) {
      recordError(`${filePath}: ${error.message}`)
    }
  }

  async function walk(directory, basePath = directory) {
    if (truncated) return
    let handle
    try {
      handle = await fileSystem.opendir(directory)
    } catch (error) {
      recordError(`${directory}: ${error.message}`)
      return
    }
    try {
      for await (const entry of handle) {
        if (truncated) return
        const entryPath = path.join(directory, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          await walk(entryPath, basePath)
          continue
        }
        if (entry.isFile()) await addFile(entryPath, basePath)
      }
    } finally {
      await handle.close().catch(() => {})
    }
  }

  for (const sourcePath of sourcePaths) {
    if (truncated) break
    let stat
    try {
      stat = await fileSystem.stat(sourcePath)
    } catch (error) {
      recordError(`${sourcePath}: ${error.message}`)
      continue
    }
    if (stat.isDirectory()) await walk(sourcePath)
    else if (stat.isFile()) await addFile(sourcePath, path.dirname(sourcePath), true)
  }

  return { scannedFiles, errors, totalFiles, truncated }
}

module.exports = { scanImportSources }
