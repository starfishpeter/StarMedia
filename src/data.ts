import type { LucideIcon } from 'lucide-react'
import { BookOpen, Clapperboard, MonitorPlay, Sparkles, Tv } from 'lucide-react'

export type LibraryId = 'erAnime' | 'anime' | 'creator' | 'books' | 'comics' | 'general'
export type NavigationId = LibraryId
export type MediaKind = 'video' | 'book'

export interface LibraryDefinition {
  id: LibraryId
  label: string
  description: string
  icon: LucideIcon
  color: string
}

export interface MediaItem {
  id: string
  library: LibraryId
  title: string
  grouping: string
  affiliation?: string
  shelf?: string
  episode?: string
  tags: string[]
  year?: number
  addedAt: string
  duration: string
  kind: MediaKind
  cover: string
  episodeCover?: string
  note: string
  sourcePath?: string
  relativePath?: string
  size?: number
  importedAt?: string
  originalSourcePath?: string
  durationSeconds?: number
  releaseDate?: string
  firstAiredAt?: string
  creator?: string
  studio?: string
  originalTitle?: string
  scraperSource?: 'Bangumi' | 'FreeAnimeHentai' | 'Hanime1'
  scraperId?: string
  scraperUrl?: string
  bangumiId?: string
  bangumiUrl?: string
  freeAnimeHentaiId?: string
  freeAnimeHentaiUrl?: string
  hanime1Id?: string
  hanime1Url?: string
  sidecars?: Array<{
    fileName: string
    sourcePath: string
    originalSourcePath?: string
    extension: string
    size: number
  }>
}

export const libraries: LibraryDefinition[] = [
  { id: 'erAnime', label: '里番', description: '按合集浏览视频作品', icon: Clapperboard, color: '#db4f87' },
  { id: 'anime', label: '番剧', description: '按合集浏览视频作品', icon: Tv, color: '#6f8df7' },
  { id: 'creator', label: '原创', description: '以创作者为合集浏览作品', icon: Sparkles, color: '#d69745' },
  { id: 'general', label: '综合', description: '按合集浏览视频作品', icon: MonitorPlay, color: '#37a894' },
  { id: 'books', label: '本子', description: '按书架浏览并直接阅读压缩包', icon: BookOpen, color: '#9b66df' },
  { id: 'comics', label: '漫画', description: '按书架浏览并直接阅读压缩包', icon: BookOpen, color: '#4e9bdb' },
]

export const libraryById = Object.fromEntries(libraries.map((library) => [library.id, library])) as Record<LibraryId, LibraryDefinition>
