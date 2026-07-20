const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, net, session, shell } = require('electron')
const fs = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const { fileURLToPath, pathToFileURL } = require('node:url')
const { pruneCacheDirectory, touchCacheFile } = require('./cache-service.cjs')
const { createDesktopDialogService } = require('./desktop-dialog-service.cjs')
const { scanImportSources } = require('./import-plan-scan-service.cjs')
const {
  executeMediaImport,
  getImportExtensions,
  getItemAffiliation,
  getItemEpisode,
  isArchiveLibrary,
  supportedArchiveExtensions,
  supportedVideoExtensions,
} = require('./import-service.cjs')
const { isPathInside, normalizeFolderName } = require('./file-operations.cjs')
const { clearImportedRecords, loadLibraryFile, saveLibraryFile, writeFileAtomically } = require('./library-store.cjs')
const { isPosterLibrary, libraryIds } = require('./library-definitions.cjs')
const { removeEmptyDirectoriesUpward } = require('./library-file-layout-service.cjs')
const { createSerialOperationQueue } = require('./operation-queue.cjs')
const { createConfigService } = require('./config-service.cjs')
const { IPC_CHANNELS } = require('./ipc-channels.cjs')
const { parseIpcRequest } = require('./ipc-contracts.cjs')
const { getVideoPlaybackForLibrary, getVideoPlaybackSupportForLibrary, openVideoExternallyForLibrary } = require('./video-service.cjs')
const { executeLibraryTransfer } = require('./library-transfer-service.cjs')
const { replaceFileAtomically, run7z } = require('./archive-tooling.cjs')
const { createArchiveReaderCacheService } = require('./archive-reader-cache-service.cjs')
const { createLibraryMaintenanceService } = require('./library-maintenance-service.cjs')
const { createLibraryMetadataService } = require('./library-metadata-service.cjs')
const { clearEmptyMediaDirectories: clearEmptyMediaDirectoriesForConfig } = require('./media-directory-maintenance-service.cjs')
const { createPortableDataService } = require('./portable-data-service.cjs')
const { createScraperAdapters } = require('./scraper-adapters.cjs')
const { createScraperApplicationService } = require('./scraper-application-service.cjs')
const { createNetworkProxyService, createSystemNetworkFetch, fetchWithTimeout } = require('./system-network-service.cjs')
const { createSubtitlePlaybackTracks } = require('./subtitle-cache-service.cjs')
const { extractMatroskaSubtitles } = require('./matroska-subtitle-service.cjs')
const { createThumbnailService, getCurrentArchiveCoverPath } = require('./thumbnail-service.cjs')
const { createBookCoverThumbnailService } = require('./book-cover-thumbnail-service.cjs')
const { createLocalUpdateService } = require('./local-update-service.cjs')
const { createGitHubUpdateService } = require('./github-update-service.cjs')

const isDevelopment = !app.isPackaged

function resolvePortableDataRoot({ development, appPath, executablePath }) {
  return development ? path.join(appPath, 'StarMediaData') : path.join(path.dirname(executablePath), 'StarMediaData')
}

const portableDataRoot = resolvePortableDataRoot({
  development: isDevelopment,
  appPath: app.getAppPath(),
  executablePath: process.execPath,
})
const bangumiTokenPageUrl = 'https://next.bgm.tv/demo/access-token'
const freeAnimeHentaiSearchEndpoint = 'https://guest.freeanimehentai.net/api/v11/search_hvs'
const defaultHanime1Endpoint = 'https://hanime1.com'
app.setPath('userData', portableDataRoot)
app.setPath('sessionData', path.join(portableDataRoot, 'session'))
app.setPath('crashDumps', path.join(portableDataRoot, 'crashes'))

let mainWindow = null
let ownsSingleInstance = true
let localUpdateQuitRequested = false
const approvedWindowCloses = new WeakSet()
const pendingWindowCloses = new WeakMap()
const singletonLockDataRoot = path.join(os.tmpdir(), 'StarMedia-single-instance')

if (require.main === module) {
  // Keep the Electron lock independent from the portable data directory.
  app.setPath('userData', singletonLockDataRoot)
  ownsSingleInstance = app.requestSingleInstanceLock()
  app.setPath('userData', portableDataRoot)
  if (!ownsSingleInstance) {
    app.quit()
  }
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}
const supportedSidecarExtensions = new Set(['.srt', '.ass', '.ssa', '.vtt', '.sub', '.idx'])
const maxImportPlanItems = 1000
const maxImportScanFiles = 20000
const maxImportErrors = 50
const importPlans = new Map()
const importPlanLifetimeMs = 60 * 60 * 1000
const portableBackupVersion = 2
const supportedPortableBackupVersions = new Set([1, portableBackupVersion])
let libraryMetadataService = null
let thumbnailService = null
const operationQueue = createSerialOperationQueue()

function withFileOperationLock(task) {
  return operationQueue.run(task)
}

function pathsMatch(left, right) {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight
}

function isTrustedRendererUrl(url) {
  try {
    const parsed = new URL(url)
    if (isDevelopment) return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port === '5173'
    return parsed.protocol === 'file:' && pathsMatch(fileURLToPath(parsed), path.join(__dirname, '..', 'dist', 'index.html'))
  } catch {
    return false
  }
}

function assertTrustedIpcSender(event) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(event.senderFrame.url)
  ) {
    throw new Error('已拒绝来自非受信任页面的请求')
  }
}

function getConfigPaths() {
  const userData = app.getPath('userData')
  return {
    dataRoot: userData,
    configPath: path.join(userData, 'starmedia-config.json'),
    libraryPath: path.join(userData, 'starmedia-library.json'),
    backupDir: path.join(userData, 'backups'),
    cacheDir: path.join(userData, 'cache'),
    coversDir: path.join(userData, 'covers'),
  }
}

const { loadConfig, saveConfig } = createConfigService({ getConfigPaths, defaultHanime1Endpoint })

const bookCoverThumbnailService = createBookCoverThumbnailService({ nativeImage, writeFileAtomically })

let networkProxyService = null
let bangumiDirectProxyTask = null
const fetchWithSystemNetwork = createSystemNetworkFetch({
  electronFetch: (url, options = {}) => net.fetch(url, { ...options, session: session.defaultSession }),
  isProxyEnabled: () => networkProxyService?.isEnabled() ?? false,
})

async function fetchBangumiDirect(url, options = {}) {
  const bangumiSession = session.fromPartition('starmedia-bangumi-direct')
  if (!bangumiDirectProxyTask) bangumiDirectProxyTask = bangumiSession.setProxy({ mode: 'direct' })
  await bangumiDirectProxyTask
  return fetchWithTimeout(
    (requestUrl, requestOptions) => net.fetch(requestUrl, { ...requestOptions, session: bangumiSession }),
    url,
    options,
  )
}

