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
    const result = left.title.localeCompare(right.title, 'zh-CN', { numeric: true })
    return sortDirection === 'ascending' ? result : -result
  }

  const leftValue = String(sortMode === 'firstAired' ? left.firstAiredAt : (left.releaseDate ?? left.year ?? '')).trim()
  const rightValue = String(sortMode === 'firstAired' ? right.firstAiredAt : (right.releaseDate ?? right.year ?? '')).trim()
  if (!leftValue && rightValue) return 1
  if (leftValue && !rightValue) return -1
  const dateResult = leftValue.localeCompare(rightValue)
  if (dateResult !== 0) return sortDirection === 'ascending' ? dateResult : -dateResult
  const titleResult = left.title.localeCompare(right.title, 'zh-CN', { numeric: true })
  return sortDirection === 'ascending' ? titleResult : -titleResult
}

export function getMediaAffiliation(item: MediaItem) {
  return item.affiliation?.trim() || item.grouping || '未归入合集'
}

export function getMediaEpisodeName(item: MediaItem) {
  return item.episode?.trim() || item.title
}

export function getMediaEpisode(item: MediaItem) {
  const episodeTitle = item.episodeTitle?.trim()
  return episodeTitle || getMediaEpisodeName(item)
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
  return getMediaEpisodeName(left).localeCompare(getMediaEpisodeName(right), 'zh-CN', { numeric: true })
}

export function getMediaShelf(item: MediaItem) {
  return item.shelf?.trim() || '未放入书架'
}

export function getEpisodeCover(item: MediaItem) {
  return item.kind === 'video' && (item.library === 'erAnime' || item.library === 'anime') ? item.episodeCover || item.cover : item.cover
}
