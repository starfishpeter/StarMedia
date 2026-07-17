const fs = require('node:fs/promises')
const path = require('node:path')
const { isPathInside, normalizeFolderName } = require('./file-operations.cjs')
const { getItemAffiliation } = require('./import-service.cjs')

function getVideoStorageFolderName(item) {
  if (item?.library === 'creator') return getItemAffiliation(item)
  return String(item?.originalTitle ?? '').trim() || getItemAffiliation(item) || '未归入合集'
}

function pathsMatch(left, right) {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight
}

function updatePathAfterDirectoryRename(value, oldDirectory, newDirectory) {
  if (typeof value !== 'string' || !value.trim()) return value
  const absolutePath = path.resolve(value)
  if (!isPathInside(oldDirectory, absolutePath)) return value
  return path.join(newDirectory, path.relative(oldDirectory, absolutePath))
}

async function renameVideoContainerDirectory(containerItems, selected, nextFolder, config, fileSystem = fs) {
  const sourceDirectories = [
    ...new Set(
      containerItems
        .map((item) => (typeof item?.sourcePath === 'string' && item.sourcePath.trim() ? path.dirname(path.resolve(item.sourcePath)) : ''))
        .filter(Boolean),
    ),
  ]
  if (sourceDirectories.length === 0) return null
  if (sourceDirectories.length !== 1) throw new Error('这个合集的文件分布在多个文件夹中，暂时无法安全重命名目录')
  const oldDirectory = sourceDirectories[0]
  const newDirectory = path.join(path.dirname(oldDirectory), normalizeFolderName(nextFolder, '', '合集名称'))
  if (pathsMatch(oldDirectory, newDirectory)) return null
  const managedRoot = config?.libraries?.[selected.library]?.rootPath
  if (managedRoot && (!isPathInside(managedRoot, oldDirectory) || !isPathInside(managedRoot, newDirectory)))
    throw new Error('合集目录不在当前媒体库受管理路径内，已中止重命名')
  const directoryStat = await fileSystem.stat(oldDirectory).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (!directoryStat?.isDirectory()) throw new Error('合集实际存储目录不存在，已中止重命名')
  const exists = await fileSystem
    .stat(newDirectory)
    .then(() => true)
    .catch((error) => {
      if (error?.code === 'ENOENT') return false
      throw error
    })
  if (exists) throw new Error('目标合集目录已存在，已中止重命名')
  await fileSystem.rename(oldDirectory, newDirectory)
  const pathByItemId = new Map(
    containerItems.map((item) => [
      item.id,
      {
        sourcePath: updatePathAfterDirectoryRename(item.sourcePath, oldDirectory, newDirectory),
        sidecars: Array.isArray(item.sidecars)
          ? item.sidecars.map((sidecar) => ({
              ...sidecar,
              sourcePath: updatePathAfterDirectoryRename(sidecar.sourcePath, oldDirectory, newDirectory),
            }))
          : item.sidecars,
      },
    ]),
  )
  return { oldDirectory, newDirectory, pathByItemId }
}

async function removeEmptyDirectoriesUpward(startDirectory, protectedRoot, fileSystem = fs) {
  let directory = path.resolve(startDirectory)
  const root = path.resolve(protectedRoot)
  while (directory !== root && isPathInside(root, directory)) {
    const entries = await fileSystem.readdir(directory).catch((error) => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    if (!entries || entries.length > 0) break
    await fileSystem.rmdir(directory)
    directory = path.dirname(directory)
  }
}

module.exports = {
  getVideoStorageFolderName,
  pathsMatch,
  removeEmptyDirectoriesUpward,
  renameVideoContainerDirectory,
  updatePathAfterDirectoryRename,
}