function getNetworkProxyService() {
  if (!networkProxyService) networkProxyService = createNetworkProxyService({ electronSession: session.defaultSession })
  return networkProxyService
}

async function configureNetworkProxy(config) {
  return getNetworkProxyService().configure(config)
}

async function saveConfigWithNetworkProxy(config) {
  const result = await saveConfig(config)
  await configureNetworkProxy(result.config)
  return result
}

const scraperAdapters = createScraperAdapters({
  loadConfig,
  fetchBangumi: fetchBangumiDirect,
  fetchWithNetwork: fetchWithSystemNetwork,
  appVersion: `StarMedia/${app.getVersion()}`,
  defaultHanime1Endpoint,
  freeAnimeHentaiSearchEndpoint,
})

const portableDataService = createPortableDataService({
  getConfigPaths,
  loadConfig,
  loadLibrary,
  saveConfig,
  saveLibrary,
  run7z,
  replaceFileAtomically,
  appVersion: app.getVersion(),
  portableBackupVersion,
  supportedPortableBackupVersions,
})

const localUpdateService = createLocalUpdateService({
  isPackaged: app.isPackaged,
  appVersion: app.getVersion(),
  executablePath: process.execPath,
  dataRoot: portableDataRoot,
  run7z,
  updaterScriptPath: path.join(__dirname, 'local-update-runner.ps1'),
  updaterLauncherPath: path.join(__dirname, 'local-update-launcher.cmd'),
  updaterLauncherScriptPath: path.join(__dirname, 'local-update-launcher.vbs'),
})

const githubUpdateService = createGitHubUpdateService({
  appVersion: app.getVersion(),
  fetchWithNetwork: fetchWithSystemNetwork,
})

const archiveReader = createArchiveReaderCacheService({
  getConfigPaths,
  loadConfig,
  pruneCacheDirectory,
  touchCacheFile,
  run7z,
  replaceFileAtomically,
  createCoverThumbnail: createBookCoverThumbnail,
})

const libraryMaintenanceService = createLibraryMaintenanceService({
  loadConfig,
  loadLibrary,
  saveLibrary,
  trashItem: (...args) => shell.trashItem(...args),
})

function buildPlanTargetPath(libraryId, targetRoot, affiliation, fileName, shelf = '') {
  return isArchiveLibrary(libraryId)
    ? shelf
      ? path.join(targetRoot, normalizeFolderName(shelf, '', '书架'), fileName)
      : path.join(targetRoot, fileName)
    : path.join(targetRoot, normalizeFolderName(affiliation, '未归入合集', '合集'), fileName)
}

function inferManagedLibrary(config, filePath, extension) {
  return libraryIds
    .map((id) => ({ id, rootPath: config.libraries[id]?.rootPath ?? '' }))
    .filter(({ id, rootPath }) => path.isAbsolute(rootPath) && getImportExtensions(id).has(extension) && isPathInside(rootPath, filePath))
    .sort((left, right) => path.resolve(right.rootPath).length - path.resolve(left.rootPath).length)[0]?.id
}

function getManagedParentName(rootPath, filePath) {
  if (!path.isAbsolute(rootPath) || !isPathInside(rootPath, filePath)) return ''
  const parent = path.dirname(path.resolve(filePath))
  return parent === path.resolve(rootPath) ? '' : path.basename(parent)
}

function createImportPlanItem({
  filePath,
  sourcePath,
  targetRoot,
  libraryId,
  affiliation = '',
  shelf = '',
  size,
  sidecars = [],
  replacementItemId = '',
}) {
  const fileName = path.basename(filePath)
  const extension = path.extname(fileName).toLowerCase()
  const relativePath = path.relative(sourcePath, filePath) || fileName
  const supported = getImportExtensions(libraryId).has(extension)
  const episode = path.basename(fileName, extension)
  const managedInPlace = path.isAbsolute(targetRoot) && isPathInside(targetRoot, filePath)

  if (!supported) {
    return {
      fileName,
      sourcePath: filePath,
      relativePath,
      extension: extension || '(无扩展名)',
      size,
      status: 'unsupported',
      affiliation: '',
      shelf: '',
      episode: '',
      targetPath: '',
      reason: isArchiveLibrary(libraryId) ? '目标库只接受 ZIP / RAR / 7z' : '目标库不接受该视频格式',
    }
  }

  if (!targetRoot || !path.isAbsolute(targetRoot)) {
    return {
      fileName,
      sourcePath: filePath,
      relativePath,
      extension,
      size,
      status: 'blocked',
      affiliation,
      shelf,
      episode,
      targetPath: '',
      reason: targetRoot ? '受管理根目录必须使用绝对路径' : '目标媒体库尚未设置受管理根目录',
    }
  }

  let targetPath
  try {
    targetPath = managedInPlace ? path.resolve(filePath) : buildPlanTargetPath(libraryId, targetRoot, affiliation, fileName, shelf)
  } catch (error) {
    return {
      fileName,
      sourcePath: filePath,
      relativePath,
      extension,
      size,
      status: 'blocked',
      affiliation,
      episode,
      targetPath: '',
      reason: error.message,
    }
  }

  return {
    fileName,
    sourcePath: filePath,
    relativePath,
    extension,
    size,
    status: 'ready',
    affiliation: isArchiveLibrary(libraryId) ? '' : String(affiliation).trim(),
    shelf: isArchiveLibrary(libraryId) ? String(shelf).trim() : '',
    episode: isArchiveLibrary(libraryId) ? '' : episode,
    targetPath,
    sidecars: sidecars.map((sidecar) => ({
      ...sidecar,
      targetPath: targetRoot ? path.join(path.dirname(targetPath), sidecar.fileName) : '',
    })),
    managedInPlace,
    ...(replacementItemId ? { replacementItemId } : {}),
  }
}

