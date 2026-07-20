import type { LibraryId, MediaItem } from '../data'

export type SortMode = 'title' | 'releaseDate' | 'firstAired'
export type SortDirection = 'ascending' | 'descending'

const archiveLibraryIds = new Set<LibraryId>(['books', 'comics'])

const chineseEpisodeDigits: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

const chineseEpisodeUnits: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
  万: 10000,
}

const titleCollator = new Intl.Collator('zh-CN', { numeric: true })
const leadingChineseNumberPattern = /^(?:第\s*)?([零〇一二三四五六七八九十百千万两]+)/u
const embeddedChineseOrdinalPattern = /第\s*([零〇一二三四五六七八九十百千万两]+)\s*([季部卷篇话集期章回幕])/u

export function isArchiveLibrary(libraryId: LibraryId) {
  return archiveLibraryIds.has(libraryId)
}

export function getSortOptions(libraryId: LibraryId | null) {
  if (libraryId === 'erAnime' || libraryId === 'anime')
    return [
      { value: 'title' as const, label: '标题' },
      { value: 'firstAired' as const, label: '第一话首播日期' },
    ]
  if (libraryId === 'creator' || (libraryId !== null && isArchiveLibrary(libraryId)))
    return [
      { value: 'title' as const, label: '标题' },
      { value: 'releaseDate' as const, label: '发行日期' },
    ]
  return [{ value: 'title' as const, label: '标题' }]
}

export function compareMediaItems(left: MediaItem, right: MediaItem, sortMode: SortMode, sortDirection: SortDirection) {
  if (sortMode === 'title') {
    const result = compareMediaNames(left.title, right.title)
    return sortDirection === 'ascending' ? result : -result
  }

  const leftValue = String(sortMode === 'firstAired' ? left.firstAiredAt : (left.releaseDate ?? left.year ?? '')).trim()
  const rightValue = String(sortMode === 'firstAired' ? right.firstAiredAt : (right.releaseDate ?? right.year ?? '')).trim()
  if (!leftValue && rightValue) return 1
  if (leftValue && !rightValue) return -1
  const dateResult = leftValue.localeCompare(rightValue)
  if (dateResult !== 0) return sortDirection === 'ascending' ? dateResult : -dateResult
  const titleResult = compareMediaNames(left.title, right.title)
  return sortDirection === 'ascending' ? titleResult : -titleResult
}

export function compareMediaNames(left: string, right: string) {
  const leftNumber = getLeadingChineseNumber(left)
  const rightNumber = getLeadingChineseNumber(right)
  if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) return leftNumber - rightNumber
  const leftOrdinal = getEmbeddedChineseOrdinal(left)
  const rightOrdinal = getEmbeddedChineseOrdinal(right)
  if (
    leftOrdinal &&
    rightOrdinal &&
    leftOrdinal.prefix === rightOrdinal.prefix &&
    leftOrdinal.unit === rightOrdinal.unit &&
    leftOrdinal.value !== rightOrdinal.value
  )
    return leftOrdinal.value - rightOrdinal.value
  return titleCollator.compare(left, right)
}

function getLeadingChineseNumber(title: string) {
  const match = title.match(leadingChineseNumberPattern)
  return match ? parseChineseEpisodeNumber(match[1]) : null
}

function getEmbeddedChineseOrdinal(title: string) {
  const match = title.match(embeddedChineseOrdinalPattern)
  if (!match || match.index === undefined) return null
  const value = parseChineseEpisodeNumber(match[1])
  if (value === null) return null
  return { prefix: title.slice(0, match.index), unit: match[2], value }
}

export function getMediaAffiliation(item: MediaItem) {
  return item.affiliation?.trim() || '未归入合集'
}

export function getMediaEpisodeName(item: MediaItem) {
  return item.episode?.trim() || item.title
}

export function getMediaEpisode(item: MediaItem, includeEpisodePrefix = true) {
  const episodeTitle = formatBangumiEpisodeTitle(item, includeEpisodePrefix)
  return episodeTitle || getMediaEpisodeName(item)
}

