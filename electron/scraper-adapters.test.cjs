const test = require('node:test')
const assert = require('node:assert/strict')
const { createScraperAdapters, parseHanime1Id, parseHanime1Page, parseHanime1SearchResults } = require('./scraper-adapters.cjs')

function jsonResponse(value, { status = 200 } = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function createAdapters(fetchWithNetwork, now = () => Date.now()) {
  return createScraperAdapters({
    loadConfig: async () => ({
      scraping: {
        bangumiEndpoint: 'https://bangumi.example',
        bangumiToken: 'header.eyJleHAiOjIwMDAwMDAwMDB9.signature',
        hanime1Endpoint: 'https://hanime1.example',
      },
    }),
    fetchWithNetwork,
    appVersion: 'StarMedia/test',
    now,
  })
}

test('searches and previews Bangumi subjects through the injected network port', async () => {
  const calls = []
  const adapters = createAdapters(async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/search/subjects'))
      return jsonResponse({
        data: [
          {
            id: 7,
            name: 'Original',
            name_cn: '中文名',
            date: '2026-01-01',
            images: { large: 'https://image.example/cover.jpg' },
            summary: '<b>简介</b>',
          },
        ],
      })
    if (url.endsWith('/subjects/7'))
      return jsonResponse({
        id: 7,
        name: 'Original',
        name_cn: '中文名',
        date: '2026-01-01',
        images: { common: 'https://image.example/cover.jpg' },
        summary: '<p>简介<br>第二行</p>',
        infobox: [{ key: '动画制作', value: 'Studio' }],
      })
    if (url.includes('/episodes?subject_id=7'))
      return jsonResponse({
        data: [
          {
            id: 71,
            subject_id: 7,
            type: 0,
            ep: 1,
            sort: 1,
            name: 'Episode',
            name_cn: '第一集',
            airdate: '2026-01-02',
            desc: '<b>单集简介</b>',
          },
          {
            id: 72,
            subject_id: 7,
            type: 1,
            ep: 0,
            sort: 1,
            name: 'Special',
            name_cn: '特别篇',
            airdate: '2026-01-03',
            desc: '',
          },
        ],
      })
    if (url.endsWith('/episodes/71'))
      return jsonResponse({
        id: 71,
        subject_id: 7,
        type: 0,
        ep: 1,
        sort: 1,
        name: 'Episode',
        name_cn: '第一集',
        airdate: '2026-01-02',
        desc: '<b>单集简介</b>',
      })
    if (url.endsWith('/me')) return jsonResponse({ nickname: 'tester' })
    throw new Error(`unexpected URL: ${url}`)
  })

  const search = await adapters.searchBangumiSubjects({ query: 'Original' })
  const preview = await adapters.previewBangumiSubject({ subjectId: 7 })
  const episodes = await adapters.getBangumiEpisodes(7)
  const episode = await adapters.getBangumiEpisode(71)
  const token = await adapters.verifyBangumiToken()

  assert.deepEqual(search.subjects, [
    { id: 7, name: 'Original', nameCn: '中文名', date: '2026-01-01', image: 'https://image.example/cover.jpg', summary: '简介' },
  ])
  assert.equal(preview.preview.studio, 'Studio')
  assert.equal(preview.preview.note, '简介\n第二行')
  assert.equal(token.userName, 'tester')
  assert.deepEqual(episodes, [
    {
      id: 71,
      subjectId: 7,
      type: 0,
      ep: 1,
      sort: 1,
      name: 'Episode',
      nameCn: '第一集',
      airdate: '2026-01-02',
      summary: '单集简介',
      url: 'https://bgm.tv/ep/71',
    },
    {
      id: 72,
      subjectId: 7,
      type: 1,
      ep: 0,
      sort: 1,
      name: 'Special',
      nameCn: '特别篇',
      airdate: '2026-01-03',
      summary: '',
      url: 'https://bgm.tv/ep/72',
    },
  ])
  assert.deepEqual(episode, episodes[0])
  assert.equal(token.expiresAt, '2033-05-18T03:33:20.000Z')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer header.eyJleHAiOjIwMDAwMDAwMDB9.signature')
})

test('routes Bangumi requests through its dedicated direct network port', async () => {
  const calls = []
  const adapters = createScraperAdapters({
    loadConfig: async () => ({
      scraping: { bangumiEndpoint: 'https://bangumi.example', bangumiToken: '', hanime1Endpoint: 'https://hanime1.example' },
    }),
    fetchWithNetwork: async () => {
      throw new Error('proxy should not handle Bangumi')
    },
    fetchBangumi: async (url, options) => {
      calls.push({ url, options })
      return jsonResponse({ data: [] })
    },
  })

  await adapters.searchBangumiSubjects({ query: 'Example' })
  assert.equal(calls[0].url, 'https://bangumi.example/v0/search/subjects')
  assert.equal(calls[0].options.method, 'POST')
})

test('caches FreeAnimeHentai data and ranks exact matches first', async () => {
  let calls = 0
  let time = 0
  const adapters = createAdapters(
    async () => {
      calls += 1
      return jsonResponse([
        { id: 1, name: 'Example', search_titles: 'Example Title', slug: 'example', released_at: '2026-01-01', brand: 'Brand' },
        { id: 2, name: 'Example Extra', search_titles: '', slug: 'example-extra', released_at: '2026-01-02', brand: '' },
      ])
    },
    () => time,
  )

  const first = await adapters.searchHanimeSubjects({ query: 'Example', source: 'freeanimehentai' })
  time += 60_000
  const second = await adapters.searchHanimeSubjects({ query: 'Extra', source: 'freeanimehentai' })
  const preview = await adapters.previewHanimeSubject({ subjectId: 1, source: 'freeanimehentai' })

  assert.equal(first.subjects[0].id, 1)
  assert.equal(second.subjects[0].id, 2)
  assert.equal(preview.preview.firstAiredAt, '2026-01-01')
  assert.equal(preview.preview.releaseDate, '')
  assert.equal(calls, 1)
})

test('parses Hanime1 IDs, pages, and search links', () => {
  const root = 'https://hanime1.example'
  const html =
    '<meta property="og:title" content="Sample - Hanime1"><meta property="og:image" content="https://image.example/cover.jpg"><meta property="og:video:duration" content="120"><div id="video-artist-name">Studio</div><div id="shareBtn-title">Sample</div><div class="video-caption-text">A <b>description</b></div><div class="single-video-tag"><a>Tag (10)</a></div><a href="/watch?v=12">Search Result</a>'

  assert.equal(parseHanime1Id('https://hanime1.example/watch?v=12', root), 12)
  assert.equal(parseHanime1Id('invalid', root), 0)
  assert.deepEqual(parseHanime1Page(html, 12, root).tags, ['Tag'])
  assert.equal(parseHanime1SearchResults(html, root)[0].id, 12)
})
