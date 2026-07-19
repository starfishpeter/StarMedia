const fs = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { isPathInside } = require('./file-operations.cjs')
const { getItemAffiliation } = require('./import-service.cjs')

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

  async function trashVideoContainer(input) {
    const id = String(input?.id ?? '').trim()
    if (!id) throw new Error('请选择要删除的合集')
    const [config, library] = await Promise.all([loadConfig(), loadLibrary()])
    const selected = library.items.find((item) => item?.id === id && item.kind === 'video')
    if (!selected) throw new Error('视频合集不存在或已变化')

    const rootPath = String(config.libraries[selected.library]?.rootPath ?? '').trim()
    if (!path.isAbsolute(rootPath)) throw new Error('当前媒体库未配置受管理根目录')
    const resolvedRoot = path.resolve(rootPath)
    const containerName = getItemAffiliation(selected)
    const containerItems = library.items.filter(
      (item) => item?.kind === 'video' && item.library === selected.library && getItemAffiliation(item) === containerName,
    )
    const directories = [
      ...new Set(
        containerItems
          .map((item) =>
            typeof item?.sourcePath === 'string' && path.isAbsolute(item.sourcePath) ? path.dirname(path.resolve(item.sourcePath)) : '',
          )
          .filter(Boolean),
      ),
    ]
    if (directories.length !== 1) throw new Error('这个合集的文件分布在多个文件夹中，无法安全删除整个合集目录')
    const containerDirectory = directories[0]
    if (!isPathInside(resolvedRoot, containerDirectory) || containerDirectory === resolvedRoot)
      throw new Error('合集目录不在当前媒体库受管理路径内')

    const indexedItems = library.items.filter(
      (item) =>
        item?.library === selected.library &&
        typeof item.sourcePath === 'string' &&
        path.isAbsolute(item.sourcePath) &&
        isPathInside(containerDirectory, item.sourcePath),
    )
    const indexedIds = new Set(indexedItems.map((item) => item.id))
    for (const item of containerItems) {
      if (
        typeof item.sourcePath !== 'string' ||
        !path.isAbsolute(item.sourcePath) ||
        !isPathInside(resolvedRoot, item.sourcePath) ||
        !isPathInside(containerDirectory, item.sourcePath)
      )
        throw new Error(`${item.title}: 文件不在待删除的受管理合集目录内`)
    }
    for (const item of indexedItems) {
      for (const sidecar of Array.isArray(item.sidecars) ? item.sidecars : []) {
        if (
          typeof sidecar?.sourcePath !== 'string' ||
          !path.isAbsolute(sidecar.sourcePath) ||
          !isPathInside(resolvedRoot, sidecar.sourcePath) ||
          !isPathInside(containerDirectory, sidecar.sourcePath)
        )
          throw new Error(`${item.title}: 字幕文件不在待删除的受管理合集目录内`)
      }
    }
    const directoryStat = await fileSystem.stat(containerDirectory).catch((error) => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    if (!directoryStat?.isDirectory()) throw new Error('合集实际存储目录不存在，无法删除整个合集')

    await trashItem(containerDirectory)
    const operation = {
      id: `trash-container:${randomUUID()}`,
      type: 'library-container-trash',
      status: 'complete',
      itemIds: [...indexedIds],
      library: selected.library,
      containerName,
      createdAt: new Date().toISOString(),
    }
    const saved = await saveLibrary({
      items: library.items.filter((item) => !indexedIds.has(item.id)),
      operations: [...library.operations, operation],
    })
    return { ...saved, deletedCount: indexedIds.size, containerName }
  }

  return { trashLibraryItems, trashVideoContainer }
}

module.exports = { createLibraryMaintenanceService }
