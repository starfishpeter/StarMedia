const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { buildManagedTargetPath, isPathInside, moveFileSafely, normalizeFolderName } = require('./file-operations.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-file-operations-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

test('builds managed paths inside the selected media root', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'incoming', 'episode.mp4')
  const targetRoot = path.join(root, 'library')
  const targetPath = buildManagedTargetPath({ rootPath: targetRoot, folderName: '测试合集', fallbackFolderName: '未归入合集', sourcePath })

  assert.equal(targetPath, path.join(targetRoot, '测试合集', 'episode.mp4'))
  assert.equal(isPathInside(targetRoot, targetPath), true)
  assert.equal(isPathInside(targetRoot, path.join(root, 'outside', 'episode.mp4')), false)
})

test('rejects invalid Windows folder names and path traversal inputs', () => {
  assert.throws(() => normalizeFolderName('../escape', '', '合集'), /Windows 不允许/)
  assert.throws(() => normalizeFolderName('trailing.', '', '合集'), /Windows 不允许/)
  assert.throws(() => normalizeFolderName('a/b', '', '合集'), /Windows 不允许/)
})

test('moves a file while preserving its bytes and reports an idempotent same-path operation', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'source', 'media.bin')
  const targetPath = path.join(root, 'target', 'media.bin')
  const contents = Buffer.from('portable media bytes')
  await fs.mkdir(path.dirname(sourcePath), { recursive: true })
  await fs.writeFile(sourcePath, contents)

  const moved = await moveFileSafely(sourcePath, targetPath)
  const samePath = await moveFileSafely(targetPath, targetPath)

  assert.deepEqual(moved, { moved: true, sourcePath, targetPath, size: contents.length })
  assert.deepEqual(await fs.readFile(targetPath), contents)
  await assert.rejects(fs.access(sourcePath), { code: 'ENOENT' })
  assert.deepEqual(samePath, { moved: false, sourcePath: targetPath, targetPath, size: contents.length })
})

test('never overwrites an existing target file', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'source', 'media.bin')
  const targetPath = path.join(root, 'target', 'media.bin')
  await fs.mkdir(path.dirname(sourcePath), { recursive: true })
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(sourcePath, 'source', 'utf8')
  await fs.writeFile(targetPath, 'target', 'utf8')

  await assert.rejects(moveFileSafely(sourcePath, targetPath), /目标文件已存在/)
  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'source')
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'target')
})
