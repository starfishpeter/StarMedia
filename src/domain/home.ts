import type { MediaItem } from '../data'
import { compareMediaEpisodes, getMediaAffiliation } from './media'

export interface HomeVideoCollection {
  id: string
  name: string
  items: MediaItem[]
  coverItem: MediaItem
}

function hashText(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function pickRandomHomeItems<T extends { id: string }>(items: T[], seed: string, limit = 8) {
  if (limit <= 0 || items.length === 0) return []
  return [...items]
    .sort((left, right) => {
      const scoreDifference = hashText(`${seed}:${left.id}`) - hashText(`${seed}:${right.id}`)
      return scoreDifference || left.id.localeCompare(right.id)
    })
    .slice(0, limit)
}

export function getHomeVideoCollections(items: MediaItem[]): HomeVideoCollection[] {
  const groups = new Map<string, MediaItem[]>()
  for (const item of items) {
    if (item.kind !== 'video') continue
    const name = getMediaAffiliation(item)
    const group = groups.get(name) ?? []
    group.push(item)
    groups.set(name, group)
  }
  return [...groups.entries()].map(([name, collectionItems]) => ({
    id: `${collectionItems[0].library}:${name}`,
    name,
    items: collectionItems,
    coverItem: [...collectionItems].sort(compareMediaEpisodes)[0],
  }))
}
