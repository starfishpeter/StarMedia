const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { executeMediaImport } = require('./import-service.cjs')

const videoBytes = Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-import-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return {
    root,
    sourceRoot: path.join(root, 'source'),
    targetRoot: path.join(root, 'library', 'anime'),
    replacedRoot: path.join(root, 'data', 'replaced'),
  }
}

function createConfig(targetRoot) {
  return { libraries: { anime: { rootPath: targetRoot, enabled: true } } }
}

async function writeFile(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, contents)
}

async function fileExists(filePath) {
  return fs.access(filePath).then(
    () => true,
    () => false,
  )
}

test('imports a video and its sidecar into the managed affiliation directory', async (t) => {
  const { sourceRoot, targetRoot, replacedRoot } = await createSandbox(t)
  const sourcePath = path.join(sourceRoot, 'Episode 01.mp4')
  const sidecarPath = path.join(sourceRoot, 'Episode 01.srt')
  await writeFile(sourcePath, videoBytes)
  await writeFile(sidecarPath, 'subtitle')
  const saves = []

  const result = await executeMediaImport({
    libraryId: 'anime',
    config: createConfig(targetRoot),
    library: { items: [], operations: [] },
    replacedRoot,
    saveLibrary: async (data) => {
      saves.push(data)
    },
    items: [
      {
        id: 'plan-1',
        fileName: 'Episode 01.mp4',
        sourcePath,
        size: videoBytes.length,
        affiliation: '测试合集',
        episode: '第 1 话',
        sidecars: [{ fileName: 'Episode 01.srt', sourcePath: sidecarPath, size: 8 }],
      },
    ],
  })

  const targetPath = path.join(targetRoot, '测试合集', 'Episode 01.mp4')
  const targetSidecarPath = path.join(targetRoot, '测试合集', 'Episode 01.srt')
  assert.equal(result.importedCount, 1)
  assert.equal(result.skippedCount, 0)
  assert.equal(await fileExists(sourcePath), false)
  assert.equal(await fileExists(sidecarPath), false)
  assert.deepEqual(await fs.readFile(targetPath), videoBytes)
  assert.equal(await fs.readFile(targetSidecarPath, 'utf8'), 'subtitle')
  assert.equal(result.data.items[0].sourcePath, targetPath)
  assert.equal(result.data.items[0].sidecars[0].sourcePath, targetSidecarPath)
  assert.equal(saves.length, 2)
})

test('indexes media already inside its managed library without moving the files', async (t) => {
  const { targetRoot, replacedRoot } = await createSandbox(t)
  const sourcePath = path.join(targetRoot, '测试合集', 'Episode 01.mp4')
  const sidecarPath = path.join(targetRoot, '测试合集', 'Episode 01.srt')
  await writeFile(sourcePath, videoBytes)
  await writeFile(sidecarPath, 'subtitle')

  const result = await executeMediaImport({
    libraryId: 'anime',
    config: createConfig(targetRoot),
    library: { items: [], operations: [] },
    replacedRoot,
    saveLibrary: async () => {},
    items: [
      {
        id: 'managed-plan',
        fileName: 'Episode 01.mp4',
        sourcePath,
        size: videoBytes.length,
        affiliation: '测试合集',
        episode: '第 1 话',
        preserveManagedPath: true,
        sidecars: [{ fileName: 'Episode 01.srt', sourcePath: sidecarPath, size: 8 }],
      },
    ],
  })

  assert.equal(result.importedCount, 1)
  assert.equal(result.data.items[0].sourcePath, sourcePath)
  assert.equal(result.data.items[0].sidecars[0].sourcePath, sidecarPath)
  assert.deepEqual(await fs.readFile(sourcePath), videoBytes)
  assert.equal(await fs.readFile(sidecarPath, 'utf8'), 'subtitle')
})