async function createImportPlan(input) {
  let sourcePaths = Array.isArray(input?.sourcePaths)
    ? input.sourcePaths.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [typeof input?.sourcePath === 'string' ? input.sourcePath.trim() : ''].filter(Boolean)
  const scanManagedLibraries = input?.scanManagedLibraries === true
  const libraryId = scanManagedLibraries ? 'auto' : typeof input?.targetLibrary === 'string' ? input.targetLibrary : ''
  const automaticLibrary = libraryId === 'auto'
  const affiliation = typeof input?.affiliation === 'string' ? input.affiliation.trim() : ''
  const shelf = typeof input?.shelf === 'string' ? input.shelf.trim() : ''
  const replacementItemId = typeof input?.replacementItemId === 'string' ? input.replacementItemId.trim() : ''

  if (!automaticLibrary && !libraryIds.includes(libraryId)) throw new Error('目标媒体库无效')

  const config = await loadConfig()
  if (scanManagedLibraries) {
    sourcePaths = [
      ...new Map(
        libraryIds
          .filter((id) => config.libraries[id]?.enabled !== false)
          .map((id) => String(config.libraries[id]?.rootPath ?? '').trim())
          .filter((rootPath) => path.isAbsolute(rootPath))
          .map((rootPath) => [path.resolve(rootPath).toLocaleLowerCase(), path.resolve(rootPath)]),
      ).values(),
    ]
  }
  if (sourcePaths.length === 0) throw new Error(scanManagedLibraries ? '没有已启用且设置了有效路径的媒体库' : '必须先选择来源文件或目录')
  if (!automaticLibrary && config.libraries[libraryId]?.enabled === false) throw new Error('目标媒体库已停用，请先在设置中启用')
  const targetRoot = automaticLibrary ? '' : (config.libraries[libraryId]?.rootPath ?? '')
  const indexedLibrary = await loadLibrary()
  const indexedSourcePaths = new Set(
    indexedLibrary.items
      .map((item) => (typeof item?.sourcePath === 'string' ? item.sourcePath : ''))
      .filter((sourcePath) => path.isAbsolute(sourcePath))
      .map((sourcePath) => path.resolve(sourcePath).toLocaleLowerCase()),
  )
  const { scannedFiles, errors, totalFiles, truncated } = await scanImportSources({
    sourcePaths,
    maxFiles: maxImportScanFiles,
    maxErrors: maxImportErrors,
  })

  const sidecarsByKey = new Map()
  if (automaticLibrary || !isArchiveLibrary(libraryId)) {
    for (const file of scannedFiles) {
      if (!supportedSidecarExtensions.has(file.extension)) continue
      const key = `${path.dirname(file.filePath).toLowerCase()}\u0000${path.basename(file.fileName, file.extension).toLowerCase()}`
      const values = sidecarsByKey.get(key) ?? []
      values.push({ sourcePath: file.filePath, fileName: file.fileName, extension: file.extension, size: file.size })
      sidecarsByKey.set(key, values)
    }
  }

  const allCandidates = scannedFiles.flatMap((file) => {
    if (scanManagedLibraries && indexedSourcePaths.has(path.resolve(file.filePath).toLocaleLowerCase())) return []
    const managedLibrary = automaticLibrary ? inferManagedLibrary(config, file.filePath, file.extension) : ''
    const inferredLibrary = automaticLibrary
      ? managedLibrary ||
        (supportedArchiveExtensions.has(file.extension) ? 'books' : supportedVideoExtensions.has(file.extension) ? 'general' : '')
      : libraryId
    if (!inferredLibrary || !getImportExtensions(inferredLibrary).has(file.extension)) return []
    const key = `${path.dirname(file.filePath).toLowerCase()}\u0000${path.basename(file.fileName, file.extension).toLowerCase()}`
    const isVideo = !isArchiveLibrary(inferredLibrary)
    const inferredRoot = config.libraries[inferredLibrary]?.rootPath ?? ''
    const managedParentName = getManagedParentName(inferredRoot, file.filePath)
    const inferredAffiliation = isVideo
      ? affiliation ||
        managedParentName ||
        (file.sourceIsFile ? path.basename(file.fileName, file.extension) : path.basename(path.dirname(file.filePath)))
      : ''
    const item = createImportPlanItem({
      filePath: file.filePath,
      sourcePath: file.sourcePath,
      targetRoot: config.libraries[inferredLibrary]?.rootPath ?? '',
      libraryId: inferredLibrary,
      affiliation: inferredAffiliation,
      shelf: isArchiveLibrary(inferredLibrary) ? shelf || managedParentName : '',
      size: file.size,
      sidecars: sidecarsByKey.get(key) ?? [],
      replacementItemId,
    })
    if (config.libraries[inferredLibrary]?.enabled === false && item.status === 'ready') {
      item.status = 'blocked'
      item.targetPath = ''
      item.reason = '自动分配的目标媒体库已停用'
    }
    return [{ ...item, library: inferredLibrary }]
  })
  const candidateItemsTruncated = allCandidates.length > maxImportPlanItems
  const candidateItems = allCandidates.slice(0, maxImportPlanItems)
  const attachedSidecars = new Set(allCandidates.flatMap((item) => item.sidecars ?? []).map((sidecar) => sidecar.sourcePath))
  const supportedExtensions = new Set([...supportedArchiveExtensions, ...supportedVideoExtensions])
  const unsupportedCount = scannedFiles.filter(
    (file) => !supportedExtensions.has(file.extension) && !supportedSidecarExtensions.has(file.extension),
  ).length
  const unattachedSidecarCount = scannedFiles.filter(
    (file) => supportedSidecarExtensions.has(file.extension) && !attachedSidecars.has(file.filePath),
  ).length

  const acceptedCount = candidateItems.filter((item) => item.status === 'ready').length
  const blockedCount = candidateItems.filter((item) => item.status === 'blocked').length
  const planId = randomUUID()
  const generatedAt = new Date().toISOString()
  const replaceableItems = automaticLibrary
    ? indexedLibrary.items
        .filter((item) => item?.kind === 'video' && typeof item.sourcePath === 'string')
        .map((item) => ({
          id: item.id,
          library: item.library,
          affiliation: getItemAffiliation(item),
          episode: getItemEpisode(item),
          title: item.title,
          sourcePath: item.sourcePath,
        }))
    : isArchiveLibrary(libraryId)
      ? []
      : indexedLibrary.items
          .filter((item) => item?.kind === 'video' && item.library === libraryId && typeof item.sourcePath === 'string')
          .map((item) => ({
            id: item.id,
            affiliation: getItemAffiliation(item),
            episode: getItemEpisode(item),
            title: item.title,
            sourcePath: item.sourcePath,
          }))
  if (replacementItemId && candidateItems.length !== 1) throw new Error('替换文件一次只能选择一个视频来源')
  if (replacementItemId && !replaceableItems.some((item) => item.id === replacementItemId))
    throw new Error('替换目标视频不存在，请重新打开替换流程')
  if (replacementItemId) {
    const replacement = replaceableItems.find((item) => item.id === replacementItemId)
    const replacementTarget = candidateItems[0]
    replacementTarget.targetPath = replacement.sourcePath
    replacementTarget.sidecars = replacementTarget.sidecars?.map((sidecar) => ({
      ...sidecar,
      targetPath: path.join(path.dirname(replacement.sourcePath), sidecar.fileName),
    }))
  }
  const plan = {
    planId,
    sourcePath: sourcePaths.length === 1 ? sourcePaths[0] : `${sourcePaths.length} 个来源`,
    sourcePaths,
    targetLibrary: automaticLibrary ? 'auto' : libraryId,
    targetRoot,
    generatedAt,
    configUpdatedAt: config.updatedAt,
    replaceableItems,
    totalFiles,
    mediaFileCount: allCandidates.length,
    sidecarCount: attachedSidecars.size,
    unattachedSidecarCount,
    acceptedCount,
    blockedCount,
    unsupportedCount,
    errorCount: errors.length,
    truncated: truncated || candidateItemsTruncated,
    candidateItemsTruncated,
    maxImportPlanItems,
    maxImportScanFiles,
    items: candidateItems.map((item, index) => ({ id: String(index + 1), ...item })),
    errors,
    scanManagedLibraries,
  }
  importPlans.set(planId, { plan, createdAt: Date.now() })
  for (const [id, stored] of importPlans) {
    if (Date.now() - stored.createdAt > importPlanLifetimeMs) importPlans.delete(id)
  }
  return plan
}

