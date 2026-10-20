const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  clearCacheDirectory,
  collectFiles,
  mapWithConcurrency,
  measureDirectoryBytes,
  pruneCacheDirectory,
  touchCacheFile,
} = require('./cache-service.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-cache-service-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

test('maps values with a bounded worker pool and preserves order', async () => {
  const seen = []
  const result = await mapWithConcurrency(
    [1, 2, 3, 4, 5],
    async (value) => {
      seen.push(value)
      await new Promise((resolve) => setTimeout(resolve, 5 - value))
      return value * 2
    },
    2,
  )
  assert.deepEqual(result, [2, 4, 6, 8, 10])
  assert.deepEqual(
    seen.sort((left, right) => left - right),
    [1, 2, 3, 4, 5],
  )
})

test('measures nested directory bytes without following symbolic links', async (t) => {
  const root = await createSandbox(t)
  const nested = path.join(root, 'nested', 'folder')
  await fs.mkdir(nested, { recursive: true })
  await fs.writeFile(path.join(root, 'a.bin'), '1234')
  await fs.writeFile(path.join(nested, 'b.bin'), '567890')
  const linkPath = path.join(root, 'link.bin')
  try {
    await fs.symlink(path.join(root, 'a.bin'), linkPath)
  } catch {
    // Windows may refuse unprivileged symlinks; the byte total still has to ignore missing links.
  }

  assert.equal(await measureDirectoryBytes(root), 10)
  assert.equal(await measureDirectoryBytes('relative'), 0)
})

test('prunes the oldest unprotected files and removes their empty directories', async (t) => {
  const root = await createSandbox(t)
  const oldPath = path.join(root, 'old', 'first.vtt')
  const protectedPath = path.join(root, 'protected', 'second.vtt')
  const recentPath = path.join(root, 'recent.vtt')
  await fs.mkdir(path.dirname(oldPath), { recursive: true })
  await fs.mkdir(path.dirname(protectedPath), { recursive: true })
  await fs.writeFile(oldPath, '1111')
  await fs.writeFile(protectedPath, '2222')
  await fs.writeFile(recentPath, '3333')
  await fs.utimes(oldPath, new Date('2020-01-01'), new Date('2020-01-01'))
  await fs.utimes(protectedPath, new Date('2021-01-01'), new Date('2021-01-01'))
  await touchCacheFile(recentPath)

  const result = await pruneCacheDirectory(root, 8, [protectedPath])

  assert.equal(result.removedFiles, 1)
  assert.equal(result.removedBytes, 4)
  assert.equal(result.withinLimit, true)
  await assert.rejects(fs.access(oldPath), { code: 'ENOENT' })
  await assert.rejects(fs.access(path.dirname(oldPath)), { code: 'ENOENT' })
  assert.equal((await collectFiles(root)).length, 2)
})

test('reports when protected files prevent the cache from meeting its limit and clears recursively', async (t) => {
  const root = await createSandbox(t)
  const protectedPath = path.join(root, 'nested', 'protected.vtt')
  await fs.mkdir(path.dirname(protectedPath), { recursive: true })
  await fs.writeFile(protectedPath, '1234')

  const result = await pruneCacheDirectory(root, 0, [protectedPath])

  assert.equal(result.withinLimit, false)
  assert.equal(result.sizeBytes, 4)
  await clearCacheDirectory(root)
  await assert.rejects(fs.access(root), { code: 'ENOENT' })
})
