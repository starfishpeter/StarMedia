const fs = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { isPathInside } = require('./file-operations.cjs')

function createLibraryMaintenanceService({ loadConfig, loadLibrary, saveLibrary, trashItem, fileSystem = fs }) {
  if (
    typeof loadConfig !== 'function' ||
    typeof loadLibrary !== 'function' ||
    typeof saveLibrary !== 'function' ||
    typeof trashItem !== 'function'
  )
    throw new Error('资料库维护服务依赖不可用')

  async function trashLibraryItems(input) {
    const ids = [...new Set(Array.isArray(input?.ids) ? input.ids.map((id) => String(id)).filter(Boolean) : [])]
    if (ids.length === 0 || ids.length > 1000) throw new Error('请选择要删除的媒体')
    const [config, library] = await Promise.all([loadConfig(), loadLibrary()])
    const selectedIds = new Set(ids)
    const selected = library.items.filter((item) => selectedIds.has(item?.id))
    if (selected.length !== ids.length) throw new Error('选中的媒体不存在或已变化')

    // Validate every path before handing any file to the irreversible system recycle bin.
    const availablePathsByItemId = new Map()
    const missingMediaIds = new Set()
    for (const item of selected) {
      const rootPath = config.libraries[item.library]?.rootPath ?? ''
      if (!path.isAbsolute(rootPath)) throw new Error(`${item.title}: 未配置媒体库受管理根目录`)
      const itemFiles = [{ sourcePath: item.sourcePath, label: item.title }]
      for (const sidecar of Array.isArray(item.sidecars) ? item.sidecars : [])
        itemFiles.push({ sourcePath: sidecar?.sourcePath, label: `${item.title} 的字幕` })
      const availablePaths = []
      for (const file of itemFiles) {
        if (typeof file.sourcePath !== 'string' || !path.isAbsolute(file.sourcePath) || !isPathInside(rootPath, file.sourcePath))
          throw new Error(`${file.label}: 文件不在当前媒体库受管理路径内`)
        const resolvedPath = path.resolve(file.sourcePath)
        let stat
        try {
          stat = await fileSystem.stat(resolvedPath)
        } catch (error) {
          if (error?.code !== 'ENOENT') throw new Error(`${file.label}: ${error.message}`, { cause: error })
        }
        if (!stat) {
          if (resolvedPath === path.resolve(item.sourcePath)) missingMediaIds.add(item.id)
          continue
        }
        if (!stat.isFile()) throw new Error(`${file.label}: 路径不是文件`)
        availablePaths.push(resolvedPath)
      }
      availablePathsByItemId.set(item.id, availablePaths)
    }

    const deletedIds = new Set()
    const partialIds = new Set()
    const errors = []
    let failed = false
    for (const item of selected) {
      if (failed) break
      const itemPaths = availablePathsByItemId.get(item.id) ?? []
      const mediaPath = path.resolve(item.sourcePath)
      let mediaAccepted = missingMediaIds.has(item.id)
      for (const filePath of itemPaths) {
        try {
          await trashItem(filePath)
          if (filePath === mediaPath) mediaAccepted = true
        } catch (error) {
          errors.push(`${item.title}: ${error.message}`)
          if (mediaAccepted) partialIds.add(item.id)
          failed = true
          break
        }
      }
      // The media file is submitted first. Once accepted, its record must no longer point to an unavailable file.
      if (mediaAccepted) deletedIds.add(item.id)
    }
    if (failed && deletedIds.size === 0) throw new Error(errors[0])

    const parentDirectories = [
      ...new Set(
        selected
          .filter((item) => deletedIds.has(item.id))
          .map((item) => (typeof item.sourcePath === 'string' ? path.dirname(path.resolve(item.sourcePath)) : ''))
          .filter(Boolean),
      ),
    ]
    for (const initialDirectory of parentDirectories) {
      const item = selected.find((candidate) => path.dirname(path.resolve(candidate.sourcePath)) === initialDirectory)
      const libraryRoot = path.resolve(config.libraries[item?.library]?.rootPath ?? '')
      let directory = initialDirectory
      while (path.isAbsolute(libraryRoot) && isPathInside(libraryRoot, directory) && path.resolve(directory) !== libraryRoot) {
        const directoryStat = await fileSystem.stat(directory).catch(() => null)
        if (!directoryStat?.isDirectory()) break
        const remaining = await fileSystem.readdir(directory)
        if (remaining.length > 0) break
        await trashItem(directory)
        directory = path.dirname(directory)
      }
    }

    const operation = {
      id: `trash:${randomUUID()}`,
      type: 'library-trash',
      status: failed ? 'partial' : 'complete',
      itemIds: [...deletedIds],
      ...(failed
        ? {
            failedItemIds: selected.filter((item) => !deletedIds.has(item.id)).map((item) => item.id),
            partialItemIds: [...partialIds],
            errors,
          }
        : {}),
      createdAt: new Date().toISOString(),
    }
    const saved = await saveLibrary({
      items: library.items.filter((item) => !deletedIds.has(item.id)),
      operations: [...library.operations, operation],
    })
    return {
      ...saved,
      deletedCount: deletedIds.size,
      recordOnlyCount: [...deletedIds].filter((id) => missingMediaIds.has(id)).length,
      ...(failed ? { failedCount: partialIds.size + selected.length - deletedIds.size, errors } : {}),
    }
  }

  return { trashLibraryItems }
}

module.exports = { createLibraryMaintenanceService }
