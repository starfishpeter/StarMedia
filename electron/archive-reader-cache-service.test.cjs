const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { run7z, replaceFileAtomically } = require('./archive-tooling.cjs')
const { createArchiveReaderCacheService, parse7zTechnicalList } = require('./archive-reader-cache-service.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-archive-reader-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

function createReader(root, dependencies = {}) {
  const paths = { cacheDir: path.join(root, 'cache'), coversDir: path.join(root, 'covers') }
  return createArchiveReaderCacheService({
    getConfigPaths: () => paths,
    loadConfig: async () => ({ cacheLimitMb: 128 }),
    pruneCacheDirectory: async () => {},
    touchCacheFile: async () => {},
    run7z,
    replaceFileAtomically,
    ...dependencies,
  })
}

test('opens ZIP pages in natural order and reuses cached extraction', async (t) => {
  const root = await createSandbox(t)
  const sourceDir = path.join(root, 'pages')
  const archivePath = path.join(root, 'book.zip')
  await fs.mkdir(sourceDir, { recursive: true })
  await fs.writeFile(path.join(sourceDir, '10.jpg'), 'page ten')
  await fs.writeFile(path.join(sourceDir, '2.jpg'), 'page two')
  await fs.writeFile(path.join(sourceDir, 'notes.txt'), 'not a page')
  await run7z(['a', '-y', '-tzip', archivePath, '.'], { cwd: sourceDir })
  const reader = createReader(root)

  const opened = await reader.openArchive(archivePath)
  const secondPage = await reader.getPage(opened.sessionId, 1)
  const samePage = await reader.getPage(opened.sessionId, 1)

  assert.deepEqual(
    opened.pages.map((page) => page.name),
    ['2.jpg', '10.jpg'],
  )
  assert.equal(await fs.readFile(secondPage.path, 'utf8'), 'page ten')
  assert.equal(samePage.path, secondPage.path)
  await reader.createCover(archivePath)
  const covers = await fs.readdir(path.join(root, 'covers', 'books'))
  assert.equal(covers.length, 1)
  assert.match(covers[0], /-thumb-v2\.jpg$/)

  reader.closeSession(opened.sessionId)
  await assert.rejects(reader.getPage(opened.sessionId, 0), /阅读会话已结束/)
})

test('keeps a book readable when only its cover thumbnail cannot be decoded', async (t) => {
  const root = await createSandbox(t)
  const sourceDir = path.join(root, 'pages')
  const archivePath = path.join(root, 'book.zip')
  await fs.mkdir(sourceDir, { recursive: true })
  await fs.writeFile(path.join(sourceDir, '1.webp'), 'readable page bytes')
  await run7z(['a', '-y', '-tzip', archivePath, '.'], { cwd: sourceDir })
  const warnings = []
  const reader = createReader(root, {
    createCoverThumbnail: async () => {
      throw new Error('decoder rejected WebP')
    },
    logWarning: (message) => warnings.push(message),
  })

  const opened = await reader.openArchive(archivePath)

  assert.equal(opened.coverUrl, '')
  assert.deepEqual(
    opened.pages.map((page) => page.name),
    ['1.webp'],
  )
  assert.match(opened.pages[0].url, /00001\.webp$/)
  assert.match(warnings[0], /可以阅读.*decoder rejected WebP/)
})

test('parses only non-folder image records from 7-Zip technical listings', () => {
  const output = [
    'Path = book.7z',
    '',
    'Path = page10.jpg\nFolder = -',
    '',
    'Path = page2.jpg\nFolder = -',
    '',
    'Path = nested\nFolder = +',
    '',
    'Path = notes.txt\nFolder = -',
  ].join('\n')

  assert.deepEqual(parse7zTechnicalList(output), ['page2.jpg', 'page10.jpg'])
})