async function discoverMatchingSidecars(item, directoryEntriesByPath) {
  if (item?.kind !== 'video' || typeof item.sourcePath !== 'string' || !path.isAbsolute(item.sourcePath)) return item
  const sourcePath = path.resolve(item.sourcePath)
  const directoryPath = path.dirname(sourcePath)
  let entryTask = directoryEntriesByPath.get(directoryPath)
  if (!entryTask) {
    entryTask = fs.readdir(directoryPath, { withFileTypes: true }).catch(() => [])
    directoryEntriesByPath.set(directoryPath, entryTask)
  }
  const entries = await entryTask
  const sourceBaseName = path.basename(sourcePath, path.extname(sourcePath)).toLocaleLowerCase()
  const discovered = []
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (!entry.isFile()) continue
    const extension = path.extname(entry.name).toLocaleLowerCase()
    if (!supportedSidecarExtensions.has(extension)) continue
    if (path.basename(entry.name, extension).toLocaleLowerCase() !== sourceBaseName) continue
    const sidecarPath = path.join(directoryPath, entry.name)
    const stat = await fs.stat(sidecarPath).catch(() => null)
    if (!stat?.isFile()) continue
    discovered.push({ fileName: entry.name, sourcePath: sidecarPath, extension, size: stat.size })
  }
  const previousSidecars = Array.isArray(item.sidecars) ? item.sidecars : []
  if (JSON.stringify(previousSidecars) === JSON.stringify(discovered)) return item
  return { ...item, sidecars: discovered }
}

async function loadLibrary({ waitForMissingThumbnails = false } = {}) {
  const { libraryPath, backupDir, coversDir } = getConfigPaths()
  const data = await loadLibraryFile(libraryPath)
  const config = await loadConfig()
  const availableLibraryRoots = new Map()
  for (const libraryId of libraryIds) {
    const rootPath = config.libraries[libraryId]?.rootPath ?? ''
    if (!path.isAbsolute(rootPath)) {
      availableLibraryRoots.set(libraryId, false)
      continue
    }
    try {
      availableLibraryRoots.set(libraryId, (await fs.stat(rootPath)).isDirectory())
    } catch {
      // Preserve records when an entire configured library root is temporarily unavailable, such as a disconnected drive.
      availableLibraryRoots.set(libraryId, false)
    }
  }
  const missingItemIds = new Set()
  for (const item of data.items) {
    const rootPath = config.libraries[item?.library]?.rootPath ?? ''
    if (!availableLibraryRoots.get(item?.library) || !path.isAbsolute(item?.sourcePath) || !isPathInside(rootPath, item.sourcePath))
      continue
    try {
      if (!(await fs.stat(item.sourcePath)).isFile()) missingItemIds.add(item.id)
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') missingItemIds.add(item.id)
    }
  }
  const indexedItems = data.items.filter((item) => !missingItemIds.has(item?.id))
  const generatedVideoCoverUrl = pathToFileURL(path.join(coversDir, 'videos')).toString()
  let changed = missingItemIds.size > 0
  const directoryEntriesByPath = new Map()
  const items = []
  for (const item of indexedItems) {
    let next = item
    if (availableLibraryRoots.get(item?.library)) next = await discoverMatchingSidecars(next, directoryEntriesByPath)
    if (item?.kind === 'book' && item.cover && !getCurrentArchiveCoverPath(item)) next = { ...next, cover: '' }
    if (
      item?.kind === 'video' &&
      isPosterLibrary(item.library) &&
      typeof item.cover === 'string' &&
      item.cover.includes(generatedVideoCoverUrl)
    ) {
      next = { ...next, cover: '', episodeCover: item.cover }
    }
    if (next !== item) changed = true
    items.push(next)
  }
  let normalized = data
  if (changed)
    normalized = (
      await saveLibraryFile({
        libraryPath,
        backupDir,
        data: { items, operations: data.operations },
        backupExisting: missingItemIds.size > 0,
      })
    ).data
  const repairTask = thumbnailService
    ? thumbnailService.scheduleMissingRepair(normalized, withFileOperationLock)
    : Promise.resolve(normalized)
  if (waitForMissingThumbnails) return repairTask
  return normalized
}

async function saveLibrary(data, options) {
  const { libraryPath, backupDir } = getConfigPaths()
  return saveLibraryFile({ libraryPath, backupDir, data, ...options })
}

async function pruneManagedCache(protectedPaths = []) {
  const config = await loadConfig()
  const { cacheDir } = getConfigPaths()
  return pruneCacheDirectory(cacheDir, config.cacheLimitMb * 1024 * 1024, protectedPaths)
}

async function createBookCoverThumbnail(sourcePath, outputPath) {
  return bookCoverThumbnailService.createBookCoverThumbnail(sourcePath, outputPath)
}

async function openBookForLibrary(id) {
  const library = await loadLibrary()
  const index = library.items.findIndex((item) => item?.id === id && item.kind === 'book' && typeof item.sourcePath === 'string')
  if (index < 0) throw new Error('压缩包记录不存在')
  const opened = await archiveReader.openArchive(library.items[index].sourcePath)
  if (!opened.coverUrl) return { sessionId: opened.sessionId, pages: opened.pages, item: library.items[index] }
  const cover = `url("${opened.coverUrl}") center / cover`
  if (library.items[index].cover === cover) return { sessionId: opened.sessionId, pages: opened.pages, item: library.items[index] }
  const items = [...library.items]
  items[index] = { ...items[index], cover }
  const saved = await saveLibrary({ items, operations: library.operations }, { backupExisting: false })
  return { sessionId: opened.sessionId, pages: opened.pages, item: saved.data.items[index] }
}

libraryMetadataService = createLibraryMetadataService({
  getConfigPaths,
  loadConfig,
  loadLibrary,
  saveLibrary,
  removeEmptyDirectories: (...args) => removeEmptyDirectoriesUpward(...args),
  isPosterLibrary,
})

function publishThumbnailUpdates(items) {
  if (!Array.isArray(items) || items.length === 0) return
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.libraryThumbnailsUpdated, items)
  }
}

