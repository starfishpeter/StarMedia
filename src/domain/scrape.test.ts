import { describe, expect, it } from 'vitest'
import { createAllScrapeFields } from './scrape'

describe('createAllScrapeFields', () => {
  it('writes every available field without clearing values missing from the selected source', () => {
    const fields = createAllScrapeFields(
      {
        source: 'hanime1',
        subjectId: 42,
        title: '日本語タイトル',
        chineseTitle: '中文标题',
        coverUrl: 'https://example.test/cover.jpg',
        studio: '',
        firstAiredAt: '2026-07-17',
        releaseDate: '',
        note: '简介',
        url: 'https://example.test/item',
      },
      {
        cover: true,
        affiliation: '中文标题',
        originalTitle: '日本語タイトル',
        studio: '',
        firstAiredAt: '2026-07-17',
        releaseDate: '',
        note: '简介',
      },
    )

    expect(fields).toEqual({
      cover: true,
      affiliation: '中文标题',
      originalTitle: '日本語タイトル',
      firstAiredAt: '2026-07-17',
      note: '简介',
    })
    expect(fields).not.toHaveProperty('studio')
    expect(fields).not.toHaveProperty('releaseDate')
  })
})
