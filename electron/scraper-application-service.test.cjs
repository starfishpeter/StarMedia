const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createScraperApplicationService } = require('./scraper-application-service.cjs')
const { writeFileAtomically } = require('./library-store.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-scraper-application-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

function createService({ root, library, saveLibrary, subject, fetchWithNetwork }) {
  const libraryRoot = path.join(root, 'anime')
  return createScraperApplicationService({
    scraperAdapters: {
      getBangumiSubject: async () => ({ subject }),
      getBangumiEpisodes: async () => [],
      getBangumiEpisode: async () => null,
      getHanimeSubject: async () => subject,
      previewBangumiSubject: async () => ({}),
      previewHanimeSubject: async () => ({}),
      searchBangumiSubjects: async () => ({}),
      searchHanimeSubjects: async () => ({}),
      verifyBangumiToken: async () => ({ valid: true }),
    },
    getConfigPaths: () => ({ coversDir: path.join(root, 'covers') }),
    loadConfig: async () => ({
      libraries: { anime: { rootPath: libraryRoot }, erAnime: { rootPath: libraryRoot } },
      scraping: { hanime1Endpoint: 'https://hanime1.com' },
    }),
    loadLibrary: async () => library,
    saveLibrary,
    fetchWithNetwork,
    writeFileAtomically,
    appVersion: 'StarMedia/test',
    openExternal: async () => '',
    bangumiTokenPageUrl: 'https://next.bgm.tv/demo/access-token',
    defaultHanime1Endpoint: 'https://hanime1.com',
  })
}

test('applies Bangumi metadata and an image poster to every container item', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'anime')
  const firstPath = path.join(libraryRoot, 'Old', 'one.mp4')
  const secondPath = path.join(libraryRoot, 'Old', 'two.mp4')
  await fs.mkdir(path.dirname(firstPath), { recursive: true })
  await fs.writeFile(firstPath, 'one')
  await fs.writeFile(secondPath, 'two')
  const first = { id: 'video:1', library: 'anime', kind: 'video', affiliation: '合集', title: 'One', sourcePath: firstPath, sidecars: [] }
  const second = { id: 'video:2', library: 'anime', kind: 'video', affiliation: '合集', title: 'Two', sourcePath: secondPath, sidecars: [] }
  let saved
  const service = createService({
    root,
    library: { items: [first, second], operations: [] },
    subject: {
      id: 42,
      name: 'Original',
      name_cn: '中文标题',
      date: '2026-01-01',
      summary: '简介',
      images: { large: 'https://images.test/poster.png' },
    },
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
    fetchWithNetwork: async () => new Response('poster', { headers: { 'content-type': 'image/png' } }),
  })

  const result = await service.applyBangumiSubject({ id: first.id, subjectId: 42, mode: 'both' })

  assert.equal(result.item.affiliation, '中文标题')
  assert.equal(result.item.originalTitle, 'Original')
  assert.equal(saved.items[1].bangumiId, '42')
  assert.equal(saved.items[0].bangumiEpisodeId, undefined)
  assert.match(saved.items[0].cover, /bangumi-42\.png/)
  assert.equal(await fs.readFile(path.join(root, 'covers', 'posters', 'bangumi-42.png'), 'utf8'), 'poster')
  assert.equal(await fs.readFile(path.join(libraryRoot, 'Original', 'one.mp4'), 'utf8'), 'one')
  assert.equal(await fs.readFile(path.join(libraryRoot, 'Original', 'two.mp4'), 'utf8'), 'two')
})

