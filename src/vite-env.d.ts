/// <reference types="vite/client" />

type StarMediaConfigLibraryId = 'erAnime' | 'anime' | 'creator' | 'books' | 'comics' | 'general'
type StarMediaTheme = 'dark' | 'light' | 'blue'

interface StarMediaClassification {
  id: string
  name: string
  tags: string[]
  libraryIds: StarMediaConfigLibraryId[]
}

interface StarMediaCatalog {
  tags: string[]
  classifications: StarMediaClassification[]
  studios: string[]
  creators: string[]
}

interface StarMediaLibraryConfig {
  rootPath: string
  enabled: boolean
}

interface StarMediaConfig {
  schemaVersion: 3
  updatedAt: string
  mediaRoot: string
  theme: StarMediaTheme
  cacheLimitMb: number
  confirmBeforeClose: boolean
  network: {
    proxyEnabled: boolean
    proxyUrl: string
  }
  scraping: {
    bangumiToken: string
    bangumiEndpoint: string
    hanime1Endpoint: string
  }
  libraries: Record<StarMediaConfigLibraryId, StarMediaLibraryConfig>
  catalog: StarMediaCatalog
}

interface StarMediaConfigResult {
  config: StarMediaConfig
  appVersion?: string
  configPath: string
  libraryPath: string
  backupDir: string
  dataRoot: string
  cacheDir: string
  coversDir: string
}

interface StarMediaLibraryResult {
  data: {
    items: import('./data').MediaItem[]
    operations?: StarMediaOperation[]
  }
  libraryPath: string
}

interface StarMediaOperation {
  id: string
  type: 'import-move' | 'import-batch' | string
  status: string
  library?: StarMediaConfigLibraryId
  itemId?: string
  createdAt: string
  undoneAt?: string
  importedCount?: number
  skippedCount?: number
  results?: StarMediaImportResultItem[]
}

interface StarMediaVideoPlayback {
  url: string
  mimeType: string
  title: string
  subtitles: Array<{ url: string; label: string }>
}

interface StarMediaExternalOpenResult {
  ok: boolean
  error?: string
}

interface StarMediaBangumiSubject {
  id: number
  name: string
  nameCn: string
  date: string
  image?: string
  summary?: string
}

interface StarMediaHanimeSubject {
  id: number
  name: string
  searchTitles: string
  date: string
  image?: string
  description?: string
  brand?: string
  slug: string
  url: string
  source: 'freeanimehentai' | 'hanime1'
  tags?: string[]
  durationSeconds?: number
}

interface StarMediaScrapeFields {
  cover?: boolean
  affiliation?: string
  originalTitle?: string
  studio?: string
  firstAiredAt?: string
  releaseDate?: string
  note?: string
}

interface StarMediaScrapePreview {
  source: 'bangumi' | 'freeanimehentai' | 'hanime1'
  subjectId: number
  title: string
  chineseTitle: string
  coverUrl: string
  studio: string
  firstAiredAt: string
  releaseDate: string
  note: string
  url: string
}

interface StarMediaBookPage {
  name: string
  path?: string
  url?: string
}

type StarMediaImportTarget = StarMediaConfigLibraryId | 'auto'

interface StarMediaImportPlanRequest {
  sourcePath?: string
  sourcePaths?: string[]
  targetLibrary: StarMediaImportTarget
  affiliation?: string
  shelf?: string
  replacementItemId?: string
  scanManagedLibraries?: boolean
}

interface StarMediaSidecarPlanItem {
  fileName: string
  sourcePath: string
  extension: string
  size: number
  targetPath: string
}

interface StarMediaImportPlanItem {
  id: string
  fileName: string
  sourcePath: string
  relativePath: string
  extension: string
  size: number
  status: 'ready' | 'blocked' | 'unsupported'
  library: StarMediaConfigLibraryId
  affiliation?: string
  shelf?: string
  episode?: string
  replacementItemId?: string
  targetPath: string
  sidecars?: StarMediaSidecarPlanItem[]
  reason?: string
}

interface StarMediaReplaceableItem {
  id: string
  library?: StarMediaConfigLibraryId
  affiliation: string
  episode: string
  title: string
  sourcePath: string
}