test('replaces an existing episode without losing its metadata or previous files', async (t) => {
  const { sourceRoot, targetRoot, replacedRoot } = await createSandbox(t)
  const existingPath = path.join(targetRoot, '测试合集', 'old.mp4')
  const existingSidecarPath = path.join(targetRoot, '测试合集', 'old.srt')
  const oldVideoBytes = Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x6f, 0x6c, 0x64, 0x21])
  await writeFile(existingPath, oldVideoBytes)
  await writeFile(existingSidecarPath, 'old subtitle')

  const sourcePath = path.join(sourceRoot, 'replacement.mp4')
  const sidecarPath = path.join(sourceRoot, 'replacement.srt')
  await writeFile(sourcePath, videoBytes)
  await writeFile(sidecarPath, 'new subtitle')

  const existingItem = {
    id: 'video:existing',
    library: 'anime',
    kind: 'video',
    title: '第 1 话',
    affiliation: '测试合集',
    episode: '第 1 话',
    tags: ['保留标签'],
    cover: 'existing cover',
    episodeCover: 'existing episode cover',
    note: '保留说明',
    sourcePath: existingPath,
    sidecars: [{ fileName: 'old.srt', sourcePath: existingSidecarPath, size: 12 }],
  }

  const result = await executeMediaImport({
    libraryId: 'anime',
    config: createConfig(targetRoot),
    library: { items: [existingItem], operations: [] },
    replacedRoot,
    saveLibrary: async () => {},
    items: [
      {
        id: 'plan-replacement',
        fileName: 'replacement.mp4',
        sourcePath,
        size: videoBytes.length,
        affiliation: '测试合集',
        episode: '第 1 话',
        replacementItemId: existingItem.id,
        sidecars: [{ fileName: 'replacement.srt', sourcePath: sidecarPath, size: 12 }],
      },
    ],
  })

  const replacedVideoPath = path.join(replacedRoot, 'anime', '测试合集', 'old.mp4')
  const replacedSidecarPath = path.join(replacedRoot, 'anime', '测试合集', 'old.srt')
  const newSidecarPath = path.join(targetRoot, '测试合集', 'replacement.srt')
  const item = result.data.items[0]
  assert.equal(result.importedCount, 1)
  assert.equal(result.results[0].replaced, true)
  assert.deepEqual(await fs.readFile(existingPath), videoBytes)
  assert.equal(await fs.readFile(newSidecarPath, 'utf8'), 'new subtitle')
  assert.deepEqual(await fs.readFile(replacedVideoPath), oldVideoBytes)
  assert.equal(await fs.readFile(replacedSidecarPath, 'utf8'), 'old subtitle')
  assert.equal(await fileExists(sourcePath), false)
  assert.equal(await fileExists(sidecarPath), false)
  assert.equal(item.id, existingItem.id)
  assert.deepEqual(item.tags, ['保留标签'])
  assert.equal(item.cover, 'existing cover')
  assert.equal(item.note, '保留说明')
  assert.equal(item.sourcePath, existingPath)
})

test('does not overwrite an existing target when importing a new item', async (t) => {
  const { sourceRoot, targetRoot, replacedRoot } = await createSandbox(t)
  const sourcePath = path.join(sourceRoot, 'same-name.mp4')
  const targetPath = path.join(targetRoot, '测试合集', 'same-name.mp4')
  const existingTargetBytes = Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x6b, 0x65, 0x65, 0x70])
  await writeFile(sourcePath, videoBytes)
  await writeFile(targetPath, existingTargetBytes)

  const result = await executeMediaImport({
    libraryId: 'anime',
    config: createConfig(targetRoot),
    library: { items: [], operations: [] },
    replacedRoot,
    saveLibrary: async () => {},
    items: [
      {
        id: 'plan-conflict',
        fileName: 'same-name.mp4',
        sourcePath,
        size: videoBytes.length,
        affiliation: '测试合集',
        episode: '第 1 话',
      },
    ],
  })

  assert.equal(result.importedCount, 0)
  assert.equal(result.skippedCount, 1)
  assert.equal(result.results[0].status, 'error')
  assert.match(result.results[0].error, /目标文件已存在/)
  assert.deepEqual(await fs.readFile(sourcePath), videoBytes)
  assert.deepEqual(await fs.readFile(targetPath), existingTargetBytes)
  assert.equal(result.data.items.length, 0)
})

test('rolls moved media and sidecars back when saving the library fails', async (t) => {
  const { sourceRoot, targetRoot, replacedRoot } = await createSandbox(t)
  const sourcePath = path.join(sourceRoot, 'rollback.mp4')
  const sidecarPath = path.join(sourceRoot, 'rollback.srt')
  await writeFile(sourcePath, videoBytes)
  await writeFile(sidecarPath, 'subtitle')
  let saveCalls = 0

  const result = await executeMediaImport({
    libraryId: 'anime',
    config: createConfig(targetRoot),
    library: { items: [], operations: [] },
    replacedRoot,
    saveLibrary: async () => {
      saveCalls += 1
      if (saveCalls === 1) throw new Error('simulated index write failure')
    },
    items: [
      {
        id: 'plan-rollback',
        fileName: 'rollback.mp4',
        sourcePath,
        size: videoBytes.length,
        affiliation: '测试合集',
        episode: '第 1 话',
        sidecars: [{ fileName: 'rollback.srt', sourcePath: sidecarPath, size: 8 }],
      },
    ],
  })

  const targetPath = path.join(targetRoot, '测试合集', 'rollback.mp4')
  const targetSidecarPath = path.join(targetRoot, '测试合集', 'rollback.srt')
  assert.equal(result.importedCount, 0)
  assert.equal(result.skippedCount, 1)
  assert.equal(result.results[0].status, 'error')
  assert.match(result.results[0].error, /simulated index write failure/)
  assert.deepEqual(await fs.readFile(sourcePath), videoBytes)
  assert.equal(await fs.readFile(sidecarPath, 'utf8'), 'subtitle')
  assert.equal(await fileExists(targetPath), false)
  assert.equal(await fileExists(targetSidecarPath), false)
  assert.equal(result.data.items.length, 0)
  assert.equal(saveCalls, 2)
})
