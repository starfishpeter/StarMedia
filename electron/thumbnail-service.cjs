const fs = require('node:fs/promises')
const { createHash } = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const { fileURLToPath, pathToFileURL } = require('node:url')
const { isPosterLibrary } = require('./library-definitions.cjs')

function coverUrl(filePath) {
  return `url("${pathToFileURL(filePath).toString()}") center / cover`
}

function getThumbnailConcurrency(cpuCount = os.cpus()?.length ?? 2) {
  return Math.max(2, Math.min(4, Math.floor(cpuCount / 2) || 2))
}

async function mapWithConcurrency(values, worker, concurrency = getThumbnailConcurrency()) {
  const results = new Array(values.length)
  let nextIndex = 0
  async function runWorker() {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= values.length) return
      results[index] = await worker(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, runWorker))
  return results
}

function getCurrentArchiveCoverPath(item) {
  if (item?.kind !== 'book' || typeof item.cover !== 'string' || !item.cover.trim()) return false
  const match = /^url\("([^"]+)"\)/.exec(item.cover)
  if (!match) return false
  try {
    const coverPath = fileURLToPath(match[1])
    return /-thumb-v2\.jpg$/i.test(coverPath) ? coverPath : ''
  } catch {
    return ''
  }
}

function hasUsableArchiveCover(item, syncFileSystem) {
  const coverPath = getCurrentArchiveCoverPath(item)
  if (!coverPath) return false
  try {
    return syncFileSystem.statSync(coverPath).isFile()
  } catch {
    return false
  }
}

async function hasUsableArchiveCoverAsync(item, fileSystem) {
  const coverPath = getCurrentArchiveCoverPath(item)
  if (!coverPath) return false
  try {
    return (await fileSystem.stat(coverPath)).isFile()
  } catch {
    return false
  }
}

function getVideoThumbnailPath(item) {
  if (item?.kind !== 'video') return ''
  const value = isPosterLibrary(item.library) ? item.episodeCover : item.cover
  if (typeof value !== 'string' || !value.trim()) return ''
  const match = /^url\("([^"]+)"\)/.exec(value)
  if (!match) return ''
  try {
    return fileURLToPath(match[1])
  } catch {
    return ''
  }
}

