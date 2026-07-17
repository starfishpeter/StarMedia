const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createWindowsThumbnailService } = require('./windows-thumbnail-service.cjs')

test('creates the production thumbnail service with default dependencies', () => {
  assert.doesNotThrow(() => createWindowsThumbnailService())
})

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-windows-thumbnail-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

test('uses the native thumbnail output when PowerShell writes a non-empty temporary image', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'episode.mp4')
  const outputPath = path.join(root, 'covers', 'episode.jpg')
  await fs.writeFile(sourcePath, 'video')
  let fallbackCalled = false
  const service = createWindowsThumbnailService({
    platform: 'win32',
    now: () => 1,
    processId: 2,
    runShellThumbnail: async (_script, environment) => fs.writeFile(environment.STARMEDIA_THUMB_OUTPUT, 'native thumbnail'),
    createFallbackThumbnail: async () => {
      fallbackCalled = true
    },
  })

  assert.equal(await service.createVideoThumbnail(sourcePath, outputPath), outputPath)
  assert.equal(await fs.readFile(outputPath, 'utf8'), 'native thumbnail')
  assert.equal(fallbackCalled, false)
})

test('falls back to Chromium capture when native thumbnail generation fails', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'episode.mp4')
  const outputPath = path.join(root, 'covers', 'episode.jpg')
  await fs.writeFile(sourcePath, 'video')
  const service = createWindowsThumbnailService({
    platform: 'win32',
    now: () => 1,
    processId: 2,
    runShellThumbnail: async () => {
      throw new Error('native thumbnail failure')
    },
    createFallbackThumbnail: async (_sourcePath, temporaryPath) => fs.writeFile(temporaryPath, 'fallback thumbnail'),
  })

  await service.createVideoThumbnail(sourcePath, outputPath)

  assert.equal(await fs.readFile(outputPath, 'utf8'), 'fallback thumbnail')
  await assert.rejects(fs.access(`${outputPath}.2.1.tmp`), { code: 'ENOENT' })
})

test('cleans temporary output when both thumbnail paths fail and rejects non-Windows platforms', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'episode.mp4')
  const outputPath = path.join(root, 'covers', 'episode.jpg')
  await fs.writeFile(sourcePath, 'video')
  const service = createWindowsThumbnailService({
    platform: 'win32',
    now: () => 1,
    processId: 2,
    runShellThumbnail: async (_script, environment) => fs.writeFile(environment.STARMEDIA_THUMB_OUTPUT, ''),
    createFallbackThumbnail: async () => {
      throw new Error('fallback thumbnail failure')
    },
  })
  const unsupported = createWindowsThumbnailService({
    platform: 'linux',
    runShellThumbnail: async () => {},
    createFallbackThumbnail: async () => {},
  })

  await assert.rejects(service.createVideoThumbnail(sourcePath, outputPath), /fallback thumbnail failure/)
  await assert.rejects(fs.access(`${outputPath}.2.1.tmp`), { code: 'ENOENT' })
  await assert.rejects(unsupported.createVideoThumbnail(sourcePath, outputPath), /当前系统不支持/)
})

test('rejects and cleans a zero-byte fallback thumbnail', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'episode.mp4')
  const outputPath = path.join(root, 'covers', 'episode.jpg')
  await fs.writeFile(sourcePath, 'video')
  const service = createWindowsThumbnailService({
    platform: 'win32',
    now: () => 1,
    processId: 2,
    runShellThumbnail: async () => {
      throw new Error('native thumbnail failure')
    },
    createFallbackThumbnail: async (_sourcePath, temporaryPath) => fs.writeFile(temporaryPath, ''),
  })

  await assert.rejects(service.createVideoThumbnail(sourcePath, outputPath), /视频缩略图为空/)
  await assert.rejects(fs.access(`${outputPath}.2.1.tmp`), { code: 'ENOENT' })
})