thumbnailService = createThumbnailService({
  getConfigPaths,
  createArchiveCover: (sourcePath) => archiveReader.createCover(sourcePath),
  createVideoCover: (sourcePath, outputPath) =>
    require('./windows-thumbnail-service.cjs').createWindowsVideoThumbnail(sourcePath, outputPath),
  loadLibraryFile,
  saveLibrary,
  publishUpdates: publishThumbnailUpdates,
})

const scraperApplicationService = createScraperApplicationService({
  scraperAdapters,
  getConfigPaths,
  loadConfig,
  loadLibrary,
  saveLibrary,
  fetchBangumi: fetchBangumiDirect,
  fetchWithNetwork: fetchWithSystemNetwork,
  writeFileAtomically,
  appVersion: `StarMedia/${app.getVersion()}`,
  openExternal: (...args) => shell.openExternal(...args),
  bangumiTokenPageUrl,
})

const desktopDialogService = createDesktopDialogService({
  showSaveDialog: (owner, options) => (owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)),
  showOpenDialog: (owner, options) => (owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)),
  showMessageBox: (owner, options) => (owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options)),
  getDefaultOwner: () => BrowserWindow.getAllWindows()[0] ?? null,
  exportBackup: (backupPath) => portableDataService.exportBackup(backupPath),
  runLocked: withFileOperationLock,
})

async function getBookPage(sessionId, index, options) {
  return archiveReader.getPage(sessionId, index, options)
}

function closeBookSession(sessionId) {
  archiveReader.closeSession(sessionId)
}

async function importMediaRecords(input, onProgress) {
  const planId = typeof input?.planId === 'string' ? input.planId : ''
  const stored = importPlans.get(planId)
  if (!stored || Date.now() - stored.createdAt > importPlanLifetimeMs) throw new Error('导入计划已失效，请重新生成')
  const { plan } = stored
  const config = await loadConfig()
  if (config.updatedAt !== plan.configUpdatedAt) throw new Error('设置已变化，请重新生成导入计划')
  if (plan.targetLibrary !== 'auto') {
    if (config.libraries[plan.targetLibrary]?.rootPath !== plan.targetRoot) throw new Error('设置已变化，请重新生成导入计划')
  }

  const selectedItems = new Map(Array.isArray(input?.items) ? input.items.map((entry) => [String(entry?.id ?? ''), entry]) : [])
  const items = plan.items.map((item) => {
    const selected = selectedItems.get(item.id)
    const targetLibrary =
      plan.targetLibrary === 'auto' && libraryIds.includes(selected?.library) ? selected.library : (item.library ?? plan.targetLibrary)
    const affiliation = typeof selected?.affiliation === 'string' ? selected.affiliation : item.affiliation
    const shelf = typeof selected?.shelf === 'string' ? selected.shelf : item.shelf
    const episode = typeof selected?.episode === 'string' ? selected.episode : item.episode
    const replacementItemId = typeof selected?.replacementItemId === 'string' ? selected.replacementItemId : item.replacementItemId
    const preserveManagedPath =
      item.managedInPlace === true &&
      targetLibrary === item.library &&
      affiliation === item.affiliation &&
      shelf === item.shelf &&
      !replacementItemId
    return {
      ...item,
      library: targetLibrary,
      affiliation,
      shelf,
      episode,
      replacementItemId,
      preserveManagedPath,
    }
  })
  const progressItems = items.filter((item) => item.status === 'ready' && getImportExtensions(item.library).has(item.extension))
  let completedItems = 0
  const reportProgress = ({ fileName }) => {
    completedItems = Math.min(progressItems.length, completedItems + 1)
    onProgress?.({ stage: 'importing', current: completedItems, total: progressItems.length, fileName })
  }
  onProgress?.({ stage: 'importing', current: 0, total: progressItems.length })
  const library = await loadLibrary()
  try {
    const { dataRoot } = getConfigPaths()
    let result
    if (plan.targetLibrary === 'auto') {
      let currentData = library
      const allResults = []
      const allErrors = []
      let importedCount = 0
      let skippedCount = 0
      for (const libraryId of libraryIds) {
        const groupedItems = items.filter((item) => item.library === libraryId)
        if (groupedItems.length === 0) continue
        const grouped = await executeMediaImport({
          libraryId,
          items: groupedItems,
          config,
          library: currentData,
          saveLibrary,
          replacedRoot: path.join(dataRoot, 'replaced'),
          onItemComplete: reportProgress,
        })
        currentData = grouped.data
        allResults.push(...grouped.results)
        allErrors.push(...grouped.errors)
        importedCount += grouped.importedCount
        skippedCount += grouped.skippedCount
      }
      result = { data: currentData, importedCount, skippedCount, errors: allErrors, results: allResults, batchId: `auto:${randomUUID()}` }
    } else {
      result = await executeMediaImport({
        libraryId: plan.targetLibrary,
        items,
        config,
        library,
        saveLibrary,
        replacedRoot: path.join(dataRoot, 'replaced'),
        onItemComplete: reportProgress,
      })
    }
    const { libraryPath } = getConfigPaths()
    const generatedData = await thumbnailService.generateImported(result.data, result.results, onProgress)
    const data = await thumbnailService.repairMissing(generatedData, { includeVideos: false })
    return { ...result, data, libraryPath }
  } finally {
    importPlans.delete(planId)
  }
}

async function getVideoPlayback(id) {
  const result = await getVideoPlaybackForLibrary({
    id,
    library: await loadLibrary(),
  })
  let embeddedSubtitles = { subtitles: [], protectedPaths: [] }
  try {
    embeddedSubtitles = await extractMatroskaSubtitles({
      sourcePath: result.sourcePath,
      cacheDir: getConfigPaths().cacheDir,
      touchCacheFile,
    })
  } catch (error) {
    console.warn(`无法读取内嵌字幕：${error.message}`)
  }
  const subtitles = await createSubtitlePlaybackTracks({
    subtitles: [...result.subtitles, ...embeddedSubtitles.subtitles],
    cacheDir: getConfigPaths().cacheDir,
    pruneCache: pruneManagedCache,
    protectedPaths: embeddedSubtitles.protectedPaths,
    touchCacheFile,
    onWarning: (message) => console.warn(message),
  })
  return {
    url: result.url,
    mimeType: result.mimeType,
    title: result.title,
    subtitles,
  }
}

async function getVideoPlaybackSupport(id) {
  return getVideoPlaybackSupportForLibrary({ id, library: await loadLibrary() })
}

async function openVideoExternally(id) {
  return openVideoExternallyForLibrary({ id, library: await loadLibrary(), openPath: shell.openPath })
}

async function clearEmptyMediaDirectories() {
  return clearEmptyMediaDirectoriesForConfig({ config: await loadConfig(), libraryIds })
}

