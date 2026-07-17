const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { isPathInside } = require('./file-operations.cjs')

function storedCoverPrefix(directory) {
  return `${pathToFileURL(path.resolve(directory)).toString().replace(/\/$/, '')}/`
}

function rewriteStoredCover(value, sourceCoversDir, targetCoversDir) {
  if (typeof value !== 'string') return value
  return value.replaceAll(storedCoverPrefix(sourceCoversDir), storedCoverPrefix(targetCoversDir))
}

function rewriteLibraryCoverPaths(data, sourceCoversDir, targetCoversDir) {
  return {
    ...data,
    items: data.items.map((item) => ({
      ...item,
      ...(typeof item.cover === 'string' ? { cover: rewriteStoredCover(item.cover, sourceCoversDir, targetCoversDir) } : {}),
      ...(typeof item.episodeCover === 'string'
        ? { episodeCover: rewriteStoredCover(item.episodeCover, sourceCoversDir, targetCoversDir) }
        : {}),
    })),
  }
}

function validateArchiveEntries(output) {
  let entriesStarted = false
  for (const line of String(output).split(/\r?\n/)) {
    if (line.trim() === '----------') {
      entriesStarted = true
      continue
    }
    if (!entriesStarted || !line.startsWith('Path = ')) continue
    const entry = line.slice('Path = '.length).trim().replace(/\\/g, '/')
    if (!entry || entry === '.' || entry.endsWith('/')) continue
    if (entry.startsWith('/') || /^[A-Za-z]:\//.test(entry) || entry.split('/').includes('..')) throw new Error('数据备份包含无效路径')
  }
}

async function copyDirectoryIfPresent(sourcePath, targetPath, fileSystem = fs) {
  try {
    const stat = await fileSystem.stat(sourcePath)
    if (!stat.isDirectory()) throw new Error(`${sourcePath} 不是目录`)
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  await fileSystem.cp(sourcePath, targetPath, { recursive: true, force: true })
  return true
}

async function restoreDirectorySnapshot({ targetPath, snapshotPath, existed }, fileSystem = fs) {
  await fileSystem.rm(targetPath, { recursive: true, force: true })
  if (existed) await fileSystem.cp(snapshotPath, targetPath, { recursive: true, force: true })
}

async function validateExtractedDirectory(directory, fileSystem = fs) {
  async function visit(current) {
    const entries = await fileSystem.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      if (!isPathInside(directory, entryPath)) throw new Error('数据备份包含无效路径')
      if (entry.isSymbolicLink()) throw new Error('数据备份不支持符号链接')
      if (entry.isDirectory()) await visit(entryPath)
    }
  }
  await visit(directory)
}

function countMissingMedia(data, fileSystem = fsSync) {
  return data.items.reduce((total, item) => {
    if (typeof item?.sourcePath !== 'string' || !item.sourcePath.trim()) return total
    let missing = !path.isAbsolute(item.sourcePath)
    if (!missing) {
      try {
        missing = fileSystem.statSync(item.sourcePath).isFile() === false
      } catch {
        missing = true
      }
    }
    const missingSidecars = (Array.isArray(item.sidecars) ? item.sidecars : []).filter((sidecar) => {
      try {
        return !sidecar?.sourcePath || !fileSystem.statSync(sidecar.sourcePath).isFile()
      } catch {
        return true
      }
    }).length
    return total + (missing ? 1 : 0) + missingSidecars
  }, 0)
}

function isAvailableFile(sourcePath, fileSystem = fsSync) {
  if (typeof sourcePath !== 'string' || !sourcePath.trim() || !path.isAbsolute(sourcePath)) return false
  try {
    return fileSystem.statSync(sourcePath).isFile()
  } catch {
    return false
  }
}

function pruneUnavailableMedia(data, fileSystem = fsSync) {
  let removedMediaCount = 0
  let removedSidecarCount = 0
  const items = []
  for (const item of data.items) {
    const sidecars = Array.isArray(item?.sidecars) ? item.sidecars : []
    if (!isAvailableFile(item?.sourcePath, fileSystem)) {
      removedMediaCount += 1
      removedSidecarCount += sidecars.length
      continue
    }
    const availableSidecars = sidecars.filter((sidecar) => isAvailableFile(sidecar?.sourcePath, fileSystem))
    removedSidecarCount += sidecars.length - availableSidecars.length
    items.push(availableSidecars.length === sidecars.length ? item : { ...item, sidecars: availableSidecars })
  }
  return { data: { ...data, items }, removedMediaCount, removedSidecarCount }
}

function createPortableDataService({
  getConfigPaths,
  loadConfig,
  loadLibrary,
  saveConfig,
  saveLibrary,
  run7z,
  replaceFileAtomically,
  appVersion,
  portableBackupVersion = 2,
  supportedPortableBackupVersions = new Set([1, portableBackupVersion]),
  fileSystem = fs,
  syncFileSystem = fsSync,
  temporaryDirectory = os.tmpdir,
  now = () => new Date(),
}) {
  if (
    typeof getConfigPaths !== 'function' ||
    typeof loadConfig !== 'function' ||
    typeof loadLibrary !== 'function' ||
    typeof saveConfig !== 'function' ||
    typeof saveLibrary !== 'function' ||
    typeof run7z !== 'function' ||
    typeof replaceFileAtomically !== 'function'
  )
    throw new Error('应用数据服务依赖不可用')

  async function exportBackup(backupPath) {
    const paths = getConfigPaths()
    const [config, library] = await Promise.all([loadConfig(), loadLibrary()])
    const stageDir = await fileSystem.mkdtemp(path.join(temporaryDirectory(), 'starmedia-export-'))
    const temporaryArchivePath = `${backupPath}.${process.pid}.${Date.now()}.tmp`
    try {
      const manifest = {
        format: 'starmedia-data-backup',
        version: portableBackupVersion,
        createdAt: now().toISOString(),
        applicationVersion: appVersion,
        configSchemaVersion: config.schemaVersion,
        librarySchemaVersion: 1,
        dataRoot: paths.dataRoot,
        includes: ['config', 'library', 'covers', 'replaced'],
        excludes: ['media', 'cache', 'session'],
      }
      await fileSystem.writeFile(path.join(stageDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      await fileSystem.writeFile(path.join(stageDir, 'starmedia-config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
      await fileSystem.writeFile(
        path.join(stageDir, 'starmedia-library.json'),
        `${JSON.stringify({ items: library.items, operations: library.operations }, null, 2)}\n`,
        'utf8',
      )
      await copyDirectoryIfPresent(paths.coversDir, path.join(stageDir, 'covers'), fileSystem)
      await copyDirectoryIfPresent(path.join(paths.dataRoot, 'replaced'), path.join(stageDir, 'replaced'), fileSystem)
      await fileSystem.rm(temporaryArchivePath, { force: true })
      await run7z(['a', '-y', '-tzip', temporaryArchivePath, '.'], { cwd: stageDir })
      const archiveStat = await fileSystem.stat(temporaryArchivePath)
      if (!archiveStat.isFile() || archiveStat.size <= 0) throw new Error('导出的应用数据备份为空')
      await run7z(['t', '-y', temporaryArchivePath])
      await replaceFileAtomically(temporaryArchivePath, backupPath)
      return { backupPath, missingMediaCount: countMissingMedia(library, syncFileSystem) }
    } catch (error) {
      await fileSystem.rm(temporaryArchivePath, { force: true }).catch(() => {})
      throw new Error(`导出应用数据失败：${error.message}`, { cause: error })
    } finally {
      await fileSystem.rm(stageDir, { recursive: true, force: true })
    }
  }

  async function importBackup(backupPath) {
    if (typeof backupPath !== 'string' || path.extname(backupPath).toLowerCase() !== '.zip') throw new Error('数据备份文件无效')
    const archiveStat = await fileSystem.stat(backupPath)
    if (!archiveStat.isFile() || archiveStat.size <= 0) throw new Error('数据备份文件无效')
    const extractDir = await fileSystem.mkdtemp(path.join(temporaryDirectory(), 'starmedia-import-'))
    let restoreDir = ''
    try {
      try {
        await run7z(['t', '-y', backupPath])
      } catch (error) {
        throw new Error(`应用数据备份损坏或未导出完成：${error.message}`, { cause: error })
      }
      validateArchiveEntries(await run7z(['l', '-slt', backupPath]))
      await run7z(['x', '-y', backupPath, `-o${extractDir}`])
      await validateExtractedDirectory(extractDir, fileSystem)
      const [manifest, importedConfigRaw, importedLibraryRaw] = await Promise.all([
        fileSystem.readFile(path.join(extractDir, 'manifest.json'), 'utf8').then(JSON.parse),
        fileSystem.readFile(path.join(extractDir, 'starmedia-config.json'), 'utf8').then(JSON.parse),
        fileSystem.readFile(path.join(extractDir, 'starmedia-library.json'), 'utf8').then(JSON.parse),
      ])
      if (
        manifest?.format !== 'starmedia-data-backup' ||
        !supportedPortableBackupVersions.has(manifest?.version) ||
        typeof manifest.dataRoot !== 'string' ||
        !path.isAbsolute(manifest.dataRoot)
      )
        throw new Error('不支持的数据备份版本；当前支持备份格式 1 和 2')
      if (!importedConfigRaw || typeof importedConfigRaw !== 'object') throw new Error('数据备份中的配置无效')
      if (!Array.isArray(importedLibraryRaw?.items) || !Array.isArray(importedLibraryRaw?.operations))
        throw new Error('数据备份中的媒体记录无效')

      const paths = getConfigPaths()
      const importedLibrary = rewriteLibraryCoverPaths(
        { items: importedLibraryRaw.items, operations: importedLibraryRaw.operations },
        path.join(manifest.dataRoot, 'covers'),
        paths.coversDir,
      )
      const prunedLibrary = pruneUnavailableMedia(importedLibrary, syncFileSystem)
      const [previousConfig, previousLibrary] = await Promise.all([loadConfig(), loadLibrary()])
      restoreDir = await fileSystem.mkdtemp(path.join(temporaryDirectory(), 'starmedia-restore-'))
      const directorySnapshots = [
        { label: '封面', targetPath: paths.coversDir, snapshotPath: path.join(restoreDir, 'covers'), existed: false },
        {
          label: '已替换文件',
          targetPath: path.join(paths.dataRoot, 'replaced'),
          snapshotPath: path.join(restoreDir, 'replaced'),
          existed: false,
        },
      ]
      for (const snapshot of directorySnapshots) {
        snapshot.existed = await copyDirectoryIfPresent(snapshot.targetPath, snapshot.snapshotPath, fileSystem)
      }
      let configSaved = false
      let librarySaved = false
      let directoryCopiesStarted = false
      try {
        const configResult = await saveConfig(importedConfigRaw)
        configSaved = true
        const libraryResult = await saveLibrary(prunedLibrary.data, { backupExisting: true })
        librarySaved = true
        directoryCopiesStarted = true
        await copyDirectoryIfPresent(path.join(extractDir, 'covers'), paths.coversDir, fileSystem)
        await copyDirectoryIfPresent(path.join(extractDir, 'replaced'), path.join(paths.dataRoot, 'replaced'), fileSystem)
        const normalizedLibrary = await loadLibrary()
        return {
          ...configResult,
          data: normalizedLibrary,
          libraryPath: libraryResult.libraryPath,
          missingMediaCount: countMissingMedia(normalizedLibrary, syncFileSystem),
          removedMediaCount: prunedLibrary.removedMediaCount,
          removedSidecarCount: prunedLibrary.removedSidecarCount,
        }
      } catch (error) {
        const rollbackErrors = []
        if (directoryCopiesStarted)
          for (const snapshot of directorySnapshots) {
            await restoreDirectorySnapshot(snapshot, fileSystem).catch((rollbackError) =>
              rollbackErrors.push(`${snapshot.label}：${rollbackError.message}`),
            )
          }
        if (librarySaved)
          await saveLibrary(previousLibrary, { backupExisting: false }).catch((rollbackError) =>
            rollbackErrors.push(`资料库：${rollbackError.message}`),
          )
        if (configSaved) await saveConfig(previousConfig).catch((rollbackError) => rollbackErrors.push(`配置：${rollbackError.message}`))
        if (rollbackErrors.length > 0) throw new Error(`${error.message}；回退失败：${rollbackErrors.join('；')}`, { cause: error })
        throw error
      }
    } finally {
      await fileSystem.rm(extractDir, { recursive: true, force: true })
      if (restoreDir) await fileSystem.rm(restoreDir, { recursive: true, force: true })
    }
  }

  return { exportBackup, importBackup }
}

module.exports = {
  copyDirectoryIfPresent,
  countMissingMedia,
  createPortableDataService,
  pruneUnavailableMedia,
  rewriteLibraryCoverPaths,
  restoreDirectorySnapshot,
  validateArchiveEntries,
  validateExtractedDirectory,
}
