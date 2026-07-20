const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { isPosterLibrary } = require('./library-definitions.cjs')
const { normalizeFolderName } = require('./file-operations.cjs')
const { getItemAffiliation, getItemEpisode } = require('./import-service.cjs')
const { getVideoStorageFolderName, renameVideoContainerDirectory } = require('./library-file-layout-service.cjs')
const {
  getBangumiImageUrl,
  getHanime1Root,
  makeBangumiScrapeFields,
  makeHanimeScrapeFields,
  toFreeAnimeHentaiSubject,
} = require('./scraper-adapters.cjs')

const imageExtensions = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.avif', '.gif', '.bmp'])

function normalizeScrapedField(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function normalizeScrapedFolderName(value, fallback, label = '刮削名称') {
  const cleaned = String(value ?? '')
    .trim()
    .replace(
      /[\\/:*?"<>|]/g,
      (character) =>
        ({ '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？', '"': '＂', '<': '＜', '>': '＞', '|': '｜' })[character] ?? '＿',
    )
    .replace(/[\u0000-\u001F]/g, '')
    .replace(/[. ]+$/, '')
    .trim()
  if (!cleaned) return fallback
  try {
    return normalizeFolderName(cleaned, fallback, label)
  } catch {
    return fallback
  }
}

function getLocalEpisodeReference(item) {
  const value = getItemEpisode(item)
  const specialMatch = value.match(/(?:[#＃]\s*|\b)(SP|OVA)\s*0*(\d{1,3})(?:$|[^a-z0-9])/i)
  if (specialMatch) return { category: 'special', label: specialMatch[1].toLowerCase(), number: Number(specialMatch[2]) }
  if (/(?:[#＃]\s*|\b)(?:SP|OVA)\b/i.test(value)) return { category: 'special', label: '', number: null }
  const explicitMatch = value.match(/(?:[#＃]\s*|\bep(?:isode)?\s*|第\s*)0*(\d{1,3})(?:\s*(?:话|集|話|話目))?(?:$|[^a-z0-9])/i)
  if (explicitMatch) return { category: 'regular', number: Number(explicitMatch[1]) }
  const match = value.match(/(?:^|[^a-z0-9])0*(\d{1,3})(?:$|[^a-z0-9])/i)
  return { category: 'regular', number: match ? Number(match[1]) : null }
}

function getBangumiEpisodeSort(episode) {
  const sort = Number(episode?.sort)
  if (Number.isFinite(sort) && sort > 0) return sort
  const ep = Number(episode?.ep)
  return Number.isFinite(ep) && ep > 0 ? ep : undefined
}

function getBangumiEpisodeType(episode) {
  const type = Number(episode?.type)
  return Number.isInteger(type) && type >= 0 ? type : 0
}

function hasEpisodeNumber(title, episodeSort) {
  const normalized = title.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xff10 + 0x30)).replaceAll('＃', '#')
  if (new RegExp(`(?:^|[^A-Za-z0-9])#?\\s*0*${episodeSort}(?![0-9])`, 'i').test(normalized)) return true
  return parseLeadingChineseEpisodeNumber(normalized) === episodeSort
}

function parseLeadingChineseEpisodeNumber(title) {
  const match = String(title).match(/^第?\s*([零〇一二三四五六七八九十百千万两]+)/)
  if (!match) return null
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 两: 2 }
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  let total = 0
  let section = 0
  let current = 0
  for (const character of match[1]) {
    if (digits[character] !== undefined) {
      current = digits[character]
      continue
    }
    const unit = units[character]
    if (unit === 10000) {
      total += (section + current || 1) * unit
      section = 0
      current = 0
      continue
    }
    section += (current || 1) * unit
    current = 0
  }
  const result = total + section + current
  return result > 0 ? result : null
}

function formatBangumiEpisodeTitle(episode, includeEpisodePrefix = true, specialLabel = 'sp') {
  const title = normalizeScrapedField(episode?.name, 200)
  const sort = getBangumiEpisodeSort(episode)
  const isSpecial = getBangumiEpisodeType(episode) === 1
  const normalizedTitle = isSpecial && Number.isInteger(sort) && sort > 0 ? stripSpecialEpisodeLabel(title, sort) : title
  if (!includeEpisodePrefix || !title || !Number.isInteger(sort) || sort <= 0) return normalizedTitle
  if (isSpecial && hasSpecialEpisodePrefix(title, sort)) return title
  if (!isSpecial && hasEpisodeNumber(title, sort)) return normalizedTitle
  return `${isSpecial ? `#${specialLabel.toUpperCase()}` : '#'}${String(sort).padStart(2, '0')} ${normalizedTitle}`
}

function hasSpecialEpisodePrefix(title, episodeSort) {
  return new RegExp(`^#?\\s*(?:SP|OVA)\\s*0*${episodeSort}(?![0-9])`, 'i').test(String(title).replaceAll('＃', '#'))
}

function stripSpecialEpisodeLabel(title, episodeSort) {
  return (
    String(title)
      .replace(new RegExp(`^\\s*#?\\s*(?:SP|OVA|Special)\\s*[.．#＃-]?\\s*0*${episodeSort}(?![0-9])\\s*`, 'i'), '')
      .trim() || title
  )
}

function imageExtensionFromResponse(response, imageUrl) {
  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase()
  if (contentType.includes('png')) return '.png'
  if (contentType.includes('webp')) return '.webp'
  if (contentType.includes('gif')) return '.gif'
  if (contentType.includes('bmp')) return '.bmp'
  const sourceExtension = path.extname(new URL(imageUrl).pathname).toLowerCase()
  return imageExtensions.has(sourceExtension) ? sourceExtension : '.jpg'
}

function resolveScrapeFields(input, defaults) {
  const supplied = input?.fields
  if (!supplied || typeof supplied !== 'object') {
    const mode = ['cover', 'metadata', 'both'].includes(input?.mode) ? input.mode : 'metadata'
    return { cover: mode === 'cover' || mode === 'both', ...(mode === 'cover' ? {} : defaults) }
  }
  return {
    cover: supplied.cover === true,
    affiliation: normalizeScrapedField(supplied.affiliation, 200),
    originalTitle: normalizeScrapedField(supplied.originalTitle, 200),
    studio: normalizeScrapedField(supplied.studio, 200),
    firstAiredAt: normalizeScrapedField(supplied.firstAiredAt, 40),
    releaseDate: normalizeScrapedField(supplied.releaseDate, 40),
    note: normalizeScrapedField(supplied.note, 1200),
  }
}

function createScraperApplicationService({
  scraperAdapters,
  getConfigPaths,
  loadConfig,
  loadLibrary,
  saveLibrary,
  fetchWithNetwork,
  fetchBangumi = fetchWithNetwork,
  writeFileAtomically,
  appVersion,
  openExternal,
  bangumiTokenPageUrl,
  fileSystem = fs,
}) {
  if (
    !scraperAdapters ||
    typeof getConfigPaths !== 'function' ||
    typeof loadConfig !== 'function' ||
    typeof loadLibrary !== 'function' ||
    typeof saveLibrary !== 'function' ||
    typeof fetchWithNetwork !== 'function' ||
    typeof fetchBangumi !== 'function' ||
    typeof writeFileAtomically !== 'function' ||
    typeof openExternal !== 'function'
  )
    throw new Error('刮削应用服务依赖不可用')

  async function downloadPoster({ imageUrl, prefix, label, subjectId, referer = '', fetchWith = fetchWithNetwork }) {
    if (!imageUrl) return ''
    let response
    try {
      response = await fetchWith(imageUrl, {
        headers: { 'User-Agent': `${appVersion} (desktop media library)`, ...(referer ? { Referer: referer } : {}) },
      })
    } catch (error) {
      throw new Error(`无法下载 ${label} 封面：${error.message}`, { cause: error })
    }
    if (!response.ok) throw new Error(`下载 ${label} 封面失败（${response.status}）`)
    const contentType = String(response.headers.get('content-type') ?? '').toLowerCase()
    if (contentType && !contentType.startsWith('image/')) throw new Error(`${label} 返回的封面不是图片`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0 || buffer.length > 15 * 1024 * 1024) throw new Error(`${label} 封面大小无效`)
    const outputPath = path.join(
      getConfigPaths().coversDir,
      'posters',
      `${prefix}-${Number(subjectId)}${imageExtensionFromResponse(response, imageUrl)}`,
    )
    await fileSystem.mkdir(path.dirname(outputPath), { recursive: true })
    await writeFileAtomically(outputPath, buffer)
    return `url("${pathToFileURL(outputPath).toString()}") center / cover`
  }

  async function applyBangumiSubject(input) {
    const id = String(input?.id ?? '')
    const subjectId = Number(input?.subjectId)
    if (!id || !Number.isInteger(subjectId) || subjectId <= 0) throw new Error('Bangumi 条目无效')
    const [{ subject }, library] = await Promise.all([scraperAdapters.getBangumiSubject(subjectId), loadLibrary()])
    const selected = library.items.find((item) => item?.id === id)
    if (!selected || selected.kind !== 'video' || !isPosterLibrary(selected.library)) throw new Error('只能为番剧或里番合集刮削资料')
    const fields = resolveScrapeFields(input, makeBangumiScrapeFields(subject))
    const applyMetadata = Boolean(
      fields.affiliation || fields.originalTitle || fields.studio || fields.firstAiredAt || fields.releaseDate || fields.note,
    )
    const cover = fields.cover
      ? await downloadPoster({
          imageUrl: getBangumiImageUrl(subject),
          prefix: 'bangumi',
          label: 'Bangumi',
          subjectId,
          fetchWith: fetchBangumi,
        })
      : ''
    const affiliation = getItemAffiliation(selected)
    const chineseTitle = fields.affiliation ? normalizeScrapedFolderName(fields.affiliation, affiliation) : ''
    const originalTitle = fields.originalTitle
    const containerItems = library.items.filter(
      (item) => item?.kind === 'video' && item.library === selected.library && getItemAffiliation(item) === affiliation,
    )
    const storageFolder = originalTitle
      ? normalizeScrapedFolderName(originalTitle, getVideoStorageFolderName(selected), 'Bangumi 原名')
      : getVideoStorageFolderName(selected)
    const config = originalTitle ? await loadConfig() : null
    const renamedDirectory = originalTitle
      ? await renameVideoContainerDirectory(containerItems, selected, storageFolder, config, fileSystem)
      : null
    const items = library.items.map((item) => {
      if (item?.kind !== 'video' || item.library !== selected.library || getItemAffiliation(item) !== affiliation) return item
      const renamed = renamedDirectory?.pathByItemId.get(item.id)
      return {
        ...item,
        ...(cover ? { cover } : {}),
        ...(renamed ? { sourcePath: renamed.sourcePath, sidecars: renamed.sidecars } : {}),
        ...(applyMetadata
          ? {
              ...(chineseTitle ? { affiliation: chineseTitle } : {}),
              ...(fields.studio ? { studio: fields.studio } : {}),
              ...(fields.firstAiredAt ? { firstAiredAt: fields.firstAiredAt } : {}),
              ...(fields.releaseDate ? { releaseDate: fields.releaseDate } : {}),
              ...(fields.note ? { note: fields.note } : {}),
              ...(originalTitle ? { originalTitle } : {}),
            }
          : {}),
        ...(fields.cover || applyMetadata
          ? {
              scraperSource: 'Bangumi',
              scraperId: String(subjectId),
              scraperUrl: `https://bgm.tv/subject/${subjectId}`,
              bangumiId: String(subjectId),
              bangumiUrl: `https://bgm.tv/subject/${subjectId}`,
            }
          : {}),
      }
    })
    try {
      const saved = await saveLibrary({ items, operations: library.operations }, { backupExisting: false })
      return {
        ...saved,
        item: saved.data.items.find((item) => item.id === id),
        subject: {
          id: subjectId,
          name: String(subject?.name ?? ''),
          nameCn: String(subject?.name_cn ?? ''),
          date: fields.firstAiredAt,
          summary: fields.note,
        },
      }
    } catch (error) {
      if (renamedDirectory) await fileSystem.rename(renamedDirectory.newDirectory, renamedDirectory.oldDirectory).catch(() => {})
      throw error
    }
  }

  async function assignBangumiEpisodes(input) {
    const id = String(input?.id ?? '')
    const subjectId = Number(input?.subjectId)
    if (!id || !Number.isInteger(subjectId) || subjectId <= 0) throw new Error('Bangumi 条目无效')
    const [episodes, library] = await Promise.all([scraperAdapters.getBangumiEpisodes(subjectId), loadLibrary()])
    const selected = library.items.find((item) => item?.id === id)
    if (!selected || selected.kind !== 'video' || !isPosterLibrary(selected.library)) throw new Error('只能为番剧或里番合集分配章节')
    const affiliation = getItemAffiliation(selected)
    const containerItems = library.items.filter(
      (item) => item?.kind === 'video' && item.library === selected.library && getItemAffiliation(item) === affiliation,
    )
    const regularEpisodes = episodes.filter((episode) => episode.type === 0 && episode.ep > 0)
    const specialEpisodes = episodes.filter((episode) => episode.type === 1 && getBangumiEpisodeSort(episode))
    const episodesByNumber = new Map(regularEpisodes.map((episode) => [episode.ep, episode]))
    const specialEpisodesByNumber = new Map(specialEpisodes.map((episode) => [getBangumiEpisodeSort(episode), episode]))
    const singleEpisode = containerItems.length === 1 && regularEpisodes.length === 1 ? regularEpisodes[0] : null
    let assignedCount = 0
    const items = library.items.map((item) => {
      if (item?.kind !== 'video' || item.library !== selected.library || getItemAffiliation(item) !== affiliation) return item
      const reference = getLocalEpisodeReference(item)
      const matchedEpisode =
        reference.category === 'special'
          ? reference.number === null
            ? null
            : specialEpisodesByNumber.get(reference.number)
          : (singleEpisode ?? episodesByNumber.get(reference.number))
      if (!matchedEpisode) {
        if (reference.category !== 'special') return item
        const { bangumiEpisodeId, bangumiEpisodeUrl, bangumiEpisodeSort, bangumiEpisodeType, bangumiEpisodeLabel, ...unassigned } = item
        return bangumiEpisodeId || bangumiEpisodeUrl || bangumiEpisodeSort || bangumiEpisodeType !== undefined || bangumiEpisodeLabel
          ? unassigned
          : item
      }
      const bangumiEpisodeSort = getBangumiEpisodeSort(matchedEpisode)
      if (
        item.bangumiEpisodeId === String(matchedEpisode.id) &&
        item.bangumiEpisodeUrl === matchedEpisode.url &&
        item.bangumiEpisodeSort === bangumiEpisodeSort
      )
        return item
      assignedCount += 1
      return {
        ...item,
        bangumiEpisodeId: String(matchedEpisode.id),
        bangumiEpisodeUrl: matchedEpisode.url,
        bangumiEpisodeSort,
        bangumiEpisodeType: getBangumiEpisodeType(matchedEpisode),
        ...(reference.category === 'special' && reference.label ? { bangumiEpisodeLabel: reference.label } : {}),
      }
    })
    const saved = await saveLibrary({ items, operations: library.operations }, { backupExisting: false })
    return { ...saved, assignedCount }
  }

  async function applyHanimeSubject(input) {
    const id = String(input?.id ?? '')
    const subjectId = Number(input?.subjectId)
    const source = input?.source === 'hanime1' ? 'hanime1' : 'freeanimehentai'
    const sourceLabel = source === 'hanime1' ? 'Hanime1' : 'FreeAnimeHentai'
    if (!id || !Number.isInteger(subjectId) || subjectId <= 0) throw new Error(`${sourceLabel} 条目无效`)
    const [config, library, subject] = await Promise.all([loadConfig(), loadLibrary(), scraperAdapters.getHanimeSubject(subjectId, source)])
    const selected = library.items.find((item) => item?.id === id)
    if (!selected || selected.kind !== 'video' || selected.library !== 'erAnime') throw new Error(`${sourceLabel} 资料只能应用到里番合集`)
    if (!subject) throw new Error(`${sourceLabel} 条目不存在，请重新搜索`)
    const normalizedSubject = source === 'hanime1' ? subject : toFreeAnimeHentaiSubject(subject)
    const fields = resolveScrapeFields(input, makeHanimeScrapeFields(normalizedSubject))
    const applyMetadata = Boolean(
      fields.affiliation || fields.originalTitle || fields.studio || fields.firstAiredAt || fields.releaseDate || fields.note,
    )
    const cover = fields.cover
      ? await downloadPoster({
          imageUrl: String(subject?.cover_url ?? subject?.image ?? '').trim(),
          prefix: source === 'hanime1' ? 'hanime1' : 'freeanimehentai',
          label: sourceLabel,
          subjectId,
          referer: source === 'hanime1' ? getHanime1Root(config.scraping.hanime1Endpoint) : 'https://hanime.tv/',
        })
      : ''
    const affiliation = getItemAffiliation(selected)
    const nextAffiliation = fields.affiliation ? normalizeScrapedFolderName(fields.affiliation, affiliation) : affiliation
    const originalTitle = fields.originalTitle
    const containerItems = library.items.filter(
      (item) => item?.kind === 'video' && item.library === selected.library && getItemAffiliation(item) === affiliation,
    )
    const storageFolder = originalTitle
      ? normalizeScrapedFolderName(originalTitle, getVideoStorageFolderName(selected), `${sourceLabel} 原名`)
      : getVideoStorageFolderName(selected)
    const renamedDirectory = originalTitle
      ? await renameVideoContainerDirectory(containerItems, selected, storageFolder, config, fileSystem)
      : null
    const items = library.items.map((item) => {
      if (item?.kind !== 'video' || item.library !== selected.library || getItemAffiliation(item) !== affiliation) return item
      const renamed = renamedDirectory?.pathByItemId.get(item.id)
      return {
        ...item,
        ...(cover ? { cover } : {}),
        ...(renamed ? { sourcePath: renamed.sourcePath, sidecars: renamed.sidecars } : {}),
        ...(applyMetadata
          ? {
              ...(fields.affiliation ? { affiliation: nextAffiliation } : {}),
              ...(fields.firstAiredAt ? { firstAiredAt: fields.firstAiredAt } : {}),
              ...(fields.releaseDate ? { releaseDate: fields.releaseDate } : {}),
              ...(fields.note ? { note: fields.note } : {}),
              ...(originalTitle ? { originalTitle } : {}),
              ...(fields.studio ? { studio: fields.studio } : {}),
            }
          : {}),
        ...(fields.cover || applyMetadata
          ? {
              scraperSource: source === 'hanime1' ? 'Hanime1' : 'FreeAnimeHentai',
              scraperId: String(subjectId),
              scraperUrl: String(normalizedSubject.url),
              ...(source === 'hanime1'
                ? { hanime1Id: String(subjectId), hanime1Url: String(normalizedSubject.url) }
                : { freeAnimeHentaiId: String(subjectId), freeAnimeHentaiUrl: String(normalizedSubject.url) }),
            }
          : {}),
      }
    })
    try {
      const saved = await saveLibrary({ items, operations: library.operations }, { backupExisting: false })
      return { ...saved, item: saved.data.items.find((item) => item.id === id), subject: { ...normalizedSubject } }
    } catch (error) {
      if (renamedDirectory) await fileSystem.rename(renamedDirectory.newDirectory, renamedDirectory.oldDirectory).catch(() => {})
      throw error
    }
  }

  async function applyBangumiEpisode(input) {
    const id = String(input?.id ?? '')
    const episodeId = Number(input?.episodeId)
    if (!id || !Number.isInteger(episodeId) || episodeId <= 0) throw new Error('Bangumi 单集无效')
    const [episode, library] = await Promise.all([scraperAdapters.getBangumiEpisode(episodeId), loadLibrary()])
    const index = library.items.findIndex((item) => item?.id === id && item.kind === 'video')
    if (!episode || index < 0) throw new Error('Bangumi 单集不存在，或视频记录已移除')
    const selected = library.items[index]
    const specialLabel = getLocalEpisodeReference(selected).category === 'special' ? getLocalEpisodeReference(selected).label || 'sp' : 'sp'
    const isMultiEpisodeContainer =
      library.items.filter(
        (item) => item?.kind === 'video' && item.library === selected.library && getItemAffiliation(item) === getItemAffiliation(selected),
      ).length > 1
    const items = [...library.items]
    items[index] = {
      ...items[index],
      bangumiEpisodeId: String(episode.id),
      bangumiEpisodeUrl: episode.url,
      bangumiEpisodeSort: getBangumiEpisodeSort(episode),
      bangumiEpisodeType: getBangumiEpisodeType(episode),
      ...(getBangumiEpisodeType(episode) === 1 ? { bangumiEpisodeLabel: specialLabel } : {}),
      episodeTitle: formatBangumiEpisodeTitle(episode, isMultiEpisodeContainer, specialLabel),
      episodeTitleSource: 'bangumi',
      episodeAiredAt: episode.airdate,
      episodeNote: episode.summary,
    }
    const saved = await saveLibrary({ items, operations: library.operations }, { backupExisting: false })
    return { ...saved, item: saved.data.items[index], episode }
  }

  async function openExternalUrl(input) {
    const url = String(input?.url ?? '').trim()
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('来源网页地址无效')
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('来源网页地址无效')
    const error = await openExternal(parsed.toString())
    if (error) throw new Error(error)
    return { url: parsed.toString() }
  }

  async function openBangumiTokenPage() {
    const error = await openExternal(bangumiTokenPageUrl)
    if (error) throw new Error(error)
    return { url: bangumiTokenPageUrl }
  }

  return {
    applyBangumiSubject,
    assignBangumiEpisodes,
    applyBangumiEpisode,
    applyHanimeSubject,
    openBangumiTokenPage,
    openExternalUrl,
    previewBangumiSubject: (input) => scraperAdapters.previewBangumiSubject(input),
    previewHanimeSubject: (input) => scraperAdapters.previewHanimeSubject(input),
    searchBangumiSubjects: (input) => scraperAdapters.searchBangumiSubjects(input),
    searchHanimeSubjects: (input) => scraperAdapters.searchHanimeSubjects(input),
    verifyBangumiToken: () => scraperAdapters.verifyBangumiToken(),
  }
}

module.exports = {
  createScraperApplicationService,
  formatBangumiEpisodeTitle,
  getBangumiEpisodeSort,
  getBangumiEpisodeType,
  imageExtensionFromResponse,
  normalizeScrapedFolderName,
  resolveScrapeFields,
}