async function getDirectoryUsage(directoryPath) {
  const root = String(directoryPath ?? '').trim()
  if (!path.isAbsolute(root)) return 0

  async function measure(entryPath) {
    const stat = await fs.lstat(entryPath).catch(() => null)
    if (!stat || stat.isSymbolicLink()) return 0
    if (stat.isFile()) return stat.size
    if (!stat.isDirectory()) return 0
    const entries = await fs.readdir(entryPath).catch(() => [])
    let bytes = 0
    for (const entry of entries) bytes += await measure(path.join(entryPath, entry))
    return bytes
  }

  return measure(root)
}

async function getLibraryUsage(libraryId) {
  const config = await loadConfig()
  const rootPath = String(config.libraries[libraryId]?.rootPath ?? '').trim()
  return { rootPath, bytes: await getDirectoryUsage(rootPath) }
}

async function transferLibraryItems(input) {
  const [config, library] = await Promise.all([loadConfig(), loadLibrary()])
  const sourceRoots = new Map()
  const selectedIds = new Set(Array.isArray(input?.ids) ? input.ids.map((id) => String(id)).filter(Boolean) : [])
  for (const item of library.items) {
    if (!selectedIds.has(item?.id)) continue
    const rootPath = config.libraries[item.library]?.rootPath ?? ''
    if (path.isAbsolute(rootPath)) sourceRoots.set(path.resolve(rootPath), true)
  }
  const { sourceDirectories, ...result } = await executeLibraryTransfer({ input, config, library, saveLibrary })
  for (const rootPath of sourceRoots.keys()) {
    for (const directory of sourceDirectories) await removeEmptyDirectoriesUpward(directory, rootPath)
  }
  return result
}

async function regenerateAllThumbnails() {
  return thumbnailService.regenerateAll(await loadLibrary())
}

async function clearCaches() {
  return thumbnailService.clearCaches(await loadLibrary())
}

async function clearLibraryRecords() {
  const { libraryPath, backupDir } = getConfigPaths()
  return clearImportedRecords({ libraryPath, backupDir })
}

async function trashLibraryItems(input) {
  return libraryMaintenanceService.trashLibraryItems(input)
}

async function trashVideoContainer(input) {
  return libraryMaintenanceService.trashVideoContainer(input)
}

async function updateVideoMetadata(input) {
  return libraryMetadataService.updateVideoMetadata(input)
}

async function updateContainerInfo(input) {
  return libraryMetadataService.updateContainerInfo(input)
}

async function updateContainerTags(input) {
  return libraryMetadataService.updateContainerTags(input)
}

async function updateMediaTags(input) {
  return libraryMetadataService.updateMediaTags(input)
}

async function updateMediaInfo(input) {
  return libraryMetadataService.updateMediaInfo(input)
}

async function updateVideoEpisode(input) {
  return libraryMetadataService.updateVideoEpisode(input)
}

async function updateBookShelves(input) {
  return libraryMetadataService.updateBookShelves(input)
}

async function moveVideoToAffiliation(input) {
  return libraryMetadataService.moveVideoToAffiliation(input)
}

async function openPathInExplorer(input) {
  const requested = String(input?.path ?? input ?? '').trim()
  if (!requested || !path.isAbsolute(requested)) throw new Error('无法打开无效路径')
  let target = path.resolve(requested)
  while (true) {
    const stat = await fs.stat(target).catch(() => null)
    if (stat?.isDirectory()) break
    const parent = path.dirname(target)
    if (parent === target) throw new Error('未找到可打开的目录')
    target = parent
  }
  const error = await shell.openPath(target)
  if (error) throw new Error(error)
  return { path: target }
}

function createPortableDataBackup() {
  return desktopDialogService.createPortableDataBackup()
}

function showPortableExportWarning(owner) {
  return desktopDialogService.showPortableExportWarning(owner)
}

