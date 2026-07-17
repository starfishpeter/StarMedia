const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createConfigService } = require('./config-service.cjs')
const { libraryIds } = require('./library-definitions.cjs')

const fixedDate = new Date('2026-07-16T12:00:00.000Z')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-config-service-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const paths = {
    dataRoot: root,
    configPath: path.join(root, 'starmedia-config.json'),
    libraryPath: path.join(root, 'starmedia-library.json'),
    backupDir: path.join(root, 'backups'),
    cacheDir: path.join(root, 'cache'),
    coversDir: path.join(root, 'covers'),
  }
  return {
    paths,
    service: createConfigService({
      getConfigPaths: () => paths,
      defaultHanime1Endpoint: 'https://hanime1.com',
      now: () => fixedDate,
    }),
  }
}

test('creates stable defaults for every known library without persisting on load', async (t) => {
  const { paths, service } = await createSandbox(t)
  const config = await service.loadConfig()

  assert.equal(config.schemaVersion, 3)
  assert.equal(config.updatedAt, fixedDate.toISOString())
  assert.equal(config.scraping.hanime1Endpoint, 'https://hanime1.com')
  assert.deepEqual(Object.keys(config.libraries), libraryIds)
  assert.equal(
    libraryIds.every((id) => config.libraries[id].rootPath === '' && config.libraries[id].enabled),
    true,
  )
  await assert.rejects(fs.access(paths.configPath), { code: 'ENOENT' })
})

test('sanitizes configuration values and migrates legacy classifications', async (t) => {
  const { service } = await createSandbox(t)
  const config = service.sanitizeConfig({
    mediaRoot: '  C:\\Media  ',
    theme: 'unsupported',
    cacheLimitMb: 4,
    scraping: { bangumiToken: ' token ', bangumiEndpoint: ' https://example.test ', hanime1Endpoint: ' ' },
    vocabularies: {
      tags: [' 动作 ', '动作', '科幻'],
      animeCategories: ['番剧', '未分类'],
      booksCategories: ['番剧'],
    },
    catalog: {
      studios: [' Studio ', 'Studio'],
      creators: [' Creator ', 'Creator'],
    },
  })

  assert.equal(config.mediaRoot, 'C:\\Media')
  assert.equal(config.theme, 'dark')
  assert.equal(config.cacheLimitMb, 128)
  assert.equal(config.scraping.bangumiToken, 'token')
  assert.equal(config.scraping.bangumiEndpoint, 'https://example.test')
  assert.equal(config.scraping.hanime1Endpoint, 'https://hanime1.com')
  assert.deepEqual(config.catalog.tags, ['动作', '科幻'])
  assert.deepEqual(config.catalog.studios, ['Studio'])
  assert.deepEqual(config.catalog.creators, ['Creator'])
  assert.deepEqual(config.catalog.classifications, [{ id: 'legacy-1', name: '番剧', tags: [], libraryIds: ['anime', 'books'] }])
})

test('saves an absolute media root, creates default library roots, and backs up previous config bytes', async (t) => {
  const { paths, service } = await createSandbox(t)
  const previousContents = '{"previous":true}\n'
  await fs.writeFile(paths.configPath, previousContents, 'utf8')
  const mediaRoot = path.join(paths.dataRoot, 'media')

  const result = await service.saveConfig({
    mediaRoot,
    libraries: { anime: { rootPath: path.join(paths.dataRoot, 'custom-anime'), enabled: false } },
  })
  const backupNames = await fs.readdir(paths.backupDir)
  const saved = JSON.parse(await fs.readFile(paths.configPath, 'utf8'))

  assert.deepEqual(result.config, saved)
  assert.equal((await fs.stat(mediaRoot)).isDirectory(), true)
  assert.equal((await fs.stat(path.join(mediaRoot, '里番'))).isDirectory(), true)
  assert.equal((await fs.stat(path.join(paths.dataRoot, 'custom-anime'))).isDirectory(), true)
  assert.equal(result.config.libraries.anime.enabled, false)
  assert.equal(result.config.libraries.anime.rootPath, path.join(paths.dataRoot, 'custom-anime'))
  assert.equal(backupNames.length, 1)
  assert.equal(await fs.readFile(path.join(paths.backupDir, backupNames[0]), 'utf8'), previousContents)
  assert.equal((await fs.readFile(paths.configPath, 'utf8')).endsWith('\n'), true)
})

test('rejects relative roots before creating any paths', async (t) => {
  const { paths, service } = await createSandbox(t)

  await assert.rejects(service.saveConfig({ mediaRoot: 'relative-media-root' }), /必须使用绝对路径/)
  await assert.rejects(fs.access(paths.configPath), { code: 'ENOENT' })
  await assert.rejects(fs.access(paths.backupDir), { code: 'ENOENT' })
})

test('rejects malformed existing configuration instead of silently replacing it', async (t) => {
  const { paths, service } = await createSandbox(t)
  await fs.writeFile(paths.configPath, '{invalid json', 'utf8')

  await assert.rejects(service.loadConfig())
  assert.equal(await fs.readFile(paths.configPath, 'utf8'), '{invalid json')
})