export function formatBangumiEpisodeTitle(item: MediaItem, includeEpisodePrefix = true) {
  const title = item.episodeTitle?.trim()
  if (!title) return ''
  if (item.episodeTitleSource === 'manual') return title
  if (title === getMediaEpisodeName(item) && item.episodeTitleSource !== 'bangumi') return title
  const sort = item.bangumiEpisodeSort
  const episodeSort = typeof sort === 'number' && Number.isInteger(sort) && sort > 0 ? sort : null
  const isSpecial = item.bangumiEpisodeType === 1
  const specialLabel = item.bangumiEpisodeLabel === 'ova' ? 'OVA' : 'SP'
  const automaticPrefix =
    episodeSort === null
      ? ''
      : isSpecial
        ? `#${specialLabel}${String(episodeSort).padStart(2, '0')} `
        : `#${String(episodeSort).padStart(2, '0')} `
  const normalizedTitle = isSpecial && episodeSort !== null ? stripSpecialEpisodeLabel(title, episodeSort) : title
  if (!includeEpisodePrefix || episodeSort === null) return normalizedTitle
  if (isSpecial && hasSpecialEpisodePrefix(title, episodeSort)) return title
  if (!isSpecial && hasEpisodeNumber(title, episodeSort)) return normalizedTitle
  return `${automaticPrefix}${normalizedTitle}`
}

function hasEpisodeNumber(title: string, episodeSort: number | null) {
  if (episodeSort === null) return false
  const normalized = title.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xff10 + 0x30)).replaceAll('＃', '#')
  if (new RegExp(`(?:^|[^A-Za-z0-9])#?\\s*0*${episodeSort}(?![0-9])`, 'i').test(normalized)) return true
  return parseLeadingChineseEpisodeNumber(normalized) === episodeSort
}

function parseLeadingChineseEpisodeNumber(title: string) {
  const match = title.match(/^第?\s*([零〇一二三四五六七八九十百千万两]+)/)
  return match ? parseChineseEpisodeNumber(match[1]) : null
}

function hasSpecialEpisodePrefix(title: string, episodeSort: number) {
  return new RegExp(`^#?\\s*(?:SP|OVA)\\s*0*${episodeSort}(?![0-9])`, 'i').test(title.replaceAll('＃', '#'))
}

function stripSpecialEpisodeLabel(title: string, episodeSort: number) {
  return title.replace(new RegExp(`^\\s*#?\\s*(?:SP|OVA|Special)\\s*[.．#＃-]?\\s*0*${episodeSort}(?![0-9])\\s*`, 'i'), '').trim() || title
}

export function parseChineseEpisodeNumber(value: string) {
  const characters = value.match(/[零〇一二三四五六七八九十百千万两]/g)
  if (!characters) return null

  let total = 0
  let section = 0
  let current = 0
  for (const character of characters) {
    const digit = chineseEpisodeDigits[character]
    if (digit !== undefined) {
      current = digit
      continue
    }

    const unit = chineseEpisodeUnits[character]
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

export function getEpisodeSortNumber(item: MediaItem) {
  if (Number.isInteger(item.bangumiEpisodeSort) && item.bangumiEpisodeSort! > 0) return item.bangumiEpisodeSort!
  const text = getMediaEpisodeName(item).trim()
  const hashMatch = text.match(/^#\s*0*(\d{1,3})$/)
  if (hashMatch) return Number(hashMatch[1])
  const arabicMatch = text.match(/(?:第\s*)?(\d{1,3})\s*(?:话|集|話|話目|episode|ep\b)/i)
  if (arabicMatch) return Number(arabicMatch[1])
  const chineseMatch = text.match(/([零〇一二三四五六七八九十百千万两]+)\s*(?:话|集|話|話目|甘)/)
  return chineseMatch ? parseChineseEpisodeNumber(chineseMatch[1]) : null
}

export function compareMediaEpisodes(left: MediaItem, right: MediaItem) {
  const leftNumber = getEpisodeSortNumber(left)
  const rightNumber = getEpisodeSortNumber(right)
  if (leftNumber !== null && rightNumber === null) return -1
  if (leftNumber === null && rightNumber !== null) return 1
  if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) return leftNumber - rightNumber
  return compareMediaNames(getMediaEpisodeName(left), getMediaEpisodeName(right))
}

export function getMediaShelf(item: MediaItem) {
  return item.shelf?.trim() || '未放入书架'
}

export function getEpisodeCover(item: MediaItem) {
  return item.kind === 'video' && (item.library === 'erAnime' || item.library === 'anime') ? item.episodeCover || item.cover : item.cover
}
