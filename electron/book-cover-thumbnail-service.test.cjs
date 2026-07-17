const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createBookCoverThumbnailService } = require('./book-cover-thumbnail-service.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-book-thumbnail-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

function emptyNativeImage() {
  return {
    createFromPath: () => ({ isEmpty: () => true }),
  }
}

test('falls back to Chromium-compatible decoding when nativeImage rejects a WebP cover', async (t) => {
  const root = await createSandbox(t)
  const outputPath = path.join(root, 'cover.jpg')
  const service = createBookCoverThumbnailService({
    nativeImage: emptyNativeImage(),
    createFallbackThumbnail: async () => Buffer.from('chromium jpeg'),
    writeFileAtomically: (filePath, contents) => fs.writeFile(filePath, contents),
  })

  await service.createBookCoverThumbnail(path.join(root, 'cover.webp'), outputPath)

  assert.equal(await fs.readFile(outputPath, 'utf8'), 'chromium jpeg')
})

test('preserves both decoder errors when neither path can decode a cover', async (t) => {
  const root = await createSandbox(t)
  const service = createBookCoverThumbnailService({
    nativeImage: emptyNativeImage(),
    createFallbackThumbnail: async () => {
      throw new Error('fallback failed')
    },
    writeFileAtomically: (filePath, contents) => fs.writeFile(filePath, contents),
  })

  await assert.rejects(service.createBookCoverThumbnail('broken.webp', path.join(root, 'cover.jpg')), (error) => {
    assert.equal(error instanceof AggregateError, true)
    assert.equal(error.errors.length, 2)
    assert.match(error.message, /fallback failed/)
    return true
  })
})
