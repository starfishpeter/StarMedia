function stripHtml(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, code) => {
      const parsed = String(code).toLowerCase().startsWith('x')
        ? Number.parseInt(String(code).slice(1), 16)
        : Number.parseInt(String(code), 10)
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : ''
    })
    .replace(/[ \t\r\f]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim()
}

function getBangumiImageUrl(subject) {
  const images = subject?.images && typeof subject.images === 'object' ? subject.images : {}
  for (const key of ['large', 'common', 'medium', 'small', 'grid']) {
    if (typeof images[key] === 'string' && images[key]) return images[key]
  }
  return ''
}

function extractBangumiStudio(subject) {
  const infobox = Array.isArray(subject?.infobox) ? subject.infobox : []
  const normalizeKey = (value) =>
    String(value ?? '')
      .replace(/[\s\u3000]/g, '')
      .replace(/[：:]/g, '')
  const readValue = (value) => {
    if (typeof value === 'string') return value.trim()
    if (Array.isArray(value)) return value.map(readValue).filter(Boolean).join('、').trim()
    if (value && typeof value === 'object') return readValue(value.v ?? value.value ?? value.name ?? '')
    return ''
  }
  function findValueByKey(value, matcher, depth = 0) {
    if (depth > 8 || value === null || value === undefined) return ''
    if (Array.isArray(value)) {
      for (const entry of value) {
        const result = findValueByKey(entry, matcher, depth + 1)
        if (result) return result
      }
      return ''
    }
    if (typeof value !== 'object') return ''
    const key = normalizeKey(value.key ?? value.k ?? value.name)
    if (matcher.test(key)) {
      const result = readValue(value.value ?? value.v ?? value.name)
      if (result) return result
    }
    for (const child of Object.values(value)) {
      const result = findValueByKey(child, matcher, depth + 1)
      if (result) return result
    }
    return ''
  }
  const specificMatcher = /动画制作|动画制作公司|アニメーション制作|アニメーション制作会社|制作公司|制作会社|製作会社/i
  return (
    findValueByKey(infobox, specificMatcher) ||
    findValueByKey(infobox, /^(?:制作|製作)$/i) ||
    findValueByKey(subject, /(?:动画制作|アニメーション制作|制作公司|制作会社|製作会社|制作单位|studio|studios|producer|producers)/i) ||
    readValue(subject?.studio ?? subject?.studios ?? subject?.producer ?? subject?.producers)
  )
}

