const fs = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { buildManagedTargetPath, isPathInside, moveFileSafely, normalizeFolderName } = require('./file-operations.cjs')
const { createArchiveItemFromImportPlan, createVideoItemFromImportPlan } = require('./library-store.cjs')
const { isArchiveLibrary, isKnownLibrary } = require('./library-definitions.cjs')
const supportedArchiveExtensions = new Set(['.zip', '.rar', '.7z'])
const supportedVideoExtensions = new Set([
  '.mp4',
  '.mkv',
  '.m4v',
  '.mov',
  '.avi',
  '.webm',
  '.ogv',
  '.wmv',
  '.flv',
  '.f4v',
  '.ts',
  '.m2ts',
  '.mts',
  '.mpeg',
  '.mpg',
  '.mpe',
  '.m2v',
  '.3gp',
  '.3g2',
  '.asf',
  '.vob',
  '.divx',
  '.mxf',
  '.qt',
  '.dv',
  '.mod',
  '.tod',
])

function getImportExtensions(libraryId) {
  return isArchiveLibrary(libraryId) ? supportedArchiveExtensions : supportedVideoExtensions
}

function sourceKey(filePath) {
  return path.resolve(filePath).toLocaleLowerCase()
}

function getItemAffiliation(item) {
  return typeof item?.affiliation === 'string' && item.affiliation.trim() ? item.affiliation.trim() : item?.grouping || '未归入合集'
}

function getItemEpisode(item) {
  return typeof item?.episode === 'string' && item.episode.trim() ? item.episode.trim() : item?.title || ''
}

function normalizeEpisode(value, fileName) {
  const fallback = path.basename(fileName, path.extname(fileName))
  const episode = String(value ?? '').trim() || fallback
  if (episode.length > 200 || /[\u0000-\u001F]/.test(episode)) throw new Error('选集名称无效')
  return episode
}

function normalizeAffiliation(value) {
  const affiliation = String(value ?? '').trim()
  if (!affiliation) return '未归入合集'
  if (affiliation.length > 200) throw new Error('合集名称过长')
  return normalizeFolderName(affiliation, '', '合集')
}

function normalizeShelf(value) {
  const shelf = String(value ?? '').trim()
  if (!shelf) return ''
  if (shelf.length > 200) throw new Error('书架名称过长')
  return normalizeFolderName(shelf, '', '书架')
}

async function verifyMediaSignature(filePath, extension) {
  if (!supportedVideoExtensions.has(extension)) return
  if (!['.mp4', '.m4v', '.mov', '.avi', '.mkv', '.webm'].includes(extension)) return
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(12)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead < 4) throw new Error('视频文件过短或内容无效')
    const valid =
      extension === '.mkv' || extension === '.webm'
        ? buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
        : extension === '.avi'
          ? buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 11) === 'AVI'
          : buffer.toString('ascii', 4, 8) === 'ftyp'
    if (!valid) throw new Error('文件内容与视频扩展名不匹配')
  } finally {
    await handle.close()
  }
}

async function rollbackMoves(moves) {
  const errors = []
  for (const move of [...moves].reverse()) {
    if (!move.moved) continue
    try {
      await moveFileSafely(move.targetPath, move.sourcePath)
    } catch (error) {
      errors.push(`${path.basename(move.targetPath)}: ${error.message}`)
    }
  }
  if (errors.length > 0) throw new Error(errors.join('；'))
}

function makeFileTargets(item, mediaTargetPath) {
  const sources = [{ sourcePath: item.sourcePath, fileName: item.fileName, size: item.size, role: 'media', targetPath: mediaTargetPath }]
  for (const sidecar of Array.isArray(item.sidecars) ? item.sidecars : []) {
    sources.push({
      ...sidecar,
      role: 'sidecar',
      targetPath: path.join(path.dirname(mediaTargetPath), sidecar.fileName),
    })
  }
  return sources
}

