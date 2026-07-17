import { describe, expect, it } from 'vitest'
import type { MediaItem } from '../data'
import { getHomeVideoCollections, pickRandomHomeItems } from './home'

const items = Array.from({ length: 12 }, (_, index): MediaItem => ({
  id: `video:${index}`,
  library: 'anime',
  title: `Episode ${index}`,
  grouping: 'Series',
  tags: [],
  addedAt: '2026-01-01',
  duration: '24:00',
  kind: 'video',
  cover: '',
  note: '',
}))

describe('home random shelves', () => {
  it('returns a stable limited selection without mutating the library items', () => {
    const originalOrder = items.map((item) => item.id)
    const first = pickRandomHomeItems(items, 'session:anime:0', 8)
    const repeated = pickRandomHomeItems(items, 'session:anime:0', 8)

    expect(first).toHaveLength(8)
    expect(repeated.map((item) => item.id)).toEqual(first.map((item) => item.id))
    expect(items.map((item) => item.id)).toEqual(originalOrder)
  })

  it('returns all available items when a library contains fewer than the shelf limit', () => {
    expect(pickRandomHomeItems(items.slice(0, 3), 'session:anime:0')).toHaveLength(3)
    expect(pickRandomHomeItems(items, 'session:anime:0', 0)).toEqual([])
  })

  it('groups video episodes by collection before random home selection', () => {
    const collections = getHomeVideoCollections([
      { ...items[0], id: 'episode:2', affiliation: 'Series A', episode: '第 2 话' },
      { ...items[1], id: 'episode:1', affiliation: 'Series A', episode: '第 1 话' },
      { ...items[2], id: 'episode:3', affiliation: 'Series B', episode: '第 1 话' },
    ])

    expect(collections).toHaveLength(2)
    expect(collections.find((collection) => collection.name === 'Series A')?.items).toHaveLength(2)
    expect(collections.find((collection) => collection.name === 'Series A')?.coverItem.id).toBe('episode:1')
  })
})
