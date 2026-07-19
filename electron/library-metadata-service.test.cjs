const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { moveFileSafely } = require('./file-operations.cjs')
const { createLibraryMetadataService } = require('./library-metadata-service.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-metadata-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

async function writeFile(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents)
}

function createService({ config, library, saveLibrary, ...dependencies }) {
  return createLibraryMetadataService({
    getConfigPaths: () => ({ libraryPath: 'index.json', coversDir: 'covers' }),
    loadConfig: async () => config,
    loadLibrary: async () => library,
    saveLibrary,
    ...dependencies,
  })
}

test('renames a video container and rewrites all indexed sidecar paths', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'anime')
  const oldDir = path.join(libraryRoot, 'Original Title')
  const sourcePath = path.join(oldDir, 'episode.mp4')
  const sidecarPath = path.join(oldDir, 'episode.srt')
  await writeFile(sourcePath, 'video')
  await writeFile(sidecarPath, 'subtitle')
  const item = {
    id: 'video:1',
    library: 'anime',
    kind: 'video',
    title: 'Episode',
    affiliation: '测试合集',
    originalTitle: 'Original Title',
    sourcePath,
    sidecars: [{ fileName: 'episode.srt', sourcePath: sidecarPath }],
    tags: [],
    note: '',
  }
  const library = { items: [item], operations: [] }
  let saved
  const service = createService({
    config: { libraries: { anime: { rootPath: libraryRoot } } },
    library,
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
  })

  const result = await service.updateContainerInfo({ id: item.id, originalTitle: 'Renamed Title' })

  const newDir = path.join(libraryRoot, 'Renamed Title')
  assert.equal(await fs.readFile(path.join(newDir, 'episode.mp4'), 'utf8'), 'video')
  assert.equal(await fs.readFile(path.join(newDir, 'episode.srt'), 'utf8'), 'subtitle')
  await assert.rejects(fs.access(oldDir), { code: 'ENOENT' })
  assert.equal(result.item.sourcePath, path.join(newDir, 'episode.mp4'))
  assert.equal(saved.items[0].sidecars[0].sourcePath, path.join(newDir, 'episode.srt'))
})

test('rolls a renamed video directory back when saving metadata fails', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'anime')
  const oldDir = path.join(libraryRoot, 'Original Title')
  const sourcePath = path.join(oldDir, 'episode.mp4')
  await writeFile(sourcePath, 'video')
  const item = {
    id: 'video:1',
    library: 'anime',
    kind: 'video',
    title: 'Episode',
    affiliation: '测试合集',
    originalTitle: 'Original Title',
    sourcePath,
    tags: [],
    note: '',
  }
  const service = createService({
    config: { libraries: { anime: { rootPath: libraryRoot } } },
    library: { items: [item], operations: [] },
    saveLibrary: async () => {
      throw new Error('injected index failure')
    },
  })

  await assert.rejects(service.updateContainerInfo({ id: item.id, originalTitle: 'Renamed Title' }), /injected index failure/)

  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'video')
  await assert.rejects(fs.access(path.join(libraryRoot, 'Renamed Title')), { code: 'ENOENT' })
})

test('rolls bookshelf moves back when saving the renamed shelf fails', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'books')
  const oldPath = path.join(libraryRoot, '旧书架', 'book.zip')
  await writeFile(oldPath, 'archive')
  const item = { id: 'book:1', library: 'books', kind: 'book', title: 'Book', shelf: '旧书架', sourcePath: oldPath, tags: [], note: '' }
  const service = createService({
    config: { libraries: { books: { rootPath: libraryRoot } } },
    library: { items: [item], operations: [] },
    saveLibrary: async () => {
      throw new Error('injected index failure')
    },
  })

  await assert.rejects(service.updateContainerInfo({ id: item.id, name: '新书架' }), /injected index failure/)

  assert.equal(await fs.readFile(oldPath, 'utf8'), 'archive')
  await assert.rejects(fs.access(path.join(libraryRoot, '新书架', 'book.zip')), { code: 'ENOENT' })
})

