const fs = require('node:fs/promises')
const { createHash, randomUUID } = require('node:crypto')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const { pathToFileURL } = require('node:url')
const yauzl = require('yauzl')
const { isPathInside } = require('./file-operations.cjs')

const defaultImageExtensions = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.avif', '.gif', '.bmp'])

function archiveKey(filePath, stat) {
  return createHash('sha1').update(`${filePath}:${stat.size}:${stat.mtimeMs}`).digest('hex')
}

function compareArchiveNames(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function parse7zTechnicalList(output, imageExtensions = defaultImageExtensions) {
  const imagePaths = []
  for (const block of String(output).split(/\r?\n\r?\n/)) {
    const fields = {}
    for (const line of block.split(/\r?\n/)) {
      const match = /^([^=]+) = ?(.*)$/.exec(line)
      if (match) fields[match[1].trim()] = match[2]
    }
    if (fields.Path && fields.Folder !== '+' && imageExtensions.has(path.extname(fields.Path).toLowerCase())) imagePaths.push(fields.Path)
  }
  return imagePaths.sort(compareArchiveNames)
}

function createArchiveReaderCacheService({
  getConfigPaths,
  loadConfig,
  pruneCacheDirectory,
  touchCacheFile,
  run7z,
  replaceFileAtomically,
  imageExtensions = defaultImageExtensions,
  fileSystem = fs,
  createCoverThumbnail = (sourcePath, outputPath) => fileSystem.copyFile(sourcePath, outputPath),
  zip = yauzl,
  now = () => Date.now(),
  logWarning = (message) => console.warn(message),
}) {
  if (
    typeof getConfigPaths !== 'function' ||
    typeof loadConfig !== 'function' ||
    typeof pruneCacheDirectory !== 'function' ||
    typeof touchCacheFile !== 'function' ||
    typeof run7z !== 'function' ||
    typeof replaceFileAtomically !== 'function'
  )
    throw new Error('归档阅读服务依赖不可用')

  const sessions = new Map()
  const pageTasks = new Map()
  const extractionQueues = new Map()
  let sevenZipExtractionQueue = Promise.resolve()

  function isImagePath(filePath) {
    return imageExtensions.has(path.extname(filePath).toLowerCase())
  }

  async function getArchiveCacheDir(filePath) {
    const stat = await fileSystem.stat(filePath)
    const key = archiveKey(filePath, stat)
    const { cacheDir } = getConfigPaths()
    const dir = path.join(cacheDir, 'books', key)
    await fileSystem.mkdir(dir, { recursive: true })
    return { dir, key }
  }

  async function pruneManagedCache(protectedPaths = []) {
    const config = await loadConfig()
    const { cacheDir } = getConfigPaths()
    return pruneCacheDirectory(cacheDir, config.cacheLimitMb * 1024 * 1024, protectedPaths)
  }

  function listZipImages(filePath) {
    return new Promise((resolve, reject) => {
      const images = []
      zip.open(filePath, { lazyEntries: true }, (openError, zipfile) => {
        if (openError || !zipfile) {
          reject(openError ?? new Error('无法打开 ZIP'))
          return
        }
        zipfile.readEntry()
        zipfile.on('entry', (entry) => {
          if (!/\/$/.test(entry.fileName) && isImagePath(entry.fileName)) images.push(entry.fileName)
          zipfile.readEntry()
        })
        zipfile.on('error', reject)
        zipfile.on('end', () => resolve(images.sort(compareArchiveNames)))
      })
    })
  }

  function extractZipEntry(filePath, entryName, outputPath) {
    return new Promise((resolve, reject) => {
      let found = false
      zip.open(filePath, { lazyEntries: true }, (openError, zipfile) => {
        if (openError || !zipfile) {
          reject(openError ?? new Error('无法打开 ZIP'))
          return
        }
        zipfile.readEntry()
        zipfile.on('entry', (entry) => {
          if (entry.fileName !== entryName) {
            zipfile.readEntry()
            return
          }
          found = true
          zipfile.openReadStream(entry, async (streamError, stream) => {
            if (streamError || !stream) {
              reject(streamError ?? new Error('无法读取 ZIP 条目'))
              return
            }
            try {
              const file = await fileSystem.open(outputPath, 'w')
              await pipeline(stream, file.createWriteStream())
              await file.close().catch(() => {})
              resolve(outputPath)
            } catch (error) {
              reject(error)
            }
          })
        })
        zipfile.on('error', reject)
        zipfile.on('end', () => {
          if (!found) reject(new Error('ZIP 条目不存在'))
        })
      })
    })
  }

  async function findImageFiles(directory) {
    const files = []
    const entries = await fileSystem.readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => compareArchiveNames(left.name, right.name))) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) files.push(...(await findImageFiles(entryPath)))
      else if (entry.isFile() && isImagePath(entryPath)) files.push(entryPath)
    }
    return files
  }

  function queueSevenZipExtraction(task) {
    const queued = sevenZipExtractionQueue.catch(() => {}).then(task)
    sevenZipExtractionQueue = queued.then(
      () => undefined,
      () => undefined,
    )
    return queued
  }

  function queueBookExtraction(session, task) {
    const queueKey = session.cacheDir
    const previous = extractionQueues.get(queueKey) ?? Promise.resolve()
    const queued = previous.catch(() => {}).then(task)
    extractionQueues.set(queueKey, queued)
    return queued.finally(() => {
      if (extractionQueues.get(queueKey) === queued) extractionQueues.delete(queueKey)
    })
  }

  async function list7zImages(filePath) {
    const pages = parse7zTechnicalList(await queueSevenZipExtraction(() => run7z(['l', '-slt', filePath])), imageExtensions)
    if (pages.length === 0) throw new Error('7z 压缩包中没有可阅读的图片')
    return pages
  }

  function getPagePath(session, index) {
    const extension = path.extname(session.pages[index]).toLowerCase() || '.img'
    return path.join(session.cacheDir, `${String(index + 1).padStart(5, '0')}${extension}`)
  }

  async function extract7zPage(session, index, outputPath) {
    return queueSevenZipExtraction(async () => {
      let lastError
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const temporaryDir = path.join(session.cacheDir, `.extract-${randomUUID()}`)
        const temporaryOutputPath = `${outputPath}.part-${randomUUID()}`
        await fileSystem.mkdir(temporaryDir, { recursive: true })
        try {
          const pageName = session.pages[index]
          let targetedError = null
          try {
            await run7z(['x', '-y', session.filePath, `-o${temporaryDir}`, '--', pageName])
          } catch (error) {
            targetedError = error
          }
          const expectedPath = path.resolve(temporaryDir, pageName)
          const readablePath = isPathInside(temporaryDir, expectedPath)
            ? await fileSystem
                .stat(expectedPath)
                .then((stat) => (stat.isFile() && stat.size > 0 ? expectedPath : null))
                .catch(() => null)
            : null
          let extractedPath = readablePath ?? (await findImageFiles(temporaryDir))[0] ?? null
          if (!extractedPath) {
            await fileSystem.rm(temporaryDir, { recursive: true, force: true })
            await fileSystem.mkdir(temporaryDir, { recursive: true })
            await run7z(['x', '-y', session.filePath, `-o${temporaryDir}`])
            extractedPath = (await findImageFiles(temporaryDir))[index] ?? null
          }
          if (!extractedPath) throw targetedError ?? new Error('压缩包页面不存在或不是图片')
          const stat = await fileSystem.stat(extractedPath)
          if (!stat.isFile() || stat.size <= 0) throw new Error('解压出的图片为空')
          await fileSystem.copyFile(extractedPath, temporaryOutputPath)
          await replaceFileAtomically(temporaryOutputPath, outputPath)
          return
        } catch (error) {
          lastError = error
          await fileSystem.rm(temporaryOutputPath, { force: true }).catch(() => {})
        } finally {
          await fileSystem.rm(temporaryDir, { recursive: true, force: true })
        }
      }
      throw new Error(`第 ${index + 1} 页解压失败：${lastError?.message ?? '未知错误'}`)
    })
  }

  function clearExpiredSessions() {
    const expiry = now() - 12 * 60 * 60 * 1000
    for (const [sessionId, session] of sessions) {
      if (session.lastUsedAt < expiry) sessions.delete(sessionId)
    }
  }

  async function createSession(filePath) {
    clearExpiredSessions()
    const extension = path.extname(filePath).toLowerCase()
    const pages = extension === '.zip' ? await listZipImages(filePath) : await list7zImages(filePath)
    const { dir, key } = await getArchiveCacheDir(filePath)
    const sessionId = randomUUID()
    const session = { sessionId, filePath, extension, pages, cacheDir: dir, archiveKey: key, lastUsedAt: now(), materializeTask: null }
    sessions.set(sessionId, session)
    return session
  }

  async function getPageFromSession(session, index, { force = false } = {}) {
    if (!Number.isInteger(index) || index < 0 || index >= session.pages.length) throw new Error('压缩包页码无效')
    session.lastUsedAt = now()
    const outputPath = getPagePath(session, index)
    const taskKey = `${session.cacheDir}:${index}`
    const activeTask = pageTasks.get(taskKey)
    if (activeTask) return activeTask
    const task = (async () => {
      const cached = await fileSystem
        .stat(outputPath)
        .then((stat) => stat.isFile() && stat.size > 0)
        .catch((error) => {
          if (error?.code === 'ENOENT') return false
          throw error
        })
      if (!cached || force) {
        await fileSystem.rm(outputPath, { force: true })
        if (session.extension === '.zip') await extractZipEntry(session.filePath, session.pages[index], outputPath)
        else if (index > 0 && session.materializeTask) await session.materializeTask
        else await queueBookExtraction(session, () => extract7zPage(session, index, outputPath))
      }
      await touchCacheFile(outputPath)
      await pruneManagedCache(session.pages.map((_page, pageIndex) => getPagePath(session, pageIndex)))
      return { name: session.pages[index], path: outputPath, url: pathToFileURL(outputPath).toString() }
    })()
    pageTasks.set(taskKey, task)
    try {
      return await task
    } finally {
      pageTasks.delete(taskKey)
    }
  }

  async function materializeSevenZipSession(session) {
    if (session.extension !== '.7z' || session.pages.length < 2 || session.materializeTask) return session.materializeTask
    const task = queueSevenZipExtraction(async () => {
      const temporaryDir = path.join(session.cacheDir, `.materialize-${randomUUID()}`)
      await fileSystem.mkdir(temporaryDir, { recursive: true })
      try {
        await run7z(['x', '-y', session.filePath, `-o${temporaryDir}`])
        const extractedImages = await findImageFiles(temporaryDir)
        for (let index = 0; index < session.pages.length; index += 1) {
          const expectedPath = path.resolve(temporaryDir, session.pages[index])
          const sourcePath =
            (isPathInside(temporaryDir, expectedPath)
              ? await fileSystem
                  .stat(expectedPath)
                  .then((stat) => (stat.isFile() && stat.size > 0 ? expectedPath : null))
                  .catch(() => null)
              : null) ?? extractedImages[index]
          if (!sourcePath || !isPathInside(temporaryDir, sourcePath)) throw new Error('7z 页面路径不安全')
          const stat = await fileSystem.stat(sourcePath)
          if (!stat.isFile() || stat.size <= 0) throw new Error(`第 ${index + 1} 页解压结果无效`)
          const outputPath = getPagePath(session, index)
          const exists = await fileSystem
            .stat(outputPath)
            .then((outputStat) => outputStat.isFile() && outputStat.size > 0)
            .catch((error) => {
              if (error?.code === 'ENOENT') return false
              throw error
            })
          if (exists) continue
          const temporaryOutputPath = `${outputPath}.part-${randomUUID()}`
          await fileSystem.copyFile(sourcePath, temporaryOutputPath)
          await replaceFileAtomically(temporaryOutputPath, outputPath)
        }
        await pruneManagedCache(session.pages.map((_page, pageIndex) => getPagePath(session, pageIndex)))
      } finally {
        await fileSystem.rm(temporaryDir, { recursive: true, force: true })
      }
    })
    session.materializeTask = task.finally(() => {
      session.materializeTask = null
    })
    return session.materializeTask
  }

  async function persistCover(session, page) {
    const { coversDir } = getConfigPaths()
    const coverDir = path.join(coversDir, 'books')
    const coverPath = path.join(coverDir, `${session.archiveKey}-thumb-v2.jpg`)
    await fileSystem.mkdir(coverDir, { recursive: true })
    const validCover = await fileSystem
      .stat(coverPath)
      .then((stat) => stat.isFile() && stat.size > 0)
      .catch((error) => {
        if (error?.code === 'ENOENT') return false
        throw error
      })
    if (!validCover) await createCoverThumbnail(page.path, coverPath)
    return pathToFileURL(coverPath).toString()
  }

  async function findPersistedCover(filePath) {
    const { key } = await getArchiveCacheDir(filePath)
    const { coversDir } = getConfigPaths()
    const coverDir = path.join(coversDir, 'books')
    const coverPath = path.join(coverDir, `${key}-thumb-v2.jpg`)
    await fileSystem.mkdir(coverDir, { recursive: true })
    const validCover = await fileSystem
      .stat(coverPath)
      .then((stat) => stat.isFile() && stat.size > 0)
      .catch((error) => {
        if (error?.code === 'ENOENT') return false
        throw error
      })
    if (validCover) return pathToFileURL(coverPath).toString()

    return ''
  }

  async function openArchive(filePath) {
    const session = await createSession(filePath)
    const firstPage = session.pages.length > 0 ? await getPageFromSession(session, 0) : null
    if (session.extension === '.7z' && session.pages.length > 1) void materializeSevenZipSession(session).catch(() => {})
    const pages = session.pages.map((name, pageIndex) => ({ name, url: pageIndex === 0 ? firstPage?.url : undefined }))
    let coverUrl = ''
    if (firstPage) {
      try {
        coverUrl = await persistCover(session, firstPage)
      } catch (error) {
        logWarning(`本子可以阅读，但封面缩略图生成失败：${error.message}`)
      }
    }
    return {
      sessionId: session.sessionId,
      pages,
      coverUrl,
      extension: session.extension,
    }
  }

  async function getPage(sessionId, index, options) {
    const session = sessions.get(sessionId)
    if (!session) throw new Error('阅读会话已结束，请重新打开压缩包')
    return getPageFromSession(session, index, options)
  }

  function closeSession(sessionId) {
    sessions.delete(sessionId)
  }

  async function createCover(filePath) {
    const persistedCover = await findPersistedCover(filePath)
    if (persistedCover) return `url("${persistedCover}") center / cover`
    const session = await createSession(filePath)
    try {
      if (session.pages.length === 0) return null
      const firstPage = await getPageFromSession(session, 0, { force: true })
      const coverUrl = await persistCover(session, firstPage)
      return `url("${coverUrl}") center / cover`
    } finally {
      closeSession(session.sessionId)
    }
  }

  return {
    clearExpiredSessions,
    closeSession,
    createCover,
    getPage,
    openArchive,
  }
}

module.exports = {
  archiveKey,
  compareArchiveNames,
  createArchiveReaderCacheService,
  parse7zTechnicalList,
}
