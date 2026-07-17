const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createThumbnailService, getCurrentArchiveCoverPath } = require('./thumbnail-service.cjs')
const { pathToFileURL } = require('node:url')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-thumbnail-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

function createService({ root, saveLibrary, createVideoCover, createArchiveCover = async () => '', ...dependencies }) {
  return createThumbnailService({
    getConfigPaths: () => ({
      coversDir: path.join(root, 'covers'),
      cacheDir: path.join(root, 'cache'),
      libraryPath: path.join(root, 'library.json'),
    }),
    createArchiveCover,
    createVideoCover,
    loadLibraryFile: async () => ({ items: [], operations: [] }),
    saveLibrary,
    temporaryDirectory: () => root,
    cpuCount: () => 2,
    logWarning: () => {},
    ...dependencies,
  })
}

test('treats only resized v2 book covers as current thumbnails', () => {
  const currentPath = path.join('C:', 'covers', 'archive-thumb-v2.jpg')
  const legacyPath = path.join('C:', 'covers', 'archive.jpg')
  assert.equal(getCurrentArchiveCoverPath({ kind: 'book', cover: `url("${pathToFileURL(currentPath)}") center / cover` }), currentPath)
  assert.equal(getCurrentArchiveCoverPath({ kind: 'book', cover: `url("${pathToFileURL(legacyPath)}") center / cover` }), '')
})

test('reuses a valid cached video thumbnail without regenerating it', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'media', 'episode.mp4')
  await fs.mkdir(path.dirname(sourcePath), { recursive: true })
  await fs.writeFile(sourcePath, 'video')
  let generated = 0
  const service = createService({
    root,
    saveLibrary: async (data) => ({ data, libraryPath: 'index.json' }),
    createVideoCover: async (_sourcePath, outputPath) => {
      generated += 1
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, 'thumbnail')
    },
  })
  const item = { id: 'video:1', library: 'general', kind: 'video', sourcePath }

  const first = await service.generateForItem(item)
  const second = await service.generateForItem(item)

  assert.equal(generated, 1)
  assert.equal(first.item.cover, second.item.cover)
})

test('keeps old thumbnails when regeneration cannot save the new index', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'media', 'episode.mp4')
  const oldCoverPath = path.join(root, 'covers', 'videos', 'old.jpg')
  await fs.mkdir(path.dirname(sourcePath), { recursive: true })
  await fs.writeFile(sourcePath, 'video')
  await fs.mkdir(path.dirname(oldCoverPath), { recursive: true })
  await fs.writeFile(oldCoverPath, 'old thumbnail')
  const service = createService({
    root,
    saveLibrary: async () => {
      throw new Error('injected index failure')
    },
    createVideoCover: async (_sourcePath, outputPath) => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, 'new thumbnail')
    },
  })

  await assert.rejects(
    service.regenerateAll({ items: [{ id: 'video:1', library: 'general', kind: 'video', sourcePath }], operations: [] }),
    /injected index failure/,
  )

  assert.equal(await fs.readFile(oldCoverPath, 'utf8'), 'old thumbnail')
  assert.deepEqual(await fs.readdir(path.dirname(oldCoverPath)), ['old.jpg'])
})

test('saves blank cover fields before deleting cache and cover directories', async (t) => {
  const root = await createSandbox(t)
  const coverPath = path.join(root, 'covers', 'videos', 'cover.jpg')
  await fs.mkdir(path.dirname(coverPath), { recursive: true })
  await fs.writeFile(coverPath, 'cover')
  const service = createService({
    root,
    saveLibrary: async () => {
      throw new Error('injected index failure')
    },
    createVideoCover: async () => {},
  })

  await assert.rejects(
    service.clearCaches({ items: [{ id: 'video:1', kind: 'video', cover: 'cover' }], operations: [] }),
    /injected index failure/,
  )

  assert.equal(await fs.readFile(coverPath, 'utf8'), 'cover')
})

test('persists generated imported thumbnails for standard and poster video libraries', async (t) => {
  const root = await createSandbox(t)
  const generalPath = path.join(root, 'media', 'general.mp4')
  const animePath = path.join(root, 'media', 'anime.mp4')
  await fs.mkdir(path.dirname(generalPath), { recursive: true })
  await fs.writeFile(generalPath, 'general')
  await fs.writeFile(animePath, 'anime')
  let saved
  const service = createService({
    root,
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
    createVideoCover: async (_sourcePath, outputPath) => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, 'thumbnail')
    },
  })
  const data = {
    items: [
      { id: 'general:1', library: 'general', kind: 'video', sourcePath: generalPath, cover: '' },
      { id: 'anime:1', library: 'anime', kind: 'video', sourcePath: animePath, cover: '', episodeCover: '' },
    ],
    operations: [],
  }

  const result = await service.generateImported(data, [
    { status: 'imported', itemId: 'general:1' },
    { status: 'imported', itemId: 'anime:1' },
  ])

  assert.equal(result, saved)
  assert.match(saved.items[0].cover, /covers[\\/]videos/)
  assert.equal(saved.items[0].episodeCover, undefined)
  assert.equal(saved.items[1].cover, '')
  assert.match(saved.items[1].episodeCover, /covers[\\/]videos/)
})

test('repairs missing video thumbnails without replacing poster artwork', async (t) => {
  const root = await createSandbox(t)
  const generalPath = path.join(root, 'media', 'general.mp4')
  const animePath = path.join(root, 'media', 'anime.mp4')
  await fs.mkdir(path.dirname(generalPath), { recursive: true })
  await fs.writeFile(generalPath, 'general')
  await fs.writeFile(animePath, 'anime')
  const data = {
    items: [
      {
        id: 'general:1',
        library: 'general',
        kind: 'video',
        title: 'General',
        sourcePath: generalPath,
        cover: 'linear-gradient(red, blue)',
      },
      {
        id: 'anime:1',
        library: 'anime',
        kind: 'video',
        title: 'Anime',
        sourcePath: animePath,
        cover: 'url("file:///poster.jpg") center / cover',
        episodeCover: '',
      },
    ],
    operations: [],
  }
  let saved
  const service = createService({
    root,
    loadLibraryFile: async () => data,
    saveLibrary: async (next) => {
      saved = next
      return { data: next, libraryPath: 'index.json' }
    },
    createVideoCover: async (_sourcePath, outputPath) => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, 'thumbnail')
    },
  })

  const repaired = await service.repairMissing(data)

  assert.equal(repaired, saved)
  assert.match(repaired.items[0].cover, /covers[\\/]videos/)
  assert.equal(repaired.items[1].cover, 'url("file:///poster.jpg") center / cover')
  assert.match(repaired.items[1].episodeCover, /covers[\\/]videos/)
})
