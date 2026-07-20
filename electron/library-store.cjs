const fs = require('node:fs/promises')
const path = require('node:path')
const { isArchiveLibrary, isVideoLibrary } = require('./library-definitions.cjs')

function makeCover(seed) {
  let hash = 0
  for (const char of seed) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  const hue = Math.abs(hash) % 360
  return `linear-gradient(145deg, hsl(${hue} 38% 31%), hsl(${(hue + 42) % 360} 64% 58%) 52%, hsl(${(hue + 214) % 360} 42% 22%))`
}

function normalizeLibraryData(data) {
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    operations: Array.isArray(data?.operations) ? data.operations : [],
  }
}

async function writeFileAtomically(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  let handle
  try {
    handle = await fs.open(temporaryPath, 'wx')
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await fs.rename(temporaryPath, filePath)
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    await fs.unlink(temporaryPath).catch(() => {})
    throw error
  }
}

async function loadLibraryFile(libraryPath) {
  try {
    const raw = await fs.readFile(libraryPath, 'utf8')
    if (!raw.trim()) return { ...normalizeLibraryData(), issue: 'empty' }
    return { ...normalizeLibraryData(JSON.parse(raw)), issue: null }
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ...normalizeLibraryData(), issue: 'missing' }
    return { ...normalizeLibraryData(), issue: 'invalid' }
  }
}

async function backupLibraryFile(libraryPath, backupDir) {
  try {
    await fs.access(libraryPath)
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
  await fs.mkdir(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDir, `starmedia-library-${stamp}.json`)
  await fs.copyFile(libraryPath, backupPath)
  return backupPath
}

async function saveLibraryFile({ libraryPath, backupDir, data, backupExisting = true }) {
  await fs.mkdir(path.dirname(libraryPath), { recursive: true })
  if (backupExisting) await backupLibraryFile(libraryPath, backupDir)
  const normalizedData = normalizeLibraryData(data)
  await writeFileAtomically(libraryPath, `${JSON.stringify(normalizedData, null, 2)}\n`)
  return { data: normalizedData, libraryPath }
}

async function clearImportedRecords({ libraryPath, backupDir }) {
  return saveLibraryFile({ libraryPath, backupDir, data: { items: [], operations: [] }, backupExisting: true })
}

async function restoreLibraryBackup({ libraryPath, backupDir, backupPath }) {
  const raw = await fs.readFile(backupPath, 'utf8')
  const data = normalizeLibraryData(JSON.parse(raw))
  return saveLibraryFile({ libraryPath, backupDir, data, backupExisting: true })
}

function createArchiveItemFromImportPlan(libraryId, item) {
  if (!isArchiveLibrary(libraryId)) throw new Error('目标压缩包媒体库无效')
  const title = path.basename(item.fileName, path.extname(item.fileName))
  const now = new Date().toISOString()
  return {
    id: `archive:${libraryId}:${Buffer.from(item.sourcePath).toString('base64url')}`,
    library: libraryId,
    title,
    shelf: typeof item.shelf === 'string' ? item.shelf : '',
    tags: [],
    addedAt: now.slice(0, 10),
    duration: item.extension.toUpperCase(),
    kind: 'book',
    cover: makeCover(title),
    note: '',
    sourcePath: item.sourcePath,
    originalSourcePath: typeof item.originalSourcePath === 'string' && item.originalSourcePath ? item.originalSourcePath : item.sourcePath,
    relativePath: item.relativePath,
    size: item.size,
    importedAt: now,
  }
}

function createVideoItemFromImportPlan(libraryId, item) {
  if (!isVideoLibrary(libraryId)) throw new Error('目标视频媒体库无效')
  const fileTitle = path.basename(item.fileName, path.extname(item.fileName))
  const episode = typeof item.episode === 'string' && item.episode.trim() ? item.episode.trim() : fileTitle
  const affiliation = typeof item.affiliation === 'string' && item.affiliation.trim() ? item.affiliation.trim() : '未归入合集'
  const now = new Date().toISOString()
  return {
    id: `video:${libraryId}:${Buffer.from(item.sourcePath).toString('base64url')}`,
    library: libraryId,
    title: episode,
    affiliation,
    episode,
    tags: [],
    addedAt: now.slice(0, 10),
    duration: item.extension.slice(1).toUpperCase(),
    kind: 'video',
    cover: makeCover(`${affiliation}:${episode}`),
    episodeCover: '',
    note: '',
    sourcePath: item.sourcePath,
    originalSourcePath: typeof item.originalSourcePath === 'string' && item.originalSourcePath ? item.originalSourcePath : item.sourcePath,
    relativePath: item.relativePath,
    sidecars: Array.isArray(item.sidecars) ? item.sidecars : [],
    size: item.size,
    importedAt: now,
  }
}

module.exports = {
  backupLibraryFile,
  clearImportedRecords,
  createArchiveItemFromImportPlan,
  createVideoItemFromImportPlan,
  loadLibraryFile,
  restoreLibraryBackup,
  saveLibraryFile,
  writeFileAtomically,
}