function normalizeScrapedField(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function makeBangumiScrapeFields(subject) {
  return {
    affiliation: normalizeScrapedField(subject?.name_cn, 200),
    originalTitle: normalizeScrapedField(subject?.name, 200),
    studio: normalizeScrapedField(extractBangumiStudio(subject), 200),
    firstAiredAt: normalizeScrapedField(subject?.date, 40),
    releaseDate: '',
    note: normalizeScrapedField(stripHtml(subject?.summary), 1200),
  }
}

function makeHanimeScrapeFields(subject) {
  return {
    affiliation: '',
    originalTitle: normalizeScrapedField(subject?.name, 200),
    studio: normalizeScrapedField(subject?.brand, 200),
    firstAiredAt: normalizeScrapedField(subject?.date ?? subject?.released_at, 40).slice(0, 10),
    releaseDate: '',
    note: normalizeScrapedField(stripHtml(subject?.description), 1200),
  }
}

function makeScrapePreview(source, subject, fields) {
  return {
    source,
    subjectId: Number(subject?.id),
    title: normalizeScrapedField(subject?.name, 200),
    chineseTitle: normalizeScrapedField(subject?.nameCn ?? subject?.name_cn, 200),
    coverUrl: normalizeScrapedField(subject?.image ?? subject?.cover_url ?? getBangumiImageUrl(subject), 2000),
    studio: fields.studio,
    firstAiredAt: fields.firstAiredAt,
    releaseDate: fields.releaseDate,
    note: fields.note,
    url: normalizeScrapedField(subject?.url, 2000),
  }
}

function getTokenExpiry(token) {
  const parts = String(token ?? '')
    .trim()
    .split('.')
  if (parts.length !== 3) return null
  try {
    const expiresAt = Number(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.exp)
    return Number.isFinite(expiresAt) && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null
  } catch {
    return null
  }
}

function getHanime1Root(endpoint) {
  const parsed = new URL(String(endpoint).trim())
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Hanime1 地址必须使用 HTTP 或 HTTPS')
  return parsed.origin
}

function decodeHtmlText(value) {
  return stripHtml(String(value ?? ''))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}

function getHtmlMetaContent(html, attribute, expected) {
  const pattern = new RegExp(`<meta\\b[^>]*\\b${attribute}\\s*=\\s*["']${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i')
  const tag = String(html).match(pattern)?.[0] ?? ''
  return tag.match(/\bcontent\s*=\s*["']([\s\S]*?)["']/i)?.[1] ?? ''
}

function getHtmlElementTextById(html, id) {
  const pattern = new RegExp(`<[^>]+\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i')
  return decodeHtmlText(String(html).match(pattern)?.[1] ?? '')
}

function parseHanime1Id(input, root) {
  const value = String(input ?? '').trim()
  if (/^\d+$/.test(value)) return Number(value)
  try {
    const parsed = new URL(value)
    if (parsed.pathname.replace(/\/$/, '') !== '/watch') return 0
    const isHanime1Host = /^(?:www\.)?hanime1\.(?:com|me)$/i.test(parsed.hostname)
    if (!isHanime1Host && parsed.origin !== getHanime1Root(root)) return 0
    const id = parsed.searchParams.get('v') ?? ''
    return /^\d+$/.test(id) ? Number(id) : 0
  } catch {
    return 0
  }
}

function toHanime1Url(id, root) {
  return `${getHanime1Root(root)}/watch?v=${encodeURIComponent(String(id))}`
}

function parseHanime1Page(html, id, root) {
  const url = toHanime1Url(id, root)
  const title =
    getHtmlElementTextById(html, 'shareBtn-title') ||
    decodeHtmlText(getHtmlMetaContent(html, 'property', 'og:title'))
      .replace(/\s+-\s+Hanime1(?:\.me)?\s*$/i, '')
      .trim()
  const description =
    decodeHtmlText(String(html).match(/<div[^>]*class=["'][^"']*video-caption-text[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '') ||
    decodeHtmlText(getHtmlMetaContent(html, 'name', 'description'))
  const date =
    String(html).match(/(?:觀看|观看)(?:次數|次数)[\s\S]{0,180}?(\d{4}-\d{2}-\d{2})/i)?.[1] ||
    String(html).match(/\d{4}-\d{2}-\d{2}/)?.[0] ||
    ''
  const durationSeconds = Number(getHtmlMetaContent(html, 'property', 'og:video:duration'))
  const tags = [...String(html).matchAll(/<div[^>]*class=["'][^"']*single-video-tag[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) =>
      decodeHtmlText(match[1])
        .replace(/\s*\(\d+\)\s*$/, '')
        .trim(),
    )
    .filter(Boolean)
  return {
    id: Number(id),
    name: title,
    searchTitles: title,
    date,
    image: getHtmlMetaContent(html, 'property', 'og:image'),
    description,
    brand: getHtmlElementTextById(html, 'video-artist-name'),
    slug: '',
    url,
    source: 'hanime1',
    tags: [...new Set(tags)],
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
  }
}

function parseHanime1SearchResults(html, root) {
  const subjects = new Map()
  for (const match of String(html).matchAll(
    /href=["'](?:https?:\/\/(?:www\.)?hanime1\.(?:com|me))?\/watch\?v=(\d+)["'][^>]*>([\s\S]{0,1200}?)<\/a>/gi,
  )) {
    const id = Number(match[1])
    const name = decodeHtmlText(match[2]).trim()
    if (!name || name.length < 2 || /^(?:<img|观看|下載|播放)$/i.test(name)) continue
    const context = String(html).slice(Math.max(0, (match.index ?? 0) - 1800), (match.index ?? 0) + 1800)
    const image = context.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i)?.[1] ?? ''
    const existing = subjects.get(id)
    if (!existing || name.length > existing.name.length)
      subjects.set(id, {
        id,
        name,
        searchTitles: name,
        date: '',
        image,
        description: '',
        brand: '',
        slug: '',
        url: toHanime1Url(id, root),
        source: 'hanime1',
      })
  }
  return [...subjects.values()].slice(0, 20)
}

function normalizeScraperText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toFreeAnimeHentaiSubject(subject) {
  return {
    id: Number(subject.id),
    name: String(subject.name ?? ''),
    searchTitles: String(subject.search_titles ?? ''),
    date: String(subject.released_at ?? '').slice(0, 10),
    image: String(subject.cover_url ?? ''),
    description: stripHtml(subject.description),
    brand: String(subject.brand ?? ''),
    slug: String(subject.slug),
    source: 'freeanimehentai',
    url: `https://hanime.tv/videos/hentai/${encodeURIComponent(String(subject.slug))}`,
  }
}

function createScraperAdapters({
  loadConfig,
  fetchWithNetwork,
  appVersion = 'StarMedia',
  defaultHanime1Endpoint = 'https://hanime1.com',
  freeAnimeHentaiSearchEndpoint = 'https://guest.freeanimehentai.net/api/v11/search_hvs',
  now = () => Date.now(),
}) {
  if (typeof loadConfig !== 'function' || typeof fetchWithNetwork !== 'function') throw new Error('刮削服务依赖不可用')
  let hanimeSearchCache = { expiresAt: 0, subjects: [] }

  function getBangumiApiRoot(config) {
    const endpoint = String(config?.scraping?.bangumiEndpoint ?? '')
      .trim()
      .replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(endpoint)) throw new Error('Bangumi 服务地址必须以 http:// 或 https:// 开头')
    return /\/v0$/i.test(endpoint) ? endpoint : `${endpoint}/v0`
  }

  function getBangumiHeaders(config, withJsonBody = false) {
    const headers = { Accept: 'application/json', 'User-Agent': `${appVersion} (desktop media library)` }
    if (withJsonBody) headers['Content-Type'] = 'application/json'
    const token = String(config?.scraping?.bangumiToken ?? '').trim()
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }

  async function requestBangumi(config, endpoint, options = {}) {
    let response
    try {
      response = await fetchWithNetwork(`${getBangumiApiRoot(config)}${endpoint}`, options)
    } catch (error) {
      throw new Error(`无法连接 Bangumi：${error.message}`, { cause: error })
    }
    if (!response.ok) throw new Error(`Bangumi 请求失败（${response.status}）`)
    return response.json()
  }

  async function getBangumiSubject(subjectId) {
    const config = await loadConfig()
    return { config, subject: await requestBangumi(config, `/subjects/${subjectId}`, { headers: getBangumiHeaders(config) }) }
  }

  async function searchBangumiSubjects({ query }) {
    const config = await loadConfig()
    const result = await requestBangumi(config, '/search/subjects', {
      method: 'POST',
      headers: getBangumiHeaders(config, true),
      body: JSON.stringify({ keyword: query, filter: { type: [2] }, limit: 10 }),
    })
    return {
      subjects: (Array.isArray(result?.data) ? result.data : [])
        .map((subject) => ({
          id: Number(subject?.id),
          name: String(subject?.name ?? ''),
          nameCn: String(subject?.name_cn ?? ''),
          date: String(subject?.date ?? ''),
          image: getBangumiImageUrl(subject),
          summary: stripHtml(subject?.summary),
        }))
        .filter((subject) => Number.isInteger(subject.id) && subject.id > 0 && (subject.name || subject.nameCn)),
    }
  }

  async function previewBangumiSubject({ subjectId }) {
    const { subject } = await getBangumiSubject(subjectId)
    return { preview: makeScrapePreview('bangumi', subject, makeBangumiScrapeFields(subject)) }
  }

  async function verifyBangumiToken() {
    const config = await loadConfig()
    const token = String(config?.scraping?.bangumiToken ?? '').trim()
    if (!token) throw new Error('请先粘贴访问令牌')
    const profile = await requestBangumi(config, '/me', { headers: getBangumiHeaders(config) })
    return {
      valid: true,
      expiresAt: getTokenExpiry(token),
      userName: String(profile?.nickname ?? profile?.username ?? profile?.user?.nickname ?? profile?.user?.username ?? '').trim(),
    }
  }

  async function loadFreeAnimeHentaiSubjects() {
    if (hanimeSearchCache.expiresAt > now() && hanimeSearchCache.subjects.length > 0) return hanimeSearchCache.subjects
    const response = await fetchWithNetwork(freeAnimeHentaiSearchEndpoint, {
      headers: { Accept: 'application/json', 'User-Agent': `${appVersion} (desktop media library)`, Referer: 'https://hanime.tv/' },
    })
    if (!response.ok) throw new Error(`FreeAnimeHentai 请求失败（${response.status}）`)
    const payload = await response.json()
    if (!Array.isArray(payload)) throw new Error('FreeAnimeHentai 返回的数据格式无效')
    hanimeSearchCache = {
      expiresAt: now() + 10 * 60 * 1000,
      subjects: payload.filter(
        (subject) => Number.isInteger(Number(subject?.id)) && String(subject?.slug ?? '').trim() && String(subject?.name ?? '').trim(),
      ),
    }
    return hanimeSearchCache.subjects
  }

  async function loadHanime1SubjectById(subjectId) {
    const config = await loadConfig()
    const root = getHanime1Root(config.scraping.hanime1Endpoint || defaultHanime1Endpoint)
    const response = await fetchWithNetwork(toHanime1Url(subjectId, root), {
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': `${appVersion} (desktop media library)`, Referer: `${root}/` },
    })
    if (!response.ok) throw new Error(`Hanime1 请求失败（${response.status}）`)
    const subject = parseHanime1Page(await response.text(), subjectId, root)
    if (!subject.name) throw new Error('Hanime1 页面中没有找到视频标题')
    return subject
  }

  async function searchHanime1Subjects(query) {
    const config = await loadConfig()
    const root = getHanime1Root(config.scraping.hanime1Endpoint || defaultHanime1Endpoint)
    const exactId = parseHanime1Id(query, root)
    if (exactId > 0) return { subjects: [await loadHanime1SubjectById(exactId)] }
    const response = await fetchWithNetwork(`${root}/search?query=${encodeURIComponent(query)}`, {
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': `${appVersion} (desktop media library)`, Referer: `${root}/` },
    })
    if (!response.ok) throw new Error(`Hanime1 搜索失败（${response.status}）`)
    return { subjects: parseHanime1SearchResults(await response.text(), root) }
  }

  async function getHanimeSubject(subjectId, source) {
    if (source === 'hanime1') return loadHanime1SubjectById(subjectId)
    return (await loadFreeAnimeHentaiSubjects()).find((candidate) => Number(candidate?.id) === subjectId) ?? null
  }

  async function searchHanimeSubjects({ query, source = 'freeanimehentai' }) {
    if (source === 'hanime1') return searchHanime1Subjects(query)
    const normalizedQuery = normalizeScraperText(query)
    const terms = normalizedQuery.split(' ').filter(Boolean)
    const subjects = await loadFreeAnimeHentaiSubjects()
    const results = subjects
      .map((subject) => {
        const name = String(subject.name ?? '')
        const normalizedName = normalizeScraperText(name)
        const haystack = normalizeScraperText(`${name} ${subject.search_titles ?? ''} ${subject.brand ?? ''}`)
        const compactQuery = normalizedQuery.replace(/\s/g, '')
        const matches =
          compactQuery.length > 0 && (terms.every((term) => haystack.includes(term)) || haystack.replace(/\s/g, '').includes(compactQuery))
        if (!matches) return null
        return {
          subject,
          score:
            (normalizedName === normalizedQuery ? 3 : 0) +
            (normalizedName.startsWith(normalizedQuery) ? 2 : 0) +
            (haystack.includes(normalizedQuery) ? 1 : 0),
        }
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || String(left.subject.name).localeCompare(String(right.subject.name)))
      .slice(0, 20)
      .map(({ subject }) => toFreeAnimeHentaiSubject(subject))
    return { subjects: results }
  }

  async function previewHanimeSubject({ subjectId, source = 'freeanimehentai' }) {
    const rawSubject = await getHanimeSubject(subjectId, source)
    const sourceLabel = source === 'hanime1' ? 'Hanime1' : 'FreeAnimeHentai'
    if (!rawSubject) throw new Error(`${sourceLabel} 条目不存在，请重新搜索`)
    const subject = source === 'hanime1' ? rawSubject : toFreeAnimeHentaiSubject(rawSubject)
    return { preview: makeScrapePreview(source, subject, makeHanimeScrapeFields(subject)) }
  }

  return {
    getBangumiSubject,
    getHanimeSubject,
    makeBangumiScrapeFields,
    makeHanimeScrapeFields,
    previewBangumiSubject,
    previewHanimeSubject,
    searchBangumiSubjects,
    searchHanimeSubjects,
    verifyBangumiToken,
  }
}

module.exports = {
  createScraperAdapters,
  extractBangumiStudio,
  getBangumiImageUrl,
  getHanime1Root,
  makeBangumiScrapeFields,
  makeHanimeScrapeFields,
  normalizeScraperText,
  parseHanime1Id,
  parseHanime1Page,
  parseHanime1SearchResults,
  stripHtml,
  toFreeAnimeHentaiSubject,
}