interface StarMediaImportPlan {
  planId: string
  sourcePath: string
  sourcePaths: string[]
  targetLibrary: StarMediaImportTarget
  targetRoot: string
  generatedAt: string
  configUpdatedAt: string
  replaceableItems: StarMediaReplaceableItem[]
  totalFiles: number
  acceptedCount: number
  blockedCount: number
  unsupportedCount: number
  errorCount: number
  truncated: boolean
  candidateItemsTruncated: boolean
  maxImportPlanItems: number
  maxImportScanFiles: number
  items: StarMediaImportPlanItem[]
  errors: string[]
  scanManagedLibraries?: boolean
}

interface StarMediaGitHubUpdateResult {
  currentVersion: string
  latestVersion?: string
  updateAvailable: boolean
  releaseFound: boolean
  releaseUrl?: string
  publishedAt?: string
  assetName?: string
  assetSize?: number
}

interface StarMediaGitHubUpdateProgress {
  stage: 'downloading' | 'preparing' | 'restarting'
  downloadedBytes: number
  totalBytes: number
}

interface StarMediaImportResultItem {
  id: string
  itemId?: string
  fileName: string
  status: 'imported' | 'skipped' | 'error'
  targetPath?: string
  sidecarCount?: number
  replaced?: boolean
  error?: string
}