async function assertTargetAvailable(targetPath, permittedExistingTargets = new Set()) {
  try {
    await fs.access(targetPath)
    if (permittedExistingTargets.has(sourceKey(targetPath))) return
    throw new Error('目标文件已存在，已中止且未覆盖')
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
}

async function buildUniqueReplacedPath({ replacedRoot, libraryId, affiliation, fileName, reservedTargets }) {
  const folder = path.resolve(replacedRoot, libraryId, normalizeFolderName(affiliation, '未归入合集', '合集'))
  if (!isPathInside(replacedRoot, folder)) throw new Error('已替换文件目录无效')
  const extension = path.extname(fileName)
  const baseName = path.basename(fileName, extension)
  let index = 0

  while (true) {
    const suffix = index === 0 ? '' : ` (${index})`
    const candidate = path.join(folder, `${baseName}${suffix}${extension}`)
    const key = sourceKey(candidate)
    if (!reservedTargets.has(key)) {
      try {
        await fs.access(candidate)
      } catch (error) {
        if (error?.code === 'ENOENT') {
          reservedTargets.add(key)
          return candidate
        }
        throw error
      }
    }
    index += 1
  }
}

async function makeReplacedFileTargets({ existingItem, replacedRoot, libraryId, affiliation }) {
  const oldFiles = [
    {
      role: 'replaced-media',
      sourcePath: existingItem.sourcePath,
      fileName: path.basename(existingItem.sourcePath),
      size: existingItem.size,
    },
    ...(Array.isArray(existingItem.sidecars)
      ? existingItem.sidecars.map((sidecar) => ({
          role: 'replaced-sidecar',
          sourcePath: sidecar.sourcePath,
          fileName: sidecar.fileName || path.basename(sidecar.sourcePath),
          size: sidecar.size,
        }))
      : []),
  ]
  const reservedTargets = new Set()
  const result = []
  for (const file of oldFiles) {
    if (typeof file.sourcePath !== 'string' || !file.sourcePath) throw new Error('已有选集的文件记录无效')
    result.push({
      ...file,
      targetPath: await buildUniqueReplacedPath({ replacedRoot, libraryId, affiliation, fileName: file.fileName, reservedTargets }),
    })
  }
  return result
}

function itemAlreadyImported(items, sourcePath) {
  const key = sourceKey(sourcePath)
  return items.some((item) => {
    for (const candidate of [item?.sourcePath, item?.originalSourcePath]) {
      if (typeof candidate === 'string' && sourceKey(candidate) === key) return true
    }
    return false
  })
}

function makeVideoTargetPath(targetRoot, affiliation, sourcePath, originalTitle = '') {
  return buildManagedTargetPath({
    rootPath: targetRoot,
    folderName: originalTitle || affiliation,
    fallbackFolderName: '未归入合集',
    sourcePath,
  })
}

function makeArchiveTargetPath(targetRoot, shelf, sourcePath) {
  return shelf
    ? buildManagedTargetPath({ rootPath: targetRoot, folderName: shelf, fallbackFolderName: '', sourcePath })
    : buildManagedTargetPath({ rootPath: targetRoot, sourcePath, flat: true })
}

async function executeMediaImport({ libraryId, items, config, library, saveLibrary, replacedRoot, onItemComplete }) {
  if (!isKnownLibrary(libraryId)) throw new Error('目标媒体库无效')
  if (typeof saveLibrary !== 'function') throw new Error('导入存储不可用')

  const targetRoot = config?.libraries?.[libraryId]?.rootPath ?? ''
  if (!path.isAbsolute(targetRoot)) throw new Error('受管理根目录必须是绝对路径')
  if (config?.libraries?.[libraryId]?.enabled === false) throw new Error('目标媒体库已停用')
  if (!isArchiveLibrary(libraryId) && (!replacedRoot || !path.isAbsolute(replacedRoot))) throw new Error('应用数据目录无效')

  const extensions = getImportExtensions(libraryId)
  const supportedItems = Array.isArray(items)
    ? items.filter((item) => item && typeof item.sourcePath === 'string' && extensions.has(path.extname(item.sourcePath).toLowerCase()))
    : []
  let currentItems = Array.isArray(library?.items) ? [...library.items] : []
  const operations = Array.isArray(library?.operations) ? [...library.operations] : []
  const results = []
  const errors = []
  const replacedItemIds = new Set()
  let importedCount = 0
  let skippedCount = 0

  for (const item of supportedItems) {
    if (itemAlreadyImported(currentItems, item.sourcePath)) {
      skippedCount += 1
      results.push({ id: item.id, fileName: item.fileName, status: 'skipped', error: '来源已在资料库中；请在媒体库中批量转移' })
      onItemComplete?.({ id: item.id, fileName: item.fileName })
      continue
    }

    const movedFiles = []
    try {
      const isArchive = isArchiveLibrary(libraryId)
      const affiliation = isArchive ? '' : normalizeAffiliation(item.affiliation)
      const shelf = isArchive ? normalizeShelf(item.shelf) : ''
      const episode = isArchive ? '' : normalizeEpisode(item.episode, item.fileName)
      const replacementItemId = typeof item.replacementItemId === 'string' ? item.replacementItemId.trim() : ''
      const replacementItem = replacementItemId ? currentItems.find((candidate) => candidate?.id === replacementItemId) : null

      if (replacementItemId && !replacementItem) throw new Error('要替换的选集不存在')
      if (replacementItem && (isArchive || replacementItem.kind !== 'video' || replacementItem.library !== libraryId))
        throw new Error('只能替换同一媒体库中的视频选集')
      if (replacementItem && getItemAffiliation(replacementItem) !== affiliation) throw new Error('替换目标必须属于当前归属')
      if (replacementItem && replacedItemIds.has(replacementItem.id)) throw new Error('同一个导入计划不能多次替换同一选集')
      if (replacementItem && (!replacementItem.sourcePath || !isPathInside(targetRoot, replacementItem.sourcePath)))
        throw new Error('要替换的选集不在当前受管理媒体库中')

      const mediaTargetPath = replacementItem
        ? replacementItem.sourcePath
        : item.preserveManagedPath === true && isPathInside(targetRoot, item.sourcePath)
          ? path.resolve(item.sourcePath)
          : isArchive
            ? makeArchiveTargetPath(targetRoot, shelf, item.sourcePath)
            : makeVideoTargetPath(targetRoot, affiliation, item.sourcePath, item.originalTitle)
      const fileTargets = makeFileTargets(item, mediaTargetPath)
      const permittedExistingTargets = new Set()

      if (replacementItem) {
        permittedExistingTargets.add(sourceKey(replacementItem.sourcePath))
        for (const sidecar of replacementItem.sidecars ?? []) {
          if (typeof sidecar?.sourcePath === 'string') permittedExistingTargets.add(sourceKey(sidecar.sourcePath))
        }
      } else if (
        currentItems.some(
          (candidate) => typeof candidate?.sourcePath === 'string' && sourceKey(candidate.sourcePath) === sourceKey(mediaTargetPath),
        )
      ) {
        throw new Error('目标已在资料库中')
      }

      for (const file of fileTargets) {
        const stat = await fs.stat(file.sourcePath)
        if (!stat.isFile()) throw new Error(`${file.fileName}: 来源不是文件`)
        if (sourceKey(file.sourcePath) === sourceKey(file.targetPath)) permittedExistingTargets.add(sourceKey(file.targetPath))
        await assertTargetAvailable(file.targetPath, permittedExistingTargets)
        if (file.role === 'media') await verifyMediaSignature(file.sourcePath, path.extname(file.sourcePath).toLowerCase())
      }

      if (replacementItem) {
        const replacedTargets = await makeReplacedFileTargets({ existingItem: replacementItem, replacedRoot, libraryId, affiliation })
        for (const file of replacedTargets) {
          if (!isPathInside(targetRoot, file.sourcePath)) throw new Error('要替换的文件不在当前受管理媒体库中')
          const stat = await fs.stat(file.sourcePath)
          if (!stat.isFile()) throw new Error(`要替换的 ${file.fileName} 不存在`)
          movedFiles.push({ ...file, ...(await moveFileSafely(file.sourcePath, file.targetPath)) })
        }
      }

      for (const file of fileTargets) movedFiles.push({ ...file, ...(await moveFileSafely(file.sourcePath, file.targetPath)) })

      const mediaMove = movedFiles.find((file) => file.role === 'media')
      const normalizedItem = {
        ...item,
        sourcePath: mediaMove.targetPath,
        originalSourcePath: mediaMove.sourcePath,
        extension: path.extname(mediaMove.targetPath).toLowerCase(),
        size: mediaMove.size,
        affiliation,
        shelf,
        episode,
        relativePath: path.relative(targetRoot, mediaMove.targetPath),
        sidecars: movedFiles
          .filter((file) => file.role === 'sidecar')
          .map((file) => ({
            fileName: file.fileName,
            sourcePath: file.targetPath,
            originalSourcePath: file.sourcePath,
            extension: path.extname(file.targetPath).toLowerCase(),
            size: file.size,
          })),
      }
      const createdItem = isArchive
        ? createArchiveItemFromImportPlan(libraryId, normalizedItem)
        : createVideoItemFromImportPlan(libraryId, normalizedItem)
      const mediaItem = replacementItem
        ? {
            ...createdItem,
            id: replacementItem.id,
            tags: replacementItem.tags,
            cover: replacementItem.cover,
            episodeCover: replacementItem.episodeCover,
            note: replacementItem.note,
            releaseDate: replacementItem.releaseDate,
            firstAiredAt: replacementItem.firstAiredAt,
            creator: replacementItem.creator,
            studio: replacementItem.studio,
            originalTitle: replacementItem.originalTitle,
            scraperSource: replacementItem.scraperSource,
            scraperId: replacementItem.scraperId,
            scraperUrl: replacementItem.scraperUrl,
            bangumiId: replacementItem.bangumiId,
            bangumiUrl: replacementItem.bangumiUrl,
            freeAnimeHentaiId: replacementItem.freeAnimeHentaiId,
            freeAnimeHentaiUrl: replacementItem.freeAnimeHentaiUrl,
            hanime1Id: replacementItem.hanime1Id,
            hanime1Url: replacementItem.hanime1Url,
          }
        : createdItem
      const operation = {
        id: `${replacementItem ? 'replace' : 'move'}:${randomUUID()}`,
        type: replacementItem ? 'replace-media' : 'import-move',
        status: 'complete',
        library: libraryId,
        itemId: mediaItem.id,
        replacedItemId: replacementItem?.id,
        files: movedFiles.map((file) => ({
          sourcePath: file.sourcePath,
          targetPath: file.targetPath,
          moved: file.moved,
          size: file.size,
          role: file.role,
        })),
        createdAt: new Date().toISOString(),
      }
      const nextItems = [
        ...currentItems.filter((candidate) => candidate.id !== replacementItem?.id && candidate.id !== mediaItem.id),
        mediaItem,
      ]
      const next = { items: nextItems, operations: [...operations, operation] }
      await saveLibrary(next, { backupExisting: importedCount === 0 })
      currentItems = nextItems
      if (replacementItem) replacedItemIds.add(replacementItem.id)
      operations.push(operation)
      importedCount += 1
      results.push({
        id: item.id,
        itemId: mediaItem.id,
        fileName: item.fileName,
        status: 'imported',
        targetPath: mediaMove.targetPath,
        sidecarCount: fileTargets.length - 1,
        replaced: Boolean(replacementItem),
      })
    } catch (error) {
      let itemError = error
      if (movedFiles.length > 0) {
        try {
          await rollbackMoves(movedFiles)
        } catch (rollbackError) {
          itemError = new Error(`${error.message}；成组回退失败：${rollbackError.message}`, { cause: rollbackError })
        }
      }
      skippedCount += 1
      errors.push(`${item.fileName}: ${itemError.message}`)
      results.push({ id: item.id, fileName: item.fileName, status: 'error', error: itemError.message })
    }
    onItemComplete?.({ id: item.id, fileName: item.fileName })
  }

  const batchOperation = {
    id: `batch:${randomUUID()}`,
    type: 'import-batch',
    status: errors.length > 0 ? 'completed-with-errors' : 'complete',
    library: libraryId,
    createdAt: new Date().toISOString(),
    importedCount,
    skippedCount,
    results,
  }
  const finalData = { items: currentItems, operations: [...operations, batchOperation] }
  await saveLibrary(finalData, { backupExisting: importedCount === 0 })
  return { data: finalData, importedCount, skippedCount, errors, results, batchId: batchOperation.id }
}

module.exports = {
  executeMediaImport,
  getImportExtensions,
  getItemAffiliation,
  getItemEpisode,
  isArchiveLibrary,
  supportedArchiveExtensions,
  supportedVideoExtensions,
  verifyMediaSignature,
}
