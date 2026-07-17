const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { clearEmptyMediaDirectories } = require('./media-directory-maintenance-service.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-directory-maintenance-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

function createConfig(mediaRoot, libraryRoot) {
  return { mediaRoot, libraries: { anime: { rootPath: libraryRoot } } }
}

test('removes only empty directories outside configured library roots', async (t) => {
  const root = await createSandbox(t)
  const mediaRoot = path.join(root, 'media')
  const libraryRoot = path.join(mediaRoot, 'anime')
  const removable = path.join(mediaRoot, 'leftover', 'nested')
  const protectedEmpty = path.join(libraryRoot, 'Empty Collection')
  const occupied = path.join(mediaRoot, 'occupied')
  await fs.mkdir(removable, { recursive: true })
  await fs.mkdir(protectedEmpty, { recursive: true })
  await fs.mkdir(occupied, { recursive: true })
  await fs.writeFile(path.join(occupied, 'keep.txt'), 'keep')

  const result = await clearEmptyMediaDirectories({ config: createConfig(mediaRoot, libraryRoot), libraryIds: ['anime'] })

  assert.equal(result.removedCount, 2)
  await assert.rejects(fs.access(removable), { code: 'ENOENT' })
  await assert.rejects(fs.access(path.dirname(removable)), { code: 'ENOENT' })
  assert.equal((await fs.stat(protectedEmpty)).isDirectory(), true)
  assert.equal(await fs.readFile(path.join(occupied, 'keep.txt'), 'utf8'), 'keep')
})

test('rejects missing or relative media roots without deleting paths', async (t) => {
  const root = await createSandbox(t)
  await assert.rejects(
    clearEmptyMediaDirectories({ config: createConfig('relative', root), libraryIds: ['anime'] }),
    /有效的媒体数据总目录/,
  )
  await assert.rejects(
    clearEmptyMediaDirectories({ config: createConfig(path.join(root, 'missing'), root), libraryIds: ['anime'] }),
    /媒体数据总目录不存在/,
  )
})

test('does not descend into children when the media root itself is a configured library root', async (t) => {
  const root = await createSandbox(t)
  const mediaRoot = path.join(root, 'media')
  const protectedEmpty = path.join(mediaRoot, 'Empty Collection')
  await fs.mkdir(protectedEmpty, { recursive: true })

  const result = await clearEmptyMediaDirectories({ config: createConfig(mediaRoot, mediaRoot), libraryIds: ['anime'] })

  assert.equal(result.removedCount, 0)
  assert.equal((await fs.stat(protectedEmpty)).isDirectory(), true)
})
