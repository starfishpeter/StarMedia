import { describe, expect, it } from 'vitest'
import {
  compareMediaEpisodes,
  compareMediaItems,
  compareMediaNames,
  formatBangumiEpisodeTitle,
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
    expect(getMediaAffiliation(createItem({ affiliation: '  新合集  ' }))).toBe('新合集')
    expect(getMediaAffiliation(createItem())).toBe('未归入合集')
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

  it('uses Bangumi episode sorting while formatting unnumbered titles for file renaming', () => {
    const first = createItem({ id: 'first', episode: 'Z local name', episodeTitle: 'Unnumbered Bangumi title', bangumiEpisodeSort: 1 })
    const second = createItem({ id: 'second', episode: 'A local name', episodeTitle: 'Another title', bangumiEpisodeSort: 2 })

    expect([second, first].sort(compareMediaEpisodes).map((item) => item.id)).toEqual(['first', 'second'])
    expect(formatBangumiEpisodeTitle(first)).toBe('#01 Unnumbered Bangumi title')
    expect(formatBangumiEpisodeTitle(first, false)).toBe('Unnumbered Bangumi title')
    expect(formatBangumiEpisodeTitle(createItem({ episodeTitle: '#02 Already numbered', bangumiEpisodeSort: 2 }))).toBe(
      '#02 Already numbered',
    )
    expect(formatBangumiEpisodeTitle(createItem({ episodeTitle: '03 Already numbered', bangumiEpisodeSort: 3 }))).toBe(
      '03 Already numbered',
    )
    expect(formatBangumiEpisodeTitle(createItem({ episodeTitle: '一甘', bangumiEpisodeSort: 1 }))).toBe('一甘')
    expect(formatBangumiEpisodeTitle(createItem({ episodeTitle: '二つのキャンプ', bangumiEpisodeSort: 5 }))).toBe('#05 二つのキャンプ')
    expect(formatBangumiEpisodeTitle(createItem({ episode: 'Other', episodeTitle: 'Kiss Hug 02', bangumiEpisodeSort: 2 }))).toBe(
      'Kiss Hug 02',
    )
    expect(formatBangumiEpisodeTitle(createItem({ episodeTitle: '＃１妹D王様', bangumiEpisodeSort: 1 }))).toBe('＃１妹D王様')
    expect(formatBangumiEpisodeTitle(createItem({ episode: '#01 手动名称', episodeTitle: '#01 手动名称', bangumiEpisodeSort: 1 }))).toBe(
      '#01 手动名称',
    )
    expect(
      formatBangumiEpisodeTitle(
        createItem({ episode: 'Bangumi title', episodeTitle: 'Bangumi title', episodeTitleSource: 'bangumi', bangumiEpisodeSort: 5 }),
      ),
    ).toBe('#05 Bangumi title')
    expect(
      formatBangumiEpisodeTitle(
        createItem({ episode: 'Manual title', episodeTitle: 'Manual title', episodeTitleSource: 'manual', bangumiEpisodeSort: 5 }),
      ),
    ).toBe('Manual title')
    expect(
      formatBangumiEpisodeTitle(createItem({ episodeTitle: 'SP.1 ミステリーキャンプ', bangumiEpisodeSort: 1, bangumiEpisodeType: 1 })),
    ).toBe('#SP01 ミステリーキャンプ')
    expect(
      formatBangumiEpisodeTitle(
        createItem({ episodeTitle: '#OVA02 あめキャン△', bangumiEpisodeSort: 2, bangumiEpisodeType: 1, bangumiEpisodeLabel: 'ova' }),
      ),
    ).toBe('#OVA02 あめキャン△')
  })

  it('sorts dates with missing values last', () => {
    const dated = createItem({ id: 'dated', title: 'B', releaseDate: '2025-01-01' })
    const undated = createItem({ id: 'undated', title: 'A' })
    expect(
      [undated, dated].sort((left, right) => compareMediaItems(left, right, 'releaseDate', 'ascending')).map((item) => item.id),
    ).toEqual(['dated', 'undated'])
  })

  it('orders names by any leading Chinese number regardless of the following text', () => {
    expect(['露营 第十季', '露营 第二季', '露营 第一季', '露营 第三季'].sort(compareMediaNames)).toEqual([
      '露营 第一季',
      '露营 第二季',
      '露营 第三季',
      '露营 第十季',
    ])
    expect(['二席', '三任意文字', '一甘'].sort(compareMediaNames)).toEqual(['一甘', '二席', '三任意文字'])
    expect(['二つのキャンプ', '三つのキャンプ', '一つのキャンプ'].sort(compareMediaNames)).toEqual([
      '一つのキャンプ',
      '二つのキャンプ',
      '三つのキャンプ',
    ])
  })
})