test('rolls earlier bookshelf files back when moving a later file fails', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'books')
  const firstPath = path.join(libraryRoot, '旧书架', 'first.zip')
  const secondPath = path.join(libraryRoot, '旧书架', 'second.zip')
  const firstTarget = path.join(libraryRoot, '新书架', 'first.zip')
  await writeFile(firstPath, 'first')
  await writeFile(secondPath, 'second')
  const first = { id: 'book:1', library: 'books', kind: 'book', title: 'First', shelf: '旧书架', sourcePath: firstPath, tags: [], note: '' }
  const second = {
    id: 'book:2',
    library: 'books',
    kind: 'book',
    title: 'Second',
    shelf: '旧书架',
    sourcePath: secondPath,
    tags: [],
    note: '',
  }
  let saveCalled = false
  const service = createService({
    config: { libraries: { books: { rootPath: libraryRoot } } },
    library: { items: [first, second], operations: [] },
    saveLibrary: async () => {
      saveCalled = true
    },
    moveFile: async (source, target) => {
      if (path.resolve(source) === path.resolve(secondPath)) throw new Error('injected second bookshelf failure')
      return moveFileSafely(source, target)
    },
  })

  await assert.rejects(service.updateContainerInfo({ id: first.id, name: '新书架' }), /injected second bookshelf failure/)

  assert.equal(await fs.readFile(firstPath, 'utf8'), 'first')
  assert.equal(await fs.readFile(secondPath, 'utf8'), 'second')
  await assert.rejects(fs.access(firstTarget), { code: 'ENOENT' })
  assert.equal(saveCalled, false)
})

test('does not move video media when the affiliation target collides', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'anime')
  const sourcePath = path.join(libraryRoot, 'Source', 'episode.mp4')
  const targetPath = path.join(libraryRoot, 'Target', 'episode.mp4')
  await writeFile(sourcePath, 'source')
  await writeFile(targetPath, 'target')
  const item = { id: 'video:1', library: 'anime', kind: 'video', title: 'Episode', affiliation: 'Source', sourcePath, tags: [], note: '' }
  const service = createService({
    config: { libraries: { anime: { rootPath: libraryRoot } } },
    library: { items: [item], operations: [] },
    saveLibrary: async () => {
      throw new Error('must not save')
    },
  })

  await assert.rejects(service.moveVideoToAffiliation({ id: item.id, affiliation: 'Target' }), /目标合集已有同名文件/)

  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'source')
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'target')
})

test('stores a release date on one video without changing the rest of its container', async () => {
  const first = { id: 'video:1', library: 'anime', kind: 'video', title: 'Episode 1', affiliation: 'Series', releaseDate: '' }
  const second = { id: 'video:2', library: 'anime', kind: 'video', title: 'Episode 2', affiliation: 'Series', releaseDate: '' }
  let saved
  const service = createService({
    library: { items: [first, second], operations: [] },
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
  })

  const result = await service.updateMediaInfo({ id: first.id, releaseDate: '2026-07-17' })

  assert.equal(result.item.releaseDate, '2026-07-17')
  assert.equal(saved.items[1].releaseDate, '')
  await assert.rejects(service.updateMediaInfo({ id: first.id, creator: 'Invalid' }), /只有本子或漫画/)
})

test('stores embedded subtitle status across every video in a container', async () => {
  const first = { id: 'video:1', library: 'anime', kind: 'video', title: 'Episode 1', affiliation: 'Series', hasEmbeddedSubtitles: false }
  const second = { id: 'video:2', library: 'anime', kind: 'video', title: 'Episode 2', affiliation: 'Series', hasEmbeddedSubtitles: false }
  let saved
  const service = createService({
    config: { libraries: { anime: { rootPath: '' } }, catalog: { tags: [] } },
    library: { items: [first, second], operations: [] },
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
  })

  const result = await service.updateContainerInfo({ id: first.id, hasEmbeddedSubtitles: true })

  assert.equal(result.item.hasEmbeddedSubtitles, true)
  assert.deepEqual(
    saved.items.map((item) => item.hasEmbeddedSubtitles),
    [true, true],
  )
})

