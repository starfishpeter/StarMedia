const fs = require('node:fs/promises')
const { createHash, randomUUID } = require('node:crypto')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { buildManagedTargetPath, isPathInside, moveFileSafely, normalizeFolderName } = require('./file-operations.cjs')
const { getItemAffiliation } = require('./import-service.cjs')
const { isPosterLibrary: defaultIsPosterLibrary } = require('./library-definitions.cjs')
const { getVideoStorageFolderName, pathsMatch, renameVideoContainerDirectory } = require('./library-file-layout-service.cjs')
const { writeFileAtomically } = require('./library-store.cjs')
const { updateVideoMetadataForLibrary } = require('./video-service.cjs')

async function rollbackTransferredFiles(moves, moveFile = moveFileSafely) {
  const errors = []
  for (const move of [...moves].reverse()) {
    if (!move.moved) continue
    try {
      await moveFile(move.targetPath, move.sourcePath)
    } catch (error) {
      errors.push(`${path.basename(move.targetPath)}: ${error.message}`)
    }
  }
  if (errors.length > 0) throw new Error(errors.join('；'))
}

function createLibraryMetadataService({
  getConfigPaths,
  loadConfig,
  loadLibrary,
  saveLibrary,
  removeEmptyDirectories = async () => {},
  isPosterLibrary = defaultIsPosterLibrary,
  fileSystem = fs,
  moveFile = moveFileSafely,
  atomicWrite = writeFileAtomically,
}) {
  if (
    typeof getConfigPaths !== 'function' ||
    typeof loadConfig !== 'function' ||
    typeof loadLibrary !== 'function' ||
    typeof saveLibrary !== 'function'
  )
    throw new Error('资料库元数据服务依赖不可用')

  async function prepareBookshelfRename(containerItems, selected, nextShelf, config) {
    const rootPath = String(config?.libraries?.[selected.library]?.rootPath ?? '').trim()
    const currentShelf = String(selected.shelf ?? '').trim()
    if (!currentShelf) throw new Error('未归入书架的本子不能修改书架名称')
    if (!path.isAbsolute(rootPath)) throw new Error('当前媒体库尚未设置受管理根目录')
    const reservedTargets = new Set()
    const moves = []
    for (const item of containerItems) {
      if (typeof item?.sourcePath !== 'string' || !item.sourcePath) throw new Error('书架内存在无效的本子路径')
      const sourcePath = path.resolve(item.sourcePath)
      if (!isPathInside(rootPath, sourcePath)) throw new Error('本子文件不在当前媒体库受管理路径内')
      const targetPath = buildManagedTargetPath({ rootPath, folderName: nextShelf, fallbackFolderName: '', sourcePath })
      const targetKey = process.platform === 'win32' ? targetPath.toLocaleLowerCase() : targetPath
      if (reservedTargets.has(targetKey)) throw new Error('书架重命名后存在同名文件冲突')
      reservedTargets.add(targetKey)
      const stat = await fileSystem.stat(sourcePath).catch(() => null)
      if (!stat?.isFile()) throw new Error(`本子文件不可用：${path.basename(sourcePath)}`)
      if (
        !pathsMatch(sourcePath, targetPath) &&
        (await fileSystem
          .stat(targetPath)
          .then(() => true)
          .catch((error) => (error?.code === 'ENOENT' ? false : Promise.reject(error))))
      )
        throw new Error(`目标书架已存在同名文件：${path.basename(targetPath)}`)
      moves.push({ id: item.id, sourcePath, targetPath })
    }
    return { rootPath, currentShelf, moves }
  }

  async function updateVideoMetadata(input) {
    const library = await loadLibrary()
    const current = library.items.find((item) => item?.id === input.id && item.kind === 'video')
    if (!current) throw new Error('视频记录不存在')
    let cover
    if (input.thumbnailDataUrl) {
      const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(input.thumbnailDataUrl)
      if (!match) throw new Error('视频缩略图格式无效')
      const buffer = Buffer.from(match[1], 'base64')
      if (buffer.length === 0 || buffer.length > 3 * 1024 * 1024) throw new Error('视频缩略图大小无效')
      const { coversDir } = getConfigPaths()
      const coverDir = path.join(coversDir, 'videos')
      await fileSystem.mkdir(coverDir, { recursive: true })
      const thumbnailPath = path.join(coverDir, `${createHash('sha1').update(`${input.id}:${match[1]}`).digest('hex')}.jpg`)
      const exists = await fileSystem
        .stat(thumbnailPath)
        .then(() => true)
        .catch((error) => (error?.code === 'ENOENT' ? false : Promise.reject(error)))
      if (!exists) await atomicWrite(thumbnailPath, buffer)
      cover = `url("${pathToFileURL(thumbnailPath).toString()}") center / cover`
    }
    return updateVideoMetadataForLibrary({
      id: input.id,
      durationSeconds: input.durationSeconds,
      cover: isPosterLibrary(current.library) ? undefined : cover,
      episodeCover: isPosterLibrary(current.library) ? cover : undefined,
      library,
      saveLibrary,
    })
  }

  async function updateContainerInfo(input) {
    const hasTags = Array.isArray(input.tags)
    const hasName = typeof input.name === 'string'
    const hasOriginalTitle = typeof input.originalTitle === 'string'
    const hasStudio = typeof input.studio === 'string'
    const hasFirstAiredAt = typeof input.firstAiredAt === 'string'
    const hasReleaseDate = typeof input.releaseDate === 'string'
    const hasEmbeddedSubtitles = typeof input.hasEmbeddedSubtitles === 'boolean'
    const config = hasTags || hasName || hasOriginalTitle ? await loadConfig() : null
    let tags
    if (hasTags) {
      const allowedTags = new Set(config.catalog.tags)
      tags = [...new Set(input.tags.map((tag) => String(tag).trim()).filter(Boolean))]
      if (tags.some((tag) => !allowedTags.has(tag))) throw new Error('包含未在标签管理中保存的标签')
    }
    const name = hasName ? normalizeFolderName(input.name.trim(), '', '合集名称') : undefined
    const hasNote = typeof input.note === 'string'
    const note = hasNote ? input.note.trim().slice(0, 1200) : undefined
    const originalTitle = hasOriginalTitle ? input.originalTitle.trim().slice(0, 200) : undefined
    const studio = hasStudio ? input.studio.trim().slice(0, 200) : undefined
    const firstAiredAt = hasFirstAiredAt ? input.firstAiredAt.trim().slice(0, 40) : undefined
    const releaseDate = hasReleaseDate ? input.releaseDate.trim().slice(0, 40) : undefined
    const library = await loadLibrary()
    const index = library.items.findIndex((item) => item?.id === input.id)
    if (index < 0) throw new Error('媒体记录不存在')
    const selected = library.items[index]
    if (hasTags && (selected.library === 'creator' || selected.library === 'general')) throw new Error('原创和综合合集不支持统一标签')
    const isSameContainer = (item) =>
      item?.library === selected.library &&
      item?.kind === selected.kind &&
      (selected.kind === 'video'
        ? getItemAffiliation(item) === getItemAffiliation(selected)
        : selected.shelf
          ? String(item?.shelf ?? '').trim() === selected.shelf.trim()
          : item?.id === selected.id)
    const containerItems = library.items.filter(isSameContainer)
    const oldAffiliation = getItemAffiliation(selected)
    const oldShelf = String(selected.shelf ?? '').trim()
    const nextAffiliation = hasName && selected.kind === 'video' ? name : oldAffiliation
    const nextShelf = hasName && selected.kind === 'book' ? normalizeFolderName(name, '', '书架名称') : oldShelf
    if (hasName && selected.kind === 'book' && !oldShelf) throw new Error('未归入书架的本子不能修改书架名称')
    const nextStorageFolder =
      selected.kind === 'video'
        ? selected.library === 'creator'
          ? hasName
            ? nextAffiliation
            : getVideoStorageFolderName(selected)
          : hasOriginalTitle
            ? originalTitle || nextAffiliation
            : getVideoStorageFolderName(selected)
        : ''
    const renamedDirectory =
      selected.kind === 'video' && (hasOriginalTitle || (selected.library === 'creator' && hasName))
        ? await renameVideoContainerDirectory(containerItems, selected, nextStorageFolder, config, fileSystem)
        : null
    const bookshelfRename =
      selected.kind === 'book' && hasName ? await prepareBookshelfRename(containerItems, selected, nextShelf, config) : null
    const movedBooks = []
    const items = library.items.map((item) => {
      if (!isSameContainer(item)) return item
      const renamed = renamedDirectory?.pathByItemId.get(item.id)
      const bookMove = bookshelfRename?.moves.find((move) => move.id === item.id)
      return {
        ...item,
        ...(hasName && selected.kind === 'video' ? { affiliation: nextAffiliation } : {}),
        ...(hasName && selected.kind === 'book'
          ? {
              shelf: nextShelf,
              sourcePath: bookMove?.targetPath,
              relativePath: bookMove ? path.relative(bookshelfRename.rootPath, bookMove.targetPath) : item.relativePath,
            }
          : {}),
        ...(renamed ? { sourcePath: renamed.sourcePath, sidecars: renamed.sidecars } : {}),
        ...(hasTags ? { tags } : {}),
        ...(hasNote ? { note } : {}),
        ...(hasOriginalTitle ? { originalTitle } : {}),
        ...(hasStudio ? { studio } : {}),
        ...(hasFirstAiredAt ? { firstAiredAt } : {}),
        ...(hasReleaseDate ? { releaseDate } : {}),
        ...(hasEmbeddedSubtitles ? { hasEmbeddedSubtitles: input.hasEmbeddedSubtitles } : {}),
      }
    })
    try {
      if (bookshelfRename) {
        for (const move of bookshelfRename.moves) movedBooks.push({ ...move, ...(await moveFile(move.sourcePath, move.targetPath)) })
        const oldShelfDirectory = path.join(bookshelfRename.rootPath, bookshelfRename.currentShelf)
        if (isPathInside(bookshelfRename.rootPath, oldShelfDirectory) && !pathsMatch(oldShelfDirectory, bookshelfRename.rootPath))
          await fileSystem.rmdir(oldShelfDirectory).catch(() => {})
      }
      const saved = await saveLibrary({ items, operations: library.operations }, { backupExisting: false })
      return { ...saved, item: saved.data.items.find((item) => item.id === input.id) }
    } catch (error) {
      if (movedBooks.length > 0) await rollbackTransferredFiles(movedBooks, moveFile).catch(() => {})
      if (renamedDirectory) await fileSystem.rename(renamedDirectory.newDirectory, renamedDirectory.oldDirectory).catch(() => {})
      throw error
    }
  }

  async function updateMediaInfo(input) {
    const library = await loadLibrary()
    const index = library.items.findIndex((item) => item?.id === input.id && (item.kind === 'book' || item.kind === 'video'))
    if (index < 0) throw new Error('媒体记录不存在')
    if (input.creator !== undefined && library.items[index].kind !== 'book') throw new Error('只有本子或漫画可以设置创作者')
    const items = [...library.items]
    items[index] = {
      ...items[index],
      ...(input.creator !== undefined ? { creator: input.creator.trim().slice(0, 200) } : {}),
      ...(input.releaseDate !== undefined ? { releaseDate: input.releaseDate.trim().slice(0, 40) } : {}),
    }
    const saved = await saveLibrary({ items, operations: library.operations }, { backupExisting: false })
    return { ...saved, item: saved.data.items[index] }
  }

  async function updateMediaTags(input) {
    const config = await loadConfig()
    const allowedTags = new Set(config.catalog.tags)
    const tags = [...new Set(input.tags.map((tag) => String(tag).trim()).filter(Boolean))]
    if (tags.some((tag) => !allowedTags.has(tag))) throw new Error('包含未在标签管理中保存的标签')
    const library = await loadLibrary()
    const index = library.items.findIndex((item) => item?.id === input.id)
    if (index < 0) throw new Error('媒体记录不存在')
    const items = [...library.items]
    items[index] = { ...items[index], tags }
    const saved = await saveLibrary({ items, operations: library.operations }, { backupExisting: false })
    return { ...saved, item: saved.data.items[index] }
  }

  async function updateVideoEpisode(input) {
    const episode = normalizeFolderName(input.episode.trim(), '', '视频名称')
    const episodeTitle = typeof input.episodeTitle === 'string' ? input.episodeTitle.trim().slice(0, 200) : episode
    const episodeTitleSource = input.episodeTitleSource === 'bangumi' ? 'bangumi' : 'manual'
    const [config, library] = await Promise.all([loadConfig(), loadLibrary()])
    const selected = library.items.find((item) => item?.id === input.id)
    if (!selected || selected.kind !== 'video' || typeof selected.sourcePath !== 'string') throw new Error('视频记录不存在')
    const sourcePath = path.resolve(selected.sourcePath)
    const managedRoot = config.libraries[selected.library]?.rootPath ?? ''
    if (!path.isAbsolute(managedRoot) || !isPathInside(managedRoot, sourcePath)) throw new Error('视频文件不在当前媒体库受管理路径内')
    const files = [
      {
        role: 'media',
        sourcePath,
        targetPath: path.join(path.dirname(sourcePath), `${episode}${path.extname(sourcePath)}`),
        fileName: `${episode}${path.extname(sourcePath)}`,
      },
    ]
    for (const sidecar of Array.isArray(selected.sidecars) ? selected.sidecars : []) {
      if (typeof sidecar?.sourcePath !== 'string' || !isPathInside(managedRoot, sidecar.sourcePath))
        throw new Error(`${selected.title}: 字幕文件不在当前媒体库受管理路径内`)
      const extension = path.extname(sidecar.fileName || sidecar.sourcePath)
      files.push({
        role: 'sidecar',
        sourcePath: path.resolve(sidecar.sourcePath),
        targetPath: path.join(path.dirname(sourcePath), `${episode}${extension}`),
        fileName: `${episode}${extension}`,
      })
    }
    const reserved = new Set()
    for (const file of files) {
      const key = process.platform === 'win32' ? file.targetPath.toLocaleLowerCase() : file.targetPath
      if (reserved.has(key)) throw new Error(`${selected.title}: 重命名后字幕文件名冲突`)
      reserved.add(key)
      const stat = await fileSystem.stat(file.sourcePath).catch(() => null)
      if (!stat?.isFile()) throw new Error(`${selected.title}: 文件不存在`)
      if (
        !pathsMatch(file.sourcePath, file.targetPath) &&
        (await fileSystem
          .stat(file.targetPath)
          .then(() => true)
          .catch((error) => (error?.code === 'ENOENT' ? false : Promise.reject(error))))
      )
        throw new Error(`目标文件已存在：${path.basename(file.targetPath)}`)
    }
    const movedFiles = []
    try {
      for (const file of files) movedFiles.push({ ...file, ...(await moveFile(file.sourcePath, file.targetPath)) })
      const mediaMove = movedFiles.find((move) => move.role === 'media')
      const sidecars = movedFiles
        .filter((move) => move.role === 'sidecar')
        .map((move) => {
          const previous = selected.sidecars?.find((sidecar) => sidecar.sourcePath === move.sourcePath)
          return {
            fileName: move.fileName,
            sourcePath: move.targetPath,
            originalSourcePath: previous?.originalSourcePath || move.sourcePath,
            extension: path.extname(move.targetPath).toLowerCase(),
            size: move.size,
          }
        })
      const items = library.items.map((item) =>
        item.id === input.id
          ? {
              ...item,
              title: episode,
              episode,
              episodeTitle,
              episodeTitleSource,
              sourcePath: mediaMove.targetPath,
              relativePath: path.relative(managedRoot, mediaMove.targetPath),
              sidecars,
            }
          : item,
      )
      const saved = await saveLibrary({ items, operations: library.operations }, { backupExisting: false })
      return { ...saved, item: saved.data.items.find((item) => item.id === input.id) }
    } catch (error) {
      await rollbackTransferredFiles(movedFiles, moveFile).catch(() => {})
      throw error
    }
  }

  async function updateBookShelves(input) {
    const selectedIds = new Set(input.ids)
    const library = await loadLibrary()
    const selected = library.items.filter((item) => selectedIds.has(item?.id))
    if (selected.length !== input.ids.length || selected.some((item) => item?.kind !== 'book')) throw new Error('只能批量管理本子或漫画')
    const items = library.items.map((item) => (selectedIds.has(item.id) ? { ...item, shelf: input.shelf } : item))
    const saved = await saveLibrary({ items, operations: library.operations }, { backupExisting: false })
    return { ...saved, changedCount: selected.length, shelf: input.shelf }
  }

  async function moveVideoToAffiliation(input) {
    const [config, library] = await Promise.all([loadConfig(), loadLibrary()])
    const index = library.items.findIndex((item) => item?.id === input.id && item.kind === 'video')
    if (index < 0) throw new Error('视频记录不存在')
    const selected = library.items[index]
    const affiliation = normalizeFolderName(input.affiliation, '', '合集名称')
    const currentAffiliation = getItemAffiliation(selected)
    if (affiliation === currentAffiliation)
      return { data: library, item: selected, libraryPath: getConfigPaths().libraryPath, movedCount: 0 }
    const managedRoot = config.libraries[selected.library]?.rootPath ?? ''
    if (!path.isAbsolute(managedRoot) || !path.isAbsolute(selected.sourcePath) || !isPathInside(managedRoot, selected.sourcePath))
      throw new Error('视频文件不在当前媒体库受管理路径内')
    const targetItems = library.items.filter(
      (item) => item?.kind === 'video' && item.library === selected.library && getItemAffiliation(item) === affiliation,
    )
    const targetPath = buildManagedTargetPath({
      rootPath: managedRoot,
      folderName: targetItems[0] ? getVideoStorageFolderName(targetItems[0]) : affiliation,
      fallbackFolderName: '未归入合集',
      sourcePath: selected.sourcePath,
    })
    const files = [{ role: 'media', sourcePath: selected.sourcePath, targetPath, fileName: path.basename(targetPath) }]
    for (const sidecar of Array.isArray(selected.sidecars) ? selected.sidecars : []) {
      if (typeof sidecar?.sourcePath !== 'string' || !isPathInside(managedRoot, sidecar.sourcePath))
        throw new Error(`${selected.title}: 字幕文件不在当前媒体库受管理路径内`)
      const fileName = path.basename(sidecar.fileName || sidecar.sourcePath)
      files.push({ role: 'sidecar', sourcePath: sidecar.sourcePath, targetPath: path.join(path.dirname(targetPath), fileName), fileName })
    }
    for (const file of files) {
      const stat = await fileSystem.stat(file.sourcePath).catch(() => null)
      if (!stat?.isFile()) throw new Error(`${selected.title}: ${file.fileName} 不存在`)
      if (
        !pathsMatch(file.sourcePath, file.targetPath) &&
        (await fileSystem
          .stat(file.targetPath)
          .then(() => true)
          .catch((error) => (error?.code === 'ENOENT' ? false : Promise.reject(error))))
      )
        throw new Error(`目标合集已有同名文件：${file.fileName}`)
    }
    const movedFiles = []
    try {
      for (const file of files) movedFiles.push({ ...file, ...(await moveFile(file.sourcePath, file.targetPath)) })
      const mediaMove = movedFiles.find((file) => file.role === 'media')
      const sidecars = movedFiles
        .filter((file) => file.role === 'sidecar')
        .map((file) => {
          const previous = selected.sidecars?.find((candidate) => candidate.sourcePath === file.sourcePath)
          return {
            fileName: file.fileName,
            sourcePath: file.targetPath,
            originalSourcePath: previous?.originalSourcePath || file.sourcePath,
            extension: path.extname(file.targetPath).toLowerCase(),
            size: file.size,
          }
        })
      const items = library.items.map((item) =>
        item.id !== input.id
          ? item
          : {
              ...item,
              affiliation,
              sourcePath: mediaMove.targetPath,
              relativePath: path.relative(managedRoot, mediaMove.targetPath),
              sidecars,
            },
      )
      const operation = {
        id: `move-affiliation:${randomUUID()}`,
        type: 'move-video-affiliation',
        status: 'complete',
        itemId: input.id,
        from: currentAffiliation,
        to: affiliation,
        createdAt: new Date().toISOString(),
      }
      const saved = await saveLibrary({ items, operations: [...library.operations, operation] })
      await removeEmptyDirectories(path.dirname(selected.sourcePath), managedRoot).catch(() => {})
      return { ...saved, item: saved.data.items[index], movedCount: 1 }
    } catch (error) {
      await rollbackTransferredFiles(movedFiles, moveFile).catch(() => {})
      throw error
    }
  }

  return {
    moveVideoToAffiliation,
    rollbackTransferredFiles,
    updateBookShelves,
    updateContainerInfo,
    updateContainerTags: updateContainerInfo,
    updateMediaInfo,
    updateMediaTags,
    updateVideoEpisode,
    updateVideoMetadata,
  }
}

module.exports = {
  createLibraryMetadataService,
  pathsMatch,
  rollbackTransferredFiles,
}