async function hasUsableVideoThumbnail(item, fileSystem) {
  const thumbnailPath = getVideoThumbnailPath(item)
  if (!thumbnailPath) return false
  try {
    const stat = await fileSystem.stat(thumbnailPath)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

async function hasUsableThumbnail(item, fileSystem) {
  if (item?.kind === 'book') return hasUsableArchiveCoverAsync(item, fileSystem)
  if (item?.kind === 'video') return hasUsableVideoThumbnail(item, fileSystem)
  return false
}

function applyGeneratedThumbnail(item, generatedItem) {
  if (item?.kind === 'video' && isPosterLibrary(item.library)) return { ...item, episodeCover: generatedItem.episodeCover }
  return { ...item, cover: generatedItem.cover }
}

function thumbnailFingerprint(item) {
  return `${item?.cover ?? ''}\u0000${item?.episodeCover ?? ''}`
}

function createThumbnailService({
  getConfigPaths,
  createArchiveCover,
  createVideoCover,
  loadLibraryFile,
  saveLibrary,
  publishUpdates = () => {},
  fileSystem = fs,
  temporaryDirectory = os.tmpdir,
  cpuCount = () => os.cpus()?.length ?? 2,
  logWarning = (message) => console.warn(message),
}) {
  if (
    typeof getConfigPaths !== 'function' ||
    typeof createArchiveCover !== 'function' ||
    typeof createVideoCover !== 'function' ||
    typeof loadLibraryFile !== 'function' ||
    typeof saveLibrary !== 'function'
  )
    throw new Error('缩略图服务依赖不可用')

  let videoQueue = Promise.resolve()
  let missingRepairPromise = null

  async function createVideoThumbnail(item) {
    const task = videoQueue
      .catch(() => {})
      .then(async () => {
        const stat = await fileSystem.stat(item.sourcePath)
        const { coversDir } = getConfigPaths()
        const outputPath = path.join(
          coversDir,
          'videos',
          `${createHash('sha1').update(`${item.sourcePath}:${stat.size}:${stat.mtimeMs}`).digest('hex')}.jpg`,
        )
        const cached = await fileSystem
          .stat(outputPath)
          .then((thumbnailStat) => thumbnailStat.isFile() && thumbnailStat.size > 0)
          .catch((error) => {
            if (error?.code === 'ENOENT') return false
            throw error
          })
        if (!cached) {
          await createVideoCover(item.sourcePath, outputPath)
          const generated = await fileSystem.stat(outputPath)
          if (!generated.isFile() || generated.size === 0) throw new Error('视频缩略图生成后为空')
        }
        return coverUrl(outputPath)
      })
    videoQueue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  async function generateForItem(item) {
    if (item.kind === 'video' && isPosterLibrary(item.library)) {
      const episodeCover = await createVideoThumbnail(item)
      return { item: { ...item, episodeCover: episodeCover || item.episodeCover || '' }, changed: Boolean(episodeCover) }
    }
    const cover = item.kind === 'book' ? await createArchiveCover(item.sourcePath) : await createVideoThumbnail(item)
    return { item: cover ? { ...item, cover } : item, changed: Boolean(cover) }
  }

  async function repairMissing(data, { onThumbnailGenerated, includeVideos = true } = {}) {
    const coverChecks = await mapWithConcurrency(
      data.items,
      async (item) => ({ item, usable: await hasUsableThumbnail(item, fileSystem) }),
      getThumbnailConcurrency(cpuCount()),
    )
    const candidates = coverChecks
      .filter(
        ({ item, usable }) =>
          (item?.kind === 'book' || (includeVideos && item?.kind === 'video')) && typeof item.sourcePath === 'string' && !usable,
      )
      .map(({ item }) => item)
    if (candidates.length === 0) return data
    const generated = await mapWithConcurrency(
      candidates,
      async (item) => {
        try {
          const result = await generateForItem(item)
          if (result.changed) onThumbnailGenerated?.(result.item)
          return result
        } catch (error) {
          logWarning(`无法补齐 ${item.title} 的缩略图：${error.message}`)
          return { item, changed: false }
        }
      },
      Math.min(2, getThumbnailConcurrency(cpuCount())),
    )
    if (!generated.some((result) => result.changed)) return data
    const generatedById = new Map(generated.map((result) => [result.item.id, result.item]))
    const { libraryPath } = getConfigPaths()
    const latest = await loadLibraryFile(libraryPath)
    const latestCoverChecks = await mapWithConcurrency(
      latest.items,
      async (item) => [item.id, await hasUsableThumbnail(item, fileSystem)],
      getThumbnailConcurrency(cpuCount()),
    )
    const usableLatestCoverIds = new Set(latestCoverChecks.filter(([, usable]) => usable).map(([id]) => id))
    let changed = false
    const items = latest.items.map((item) => {
      const generatedItem = generatedById.get(item.id)
      if (!generatedItem || generatedItem.sourcePath !== item.sourcePath || usableLatestCoverIds.has(item.id)) return item
      changed = true
      return applyGeneratedThumbnail(item, generatedItem)
    })
    if (!changed) return latest
    return (await saveLibrary({ items, operations: latest.operations }, { backupExisting: false })).data
  }

  function scheduleMissingRepair(data, runLocked) {
    if (missingRepairPromise) return missingRepairPromise
    if (!Array.isArray(data?.items)) return Promise.resolve(data)
    const previousCovers = new Map(data.items.map((item) => [item.id, thumbnailFingerprint(item)]))
    const publishedIds = new Set()
    const pendingUpdates = []
    const flushUpdates = () => {
      if (pendingUpdates.length === 0) return
      const updates = pendingUpdates.splice(0, pendingUpdates.length)
      updates.forEach((item) => publishedIds.add(item.id))
      publishUpdates(updates)
    }
    const queueUpdate = (item) => {
      pendingUpdates.push(item)
      if (pendingUpdates.length >= 8) flushUpdates()
    }
    const task = new Promise((resolve) => setImmediate(resolve))
      .then(() =>
        runLocked(() =>
          repairMissing(data, {
            onThumbnailGenerated: queueUpdate,
          }),
        ),
      )
      .then((repaired) => {
        flushUpdates()
        publishUpdates(
          repaired.items.filter((item) => previousCovers.get(item.id) !== thumbnailFingerprint(item) && !publishedIds.has(item.id)),
        )
        return repaired
      })
      .catch((error) => {
        flushUpdates()
        logWarning(`后台补齐媒体缩略图失败：${error.message}`)
        return data
      })
    missingRepairPromise = task
    void task.then(() => {
      if (missingRepairPromise === task) missingRepairPromise = null
    })
    return task
  }

  async function generateImported(data, results, onProgress) {
    const importedIds = new Set(
      (results ?? []).filter((result) => result?.status === 'imported' && result.itemId).map((result) => result.itemId),
    )
    if (importedIds.size === 0) {
      onProgress?.({ stage: 'saving', current: 0, total: 0 })
      return data
    }
    let completed = 0
    const generated = await mapWithConcurrency(
      data.items.filter((item) => importedIds.has(item.id)),
      async (item) => {
        try {
          return await generateForItem(item)
        } catch (error) {
          logWarning(`无法生成 ${item.title} 的缩略图：${error.message}`)
          return { item, changed: false }
        } finally {
          completed += 1
          onProgress?.({ stage: 'thumbnails', current: completed, total: importedIds.size, fileName: item.title })
        }
      },
      getThumbnailConcurrency(cpuCount()),
    )
    onProgress?.({ stage: 'saving', current: importedIds.size, total: importedIds.size })
    if (!generated.some((result) => result.changed)) return data
    const generatedById = new Map(generated.map((result) => [result.item.id, result.item]))
    return (
      await saveLibrary(
        { items: data.items.map((item) => generatedById.get(item.id) ?? item), operations: data.operations },
        { backupExisting: false },
      )
    ).data
  }

  async function regenerateAll(data) {
    const { coversDir } = getConfigPaths()
    const snapshotRoot = await fileSystem.mkdtemp(path.join(temporaryDirectory(), 'starmedia-thumbnail-'))
    const coverDirectories = ['books', 'videos'].map((name) => ({
      targetPath: path.join(coversDir, name),
      snapshotPath: path.join(snapshotRoot, name),
    }))
    try {
      for (const directory of coverDirectories) {
        const exists = await fileSystem
          .stat(directory.targetPath)
          .then((stat) => stat.isDirectory())
          .catch((error) => {
            if (error?.code === 'ENOENT') return false
            throw error
          })
        if (exists) await fileSystem.cp(directory.targetPath, directory.snapshotPath, { recursive: true, force: true })
      }
      await Promise.all(coverDirectories.map((directory) => fileSystem.rm(directory.targetPath, { recursive: true, force: true })))
      const generated = await mapWithConcurrency(
        data.items,
        async (item) => {
          try {
            const result = await generateForItem({ ...item, cover: '', episodeCover: '' })
            return { ...result, failed: !result.changed }
          } catch (error) {
            logWarning(`无法重建 ${item.title} 的缩略图：${error.message}`)
            return { item: { ...item, cover: '', ...(item.kind === 'video' ? { episodeCover: '' } : {}) }, changed: false, failed: true }
          }
        },
        getThumbnailConcurrency(cpuCount()),
      )
      const saved = await saveLibrary(
        { items: generated.map((result) => result.item), operations: data.operations },
        { backupExisting: false },
      )
      return {
        ...saved,
        generatedCount: generated.filter((result) => result.changed).length,
        failedCount: generated.filter((result) => result.failed).length,
      }
    } catch (error) {
      const rollbackErrors = []
      for (const directory of coverDirectories) {
        await fileSystem
          .rm(directory.targetPath, { recursive: true, force: true })
          .catch((rollbackError) => rollbackErrors.push(rollbackError.message))
        await fileSystem.cp(directory.snapshotPath, directory.targetPath, { recursive: true, force: true }).catch((rollbackError) => {
          if (rollbackError?.code !== 'ENOENT') rollbackErrors.push(rollbackError.message)
        })
      }
      if (rollbackErrors.length > 0) throw new Error(`${error.message}；缩略图回退失败：${rollbackErrors.join('；')}`, { cause: error })
      throw error
    } finally {
      await fileSystem.rm(snapshotRoot, { recursive: true, force: true })
    }
  }

  async function clearCaches(data) {
    const items = data.items.map((item) => ({ ...item, cover: '', ...(item.kind === 'video' ? { episodeCover: '' } : {}) }))
    const saved = await saveLibrary({ items, operations: data.operations }, { backupExisting: false })
    const { cacheDir, coversDir } = getConfigPaths()
    await Promise.all([
      fileSystem.rm(cacheDir, { recursive: true, force: true }),
      fileSystem.rm(coversDir, { recursive: true, force: true }),
    ])
    return { ...saved, clearedCoverCount: data.items.filter((item) => Boolean(item.cover || item.episodeCover)).length }
  }

  return { clearCaches, generateForItem, generateImported, regenerateAll, repairMissing, scheduleMissingRepair }
}

module.exports = {
  createThumbnailService,
  getCurrentArchiveCoverPath,
  getThumbnailConcurrency,
  hasUsableArchiveCover,
  hasUsableArchiveCoverAsync,
  mapWithConcurrency,
}