test('assigns only matching regular Bangumi episodes without changing local video names', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'anime')
  const firstPath = path.join(libraryRoot, 'Series', '#01.mp4')
  const specialPath = path.join(libraryRoot, 'Series', '#EP00.mp4')
  await fs.mkdir(path.dirname(firstPath), { recursive: true })
  await fs.writeFile(firstPath, 'one')
  await fs.writeFile(specialPath, 'special')
  const first = {
    id: 'video:1',
    library: 'anime',
    kind: 'video',
    affiliation: 'Series',
    title: '#01',
    episode: '#01',
    sourcePath: firstPath,
    sidecars: [],
  }
  const special = {
    id: 'video:2',
    library: 'anime',
    kind: 'video',
    affiliation: 'Series',
    title: '#EP00',
    episode: '#EP00',
    sourcePath: specialPath,
    sidecars: [],
  }
  let saved
  const serviceWithEpisodes = createScraperApplicationService({
    scraperAdapters: {
      getBangumiSubject: async () => ({ subject: { id: 42 } }),
      getBangumiEpisodes: async () => [
        { id: 421, type: 0, ep: 1, url: 'https://bgm.tv/ep/421' },
        { id: 422, type: 1, ep: 0, url: 'https://bgm.tv/ep/422' },
      ],
      getBangumiEpisode: async () => null,
      getHanimeSubject: async () => null,
      previewBangumiSubject: async () => ({}),
      previewHanimeSubject: async () => ({}),
      searchBangumiSubjects: async () => ({}),
      searchHanimeSubjects: async () => ({}),
      verifyBangumiToken: async () => ({ valid: true }),
    },
    getConfigPaths: () => ({ coversDir: path.join(root, 'covers') }),
    loadConfig: async () => ({ libraries: { anime: { rootPath: libraryRoot } }, scraping: { hanime1Endpoint: 'https://hanime1.com' } }),
    loadLibrary: async () => ({ items: [first, special], operations: [] }),
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
    fetchWithNetwork: async () => new Response(''),
    writeFileAtomically,
    appVersion: 'StarMedia/test',
    openExternal: async () => '',
    bangumiTokenPageUrl: 'https://next.bgm.tv/demo/access-token',
  })

  await serviceWithEpisodes.assignBangumiEpisodes({ id: first.id, subjectId: 42 })
  assert.equal(saved.items[0].bangumiEpisodeId, '421')
  assert.equal(saved.items[0].episode, '#01')
  assert.equal(saved.items[1].bangumiEpisodeId, undefined)
})

test('scrapes metadata for one Bangumi episode without altering its local episode name', async (t) => {
  const root = await createSandbox(t)
  const item = {
    id: 'video:1',
    library: 'anime',
    kind: 'video',
    title: '#01',
    episode: '#01',
    sourcePath: path.join(root, 'anime', 'Series', '#01.mp4'),
  }
  let saved
  const service = createScraperApplicationService({
    scraperAdapters: {
      getBangumiSubject: async () => ({ subject: {} }),
      getBangumiEpisodes: async () => [],
      getBangumiEpisode: async () => ({ id: 71, url: 'https://bgm.tv/ep/71', name: '原名', airdate: '2026-01-02', summary: '单集简介' }),
      getHanimeSubject: async () => null,
      previewBangumiSubject: async () => ({}),
      previewHanimeSubject: async () => ({}),
      searchBangumiSubjects: async () => ({}),
      searchHanimeSubjects: async () => ({}),
      verifyBangumiToken: async () => ({ valid: true }),
    },
    getConfigPaths: () => ({ coversDir: path.join(root, 'covers') }),
    loadConfig: async () => ({
      libraries: { anime: { rootPath: path.join(root, 'anime') } },
      scraping: { hanime1Endpoint: 'https://hanime1.com' },
    }),
    loadLibrary: async () => ({ items: [item], operations: [] }),
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
    fetchWithNetwork: async () => new Response(''),
    writeFileAtomically,
    appVersion: 'StarMedia/test',
    openExternal: async () => '',
    bangumiTokenPageUrl: 'https://next.bgm.tv/demo/access-token',
  })

  await service.applyBangumiEpisode({ id: item.id, episodeId: 71 })
  assert.equal(saved.items[0].episode, '#01')
  assert.equal(saved.items[0].episodeTitle, '原名')
  assert.equal(saved.items[0].episodeNote, '单集简介')
})

test('restores the renamed scraper container when saving metadata fails', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'anime')
  const sourcePath = path.join(libraryRoot, 'Old', 'episode.mp4')
  await fs.mkdir(path.dirname(sourcePath), { recursive: true })
  await fs.writeFile(sourcePath, 'video')
  const item = { id: 'video:1', library: 'anime', kind: 'video', affiliation: '合集', title: 'Episode', sourcePath, sidecars: [] }
  const service = createService({
    root,
    library: { items: [item], operations: [] },
    subject: { id: 42, name: 'Original', name_cn: '', date: '', summary: '', images: {} },
    saveLibrary: async () => {
      throw new Error('injected index failure')
    },
    fetchWithNetwork: async () => new Response(''),
  })

  await assert.rejects(
    service.applyBangumiSubject({ id: item.id, subjectId: 42, fields: { originalTitle: 'Renamed' } }),
    /injected index failure/,
  )

  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'video')
  await assert.rejects(fs.access(path.join(libraryRoot, 'Renamed')), { code: 'ENOENT' })
})

