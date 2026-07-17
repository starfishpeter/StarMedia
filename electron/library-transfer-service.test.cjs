const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { moveFileSafely } = require('./file-operations.cjs')
const { executeLibraryTransfer } = require('./library-transfer-service.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-transfer-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return {
    sourceRoot: path.join(root, 'source-anime'),
    targetRoot: path.join(root, 'target-general'),
  }
}

async function writeFile(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents)
}

function createConfig(sourceRoot, targetRoot) {
  return {
    libraries: {
      anime: { rootPath: sourceRoot, enabled: true },
      general: { rootPath: targetRoot, enabled: true },
    },
  }
}

function createVideo({ sourcePath, sidecarPath }) {
  return {
    id: 'video:anime:source',
    library: 'anime',
    kind: 'video',
    title: '第 1 话',
    affiliation: '测试合集',
    episode: '第 1 话',
    originalTitle: 'Original Title',
    sourcePath,
    relativePath: path.join('Original Title', path.basename(sourcePath)),
    tags: ['保留标签'],
    note: '保留说明',
    sidecars: [{ fileName: path.basename(sidecarPath), sourcePath: sidecarPath, extension: '.srt', size: 8 }],
  }
}

test('transfers media and sidecars while preserving item metadata', async (t) => {
  const { sourceRoot, targetRoot } = await createSandbox(t)
  const sourcePath = path.join(sourceRoot, 'Original Title', 'episode.mp4')
  const sidecarPath = path.join(sourceRoot, 'Original Title', 'episode.srt')
  const videoBytes = Buffer.from('video bytes')
  await writeFile(sourcePath, videoBytes)
  await writeFile(sidecarPath, 'subtitle')
  const item = createVideo({ sourcePath, sidecarPath })
  const library = { items: [item], operations: [] }
  let persisted

  const result = await executeLibraryTransfer({
    input: { ids: [item.id], targetLibrary: 'general' },
    config: createConfig(sourceRoot, targetRoot),
    library,
    saveLibrary: async (data) => {
      persisted = data
      return { data, libraryPath: path.join(targetRoot, 'index.json') }
    },
  })

  const targetPath = path.join(targetRoot, 'Original Title', 'episode.mp4')
  const targetSidecarPath = path.join(targetRoot, 'Original Title', 'episode.srt')
  const transferred = result.data.items[0]
  assert.equal(result.movedCount, 1)
  assert.equal(result.targetLibrary, 'general')
  assert.deepEqual(await fs.readFile(targetPath), videoBytes)
  assert.equal(await fs.readFile(targetSidecarPath, 'utf8'), 'subtitle')
  await assert.rejects(fs.access(sourcePath), { code: 'ENOENT' })
  await assert.rejects(fs.access(sidecarPath), { code: 'ENOENT' })
  assert.equal(transferred.library, 'general')
  assert.equal(transferred.sourcePath, targetPath)
  assert.equal(transferred.sidecars[0].sourcePath, targetSidecarPath)
  assert.deepEqual(transferred.tags, ['保留标签'])
  assert.equal(transferred.note, '保留说明')
  assert.equal(persisted.operations.length, 1)
})

test('rejects target collisions without moving files or saving the index', async (t) => {
  const { sourceRoot, targetRoot } = await createSandbox(t)
  const sourcePath = path.join(sourceRoot, 'Original Title', 'episode.mp4')
  const sidecarPath = path.join(sourceRoot, 'Original Title', 'episode.srt')
  const targetPath = path.join(targetRoot, 'Original Title', 'episode.mp4')
  await writeFile(sourcePath, 'source')
  await writeFile(sidecarPath, 'subtitle')
  await writeFile(targetPath, 'target')
  const item = createVideo({ sourcePath, sidecarPath })
  let saveCalled = false

  await assert.rejects(
    executeLibraryTransfer({
      input: { ids: [item.id], targetLibrary: 'general' },
      config: createConfig(sourceRoot, targetRoot),
      library: { items: [item], operations: [] },
      saveLibrary: async () => {
        saveCalled = true
      },
    }),
    /目标文件已存在，未覆盖/,
  )

  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'source')
  assert.equal(await fs.readFile(sidecarPath, 'utf8'), 'subtitle')
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'target')
  assert.equal(saveCalled, false)
})

test('rolls media and sidecars back when saving the transferred library fails', async (t) => {
  const { sourceRoot, targetRoot } = await createSandbox(t)
  const sourcePath = path.join(sourceRoot, 'Original Title', 'episode.mp4')
  const sidecarPath = path.join(sourceRoot, 'Original Title', 'episode.srt')
  const videoBytes = Buffer.from('source video')
  await writeFile(sourcePath, videoBytes)
  await writeFile(sidecarPath, 'subtitle')
  const item = createVideo({ sourcePath, sidecarPath })
  const targetPath = path.join(targetRoot, 'Original Title', 'episode.mp4')
  const targetSidecarPath = path.join(targetRoot, 'Original Title', 'episode.srt')

  await assert.rejects(
    executeLibraryTransfer({
      input: { ids: [item.id], targetLibrary: 'general' },
      config: createConfig(sourceRoot, targetRoot),
      library: { items: [item], operations: [] },
      saveLibrary: async () => {
        throw new Error('simulated index write failure')
      },
    }),
    /simulated index write failure/,
  )

  assert.deepEqual(await fs.readFile(sourcePath), videoBytes)
  assert.equal(await fs.readFile(sidecarPath, 'utf8'), 'subtitle')
  await assert.rejects(fs.access(targetPath), { code: 'ENOENT' })
  await assert.rejects(fs.access(targetSidecarPath), { code: 'ENOENT' })
})

test('rolls already transferred media back when the following sidecar move fails', async (t) => {
  const { sourceRoot, targetRoot } = await createSandbox(t)
  const sourcePath = path.join(sourceRoot, 'Original Title', 'episode.mp4')
  const sidecarPath = path.join(sourceRoot, 'Original Title', 'episode.srt')
  const targetPath = path.join(targetRoot, 'Original Title', 'episode.mp4')
  const targetSidecarPath = path.join(targetRoot, 'Original Title', 'episode.srt')
  await writeFile(sourcePath, 'source video')
  await writeFile(sidecarPath, 'subtitle')
  const item = createVideo({ sourcePath, sidecarPath })
  let saveCalled = false

  await assert.rejects(
    executeLibraryTransfer({
      input: { ids: [item.id], targetLibrary: 'general' },
      config: createConfig(sourceRoot, targetRoot),
      library: { items: [item], operations: [] },
      saveLibrary: async () => {
        saveCalled = true
      },
      moveFile: async (source, target) => {
        if (path.resolve(source) === path.resolve(sidecarPath) && path.resolve(target) === path.resolve(targetSidecarPath))
          throw new Error('injected sidecar transfer failure')
        return moveFileSafely(source, target)
      },
    }),
    /injected sidecar transfer failure/,
  )

  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'source video')
  assert.equal(await fs.readFile(sidecarPath, 'utf8'), 'subtitle')
  await assert.rejects(fs.access(targetPath), { code: 'ENOENT' })
  await assert.rejects(fs.access(targetSidecarPath), { code: 'ENOENT' })
  assert.equal(saveCalled, false)
})