function requestWindowClose(window) {
  if (!window || window.isDestroyed()) return Promise.resolve('closed')
  const pending = pendingWindowCloses.get(window)
  if (pending) return pending
  const task = (async () => {
    if (isPortableDataExportInProgress()) {
      await showPortableExportWarning(window)
      return 'blocked'
    }
    const config = await loadConfig().catch(() => ({ confirmBeforeClose: true }))
    if (config.confirmBeforeClose) {
      const result = await dialog.showMessageBox(window, {
        type: 'question',
        title: '退出 StarMedia',
        message: '确定要退出 StarMedia 吗？',
        buttons: ['退出', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      if (result.response !== 0) return 'blocked'
    }
    approvedWindowCloses.add(window)
    window.close()
    return 'closed'
  })().finally(() => pendingWindowCloses.delete(window))
  pendingWindowCloses.set(window, task)
  return task
}

function startPortableDataExport() {
  return desktopDialogService.startPortableDataExport()
}

function isPortableDataExportInProgress() {
  return desktopDialogService.isPortableDataExportInProgress()
}

async function importPortableData(backupPath) {
  const result = await portableDataService.importBackup(backupPath)
  await configureNetworkProxy(result.config)
  return result
}

function sendGitHubUpdateProgress(owner, progress) {
  if (!owner || owner.isDestroyed() || owner.webContents.isDestroyed()) return
  owner.webContents.send(IPC_CHANNELS.appGitHubUpdateProgress, progress)
}

function quitForLocalUpdate() {
  localUpdateQuitRequested = true
  for (const window of BrowserWindow.getAllWindows()) approvedWindowCloses.add(window)
  app.quit()
}

async function installLocalUpdate(owner) {
  if (!app.isPackaged) throw new Error('本地 ZIP 升级只能在打包版中使用')
  if (isPortableDataExportInProgress()) throw new Error('正在导出应用数据，请稍后再升级')
  const selection = await dialog.showOpenDialog(owner, {
    title: '选择 StarMedia 本地升级包',
    properties: ['openFile'],
    filters: [{ name: 'StarMedia ZIP 升级包', extensions: ['zip'] }],
  })
  const archivePath = selection.canceled ? null : (selection.filePaths[0] ?? null)
  if (!archivePath) return { canceled: true }

  const prepared = await localUpdateService.prepareUpdate(archivePath)
  try {
    const versionDescription = prepared.reinstall
      ? `重新安装当前版本 ${prepared.targetVersion}`
      : `从 ${prepared.currentVersion} 升级到 ${prepared.targetVersion}`
    const confirmation = await dialog.showMessageBox(owner, {
      type: 'question',
      title: '安装本地升级包',
      message: `确定要${versionDescription}吗？`,
      detail: `程序将自动退出、替换应用文件并重新启动。\n\n数据目录会保留：\n${portableDataRoot}\n\n升级前会备份配置和媒体索引，启动失败时会恢复旧程序。`,
      buttons: ['安装并重启', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (confirmation.response !== 0) {
      await localUpdateService.discardPreparedUpdate(prepared)
      return { canceled: true }
    }

    const result = await localUpdateService.launchPreparedUpdate(prepared)
    quitForLocalUpdate()
    return { canceled: false, ...result }
  } catch (error) {
    await localUpdateService.discardPreparedUpdate(prepared).catch(() => {})
    throw error
  }
}

function publicGitHubRelease(release) {
  if (!release) return null
  const result = { ...release }
  delete result.asset
  return result
}

async function checkGitHubUpdate() {
  if (!app.isPackaged) throw new Error('GitHub 更新只能在打包版中使用')
  return publicGitHubRelease(await githubUpdateService.checkLatestRelease())
}

async function testNetworkProxy() {
  const config = await loadConfig()
  if (!config.network.proxyEnabled) throw new Error('请先启用应用代理')
  await configureNetworkProxy(config)
  const response = await fetchWithSystemNetwork('https://api.github.com/rate_limit', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `StarMedia/${app.getVersion()}` },
    redirect: 'error',
  })
  return { status: response.status }
}

async function installGitHubUpdate(owner) {
  if (!app.isPackaged) throw new Error('GitHub 更新只能在打包版中使用')
  if (isPortableDataExportInProgress()) throw new Error('正在导出应用数据，请稍后再升级')
  const release = await githubUpdateService.checkLatestRelease()
  if (!release.updateAvailable) return { canceled: false, updateAvailable: false, ...publicGitHubRelease(release) }
  const sizeMb = (release.assetSize / 1024 / 1024).toFixed(1)
  const confirmation = await dialog.showMessageBox(owner, {
    type: 'question',
    title: '安装 GitHub 更新',
    message: `发现 StarMedia ${release.latestVersion}，是否下载并安装？`,
    detail: `更新包约 ${sizeMb} MB。下载后会校验 SHA-256，并再次执行本地升级包结构校验。\n\n程序随后会自动退出、替换应用文件并重新启动；StarMediaData 不会被覆盖。`,
    buttons: ['下载并安装', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  })
  if (confirmation.response !== 0) return { canceled: true, updateAvailable: true, ...publicGitHubRelease(release) }

  let download
  let prepared
  try {
    sendGitHubUpdateProgress(owner, { stage: 'downloading', downloadedBytes: 0, totalBytes: release.assetSize })
    download = await githubUpdateService.downloadLatestRelease(release, {
      onProgress: (progress) => sendGitHubUpdateProgress(owner, { stage: 'downloading', ...progress }),
    })
    sendGitHubUpdateProgress(owner, { stage: 'preparing', downloadedBytes: download.downloadedBytes, totalBytes: release.assetSize })
    prepared = await localUpdateService.prepareUpdate(download.archivePath)
    await githubUpdateService.discardDownloadedArchive(download.archivePath)
    download = null
    const result = await localUpdateService.launchPreparedUpdate(prepared)
    sendGitHubUpdateProgress(owner, { stage: 'restarting', downloadedBytes: release.assetSize, totalBytes: release.assetSize })
    quitForLocalUpdate()
    return { canceled: false, updateAvailable: true, ...result }
  } catch (error) {
    if (prepared) await localUpdateService.discardPreparedUpdate(prepared).catch(() => {})
    if (download?.archivePath) await githubUpdateService.discardDownloadedArchive(download.archivePath).catch(() => {})
    throw error
  }
}

function registerIpc() {
  const handle = (channel, listener) =>
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedIpcSender(event)
      return listener(event, ...parseIpcRequest(channel, args))
    })

  handle(IPC_CHANNELS.configLoad, async () => {
    const paths = getConfigPaths()
    return { config: await loadConfig(), appVersion: app.getVersion(), ...paths }
  })

  handle(IPC_CHANNELS.configSave, async (_event, config) => withFileOperationLock(() => saveConfigWithNetworkProxy(config)))

  handle(IPC_CHANNELS.importCreatePlan, async (_event, input) => createImportPlan(input))

  handle(IPC_CHANNELS.libraryLoad, async () =>
    withFileOperationLock(async () => {
      const { libraryPath } = getConfigPaths()
      return { data: await loadLibrary(), libraryPath }
    }),
  )

  handle(IPC_CHANNELS.libraryGetUsage, async (_event, libraryId) => getLibraryUsage(libraryId))

  handle(IPC_CHANNELS.libraryImportMedia, async (event, input) =>
    withFileOperationLock(() => importMediaRecords(input, (progress) => event.sender.send(IPC_CHANNELS.importProgress, progress))),
  )

  handle(IPC_CHANNELS.libraryClearRecords, async () => withFileOperationLock(() => clearLibraryRecords()))

  handle(IPC_CHANNELS.videoGetPlaybackSupport, async (_event, id) => getVideoPlaybackSupport(id))

  handle(IPC_CHANNELS.appExportData, async () => startPortableDataExport())

  handle(IPC_CHANNELS.appImportData, async (_event, backupPath) => withFileOperationLock(() => importPortableData(backupPath)))

  handle(IPC_CHANNELS.appInstallLocalUpdate, async (event) =>
    withFileOperationLock(() => installLocalUpdate(BrowserWindow.fromWebContents(event.sender))),
  )

  handle(IPC_CHANNELS.appCheckGitHubUpdate, async () => checkGitHubUpdate())

  handle(IPC_CHANNELS.appTestNetworkProxy, async () => testNetworkProxy())

  handle(IPC_CHANNELS.appInstallGitHubUpdate, async (event) =>
    withFileOperationLock(() => installGitHubUpdate(BrowserWindow.fromWebContents(event.sender))),
  )

  handle(IPC_CHANNELS.bookOpen, async (_event, id) => openBookForLibrary(id))

  handle(IPC_CHANNELS.bookGetPage, async (_event, sessionId, index, options) => getBookPage(sessionId, index, options))

  handle(IPC_CHANNELS.bookClose, async (_event, sessionId) => closeBookSession(sessionId))

  handle(IPC_CHANNELS.videoGetPlayback, async (_event, id) => getVideoPlayback(id))

  handle(IPC_CHANNELS.videoOpenExternal, async (_event, id) => openVideoExternally(id))

  handle(IPC_CHANNELS.videoUpdateMetadata, async (_event, input) => withFileOperationLock(() => updateVideoMetadata(input)))

  handle(IPC_CHANNELS.libraryUpdateContainerTags, async (_event, input) => withFileOperationLock(() => updateContainerTags(input)))

  handle(IPC_CHANNELS.libraryUpdateMediaTags, async (_event, input) => withFileOperationLock(() => updateMediaTags(input)))

  handle(IPC_CHANNELS.libraryUpdateContainerInfo, async (_event, input) => withFileOperationLock(() => updateContainerInfo(input)))

  handle(IPC_CHANNELS.libraryUpdateMediaInfo, async (_event, input) => withFileOperationLock(() => updateMediaInfo(input)))

  handle(IPC_CHANNELS.libraryUpdateVideoEpisode, async (_event, input) => withFileOperationLock(() => updateVideoEpisode(input)))

  handle(IPC_CHANNELS.libraryUpdateBookShelves, async (_event, input) => withFileOperationLock(() => updateBookShelves(input)))

  handle(IPC_CHANNELS.libraryTransferItems, async (_event, input) => withFileOperationLock(() => transferLibraryItems(input)))

  handle(IPC_CHANNELS.libraryMoveVideoAffiliation, async (_event, input) => withFileOperationLock(() => moveVideoToAffiliation(input)))

  handle(IPC_CHANNELS.libraryTrashItems, async (_event, input) => withFileOperationLock(() => trashLibraryItems(input)))

  handle(IPC_CHANNELS.libraryTrashVideoContainer, async (_event, input) => withFileOperationLock(() => trashVideoContainer(input)))

  handle(IPC_CHANNELS.libraryRegenerateThumbnails, async () => withFileOperationLock(() => regenerateAllThumbnails()))

  handle(IPC_CHANNELS.libraryClearCaches, async () => withFileOperationLock(() => clearCaches()))

  handle(IPC_CHANNELS.libraryClearEmptyMediaDirectories, async () => withFileOperationLock(() => clearEmptyMediaDirectories()))

  handle(IPC_CHANNELS.systemOpenPath, async (_event, input) => openPathInExplorer(input))

  handle(IPC_CHANNELS.systemOpenExternalUrl, async (_event, input) => scraperApplicationService.openExternalUrl(input))

  handle(IPC_CHANNELS.bangumiSearchSubjects, async (_event, input) => scraperApplicationService.searchBangumiSubjects(input))

  handle(IPC_CHANNELS.bangumiPreviewSubject, async (_event, input) => scraperApplicationService.previewBangumiSubject(input))

  handle(IPC_CHANNELS.bangumiApplySubject, async (_event, input) =>
    withFileOperationLock(() => scraperApplicationService.applyBangumiSubject(input)),
  )

  handle(IPC_CHANNELS.bangumiAssignEpisodes, async (_event, input) =>
    withFileOperationLock(() => scraperApplicationService.assignBangumiEpisodes(input)),
  )

  handle(IPC_CHANNELS.bangumiApplyEpisode, async (_event, input) =>
    withFileOperationLock(() => scraperApplicationService.applyBangumiEpisode(input)),
  )

  handle(IPC_CHANNELS.hanimeSearchSubjects, async (_event, input) => scraperApplicationService.searchHanimeSubjects(input))

  handle(IPC_CHANNELS.hanimePreviewSubject, async (_event, input) => scraperApplicationService.previewHanimeSubject(input))

  handle(IPC_CHANNELS.hanimeApplySubject, async (_event, input) =>
    withFileOperationLock(() => scraperApplicationService.applyHanimeSubject(input)),
  )

  handle(IPC_CHANNELS.bangumiOpenTokenPage, async () => scraperApplicationService.openBangumiTokenPage())

  handle(IPC_CHANNELS.bangumiVerifyToken, async () => scraperApplicationService.verifyBangumiToken())

  handle(IPC_CHANNELS.windowMinimize, (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())

  handle(IPC_CHANNELS.windowToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })

  handle(IPC_CHANNELS.windowClose, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return requestWindowClose(window)
  })

  handle(IPC_CHANNELS.dialogChooseDirectory, async (event) =>
    desktopDialogService.chooseDirectory(BrowserWindow.fromWebContents(event.sender)),
  )

  handle(IPC_CHANNELS.dialogChooseImportSources, async (event) =>
    desktopDialogService.chooseImportSources(BrowserWindow.fromWebContents(event.sender)),
  )

  handle(IPC_CHANNELS.dialogChooseVideoFile, async (event) =>
    desktopDialogService.chooseVideoFile(BrowserWindow.fromWebContents(event.sender)),
  )

  handle(IPC_CHANNELS.dialogChooseAppDataBackup, async (event) =>
    desktopDialogService.chooseAppDataBackup(BrowserWindow.fromWebContents(event.sender)),
  )
}

function createWindow() {
  const options = {
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 700,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#101018',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload bridge imports local contract modules. Keep renderer isolation and disable Node integration,
      // but do not sandbox preload itself or the bridge will fail before exposing window.starMedia.
      sandbox: false,
    },
  }
  if (isDevelopment) options.icon = path.join(app.getAppPath(), 'src', 'assets', 'starmedia-logo.png')
  const window = new BrowserWindow(options)
  mainWindow = window
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Preload failed (${preloadPath}): ${error.message}`)
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  window.on('close', (event) => {
    if (approvedWindowCloses.delete(window)) return
    event.preventDefault()
    void requestWindowClose(window)
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.maximize()

  if (isDevelopment) {
    window.loadURL('http://127.0.0.1:5173')
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

if (require.main === module) {
  if (ownsSingleInstance) {
    app.whenReady().then(async () => {
      app.setName('StarMedia')
      app.setAppUserModelId('com.starmedia.app')
      Menu.setApplicationMenu(null)
      try {
        await configureNetworkProxy(await loadConfig())
      } catch (error) {
        console.error(`Failed to configure network proxy: ${error.message}`)
      }
      registerIpc()
      createWindow()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit()
    })
    app.on('before-quit', (event) => {
      if (localUpdateQuitRequested) return
      if (!isPortableDataExportInProgress()) return
      event.preventDefault()
      void showPortableExportWarning(mainWindow)
    })
  }
}

module.exports = {
  closeBookSession,
  createImportPlan,
  getBookPage,
  getVideoPlayback,
  importMediaRecords,
  loadLibrary,
  loadConfig,
  openBookForLibrary,
  saveConfig,
  updateVideoMetadata,
  transferLibraryItems,
  moveVideoToAffiliation,
  trashLibraryItems,
  trashVideoContainer,
  updateVideoEpisode,
  updateContainerInfo,
  updateMediaInfo,
  clearCaches,
  clearEmptyMediaDirectories,
  getLibraryUsage,
  regenerateAllThumbnails,
  verifyBangumiToken: () => scraperApplicationService.verifyBangumiToken(),
  openPathInExplorer,
  withFileOperationLock,
  createPortableDataBackup,
  importPortableData,
  applyBangumiSubject: (input) => scraperApplicationService.applyBangumiSubject(input),
  applyHanimeSubject: (input) => scraperApplicationService.applyHanimeSubject(input),
  previewBangumiSubject: (input) => scraperApplicationService.previewBangumiSubject(input),
  previewHanimeSubject: (input) => scraperApplicationService.previewHanimeSubject(input),
  searchHanimeSubjects: (input) => scraperApplicationService.searchHanimeSubjects(input),
  startPortableDataExport,
  isPortableDataExportInProgress,
  requestWindowClose,
  resolvePortableDataRoot,
  createWindow,
  registerIpc,
}
