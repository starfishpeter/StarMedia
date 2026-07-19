import { describe, expect, it } from 'vitest'
import {
  compareMediaEpisodes,
  compareMediaItems,
  getEpisodeSortNumber,
  getMediaAffiliation,
  getMediaEpisode,
  getMediaShelf,
  isArchiveLibrary,
  parseChineseEpisodeNumber,
} from './media'
import type { MediaItem } from '../data'

function createItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'item-1',
    library: 'anime',
    title: '第 1 话',
    grouping: '',
    tags: [],
    addedAt: '2026-01-01',
    duration: 'MP4',
    kind: 'video',
    cover: '',
    note: '',
    ...overrides,
  }
}

describe('media domain rules', () => {
  it('identifies archive libraries without classifying video libraries as archives', () => {
    expect(isArchiveLibrary('books')).toBe(true)
    expect(isArchiveLibrary('comics')).toBe(true)
    expect(isArchiveLibrary('anime')).toBe(false)
  })

  it('uses the established affiliation and shelf fallbacks', () => {
    expect(getMediaAffiliation(createItem({ grouping: '旧合集' }))).toBe('旧合集')
    expect(getMediaAffiliation(createItem({ affiliation: '  新合集  ' }))).toBe('新合集')
    expect(getMediaShelf(createItem())).toBe('未放入书架')
    expect(getMediaShelf(createItem({ shelf: '  待读  ' }))).toBe('待读')
  })

  it('parses and orders Arabic and Chinese episode numbers', () => {
    expect(parseChineseEpisodeNumber('第十二')).toBe(12)
    expect(parseChineseEpisodeNumber('一百零二')).toBe(102)
    expect(parseChineseEpisodeNumber('十万')).toBe(100000)
    expect(getEpisodeSortNumber(createItem({ episode: '第 12 话' }))).toBe(12)
    expect(getEpisodeSortNumber(createItem({ episode: '第十二话' }))).toBe(12)
    expect(getEpisodeSortNumber(createItem({ episode: '#01' }))).toBe(1)

    const episodes = [
      createItem({ id: 'third', episode: '第 3 话' }),
      createItem({ id: 'first', episode: '第 一 话' }),
      createItem({ id: 'second', episode: '第 2 话' }),
    ]
    expect(episodes.sort(compareMediaEpisodes).map((item) => item.id)).toEqual(['first', 'second', 'third'])
  })

  it('prefers a scraped episode title for display while retaining the local episode name for sorting', () => {
    const item = createItem({ episode: '#01', episodeTitle: 'Bangumi 原始标题' })

    expect(getMediaEpisode(item)).toBe('Bangumi 原始标题')
    expect(getEpisodeSortNumber(item)).toBe(1)
  })

  it('sorts dates with missing values last', () => {
    const dated = createItem({ id: 'dated', title: 'B', releaseDate: '2025-01-01' })
    const undated = createItem({ id: 'undated', title: 'A' })
    expect(
      [undated, dated].sort((left, right) => compareMediaItems(left, right, 'releaseDate', 'ascending')).map((item) => item.id),
    ).toEqual(['dated', 'undated'])
  })
})