test('stores tags on one video without changing the rest of its creator container', async () => {
  const first = { id: 'video:1', library: 'creator', kind: 'video', title: 'Episode 1', affiliation: 'Creator', tags: [] }
  const second = { id: 'video:2', library: 'creator', kind: 'video', title: 'Episode 2', affiliation: 'Creator', tags: ['保留'] }
  let saved
  const service = createService({
    config: { catalog: { tags: ['单集标签', '保留'] } },
    library: { items: [first, second], operations: [] },
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
  })

  const result = await service.updateMediaTags({ id: first.id, tags: ['单集标签'] })

  assert.deepEqual(result.item.tags, ['单集标签'])
  assert.deepEqual(saved.items[1].tags, ['保留'])
  await assert.rejects(service.updateMediaTags({ id: first.id, tags: ['未登记标签'] }), /未在标签管理中保存/)
})

test('rolls video episode files and sidecars back when saving metadata fails', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'anime')
  const sourcePath = path.join(libraryRoot, 'Collection', 'episode.mp4')
  const sidecarPath = path.join(libraryRoot, 'Collection', 'episode.srt')
  const targetPath = path.join(libraryRoot, 'Collection', 'Renamed.mp4')
  const targetSidecarPath = path.join(libraryRoot, 'Collection', 'Renamed.srt')
  await writeFile(sourcePath, 'video')
  await writeFile(sidecarPath, 'subtitle')
  const item = {
    id: 'video:1',
    library: 'anime',
    kind: 'video',
    title: 'Episode',
    affiliation: 'Collection',
    sourcePath,
    sidecars: [{ fileName: 'episode.srt', sourcePath: sidecarPath }],
    tags: [],
    note: '',
  }
  const service = createService({
    config: { libraries: { anime: { rootPath: libraryRoot } } },
    library: { items: [item], operations: [] },
    saveLibrary: async () => {
      throw new Error('injected index failure')
    },
  })

  await assert.rejects(service.updateVideoEpisode({ id: item.id, episode: 'Renamed' }), /injected index failure/)

  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'video')
  assert.equal(await fs.readFile(sidecarPath, 'utf8'), 'subtitle')
  await assert.rejects(fs.access(targetPath), { code: 'ENOENT' })
  await assert.rejects(fs.access(targetSidecarPath), { code: 'ENOENT' })
})

test('rolls moved affiliation files and sidecars back when saving metadata fails', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'anime')
  const sourcePath = path.join(libraryRoot, 'Source', 'episode.mp4')
  const sidecarPath = path.join(libraryRoot, 'Source', 'episode.srt')
  const targetPath = path.join(libraryRoot, 'Target', 'episode.mp4')
  const targetSidecarPath = path.join(libraryRoot, 'Target', 'episode.srt')
  await writeFile(sourcePath, 'video')
  await writeFile(sidecarPath, 'subtitle')
  const item = {
    id: 'video:1',
    library: 'anime',
    kind: 'video',
    title: 'Episode',
    affiliation: 'Source',
    sourcePath,
    sidecars: [{ fileName: 'episode.srt', sourcePath: sidecarPath }],
    tags: [],
    note: '',
  }
  const service = createService({
    config: { libraries: { anime: { rootPath: libraryRoot } } },
    library: { items: [item], operations: [] },
    saveLibrary: async () => {
      throw new Error('injected index failure')
    },
  })

  await assert.rejects(service.moveVideoToAffiliation({ id: item.id, affiliation: 'Target' }), /injected index failure/)

  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'video')
  assert.equal(await fs.readFile(sidecarPath, 'utf8'), 'subtitle')
  await assert.rejects(fs.access(targetPath), { code: 'ENOENT' })
  await assert.rejects(fs.access(targetSidecarPath), { code: 'ENOENT' })
})