test('rejects non-image scraper poster responses before writing metadata', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'anime', 'Old', 'episode.mp4')
  await fs.mkdir(path.dirname(sourcePath), { recursive: true })
  await fs.writeFile(sourcePath, 'video')
  const item = { id: 'video:1', library: 'anime', kind: 'video', affiliation: '合集', title: 'Episode', sourcePath, sidecars: [] }
  let saved = false
  const service = createService({
    root,
    library: { items: [item], operations: [] },
    subject: { id: 42, name: 'Original', name_cn: '', date: '', summary: '', images: { large: 'https://images.test/poster.txt' } },
    saveLibrary: async () => {
      saved = true
    },
    fetchWithNetwork: async () => new Response('not an image', { headers: { 'content-type': 'text/plain' } }),
  })

  await assert.rejects(service.applyBangumiSubject({ id: item.id, subjectId: 42, mode: 'cover' }), /不是图片/)
  assert.equal(saved, false)
})

test('applies Hanime1 metadata and poster fields only to the selected erAnime container', async (t) => {
  const root = await createSandbox(t)
  const libraryRoot = path.join(root, 'anime')
  const sourcePath = path.join(libraryRoot, 'Old', 'episode.mp4')
  const unrelatedPath = path.join(libraryRoot, 'Other', 'episode.mp4')
  await fs.mkdir(path.dirname(sourcePath), { recursive: true })
  await fs.mkdir(path.dirname(unrelatedPath), { recursive: true })
  await fs.writeFile(sourcePath, 'video')
  await fs.writeFile(unrelatedPath, 'other')
  const item = { id: 'video:1', library: 'erAnime', kind: 'video', affiliation: '合集', title: 'Episode', sourcePath, sidecars: [] }
  const unrelated = {
    id: 'video:2',
    library: 'erAnime',
    kind: 'video',
    affiliation: '其他',
    title: 'Other',
    sourcePath: unrelatedPath,
    sidecars: [],
  }
  let saved
  const service = createService({
    root,
    library: { items: [item, unrelated], operations: [] },
    subject: {
      id: 99,
      name: 'Original Title',
      date: '2026-02-03',
      image: 'https://images.test/hanime.webp',
      description: 'Description',
      brand: 'Studio',
      url: 'https://hanime1.com/watch?v=99',
    },
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
    fetchWithNetwork: async () => new Response('poster', { headers: { 'content-type': 'image/webp' } }),
  })

  const result = await service.applyHanimeSubject({ id: item.id, subjectId: 99, source: 'hanime1', mode: 'both' })

  assert.equal(result.item.hanime1Id, '99')
  assert.equal(result.item.originalTitle, 'Original Title')
  assert.equal(result.item.firstAiredAt, '2026-02-03')
  assert.equal(result.item.releaseDate, undefined)
  assert.equal(result.item.studio, 'Studio')
  assert.match(result.item.cover, /hanime1-99\.webp/)
  assert.equal(saved.items[1].hanime1Id, undefined)
  assert.equal(await fs.readFile(path.join(root, 'covers', 'posters', 'hanime1-99.webp'), 'utf8'), 'poster')
})

test('opens the Bangumi token page and surfaces shell errors', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'anime', 'Old', 'episode.mp4')
  await fs.mkdir(path.dirname(sourcePath), { recursive: true })
  await fs.writeFile(sourcePath, 'video')
  const item = { id: 'video:1', library: 'anime', kind: 'video', affiliation: '合集', title: 'Episode', sourcePath, sidecars: [] }
  const opened = []
  const service = createScraperApplicationService({
    scraperAdapters: {
      getBangumiSubject: async () => ({ subject: {} }),
      getBangumiEpisodes: async () => [],
      getBangumiEpisode: async () => null,
      getHanimeSubject: async () => ({}),
      previewBangumiSubject: async () => ({}),
      previewHanimeSubject: async () => ({}),
      searchBangumiSubjects: async () => ({}),
      searchHanimeSubjects: async () => ({}),
      verifyBangumiToken: async () => ({ valid: true }),
    },
    getConfigPaths: () => ({ coversDir: path.join(root, 'covers') }),
    loadConfig: async () => ({
      libraries: { anime: { rootPath: path.join(root, 'anime') } },
      scraping: { hanime1Endpoint: 'https://hanime1.com' },
    }),
    loadLibrary: async () => ({ items: [item], operations: [] }),
    saveLibrary: async (data) => ({ data, libraryPath: 'index.json' }),
    fetchWithNetwork: async () => new Response(''),
    writeFileAtomically,
    appVersion: 'StarMedia/test',
    openExternal: async (url) => {
      opened.push(url)
      return ''
    },
    bangumiTokenPageUrl: 'https://next.bgm.tv/demo/access-token',
  })

  assert.deepEqual(await service.openBangumiTokenPage(), { url: 'https://next.bgm.tv/demo/access-token' })
  assert.deepEqual(opened, ['https://next.bgm.tv/demo/access-token'])
})