interface Window {
  starMedia?: {
    prototype: boolean
    getConfig?: () => Promise<StarMediaConfigResult>
    saveConfig?: (config: StarMediaConfig) => Promise<StarMediaConfigResult>
    createImportPlan?: (input: StarMediaImportPlanRequest) => Promise<StarMediaImportPlan>
    onImportProgress?: (
      listener: (progress: { stage?: 'importing' | 'thumbnails' | 'saving'; current: number; total: number; fileName?: string }) => void,
    ) => () => void
    onLibraryThumbnailsUpdated?: (listener: (items: import('./data').MediaItem[]) => void) => () => void
    onGitHubUpdateProgress?: (listener: (progress: StarMediaGitHubUpdateProgress) => void) => () => void
    getLibrary?: () => Promise<StarMediaLibraryResult>
    importMedia?: (input: {
      planId: string
      items: Array<{
        id: string
        library?: StarMediaConfigLibraryId
        affiliation?: string
        shelf?: string
        episode?: string
        replacementItemId?: string
      }>
    }) => Promise<
      StarMediaLibraryResult & {
        importedCount: number
        skippedCount: number
        errors: string[]
        results: StarMediaImportResultItem[]
        batchId: string
      }
    >
    openBook?: (id: string) => Promise<{ sessionId: string; pages: StarMediaBookPage[]; item?: import('./data').MediaItem }>
    getBookPage?: (sessionId: string, index: number, options?: { force?: boolean }) => Promise<StarMediaBookPage>
    closeBook?: (sessionId: string) => Promise<void>
    getVideoPlayback?: (id: string) => Promise<StarMediaVideoPlayback>
    getVideoPlaybackSupport?: (id: string) => Promise<boolean>
    openVideoExternally?: (id: string) => Promise<StarMediaExternalOpenResult>
    updateVideoMetadata?: (input: {
      id: string
      durationSeconds: number
      thumbnailDataUrl?: string
    }) => Promise<StarMediaLibraryResult & { item: import('./data').MediaItem }>
    updateContainerTags?: (input: { id: string; tags: string[] }) => Promise<StarMediaLibraryResult & { item: import('./data').MediaItem }>
    updateContainerInfo?: (input: {
      id: string
      tags?: string[]
      note?: string
      name?: string
      originalTitle?: string
      studio?: string
      firstAiredAt?: string
      releaseDate?: string
    }) => Promise<StarMediaLibraryResult & { item: import('./data').MediaItem }>
    updateMediaInfo?: (input: {
      id: string
      creator?: string
      releaseDate?: string
    }) => Promise<StarMediaLibraryResult & { item: import('./data').MediaItem }>
    updateVideoEpisode?: (input: { id: string; episode: string }) => Promise<StarMediaLibraryResult & { item: import('./data').MediaItem }>
    updateBookShelves?: (input: {
      ids: string[]
      shelf: string
    }) => Promise<StarMediaLibraryResult & { changedCount: number; shelf: string }>
    transferLibraryItems?: (input: {
      ids: string[]
      targetLibrary: StarMediaConfigLibraryId
    }) => Promise<StarMediaLibraryResult & { movedCount: number; targetLibrary: StarMediaConfigLibraryId }>
    moveVideoToAffiliation?: (input: {
      id: string
      affiliation: string
    }) => Promise<StarMediaLibraryResult & { movedCount: number; item: import('./data').MediaItem }>
    trashLibraryItems?: (input: {
      ids: string[]
    }) => Promise<StarMediaLibraryResult & { deletedCount: number; recordOnlyCount: number; failedCount?: number; errors?: string[] }>
    regenerateThumbnails?: () => Promise<StarMediaLibraryResult & { generatedCount: number; failedCount: number }>
    clearCaches?: () => Promise<StarMediaLibraryResult & { clearedCoverCount: number }>
    clearEmptyMediaDirectories?: () => Promise<{ removedCount: number }>
    openPath?: (targetPath: string) => Promise<{ path: string }>
    searchBangumiSubjects?: (input: { query: string }) => Promise<{ subjects: StarMediaBangumiSubject[] }>
    previewBangumiSubject?: (input: { subjectId: number }) => Promise<{ preview: StarMediaScrapePreview }>
    applyBangumiSubject?: (input: {
      id: string
      subjectId: number
      mode?: 'cover' | 'metadata' | 'both'
      fields?: StarMediaScrapeFields
    }) => Promise<StarMediaLibraryResult & { item?: import('./data').MediaItem; subject: Omit<StarMediaBangumiSubject, 'image'> }>
    searchHanimeSubjects?: (input: {
      query: string
      source?: 'freeanimehentai' | 'hanime1'
    }) => Promise<{ subjects: StarMediaHanimeSubject[] }>
    previewHanimeSubject?: (input: {
      subjectId: number
      source?: 'freeanimehentai' | 'hanime1'
    }) => Promise<{ preview: StarMediaScrapePreview }>
    applyHanimeSubject?: (input: {
      id: string
      subjectId: number
      source?: 'freeanimehentai' | 'hanime1'
      mode?: 'cover' | 'metadata' | 'both'
      fields?: StarMediaScrapeFields
    }) => Promise<StarMediaLibraryResult & { item?: import('./data').MediaItem; subject: StarMediaHanimeSubject }>
    openBangumiTokenPage?: () => Promise<{ url: string }>
    verifyBangumiToken?: () => Promise<{ valid: boolean; expiresAt: string | null; userName: string }>
    minimizeWindow?: () => Promise<void>
    toggleMaximizeWindow?: () => Promise<boolean>
    closeWindow?: () => Promise<'closed' | 'blocked'>
    clearImportedRecords?: () => Promise<StarMediaLibraryResult>
    exportAppData?: () => Promise<{ canceled: boolean; backupPath?: string; missingMediaCount?: number }>
    chooseAppDataBackup?: () => Promise<string | null>
    importAppData?: (
      backupPath: string,
    ) => Promise<
      StarMediaConfigResult &
        StarMediaLibraryResult & { missingMediaCount: number; removedMediaCount?: number; removedSidecarCount?: number }
    >
    installLocalUpdate?: () => Promise<{
      canceled: boolean
      targetVersion?: string
      reinstall?: boolean
      snapshotDirectory?: string
      logPath?: string
    }>
    checkGitHubUpdate?: () => Promise<StarMediaGitHubUpdateResult>
    installGitHubUpdate?: () => Promise<
      StarMediaGitHubUpdateResult & {
        canceled: boolean
        targetVersion?: string
        snapshotDirectory?: string
        logPath?: string
      }
    >
    testNetworkProxy?: () => Promise<{ status: number }>
    chooseDirectory?: () => Promise<string | null>
    chooseImportSources?: () => Promise<string[]>
    getPathForFile?: (file: File) => string
  }
}
