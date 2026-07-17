const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createLibraryMaintenanceService } = require('./library-maintenance-service.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-maintenance-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

function createItem(root, overrides = {}) {
  const sourcePath = path.join(root, 'anime', 'Collection', 'episode.mp4')
  return { id: 'video:1', library: 'anime', kind: 'video', title: 'Episode', sourcePath, sidecars: [], ...overrides }
}

test('does not trash any path when preflight finds an invalid sidecar', async (t) => {
  const root = await createSandbox(t)
  const item = createItem(root, { sidecars: [{ sourcePath: path.join(root, 'outside.srt') }] })
  await fs.mkdir(path.dirname(item.sourcePath), { recursive: true })
  await fs.writeFile(item.sourcePath, 'video')
  const trashed = []
  const service = createLibraryMaintenanceService({
    loadConfig: async () => ({ libraries: { anime: { rootPath: path.join(root, 'anime') } } }),
    loadLibrary: async () => ({ items: [item], operations: [] }),
    saveLibrary: async () => {
      throw new Error('must not save')
    },
    trashItem: async (target) => trashed.push(target),
  })

  await assert.rejects(service.trashLibraryItems({ ids: [item.id] }), /不在当前媒体库受管理路径内/)
  assert.deepEqual(trashed, [])
  assert.equal(await fs.readFile(item.sourcePath, 'utf8'), 'video')
})

test('removes an unavailable media record without requiring a recycle-bin file', async (t) => {
  const root = await createSandbox(t)
  const item = createItem(root)
  let saved
  const trashed = []
  const service = createLibraryMaintenanceService({
    loadConfig: async () => ({ libraries: { anime: { rootPath: path.join(root, 'anime') } } }),
    loadLibrary: async () => ({ items: [item], operations: [] }),
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
    trashItem: async (target) => trashed.push(target),
  })

  const result = await service.trashLibraryItems({ ids: [item.id] })

  assert.equal(result.deletedCount, 1)
  assert.equal(result.recordOnlyCount, 1)
  assert.deepEqual(saved.items, [])
  assert.deepEqual(trashed, [])
})

test('ignores a missing sidecar while recycling an available media file', async (t) => {
  const root = await createSandbox(t)
  const item = createItem(root, { sidecars: [{ sourcePath: path.join(root, 'anime', 'Collection', 'missing.srt') }] })
  await fs.mkdir(path.dirname(item.sourcePath), { recursive: true })
  await fs.writeFile(item.sourcePath, 'video')
  const trashed = []
  const service = createLibraryMaintenanceService({
    loadConfig: async () => ({ libraries: { anime: { rootPath: path.join(root, 'anime') } } }),
    loadLibrary: async () => ({ items: [item], operations: [] }),
    saveLibrary: async (data) => ({ data, libraryPath: 'index.json' }),
    trashItem: async (target) => {
      trashed.push(target)
      await fs.rm(target, { recursive: true, force: false })
    },
  })

  const result = await service.trashLibraryItems({ ids: [item.id] })

  assert.equal(result.deletedCount, 1)
  assert.equal(result.recordOnlyCount, 0)
  assert.equal(trashed.includes(item.sourcePath), true)
})

test('preserves the index when the system recycle bin rejects a file', async (t) => {
  const root = await createSandbox(t)
  const item = createItem(root)
  await fs.mkdir(path.dirname(item.sourcePath), { recursive: true })
  await fs.writeFile(item.sourcePath, 'video')
  let saveCalled = false
  const service = createLibraryMaintenanceService({
    loadConfig: async () => ({ libraries: { anime: { rootPath: path.join(root, 'anime') } } }),
    loadLibrary: async () => ({ items: [item], operations: [] }),
    saveLibrary: async () => {
      saveCalled = true
    },
    trashItem: async () => {
      throw new Error('injected recycle-bin failure')
    },
  })

  await assert.rejects(service.trashLibraryItems({ ids: [item.id] }), /injected recycle-bin failure/)
  assert.equal(saveCalled, false)
  assert.equal(await fs.readFile(item.sourcePath, 'utf8'), 'video')
})

test('removes the index only after media and sidecars are accepted by the recycle bin', async (t) => {
  const root = await createSandbox(t)
  const sidecarPath = path.join(root, 'anime', 'Collection', 'episode.srt')
  const item = createItem(root, { sidecars: [{ sourcePath: sidecarPath }] })
  await fs.mkdir(path.dirname(item.sourcePath), { recursive: true })
  await fs.writeFile(item.sourcePath, 'video')
  await fs.writeFile(sidecarPath, 'subtitle')
  const trashed = []
  let saved
  const service = createLibraryMaintenanceService({
    loadConfig: async () => ({ libraries: { anime: { rootPath: path.join(root, 'anime') } } }),
    loadLibrary: async () => ({ items: [item], operations: [] }),
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
    trashItem: async (target) => {
      trashed.push(target)
    },
  })

  const result = await service.trashLibraryItems({ ids: [item.id] })

  assert.equal(result.deletedCount, 1)
  assert.deepEqual(saved.items, [])
  assert.deepEqual(trashed.slice(0, 2), [item.sourcePath, sidecarPath])
})

test('removes media, sidecars, and an empty container directory before committing the index', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'anime')
  const sidecarPath = path.join(libraryRoot, 'Collection', 'episode.srt')
  const item = createItem(root, { sidecars: [{ sourcePath: sidecarPath }] })
  await fs.mkdir(path.dirname(item.sourcePath), { recursive: true })
  await fs.writeFile(item.sourcePath, 'video')
  await fs.writeFile(sidecarPath, 'subtitle')
  const trashed = []
  const service = createLibraryMaintenanceService({
    loadConfig: async () => ({ libraries: { anime: { rootPath: libraryRoot } } }),
    loadLibrary: async () => ({ items: [item], operations: [] }),
    saveLibrary: async (data) => ({ data, libraryPath: 'index.json' }),
    trashItem: async (target) => {
      trashed.push(target)
      await fs.rm(target, { recursive: true, force: false })
    },
  })

  const result = await service.trashLibraryItems({ ids: [item.id] })

  assert.equal(result.deletedCount, 1)
  await assert.rejects(fs.access(item.sourcePath), { code: 'ENOENT' })
  await assert.rejects(fs.access(sidecarPath), { code: 'ENOENT' })
  await assert.rejects(fs.access(path.dirname(item.sourcePath)), { code: 'ENOENT' })
  assert.equal((await fs.stat(libraryRoot)).isDirectory(), true)
  assert.deepEqual(trashed, [item.sourcePath, sidecarPath, path.dirname(item.sourcePath)])
})

