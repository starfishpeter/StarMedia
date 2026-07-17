const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { getVideoStorageFolderName, pathsMatch, renameVideoContainerDirectory } = require('./library-file-layout-service.cjs')

test('uses original titles and creator affiliations as video storage folders', () => {
  assert.equal(getVideoStorageFolderName({ library: 'anime', affiliation: '合集', originalTitle: 'Original' }), 'Original')
  assert.equal(getVideoStorageFolderName({ library: 'creator', affiliation: '作者', originalTitle: 'Original' }), '作者')
})

test('renames a container and rewrites indexed media and sidecar paths', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-layout-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const libraryRoot = path.join(root, 'anime')
  const oldDirectory = path.join(libraryRoot, 'Old')
  const sourcePath = path.join(oldDirectory, 'episode.mp4')
  const sidecarPath = path.join(oldDirectory, 'episode.srt')
  await fs.mkdir(oldDirectory, { recursive: true })
  await fs.writeFile(sourcePath, 'video')
  await fs.writeFile(sidecarPath, 'subtitle')
  const item = { id: 'video:1', library: 'anime', sourcePath, sidecars: [{ sourcePath: sidecarPath }] }

  const renamed = await renameVideoContainerDirectory([item], item, 'New', { libraries: { anime: { rootPath: libraryRoot } } })

  assert.equal(renamed.pathByItemId.get(item.id).sourcePath, path.join(libraryRoot, 'New', 'episode.mp4'))
  assert.equal(renamed.pathByItemId.get(item.id).sidecars[0].sourcePath, path.join(libraryRoot, 'New', 'episode.srt'))
  assert.equal(pathsMatch(path.join(libraryRoot, 'New'), renamed.newDirectory), true)
})
