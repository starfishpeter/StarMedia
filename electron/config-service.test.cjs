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
  assert.deepEqual(config.network, { proxyEnabled: false, proxyUrl: '' })
  assert.equal(config.showExternalSubtitleBadges, false)
  assert.deepEqual(Object.keys(config.libraries), libraryIds)
  assert.equal(
    libraryIds.every(
      (id) =>
        config.libraries[id].rootPath === '' &&
        config.libraries[id].enabled &&
        config.libraries[id].sortMode === 'title' &&
        config.libraries[id].sortDirection === 'ascending',
    ),
    true,
  )
  await assert.rejects(fs.access(paths.configPath), { code: 'ENOENT' })
})

test('sanitizes configuration values and removes obsolete classifications', async (t) => {
  const { service } = await createSandbox(t)
  const config = service.sanitizeConfig({
    mediaRoot: '  C:\\Media  ',
    theme: 'unsupported',
    cacheLimitMb: 4,
    showExternalSubtitleBadges: true,
    network: { proxyEnabled: true, proxyUrl: ' 127.0.0.1:8390 ' },
    scraping: {
      anidbClient: ' obsolete-client ',
      anidbClientVersion: ' 2 ',
      anidbEndpoint: ' http://anidb.example:9001/httpapi ',
      bangumiToken: ' token ',
      bangumiEndpoint: ' https://example.test ',
      hanime1Endpoint: ' ',
    },
    vocabularies: {
      tags: [' 动作 ', '动作', '科幻'],
      animeCategories: ['番剧', '未分类'],
      booksCategories: ['番剧'],
    },
    catalog: {},
    libraries: {
      anime: { rootPath: ' C:\\Anime ', enabled: false, sortMode: 'firstAired', sortDirection: 'descending' },
      books: { sortMode: 'releaseDate', sortDirection: 'ascending' },
      general: { sortMode: 'firstAired', sortDirection: 'sideways' },
    },
  })

  assert.equal(config.mediaRoot, 'C:\\Media')
  assert.equal(config.theme, 'dark')
  assert.equal(config.cacheLimitMb, 128)
  assert.equal(config.showExternalSubtitleBadges, true)
  assert.equal(config.scraping.bangumiToken, 'token')
  assert.equal('anidbClient' in config.scraping, false)
  assert.equal(config.scraping.bangumiEndpoint, 'https://example.test')
  assert.equal(config.scraping.hanime1Endpoint, 'https://hanime1.com')
  assert.deepEqual(config.network, { proxyEnabled: true, proxyUrl: 'http://127.0.0.1:8390' })
  assert.deepEqual(config.catalog.tags, ['动作', '科幻'])
  assert.equal('classifications' in config.catalog, false)
  assert.deepEqual(config.libraries.anime, {
    rootPath: 'C:\\Anime',
    enabled: false,
    sortMode: 'firstAired',
    sortDirection: 'descending',
  })
  assert.equal(config.libraries.books.sortMode, 'releaseDate')
  assert.deepEqual(config.libraries.general, { rootPath: '', enabled: true, sortMode: 'title', sortDirection: 'ascending' })
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
  assert.equal(result.config.libraries.anime.sortMode, 'title')
  assert.equal(result.config.libraries.anime.sortDirection, 'ascending')
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