test('commits only records whose media reached the recycle bin when a later item fails', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'anime')
  const first = createItem(root, { id: 'video:1', sourcePath: path.join(libraryRoot, 'First', 'episode.mp4') })
  const second = createItem(root, { id: 'video:2', sourcePath: path.join(libraryRoot, 'Second', 'episode.mp4') })
  await fs.mkdir(path.dirname(first.sourcePath), { recursive: true })
  await fs.mkdir(path.dirname(second.sourcePath), { recursive: true })
  await fs.writeFile(first.sourcePath, 'first')
  await fs.writeFile(second.sourcePath, 'second')
  let saved
  const service = createLibraryMaintenanceService({
    loadConfig: async () => ({ libraries: { anime: { rootPath: libraryRoot } } }),
    loadLibrary: async () => ({ items: [first, second], operations: [] }),
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
    trashItem: async (target) => {
      if (target === second.sourcePath) throw new Error('injected recycle-bin failure')
      await fs.rm(target, { recursive: true, force: false })
    },
  })

  const result = await service.trashLibraryItems({ ids: [first.id, second.id] })

  assert.equal(result.deletedCount, 1)
  assert.equal(result.failedCount, 1)
  assert.match(result.errors[0], /injected recycle-bin failure/)
  assert.deepEqual(
    saved.items.map((item) => item.id),
    [second.id],
  )
  assert.equal(saved.operations[0].status, 'partial')
  assert.deepEqual(saved.operations[0].itemIds, [first.id])
  assert.equal(await fs.readFile(second.sourcePath, 'utf8'), 'second')
  await assert.rejects(fs.access(first.sourcePath), { code: 'ENOENT' })
})

test('reports a partial result when media reaches the recycle bin but a sidecar fails', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'anime')
  const sidecarPath = path.join(libraryRoot, 'Collection', 'episode.srt')
  const item = createItem(root, { sidecars: [{ sourcePath: sidecarPath }] })
  await fs.mkdir(path.dirname(item.sourcePath), { recursive: true })
  await fs.writeFile(item.sourcePath, 'video')
  await fs.writeFile(sidecarPath, 'subtitle')
  let saved
  const service = createLibraryMaintenanceService({
    loadConfig: async () => ({ libraries: { anime: { rootPath: libraryRoot } } }),
    loadLibrary: async () => ({ items: [item], operations: [] }),
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
    trashItem: async (target) => {
      if (target === sidecarPath) throw new Error('injected sidecar recycle-bin failure')
      await fs.rm(target, { recursive: true, force: false })
    },
  })

  const result = await service.trashLibraryItems({ ids: [item.id] })

  assert.equal(result.deletedCount, 1)
  assert.equal(result.failedCount, 1)
  assert.match(result.errors[0], /sidecar recycle-bin failure/)
  assert.deepEqual(saved.items, [])
  assert.equal(saved.operations[0].status, 'partial')
  assert.deepEqual(saved.operations[0].failedItemIds, [])
  assert.deepEqual(saved.operations[0].partialItemIds, [item.id])
  assert.equal(await fs.readFile(sidecarPath, 'utf8'), 'subtitle')
})
