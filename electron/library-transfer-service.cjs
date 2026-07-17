const fs = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { buildManagedTargetPath, isPathInside, moveFileSafely } = require('./file-operations.cjs')
const { isArchiveLibrary, libraryIds } = require('./library-definitions.cjs')

function getVideoStorageFolderName(item) {
  if (item?.library === 'creator') return getItemAffiliation(item)
  return String(item?.originalTitle ?? '').trim() || getItemAffiliation(item) || '未归入合集'
}

function getItemAffiliation(item) {
  return typeof item?.affiliation === 'string' && item.affiliation.trim() ? item.affiliation.trim() : item?.grouping || '未归入合集'
}

function getTransferTargetPath(item, targetRoot) {
  if (item.kind === 'book') {
    const shelf = String(item.shelf ?? '').trim()
    return shelf
      ? buildManagedTargetPath({ rootPath: targetRoot, folderName: shelf, fallbackFolderName: '', sourcePath: item.sourcePath })
      : buildManagedTargetPath({ rootPath: targetRoot, sourcePath: item.sourcePath, flat: true })
  }
  return buildManagedTargetPath({
    rootPath: targetRoot,
    folderName: getVideoStorageFolderName(item),
    fallbackFolderName: '未归入合集',
    sourcePath: item.sourcePath,
  })
}

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

async function executeLibraryTransfer({ input, config, library, saveLibrary, moveFile = moveFileSafely }) {
  const ids = [...new Set(Array.isArray(input?.ids) ? input.ids.map((id) => String(id)).filter(Boolean) : [])]
  const targetLibrary = typeof input?.targetLibrary === 'string' ? input.targetLibrary : ''
  if (ids.length === 0 || ids.length > 1000) throw new Error('请选择要转移的媒体')
  if (!libraryIds.includes(targetLibrary)) throw new Error('目标媒体库无效')
  if (typeof saveLibrary !== 'function') throw new Error('资料库保存不可用')

  const selectedIds = new Set(ids)
  const selected = library.items.filter((item) => selectedIds.has(item?.id))
  if (selected.length !== ids.length) throw new Error('选中的媒体不存在或已变化')
  const isBook = selected[0]?.kind === 'book'
  if (selected.some((item) => (item.kind === 'book') !== isBook)) throw new Error('不能同时转移视频与压缩包')
  if (isArchiveLibrary(targetLibrary) !== isBook)
    throw new Error(isBook ? '压缩包只能转移到本子或漫画媒体库' : '视频只能转移到里番、番剧、原创或综合媒体库')
  if (selected.some((item) => item.library === targetLibrary)) throw new Error('选中的媒体已经位于目标媒体库')

  const targetRoot = config.libraries[targetLibrary]?.rootPath ?? ''
  if (!path.isAbsolute(targetRoot)) throw new Error('目标媒体库尚未设置受管理根目录')
  if (config.libraries[targetLibrary]?.enabled === false) throw new Error('目标媒体库已停用')

  const assignments = []
  const reservedTargets = new Set()
  for (const item of selected) {
    if (typeof item.sourcePath !== 'string' || !path.isAbsolute(item.sourcePath)) throw new Error(`${item.title}: 文件路径无效`)
    const sourceRoot = config.libraries[item.library]?.rootPath ?? ''
    if (!path.isAbsolute(sourceRoot) || !isPathInside(sourceRoot, item.sourcePath))
      throw new Error(`${item.title}: 文件不在原受管理媒体库中`)
    const mediaTargetPath = getTransferTargetPath(item, targetRoot)
    const files = [{ role: 'media', sourcePath: item.sourcePath, targetPath: mediaTargetPath, fileName: path.basename(item.sourcePath) }]
    for (const sidecar of Array.isArray(item.sidecars) ? item.sidecars : []) {
      if (typeof sidecar?.sourcePath !== 'string' || !sidecar.sourcePath) throw new Error(`${item.title}: 字幕记录无效`)
      files.push({
        role: 'sidecar',
        sourcePath: sidecar.sourcePath,
        targetPath: path.join(path.dirname(mediaTargetPath), sidecar.fileName || path.basename(sidecar.sourcePath)),
        fileName: sidecar.fileName || path.basename(sidecar.sourcePath),
      })
    }
    for (const file of files) {
      const targetKey = path.resolve(file.targetPath).toLocaleLowerCase()
      if (reservedTargets.has(targetKey)) throw new Error(`${item.title}: 转移后会与选中媒体重名`)
      reservedTargets.add(targetKey)
      const stat = await fs.stat(file.sourcePath)
      if (!stat.isFile()) throw new Error(`${item.title}: ${file.fileName} 不存在`)
      const samePath = path.resolve(file.sourcePath).toLocaleLowerCase() === targetKey
      if (!samePath) {
        try {
          await fs.access(file.targetPath)
          throw new Error(`${item.title}: 目标文件已存在，未覆盖`)
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
      }
    }
    assignments.push({ item, mediaTargetPath, files })
  }

  const movedFiles = []
  try {
    for (const assignment of assignments) {
      for (const file of assignment.files) movedFiles.push({ ...file, ...(await moveFile(file.sourcePath, file.targetPath)) })
    }
  } catch (error) {
    try {
      await rollbackTransferredFiles(movedFiles, moveFile)
    } catch (rollbackError) {
      throw new Error(`${error.message}；回退失败：${rollbackError.message}`, { cause: rollbackError })
    }
    throw error
  }

  const updatedById = new Map(
    assignments.map((assignment) => {
      const mediaMove = movedFiles.find((move) => move.role === 'media' && move.sourcePath === assignment.item.sourcePath)
      const sidecars = assignment.files
        .filter((file) => file.role === 'sidecar')
        .map((file) => {
          const move = movedFiles.find((candidate) => candidate.role === 'sidecar' && candidate.sourcePath === file.sourcePath)
          const previous = assignment.item.sidecars?.find((sidecar) => sidecar.sourcePath === file.sourcePath)
          return {
            fileName: file.fileName,
            sourcePath: move.targetPath,
            originalSourcePath: previous?.originalSourcePath || file.sourcePath,
            extension: path.extname(move.targetPath).toLowerCase(),
            size: move.size,
          }
        })
      const prefix = assignment.item.kind === 'book' ? 'archive' : 'video'
      return [
        assignment.item.id,
        {
          ...assignment.item,
          id: `${prefix}:${targetLibrary}:${Buffer.from(mediaMove.targetPath).toString('base64url')}`,
          library: targetLibrary,
          sourcePath: mediaMove.targetPath,
          relativePath: path.relative(targetRoot, mediaMove.targetPath),
          sidecars,
        },
      ]
    }),
  )
  const operation = {
    id: `transfer:${randomUUID()}`,
    type: 'library-transfer',
    status: 'complete',
    targetLibrary,
    itemIds: selected.map((item) => item.id),
    createdAt: new Date().toISOString(),
  }
  let saved
  try {
    saved = await saveLibrary({
      items: library.items.map((item) => updatedById.get(item.id) ?? item),
      operations: [...library.operations, operation],
    })
  } catch (error) {
    try {
      await rollbackTransferredFiles(movedFiles, moveFile)
    } catch (rollbackError) {
      throw new Error(`${error.message}；回退失败：${rollbackError.message}`, { cause: rollbackError })
    }
    throw error
  }

  return {
    ...saved,
    movedCount: selected.length,
    targetLibrary,
    sourceDirectories: assignments.map((assignment) => path.dirname(path.resolve(assignment.item.sourcePath))),
  }
}

module.exports = {
  executeLibraryTransfer,
  getTransferTargetPath,
  rollbackTransferredFiles,
}
