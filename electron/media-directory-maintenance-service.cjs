const fs = require('node:fs/promises')
const path = require('node:path')
const { isPathInside } = require('./file-operations.cjs')

async function clearEmptyMediaDirectories({ config, libraryIds, fileSystem = fs }) {
  const mediaRoot = String(config?.mediaRoot ?? '').trim()
  if (!path.isAbsolute(mediaRoot)) throw new Error('请先设置有效的媒体数据总目录')
  const rootStat = await fileSystem.stat(mediaRoot).catch(() => null)
  if (!rootStat?.isDirectory()) throw new Error('媒体数据总目录不存在')
  const mediaRootPath = path.resolve(mediaRoot)
  const managedRoots = [
    ...libraryIds
      .map((id) => String(config?.libraries?.[id]?.rootPath ?? '').trim())
      .filter((rootPath) => path.isAbsolute(rootPath))
      .map((rootPath) => path.resolve(rootPath))
      .filter((rootPath) => rootPath === mediaRootPath || isPathInside(mediaRootPath, rootPath)),
  ]
  let removedCount = 0

  async function visit(directory) {
    if (managedRoots.some((rootPath) => isPathInside(rootPath, directory))) return
    const entries = await fileSystem.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      await visit(path.join(directory, entry.name))
    }
    const remaining = await fileSystem.readdir(directory)
    if (remaining.length === 0) {
      await fileSystem.rmdir(directory)
      removedCount += 1
    }
  }

  const entries = await fileSystem.readdir(mediaRootPath, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    await visit(path.join(mediaRootPath, entry.name))
  }
  return { removedCount }
}

module.exports = { clearEmptyMediaDirectories }
