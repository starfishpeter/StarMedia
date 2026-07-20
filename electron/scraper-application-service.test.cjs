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
        { id: 421, type: 0, ep: 1, sort: 1, url: 'https://bgm.tv/ep/421' },
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
  assert.equal(saved.items[0].bangumiEpisodeSort, 1)
  assert.equal(saved.items[0].episode, '#01')
  assert.equal(saved.items[1].bangumiEpisodeId, undefined)
})

test('prefers an explicit episode marker over a season number when assigning Bangumi episodes', async (t) => {
  const root = await createSandbox(t)
  const item = {
    id: 'video:4',
    library: 'anime',
    kind: 'video',
    affiliation: 'Yuru Camp Season 2',
    title: 'Yuru Camp Season 2 #04',
    episode: 'Yuru Camp Season 2 #04',
  }
  let saved
  const service = createScraperApplicationService({
    scraperAdapters: {
      getBangumiSubject: async () => ({ subject: {} }),
      getBangumiEpisodes: async () => [
        { id: 202, type: 0, ep: 2, sort: 2, url: 'https://bgm.tv/ep/202' },
        { id: 204, type: 0, ep: 4, sort: 4, url: 'https://bgm.tv/ep/204' },
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

  await service.assignBangumiEpisodes({ id: item.id, subjectId: 2 })

  assert.equal(saved.items[0].bangumiEpisodeId, '204')
  assert.equal(saved.items[0].bangumiEpisodeSort, 4)
})

test('assigns an OVA marker only to a matching Bangumi special episode, never a regular episode', async (t) => {
  const root = await createSandbox(t)
  const item = {
    id: 'video:ova2',
    library: 'anime',
    kind: 'video',
    affiliation: 'Yuru Camp Season 3',
    title: 'Yuru Camp Season 3 #OVA02',
    episode: 'Yuru Camp Season 3 #OVA02',
  }
  let saved
  const service = createScraperApplicationService({
    scraperAdapters: {
      getBangumiSubject: async () => ({ subject: {} }),
      getBangumiEpisodes: async () => [
        { id: 1304964, type: 0, ep: 3, sort: 3, url: 'https://bgm.tv/ep/1304964' },
        { id: 1362389, type: 1, ep: 0, sort: 1, url: 'https://bgm.tv/ep/1362389' },
        { id: 1366282, type: 1, ep: 0, sort: 2, url: 'https://bgm.tv/ep/1366282' },
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

  const result = await service.assignBangumiEpisodes({ id: item.id, subjectId: 405785 })

  assert.equal(result.assignedCount, 1)
  assert.equal(saved.items[0].bangumiEpisodeId, '1366282')
  assert.equal(saved.items[0].bangumiEpisodeSort, 2)
  assert.equal(saved.items[0].bangumiEpisodeType, 1)
  assert.equal(saved.items[0].bangumiEpisodeLabel, 'ova')
})

test('clears an incorrect regular assignment when an OVA marker has no matching special episode', async (t) => {
  const root = await createSandbox(t)
  const item = {
    id: 'video:ova2',
    library: 'anime',
    kind: 'video',
    affiliation: 'Series',
    title: 'Season 3 #OVA02',
    episode: 'Season 3 #OVA02',
    bangumiEpisodeId: '3',
    bangumiEpisodeUrl: 'https://bgm.tv/ep/3',
    bangumiEpisodeSort: 3,
    bangumiEpisodeType: 0,
  }
  let saved
  const service = createScraperApplicationService({
    scraperAdapters: {
      getBangumiSubject: async () => ({ subject: {} }),
      getBangumiEpisodes: async () => [{ id: 3, type: 0, ep: 3, sort: 3, url: 'https://bgm.tv/ep/3' }],
      getBangumiEpisode: async () => null,
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

  const result = await service.assignBangumiEpisodes({ id: item.id, subjectId: 405785 })

  assert.equal(result.assignedCount, 0)
  assert.equal(saved.items[0].bangumiEpisodeId, undefined)
  assert.equal(saved.items[0].bangumiEpisodeSort, undefined)
  assert.equal(saved.items[0].bangumiEpisodeType, undefined)
})

test('assigns the unique regular Bangumi episode to a single local video without a number in its name', async (t) => {
  const root = await createSandbox(t)
  const item = {
    id: 'video:1',
    library: 'erAnime',
    kind: 'video',
    affiliation: 'Single',
    title: '23076-sc-1080p',
    episode: '23076-sc-1080p',
  }
  let saved
  const service = createScraperApplicationService({
    scraperAdapters: {
      getBangumiSubject: async () => ({ subject: {} }),
      getBangumiEpisodes: async () => [{ id: 2454891, type: 0, ep: 1, sort: 1, url: 'https://bgm.tv/ep/2454891' }],
      getBangumiEpisode: async () => null,
      getHanimeSubject: async () => null,
      previewBangumiSubject: async () => ({}),
      previewHanimeSubject: async () => ({}),
      searchBangumiSubjects: async () => ({}),
      searchHanimeSubjects: async () => ({}),
      verifyBangumiToken: async () => ({ valid: true }),
    },
    getConfigPaths: () => ({ coversDir: path.join(root, 'covers') }),
    loadConfig: async () => ({
      libraries: { erAnime: { rootPath: path.join(root, 'erAnime') } },
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

  const result = await service.assignBangumiEpisodes({ id: item.id, subjectId: 245489 })

  assert.equal(result.assignedCount, 1)
  assert.equal(saved.items[0].bangumiEpisodeId, '2454891')
  assert.equal(saved.items[0].bangumiEpisodeSort, 1)
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
      getBangumiEpisode: async () => ({
        id: 71,
        ep: 1,
        sort: 1,
        url: 'https://bgm.tv/ep/71',
        name: '原名',
        airdate: '2026-01-02',
        summary: '单集简介',
      }),
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
  assert.equal(saved.items[0].episodeTitleSource, 'bangumi')
  assert.equal(saved.items[0].bangumiEpisodeSort, 1)
  assert.equal(saved.items[0].episodeNote, '单集简介')
})

test('prefixes an unnumbered Bangumi title when its container has multiple videos', async (t) => {
  const root = await createSandbox(t)
  const first = { id: 'video:1', library: 'anime', kind: 'video', affiliation: 'Series', title: '#01', episode: '#01' }
  const second = { id: 'video:2', library: 'anime', kind: 'video', affiliation: 'Series', title: '#02', episode: '#02' }
  let saved
  const service = createScraperApplicationService({
    scraperAdapters: {
      getBangumiSubject: async () => ({ subject: {} }),
      getBangumiEpisodes: async () => [],
      getBangumiEpisode: async () => ({ id: 72, ep: 1, sort: 1, url: 'https://bgm.tv/ep/72', name: '原名', airdate: '', summary: '' }),
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
    loadLibrary: async () => ({ items: [first, second], operations: [] }),
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

  await service.applyBangumiEpisode({ id: first.id, episodeId: 72 })

  assert.equal(saved.items[0].episodeTitle, '#01 原名')
  assert.equal(saved.items[0].episodeTitleSource, 'bangumi')
})

test('does not add an automatic number to a Bangumi title that starts with a Chinese episode number', async (t) => {
  const root = await createSandbox(t)
  const first = { id: 'video:1', library: 'anime', kind: 'video', affiliation: 'Series', title: '#01', episode: '#01' }
  const second = { id: 'video:2', library: 'anime', kind: 'video', affiliation: 'Series', title: '#02', episode: '#02' }
  let saved
  const service = createScraperApplicationService({
    scraperAdapters: {
      getBangumiSubject: async () => ({ subject: {} }),
      getBangumiEpisodes: async () => [],
      getBangumiEpisode: async () => ({ id: 73, ep: 1, sort: 1, url: 'https://bgm.tv/ep/73', name: '一甘', airdate: '', summary: '' }),
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
    loadLibrary: async () => ({ items: [first, second], operations: [] }),
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

  await service.applyBangumiEpisode({ id: first.id, episodeId: 73 })

  assert.equal(saved.items[0].episodeTitle, '一甘')
  assert.equal(saved.items[0].episodeTitleSource, 'bangumi')
})

test('adds the correct episode number when a Japanese title starts with a different Chinese numeral', async (t) => {
  const root = await createSandbox(t)
  const first = { id: 'video:5', library: 'anime', kind: 'video', affiliation: 'Series', title: '#05', episode: '#05' }
  const second = { id: 'video:6', library: 'anime', kind: 'video', affiliation: 'Series', title: '#06', episode: '#06' }
  let saved
  const service = createScraperApplicationService({
    scraperAdapters: {
      getBangumiSubject: async () => ({ subject: {} }),
      getBangumiEpisodes: async () => [],
      getBangumiEpisode: async () => ({
        id: 762294,
        type: 0,
        ep: 5,
        sort: 5,
        url: 'https://bgm.tv/ep/762294',
        name: '二つのキャンプ、二人の景色',
        airdate: '',
        summary: '',
      }),
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
    loadLibrary: async () => ({ items: [first, second], operations: [] }),
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

  await service.applyBangumiEpisode({ id: first.id, episodeId: 762294 })

  assert.equal(saved.items[0].episodeTitle, '#05 二つのキャンプ、二人の景色')
})

test('formats a Bangumi special episode with an SP prefix instead of a regular episode number', async (t) => {
  const root = await createSandbox(t)
  const first = { id: 'video:sp', library: 'anime', kind: 'video', affiliation: 'Series', title: 'Mystery Camp', episode: 'Mystery Camp' }
  const second = { id: 'video:2', library: 'anime', kind: 'video', affiliation: 'Series', title: '#02', episode: '#02' }
  let saved
  const service = createScraperApplicationService({
    scraperAdapters: {
      getBangumiSubject: async () => ({ subject: {} }),
      getBangumiEpisodes: async () => [],
      getBangumiEpisode: async () => ({
        id: 1038485,
        type: 1,
        ep: 1,
        sort: 1,
        url: 'https://bgm.tv/ep/1038485',
        name: 'SP.1 ミステリーキャンプ',
        airdate: '',
        summary: '',
      }),
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
    loadLibrary: async () => ({ items: [first, second], operations: [] }),
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

  await service.applyBangumiEpisode({ id: first.id, episodeId: 1038485 })

  assert.equal(saved.items[0].episodeTitle, '#SP01 ミステリーキャンプ')
  assert.equal(saved.items[0].bangumiEpisodeType, 1)
  assert.equal(saved.items[0].episodeTitleSource, 'bangumi')
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
