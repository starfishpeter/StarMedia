import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, FolderInput, Maximize2, Minus, Search, Settings, Tags, X } from 'lucide-react'
import { libraries, libraryById, type LibraryId, type MediaItem, type NavigationId } from './data'
import { MediaBatchMenu } from './components/MediaBatchMenu'
import { DetailPanel } from './components/DetailPanel'
import { BookReader } from './components/BookReader'
import { ContainerOverview, type ContainerMetadata } from './components/ContainerOverview'
import { VideoPlayer, type VideoPlayerStatus } from './components/VideoPlayer'
import { DropdownSelect } from './components/DropdownSelect'
import { ImportView, type ImportOperation, type ImportProgress, type ImportStatus, type ImportTarget } from './components/ImportView'
import { LibraryBrowser } from './components/LibraryBrowserViews'
import { SettingsView, VocabularyView } from './components/PreferencesViews'
import {
  compareMediaItems,
  getMediaAffiliation,
  getMediaEpisode,
  getMediaShelf,
  getSortOptions,
  isArchiveLibrary,
  type SortDirection,
  type SortMode,
} from './domain/media'
import logoUrl from './assets/starmedia-logo.png'

type Scope = 'all' | 'current' | LibraryId
type LibraryBrowseState = { primaryFilter: string; tagFilter: string; sortMode: SortMode; sortDirection: SortDirection }
type SectionId = NavigationId | 'import' | 'settings' | 'vocabularies'
const defaultLibraryFolders: Record<LibraryId, string> = {
  erAnime: '里番',
  anime: '番剧',
  creator: '原创',
  books: '本子',
  comics: '漫画',
  general: '综合',
}

const defaultLibraryBrowseState: LibraryBrowseState = {
  primaryFilter: 'all',
  tagFilter: 'all',
  sortMode: 'title',
  sortDirection: 'ascending',
}

function createLibraryBrowseStates() {
  return Object.fromEntries(libraries.map((library) => [library.id, { ...defaultLibraryBrowseState }])) as Record<
    LibraryId,
    LibraryBrowseState
  >
}

const fallbackConfig: StarMediaConfig = {
  schemaVersion: 3,
  updatedAt: new Date().toISOString(),
  mediaRoot: '',
  theme: 'dark',
  cacheLimitMb: 4096,
  confirmBeforeClose: true,
  network: {
    proxyEnabled: false,
    proxyUrl: '',
  },
  scraping: {
    bangumiToken: '',
    bangumiEndpoint: 'https://api.bgm.tv',
    hanime1Endpoint: 'https://hanime1.com',
  },
  libraries: {
    erAnime: { rootPath: '', enabled: true, sortMode: 'title', sortDirection: 'ascending' },
    anime: { rootPath: '', enabled: true, sortMode: 'title', sortDirection: 'ascending' },
    creator: { rootPath: '', enabled: true, sortMode: 'title', sortDirection: 'ascending' },
    books: { rootPath: '', enabled: true, sortMode: 'title', sortDirection: 'ascending' },
    comics: { rootPath: '', enabled: true, sortMode: 'title', sortDirection: 'ascending' },
    general: { rootPath: '', enabled: true, sortMode: 'title', sortDirection: 'ascending' },
  },
  catalog: {
    tags: [],
    classifications: [],
    studios: [],
    creators: [],
  },
}

function configFingerprint(config: StarMediaConfig) {
  const { updatedAt, ...persistedConfig } = config
  void updatedAt
  return JSON.stringify(persistedConfig)
}

function makeLibraryRoots(mediaRoot: string, currentRoots: StarMediaConfig['libraries']) {
  return Object.fromEntries(
    libraries.map((library) => [
      library.id,
      { ...currentRoots[library.id], rootPath: mediaRoot.trim() ? joinWindowsPath(mediaRoot, defaultLibraryFolders[library.id]) : '' },
    ]),
  ) as Record<LibraryId, StarMediaLibraryConfig>
}

function App() {
  const [activeNavigation, setActiveNavigation] = useState<SectionId>('erAnime')
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [libraryBrowseStates, setLibraryBrowseStates] = useState<Record<LibraryId, LibraryBrowseState>>(createLibraryBrowseStates)
  const [searchBrowseState, setSearchBrowseState] = useState<LibraryBrowseState>(defaultLibraryBrowseState)
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [selectedAffiliation, setSelectedAffiliation] = useState<string | null>(null)
  const [selectedShelf, setSelectedShelf] = useState<string | null>(null)
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([])
  const [mediaBatchMenu, setMediaBatchMenu] = useState<{ x: number; y: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [exportingAppData, setExportingAppData] = useState(false)
  const [installingLocalUpdate, setInstallingLocalUpdate] = useState(false)
  const [checkingGitHubUpdate, setCheckingGitHubUpdate] = useState(false)
  const [githubUpdate, setGitHubUpdate] = useState<StarMediaGitHubUpdateResult | null>(null)
  const [githubUpdateProgress, setGitHubUpdateProgress] = useState<StarMediaGitHubUpdateProgress | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [config, setConfig] = useState<StarMediaConfig>(fallbackConfig)
  const [configMeta, setConfigMeta] = useState({ dataRoot: '', configPath: '', backupDir: '', cacheDir: '' })
  const [libraryItems, setLibraryItems] = useState<MediaItem[]>([])
  const [importSources, setImportSources] = useState<string[]>([])
  const [importLibrary, setImportLibrary] = useState<ImportTarget>('auto')
  const [importPlan, setImportPlan] = useState<StarMediaImportPlan | null>(null)
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle')
  const [importError, setImportError] = useState<string | null>(null)
  const [importOperation, setImportOperation] = useState<ImportOperation>('idle')
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [directImporting, setDirectImporting] = useState(false)
  const [readerItem, setReaderItem] = useState<MediaItem | null>(null)
  const [readerSessionId, setReaderSessionId] = useState('')
  const [readerPages, setReaderPages] = useState<StarMediaBookPage[]>([])
  const [readerStatus, setReaderStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [readerError, setReaderError] = useState('')
  const [playerItem, setPlayerItem] = useState<MediaItem | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [videoMimeType, setVideoMimeType] = useState('')
  const [videoSubtitles, setVideoSubtitles] = useState<Array<{ format: 'ass' | 'vtt'; url: string; label: string }>>([])
  const [videoPlayerStatus, setVideoPlayerStatus] = useState<VideoPlayerStatus>('idle')
  const [videoPlayerError, setVideoPlayerError] = useState('')
  const configReadyRef = useRef(false)
  const configSaveTimerRef = useRef<number | null>(null)
  const configSavePromiseRef = useRef<Promise<boolean> | null>(null)
  const lastSavedConfigRef = useRef('')
  const currentConfigRef = useRef(config)
  const noticeTimerRef = useRef<number | null>(null)
  const readerRequestRef = useRef(0)
  const readerSessionIdRef = useRef('')
  const playerRequestRef = useRef(0)

  const activeLibrary = isLibraryNavigation(activeNavigation) ? libraryById[activeNavigation] : null
  const browseState = activeLibrary
    ? {
        ...libraryBrowseStates[activeLibrary.id],
        sortMode: config.libraries[activeLibrary.id].sortMode,
        sortDirection: config.libraries[activeLibrary.id].sortDirection,
      }
    : searchBrowseState
  const { primaryFilter, tagFilter, sortMode, sortDirection } = browseState
  const sortOptions = getSortOptions(activeLibrary?.id ?? null)
  const updateBrowseState = (changes: Partial<LibraryBrowseState>) => {
    if (!activeLibrary) {
      setSearchBrowseState((current) => ({ ...current, ...changes }))
      return
    }
    const { sortMode: nextSortMode, sortDirection: nextSortDirection, ...filterChanges } = changes
    if (Object.keys(filterChanges).length > 0)
      setLibraryBrowseStates((current) => ({
        ...current,
        [activeLibrary.id]: { ...current[activeLibrary.id], ...filterChanges },
      }))
    if (nextSortMode || nextSortDirection)
      setConfig((current) => ({
        ...current,
        libraries: {
          ...current.libraries,
          [activeLibrary.id]: {
            ...current.libraries[activeLibrary.id],
            ...(nextSortMode ? { sortMode: nextSortMode } : {}),
            ...(nextSortDirection ? { sortDirection: nextSortDirection } : {}),
          },
        },
      }))
  }
  const resetBrowseFilters = () => updateBrowseState({ primaryFilter: 'all', tagFilter: 'all' })
  const apiAvailable = Boolean(
    window.starMedia?.getConfig &&
    window.starMedia?.saveConfig &&
    window.starMedia?.chooseImportSources &&
    window.starMedia?.createImportPlan,
  )
  const settingsCapabilities = {
    chooseDirectory: Boolean(window.starMedia?.chooseDirectory),
    clearCaches: Boolean(window.starMedia?.clearCaches),
    clearInvalidRecords: Boolean(window.starMedia?.getLibrary),
    clearEmptyMediaDirectories: Boolean(window.starMedia?.clearEmptyMediaDirectories),
    clearImportedRecords: Boolean(window.starMedia?.clearImportedRecords),
    exportAppData: Boolean(window.starMedia?.exportAppData),
    importAppData: Boolean(window.starMedia?.chooseAppDataBackup && window.starMedia?.importAppData),
    installLocalUpdate: Boolean(window.starMedia?.installLocalUpdate),
    githubUpdate: Boolean(window.starMedia?.checkGitHubUpdate && window.starMedia?.installGitHubUpdate),
    testNetworkProxy: Boolean(window.starMedia?.testNetworkProxy),
    regenerateThumbnails: Boolean(window.starMedia?.regenerateThumbnails),
    verifyBangumiToken: Boolean(window.starMedia?.openBangumiTokenPage && window.starMedia?.verifyBangumiToken),
  }
  const allMedia = libraryItems
  const effectiveScope = scope === 'current' ? (activeLibrary?.id ?? 'all') : scope
  const scopeItems = useMemo(
    () => (effectiveScope === 'all' ? allMedia : allMedia.filter((item) => item.library === effectiveScope)),
    [allMedia, effectiveScope],
  )
  const browsingItems = useMemo(
    () => (activeLibrary ? allMedia.filter((item) => item.library === activeLibrary.id) : allMedia),
    [activeLibrary, allMedia],
  )
  const queryItems = query.trim() ? scopeItems : browsingItems
  const usesPerVideoMetadata = activeLibrary?.id === 'creator' || activeLibrary?.id === 'general'

  const primaryOptions = useMemo(
    () =>
      config.catalog.classifications
        .filter(
          (classification) => classification.tags.length > 0 && queryItems.some((item) => classification.libraryIds.includes(item.library)),
        )
        .map((classification) => classification.name)
        .sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [config.catalog.classifications, queryItems],
  )
  const tagOptions = useMemo(
    () => [...new Set(queryItems.flatMap((item) => item.tags))].sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [queryItems],
  )

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const classification = config.catalog.classifications.find((candidate) => candidate.name === primaryFilter)
    const items = queryItems.filter((item) => {
      const matchesSearch =
        !normalizedQuery ||
        [
          item.title,
          item.grouping,
          getMediaAffiliation(item),
          getMediaEpisode(item),
          item.creator,
          item.studio,
          item.originalTitle,
          item.tags.join(' '),
          libraryById[item.library].label,
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      const matchesPrimary =
        usesPerVideoMetadata ||
        primaryFilter === 'all' ||
        Boolean(
          classification &&
          classification.libraryIds.includes(item.library) &&
          classification.tags.length > 0 &&
          classification.tags.every((tag) => item.tags.includes(tag)),
        )
      const matchesTag = (usesPerVideoMetadata && !normalizedQuery) || tagFilter === 'all' || item.tags.includes(tagFilter)
      return matchesSearch && matchesPrimary && matchesTag
    })

    return [...items].sort((left, right) => compareMediaItems(left, right, sortMode, sortDirection))
  }, [config.catalog.classifications, primaryFilter, query, queryItems, sortDirection, sortMode, tagFilter, usesPerVideoMetadata])

  const isAffiliationLibrary = Boolean(activeLibrary && !isArchiveLibrary(activeLibrary.id))
  const isShelfLibrary = Boolean(activeLibrary && isArchiveLibrary(activeLibrary.id))
  const affiliationItems = useMemo(
    () =>
      selectedAffiliation && isAffiliationLibrary && !query.trim()
        ? visibleItems.filter((item) => getMediaAffiliation(item) === selectedAffiliation)
        : visibleItems,
    [isAffiliationLibrary, query, selectedAffiliation, visibleItems],
  )
  const shelfItems = useMemo(
    () =>
      selectedShelf && isShelfLibrary && !query.trim()
        ? visibleItems.filter((item) => getMediaShelf(item) === selectedShelf)
        : visibleItems,
    [isShelfLibrary, query, selectedShelf, visibleItems],
  )

  useEffect(() => {
    let cancelled = false

    async function loadConfig() {
      if (!window.starMedia?.getConfig) {
        return
      }

      try {
        const result = await window.starMedia.getConfig()
        if (cancelled) return
        lastSavedConfigRef.current = configFingerprint(result.config)
        currentConfigRef.current = result.config
        configReadyRef.current = true
        setConfig(result.config)
        setAppVersion(result.appVersion ?? '')
        setConfigMeta({ dataRoot: result.dataRoot, configPath: result.configPath, backupDir: result.backupDir, cacheDir: result.cacheDir })
      } catch (error) {
        console.error(error)
        notify(error instanceof Error ? `读取应用设置失败：${error.message}` : '读取应用设置失败。')
      }
    }

    loadConfig()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    currentConfigRef.current = config
  }, [config])

  useEffect(() => {
    let cancelled = false

    async function loadLibrary() {
      if (!window.starMedia?.getLibrary) return
      try {
        const result = await window.starMedia.getLibrary()
        if (cancelled) return
        setLibraryItems(result.data.items)
      } catch (error) {
        console.error(error)
        notify(error instanceof Error ? `读取媒体库失败：${error.message}` : '读取媒体库失败。')
      }
    }

    loadLibrary()
    return () => {
      cancelled = true
    }
  }, [])

  function selectNavigation(id: SectionId) {
    document.querySelector<HTMLElement>('.main-content')?.scrollTo({ top: 0 })
    setActiveNavigation(id)
    setSelectedAffiliation(null)
    setSelectedShelf(null)
    setSelectedMediaIds([])
    setMediaBatchMenu(null)
  }

  function notify(message: string) {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    setNotice(message)
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null
      setNotice(null)
    }, 2600)
  }

  async function persistConfig(draft: StarMediaConfig) {
    if (!window.starMedia?.saveConfig) return false
    const fingerprint = configFingerprint(draft)
    if (fingerprint === lastSavedConfigRef.current) return true
    if (configSavePromiseRef.current) {
      await configSavePromiseRef.current
      if (fingerprint === lastSavedConfigRef.current) return true
    }

    const task = (async () => {
      try {
        const result = await window.starMedia?.saveConfig?.(draft)
        if (!result) return false
        lastSavedConfigRef.current = configFingerprint(result.config)
        setConfigMeta({ dataRoot: result.dataRoot, configPath: result.configPath, backupDir: result.backupDir, cacheDir: result.cacheDir })
        if (configFingerprint(currentConfigRef.current) === fingerprint) setConfig(result.config)
        return true
      } catch (error) {
        console.error(error)
        return false
      }
    })()
    configSavePromiseRef.current = task
    try {
      return await task
    } finally {
      if (configSavePromiseRef.current === task) configSavePromiseRef.current = null
    }
  }

  useEffect(() => {
    if (!configReadyRef.current || !window.starMedia?.saveConfig) return
    if (configFingerprint(config) === lastSavedConfigRef.current) return
    if (configSaveTimerRef.current !== null) window.clearTimeout(configSaveTimerRef.current)
    configSaveTimerRef.current = window.setTimeout(() => {
      configSaveTimerRef.current = null
      void persistConfig(config)
    }, 400)
    return () => {
      if (configSaveTimerRef.current !== null) window.clearTimeout(configSaveTimerRef.current)
    }
  }, [config])

  useEffect(() => window.starMedia?.onImportProgress?.((progress) => setImportProgress(progress)), [])

  useEffect(() => window.starMedia?.onGitHubUpdateProgress?.((progress) => setGitHubUpdateProgress(progress)), [])

  useEffect(
    () =>
      window.starMedia?.onLibraryThumbnailsUpdated?.((updatedItems) => {
        const updates = new Map(updatedItems.map((item) => [item.id, item]))
        if (updates.size === 0) return
        const merge = (item: MediaItem | null) => {
          const updated = item ? updates.get(item.id) : undefined
          return updated && updated.sourcePath === item?.sourcePath ? updated : item
        }
        setLibraryItems((current) => current.map((item) => merge(item)!))
        setSelectedItem(merge)
        setReaderItem(merge)
        setPlayerItem(merge)
      }),
    [],
  )

  useEffect(() => {
    const dismissMediaBatchMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('.media-batch-menu') && !target?.closest('.dropdown-menu')) {
        setMediaBatchMenu(null)
      }
    }
    window.addEventListener('mousedown', dismissMediaBatchMenu)
    return () => window.removeEventListener('mousedown', dismissMediaBatchMenu)
  }, [])

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
      readerRequestRef.current += 1
      playerRequestRef.current += 1
      const sessionId = readerSessionIdRef.current
      readerSessionIdRef.current = ''
      if (sessionId && window.starMedia?.closeBook) void window.starMedia.closeBook(sessionId)
    },
    [],
  )

  async function flushConfigSave() {
    if (configSaveTimerRef.current !== null) {
      window.clearTimeout(configSaveTimerRef.current)
      configSaveTimerRef.current = null
    }
    return persistConfig(config)
  }

  async function requestCloseWindow() {
    if (!window.starMedia?.closeWindow) return
    if (exportingAppData) {
      window.alert('正在导出应用数据，请等待导出结束后再关闭应用。')
      return
    }
    if (!(await flushConfigSave())) {
      notify('设置尚未保存，已取消退出。')
      return
    }
    await window.starMedia.closeWindow()
  }

  async function chooseDirectory(onChoose: (directory: string) => void) {
    if (!window.starMedia?.chooseDirectory) {
      notify('浏览器预览模式无法打开文件夹选择器。')
      return
    }

    const directory = await window.starMedia.chooseDirectory()
    if (directory) onChoose(directory)
  }

  async function chooseMediaRoot() {
    await chooseDirectory((directory) => {
      updateMediaRoot(directory)
    })
  }

  async function chooseLibraryRoot(id: LibraryId) {
    await chooseDirectory((directory) => {
      setConfig((current) => ({
        ...current,
        libraries: {
          ...current.libraries,
          [id]: { ...current.libraries[id], rootPath: directory },
        },
      }))
    })
  }

  async function chooseImportSource() {
    if (!window.starMedia?.chooseImportSources) {
      notify('当前运行环境无法打开文件或文件夹选择器。')
      return
    }
    const sources = await window.starMedia.chooseImportSources()
    if (sources.length > 0) updateImportSources(sources)
  }

  function resetImportPlan() {
    setImportPlan(null)
    setImportStatus('idle')
    setImportError(null)
    setImportProgress(null)
  }

  function updateImportSources(sources: string[]) {
    setImportSources([...new Set(sources.map((source) => source.trim()).filter(Boolean))])
    resetImportPlan()
  }

  function updateImportPlanItem(
    itemId: string,
    changes: Partial<Pick<StarMediaImportPlanItem, 'library' | 'affiliation' | 'shelf' | 'episode' | 'replacementItemId'>>,
  ) {
    updateImportPlanItems([itemId], changes)
  }

  function updateImportPlanItems(
    itemIds: string[],
    changes: Partial<Pick<StarMediaImportPlanItem, 'library' | 'affiliation' | 'shelf' | 'episode' | 'replacementItemId'>>,
  ) {
    const ids = new Set(itemIds)
    setImportPlan((current) => {
      if (!current) return current
      return {
        ...current,
        items: current.items.map((item) => {
          if (!ids.has(item.id) || item.status !== 'ready') return item
          const affiliation = changes.affiliation ?? item.affiliation ?? ''
          const shelf = changes.shelf ?? item.shelf ?? ''
          const library = changes.library ?? item.library
          const targetRoot = config.libraries[library].rootPath
          const episode = changes.episode ?? item.episode ?? ''
          let replacementItemId = changes.replacementItemId ?? item.replacementItemId ?? ''
          const replacement = current.replaceableItems.find((candidate) => candidate.id === replacementItemId)
          if (replacement && replacement.affiliation !== affiliation) replacementItemId = ''
          const selectedReplacement = current.replaceableItems.find((candidate) => candidate.id === replacementItemId)
          const targetPath = isArchiveLibrary(library)
            ? shelf.trim()
              ? joinWindowsPath(joinWindowsPath(targetRoot, shelf.trim()), item.fileName)
              : joinWindowsPath(targetRoot, item.fileName)
            : selectedReplacement?.sourcePath || joinWindowsPath(joinWindowsPath(targetRoot, affiliation || '未归入合集'), item.fileName)
          return {
            ...item,
            ...changes,
            library,
            affiliation,
            shelf,
            episode,
            replacementItemId,
            targetPath,
            sidecars: item.sidecars?.map((sidecar) => ({
              ...sidecar,
              targetPath: joinWindowsPath(pathDirectory(targetPath), sidecar.fileName),
            })),
          }
        }),
      }
    })
  }

  async function generateImportPlan() {
    if (!window.starMedia?.createImportPlan) {
      notify('当前运行环境无法生成导入计划。')
      return
    }
    if (importSources.length === 0) {
      notify('请先拖入或选择来源文件/文件夹。')
      return
    }
    if (!(await flushConfigSave())) {
      notify('媒体库设置未能保存。')
      return
    }

    setImportStatus('scanning')
    setImportError(null)
    setImportPlan(null)

    try {
      const plan = await window.starMedia.createImportPlan({ sourcePaths: importSources, targetLibrary: importLibrary })
      setImportPlan(plan)
      setImportStatus('ready')
      notify(`已生成导入计划：${plan.acceptedCount} 项可导入。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成导入计划失败。'
      setImportStatus('error')
      setImportError(message)
      notify(message)
    }
  }

  async function scanManagedLibraries() {
    if (!window.starMedia?.createImportPlan || importStatus === 'scanning') return
    if (!(await flushConfigSave())) {
      notify('媒体库设置未能保存。')
      return
    }
    setImportLibrary('auto')
    setImportSources([])
    setImportStatus('scanning')
    setImportError(null)
    setImportPlan(null)
    try {
      const plan = await window.starMedia.createImportPlan({ targetLibrary: 'auto', scanManagedLibraries: true })
      setImportPlan(plan)
      setImportStatus('ready')
      notify(plan.acceptedCount > 0 ? `发现 ${plan.acceptedCount} 个尚未导入的项目。` : '媒体库目录中没有发现新增项目。')
    } catch (error) {
      const message = error instanceof Error ? error.message : '扫描媒体库目录失败。'
      setImportStatus('error')
      setImportError(message)
      notify(message)
    }
  }

  async function importIntoContainer(library: LibraryId, containerName: string, replacementItemId = '') {
    if (
      (!replacementItemId && !window.starMedia?.chooseImportSources) ||
      (Boolean(replacementItemId) && !window.starMedia?.chooseVideoFile) ||
      !window.starMedia?.createImportPlan ||
      !window.starMedia?.importMedia
    ) {
      notify('当前运行环境无法直接导入资源。')
      return
    }
    if (directImporting) return
    if (!(await flushConfigSave())) {
      notify('媒体库设置未能保存。')
      return
    }
    let sourcePaths: string[]
    if (replacementItemId) {
      const source = await window.starMedia.chooseVideoFile?.()
      sourcePaths = source ? [source] : []
    } else {
      sourcePaths = (await window.starMedia.chooseImportSources?.()) ?? []
    }
    if (sourcePaths.length === 0) return

    setDirectImporting(true)
    try {
      const isArchive = isArchiveLibrary(library)
      const plan = await window.starMedia.createImportPlan({
        sourcePaths,
        targetLibrary: library,
        ...(isArchive ? { shelf: containerName } : { affiliation: containerName }),
        ...(replacementItemId ? { replacementItemId } : {}),
      })
      const readyItems = plan.items.filter((item) => item.status === 'ready' && Boolean(item.targetPath))
      if (readyItems.length === 0) {
        notify(plan.errors[0] || '没有可导入的文件，请检查格式和媒体库路径。')
        return
      }
      const targetLabel = isArchive ? `书架「${containerName}」` : `合集「${containerName}」`
      const actionLabel = replacementItemId ? '替换选集' : '导入'
      if (
        !window.confirm(
          `将${actionLabel} ${readyItems.length} 个文件到${targetLabel}，并写入索引。${replacementItemId ? '旧选集会移入应用数据替换区。' : ''}是否继续？`,
        )
      )
        return
      const result = await window.starMedia.importMedia({
        planId: plan.planId,
        items: plan.items.map((item) => ({ id: item.id, library: item.library })),
      })
      setLibraryItems(result.data.items)
      if (replacementItemId) setSelectedItem(null)
      notify(`已导入 ${result.importedCount} 项${result.skippedCount ? `，跳过 ${result.skippedCount} 项` : ''}。`)
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? `直接导入失败：${error.message}` : '直接导入失败。')
    } finally {
      setDirectImporting(false)
    }
  }

  async function trashSingleMedia(item: MediaItem) {
    if (!window.starMedia?.trashLibraryItems) return
    if (!window.confirm(`从媒体库移除「${item.title}」；仍存在的媒体和字幕文件会移入系统回收站。是否继续？`)) return
    try {
      const result = await window.starMedia.trashLibraryItems({ ids: [item.id] })
      setLibraryItems(result.data.items)
      setSelectedItem(null)
      notify(
        result.failedCount
          ? `媒体已移入回收站，但 ${result.failedCount} 项资源未能完整处理：${result.errors?.[0] ?? '请手动检查文件。'}`
          : result.recordOnlyCount
            ? '文件已不存在，已从媒体库移除失效记录。'
            : '已将资源移入回收站并移除记录。',
      )
    } catch (error) {
      notify(error instanceof Error ? `删除失败：${error.message}` : '删除失败。')
    }
  }

  async function moveSingleVideo(item: MediaItem, affiliation: string) {
    if (!window.starMedia?.moveVideoToAffiliation) return
    try {
      const result = await window.starMedia.moveVideoToAffiliation({ id: item.id, affiliation })
      setLibraryItems(result.data.items)
      setSelectedItem(result.item)
      if (selectedAffiliation === getMediaAffiliation(item)) setSelectedAffiliation(result.item.affiliation ?? affiliation)
      notify(`已移动到合集「${result.item.affiliation ?? affiliation}」。`)
    } catch (error) {
      notify(error instanceof Error ? `移动失败：${error.message}` : '移动失败。')
    }
  }

  async function importMediaRecords() {
    if (!importPlan || !window.starMedia?.importMedia || importOperation !== 'idle') return
    const moveCount = importPlan.items.filter((item) => item.status === 'ready' && Boolean(item.targetPath)).length
    if (moveCount === 0) {
      notify('当前计划没有可导入的文件。')
      return
    }
    if (!window.confirm(`将移动 ${moveCount} 个文件到受管理媒体库并写入索引。替换选集时，旧文件会移入应用数据目录。是否继续？`)) return

    try {
      setImportOperation('importing')
      setImportProgress({ stage: 'importing', current: 0, total: moveCount })
      const result = await window.starMedia.importMedia({
        planId: importPlan.planId,
        items: importPlan.items.map((item) => ({
          id: item.id,
          library: item.library,
          affiliation: item.affiliation,
          shelf: item.shelf,
          episode: item.episode,
          replacementItemId: item.replacementItemId,
        })),
      })
      setLibraryItems(result.data.items)
      setImportSources([])
      setImportPlan(null)
      setImportStatus('idle')
      setImportError(null)
      setImportProgress(null)
      setImportLibrary('auto')
      selectNavigation('erAnime')
      notify(`已导入 ${result.importedCount} 项${result.skippedCount ? `，跳过 ${result.skippedCount} 项` : ''}。`)
    } catch (error) {
      console.error(error)
      notify('导入失败；已完成项仍保留索引，失败项未覆盖目标文件。')
    } finally {
      setImportOperation('idle')
      setImportProgress(null)
    }
  }

  async function clearImportedRecords() {
    if (!window.starMedia?.clearImportedRecords) return
    if (!window.confirm('这会删除应用内全部已导入资产记录，不会移动或删除实际文件；分类和标签会保留。是否继续？')) return
    try {
      const result = await window.starMedia.clearImportedRecords()
      setLibraryItems(result.data.items)
      setSelectedItem(null)
      notify('已清空导入资产记录，实际文件未改动。')
    } catch (error) {
      console.error(error)
      notify('清空导入资产记录失败。')
    }
  }

  async function exportAppData() {
    if (!window.starMedia?.exportAppData) return
    if (exportingAppData) return
    setExportingAppData(true)
    try {
      const result = await window.starMedia.exportAppData()
      if (result.canceled || !result.backupPath) return
      const missing = result.missingMediaCount ? `，检测到 ${result.missingMediaCount} 个媒体或字幕路径当前不可用` : ''
      notify(`应用数据已导出${missing}。`)
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? `导出应用数据失败：${error.message}` : '导出应用数据失败。')
    } finally {
      setExportingAppData(false)
    }
  }

  async function importAppData() {
    if (!window.starMedia?.chooseAppDataBackup || !window.starMedia.importAppData) return
    const backupPath = await window.starMedia.chooseAppDataBackup()
    if (!backupPath) return
    if (!window.confirm('导入应用数据会覆盖当前的配置、媒体记录和应用封面；不会移动或删除实际媒体文件。是否继续？')) return
    try {
      const result = await window.starMedia.importAppData(backupPath)
      if (configSaveTimerRef.current !== null) {
        window.clearTimeout(configSaveTimerRef.current)
        configSaveTimerRef.current = null
      }
      lastSavedConfigRef.current = configFingerprint(result.config)
      currentConfigRef.current = result.config
      configReadyRef.current = true
      setConfig(result.config)
      setConfigMeta({ dataRoot: result.dataRoot, configPath: result.configPath, backupDir: result.backupDir, cacheDir: result.cacheDir })
      setLibraryItems(result.data.items)
      const removed = [
        result.removedMediaCount ? `移除 ${result.removedMediaCount} 条文件不存在的媒体记录` : '',
        result.removedSidecarCount ? `清理 ${result.removedSidecarCount} 条失效字幕记录` : '',
      ]
        .filter(Boolean)
        .join('，')
      const pathStatus = result.missingMediaCount ? `仍有 ${result.missingMediaCount} 个路径不可用。` : '媒体路径检查正常。'
      notify(`应用数据已导入。${removed ? `${removed}；` : ''}${pathStatus}`)
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? `导入应用数据失败：${error.message}` : '导入应用数据失败。')
    }
  }

  async function installLocalUpdate() {
    if (!window.starMedia?.installLocalUpdate || installingLocalUpdate) return
    setInstallingLocalUpdate(true)
    try {
      const result = await window.starMedia.installLocalUpdate()
      if (result.canceled) return
      notify(`升级包 ${result.targetVersion ?? ''} 已准备完成，应用即将自动重启。`)
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? `安装升级包失败：${error.message}` : '安装升级包失败。')
    } finally {
      setInstallingLocalUpdate(false)
    }
  }

  async function checkGitHubUpdate() {
    if (!window.starMedia?.checkGitHubUpdate || checkingGitHubUpdate) return
    setCheckingGitHubUpdate(true)
    try {
      const result = await window.starMedia.checkGitHubUpdate()
      setGitHubUpdate(result)
      notify(result.updateAvailable ? `发现新版本 ${result.latestVersion}。` : `当前已是最新版本 ${result.currentVersion}。`)
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? `检查 GitHub 更新失败：${error.message}` : '检查 GitHub 更新失败。')
    } finally {
      setCheckingGitHubUpdate(false)
    }
  }

  async function installGitHubUpdate() {
    if (!window.starMedia?.installGitHubUpdate || installingLocalUpdate) return
    setInstallingLocalUpdate(true)
    setGitHubUpdateProgress(null)
    try {
      const result = await window.starMedia.installGitHubUpdate()
      if (result.canceled) return
      if (!result.updateAvailable) {
        setGitHubUpdate(result)
        notify(`当前已是最新版本 ${result.currentVersion}。`)
        return
      }
      notify(`版本 ${result.targetVersion ?? result.latestVersion ?? ''} 已校验，应用即将自动重启。`)
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? `安装 GitHub 更新失败：${error.message}` : '安装 GitHub 更新失败。')
      setGitHubUpdateProgress(null)
    } finally {
      setInstallingLocalUpdate(false)
    }
  }

  function toggleMediaSelection(item: MediaItem) {
    setMediaBatchMenu(null)
    setSelectedMediaIds((current) => (current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]))
  }

  function selectMediaItems(items: MediaItem[]) {
    setMediaBatchMenu(null)
    const next = [...new Set(items.map((item) => item.id))]
    setSelectedMediaIds((current) => (current.length === next.length && current.every((id, index) => id === next[index]) ? current : next))
  }

  function openMediaBatchMenu(item: MediaItem, event: React.MouseEvent<HTMLElement>) {
    openMediaBatchMenuForItems([item], event)
  }

  function openMediaBatchMenuForItems(items: MediaItem[], event: React.MouseEvent<HTMLElement>) {
    event.preventDefault()
    const ids = [...new Set(items.map((item) => item.id))]
    setSelectedMediaIds((current) =>
      event.shiftKey ? [...new Set([...current, ...ids])] : ids.every((id) => current.includes(id)) ? current : ids,
    )
    setMediaBatchMenu({
      x: Math.min(event.clientX, Math.max(12, window.innerWidth - 306)),
      y: Math.min(event.clientY, Math.max(12, window.innerHeight - 342)),
    })
  }

  async function updateBookShelves(shelf: string) {
    if (!window.starMedia?.updateBookShelves || selectedMediaIds.length === 0) return
    try {
      const result = await window.starMedia.updateBookShelves({ ids: selectedMediaIds, shelf })
      setLibraryItems(result.data.items)
      if (
        !shelf &&
        selectedShelf &&
        !result.data.items.some((item) => item.library === activeLibrary?.id && getMediaShelf(item) === selectedShelf)
      ) {
        setSelectedShelf(null)
      }
      setSelectedMediaIds([])
      setMediaBatchMenu(null)
      notify(shelf ? `已将 ${result.changedCount} 本加入书架「${result.shelf}」。` : `已将 ${result.changedCount} 本移出书架。`)
    } catch (error) {
      console.error(error)
      notify('更新书架失败。')
    }
  }

  async function transferSelectedMedia(targetLibrary: LibraryId) {
    if (!window.starMedia?.transferLibraryItems || selectedMediaIds.length === 0) return
    const target = libraryById[targetLibrary]
    if (
      !window.confirm(
        `将 ${selectedMediaIds.length} 项移动到「${target.label}」媒体库，并同步更新索引。目标位置存在同名文件时会取消本次转移。是否继续？`,
      )
    )
      return
    try {
      const result = await window.starMedia.transferLibraryItems({ ids: selectedMediaIds, targetLibrary })
      setLibraryItems(result.data.items)
      setSelectedMediaIds([])
      setMediaBatchMenu(null)
      notify(`已转移 ${result.movedCount} 项到「${target.label}」。`)
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? `转移失败：${error.message}` : '转移失败。')
    }
  }

  async function trashSelectedMedia() {
    if (!window.starMedia?.trashLibraryItems || selectedMediaIds.length === 0) return
    const count = selectedMediaIds.length
    if (!window.confirm(`从媒体库移除 ${count} 项记录；仍存在的媒体和字幕文件会移入系统回收站。是否继续？`)) return
    try {
      const result = await window.starMedia.trashLibraryItems({ ids: selectedMediaIds })
      setLibraryItems(result.data.items)
      setSelectedMediaIds([])
      setMediaBatchMenu(null)
      notify(
        result.failedCount
          ? `已将 ${result.deletedCount} 项资源移入回收站，${result.failedCount} 项资源未能完整处理：${result.errors?.[0] ?? '请手动检查文件。'}`
          : `已移除 ${result.deletedCount} 项记录${result.recordOnlyCount ? `，其中 ${result.recordOnlyCount} 项原文件已不存在` : ''}。`,
      )
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? `删除失败：${error.message}` : '删除失败。')
    }
  }

  async function regenerateThumbnails() {
    if (!window.starMedia?.regenerateThumbnails) return
    if (!window.confirm('会清理并重新生成全部已导入资源的缩略图，不会移动或删除媒体文件。是否继续？')) return
    try {
      const result = await window.starMedia.regenerateThumbnails()
      setLibraryItems(result.data.items)
      notify(`已重新生成 ${result.generatedCount} 张缩略图${result.failedCount ? `，${result.failedCount} 项未能生成` : ''}。`)
    } catch (error) {
      console.error(error)
      notify('重新生成缩略图失败。')
    }
  }

  async function clearCaches() {
    if (!window.starMedia?.clearCaches) return
    if (!window.confirm('会清空阅读页、字幕、视频缩略图、合集封面和本子封面缓存，不会移动或删除实际媒体文件。是否继续？')) return
    try {
      const result = await window.starMedia.clearCaches()
      setLibraryItems(result.data.items)
      notify(`已清空缓存${result.clearedCoverCount ? `，移除 ${result.clearedCoverCount} 项封面记录` : ''}。`)
    } catch (error) {
      console.error(error)
      notify('清空缓存失败。')
    }
  }

  function closeBookReader() {
    readerRequestRef.current += 1
    const sessionId = readerSessionIdRef.current
    readerSessionIdRef.current = ''
    if (sessionId && window.starMedia?.closeBook) void window.starMedia.closeBook(sessionId)
    setReaderSessionId('')
    setReaderPages([])
    setReaderError('')
    setReaderStatus('idle')
    setReaderItem(null)
  }

  function closeVideoPlayer() {
    playerRequestRef.current += 1
    setPlayerItem(null)
    setVideoUrl('')
    setVideoMimeType('')
    setVideoSubtitles([])
    setVideoPlayerError('')
    setVideoPlayerStatus('idle')
  }

  async function openBookReader(item: MediaItem) {
    if (!window.starMedia?.openBook) {
      notify('当前运行环境无法打开压缩包。')
      return
    }

    const requestId = readerRequestRef.current + 1
    readerRequestRef.current = requestId
    const previousSessionId = readerSessionIdRef.current
    readerSessionIdRef.current = ''
    if (previousSessionId && window.starMedia.closeBook) void window.starMedia.closeBook(previousSessionId)
    setReaderSessionId('')
    setReaderItem(item)
    setReaderPages([])
    setReaderError('')
    setReaderStatus('loading')
    try {
      const result = await window.starMedia.openBook(item.id)
      if (readerRequestRef.current !== requestId) {
        if (result.sessionId && window.starMedia.closeBook) void window.starMedia.closeBook(result.sessionId)
        return
      }
      readerSessionIdRef.current = result.sessionId
      setReaderSessionId(result.sessionId)
      setReaderPages(result.pages)
      const openedItem = result.item
      if (openedItem) {
        setLibraryItems((current) => current.map((entry) => (entry.id === openedItem.id ? openedItem : entry)))
        setSelectedItem((current) => (current?.id === openedItem.id ? openedItem : current))
        setReaderItem(openedItem)
      }
      setReaderStatus('ready')
    } catch (error) {
      if (readerRequestRef.current !== requestId) return
      console.error(error)
      setReaderStatus('error')
      const message = error instanceof Error ? error.message : '未知错误'
      setReaderError(message)
      notify(`打开本子失败：${message}`)
    }
  }

  async function openVideoPlayer(item: MediaItem) {
    if (!window.starMedia?.getVideoPlayback) {
      notify('当前运行环境无法打开视频。')
      return
    }

    const requestId = playerRequestRef.current + 1
    playerRequestRef.current = requestId
    setPlayerItem(item)
    setVideoUrl('')
    setVideoMimeType('')
    setVideoSubtitles([])
    setVideoPlayerError('')
    setVideoPlayerStatus('loading')
    try {
      const result = await window.starMedia.getVideoPlayback(item.id)
      if (playerRequestRef.current !== requestId) return
      setVideoUrl(result.url)
      setVideoMimeType(result.mimeType)
      setVideoSubtitles(result.subtitles)
      setVideoPlayerStatus('ready')
    } catch (error) {
      if (playerRequestRef.current !== requestId) return
      console.error(error)
      setVideoPlayerStatus('error')
      const message = error instanceof Error ? error.message : '未知错误'
      setVideoPlayerError(message)
      notify(`打开视频失败：${message}`)
    }
  }

  async function openVideoExternally(item: MediaItem) {
    if (!window.starMedia?.openVideoExternally) {
      notify('当前运行环境无法调用外部播放器。')
      return
    }

    try {
      const result = await window.starMedia.openVideoExternally(item.id)
      notify(result.ok ? '已交给系统默认播放器打开。' : `外部播放器启动失败：${result.error || '未知错误'}`)
    } catch (error) {
      console.error(error)
      notify('外部播放器启动失败。')
    }
  }

  async function saveVideoMetadata(item: MediaItem, durationSeconds: number, thumbnailDataUrl?: string) {
    if (!window.starMedia?.updateVideoMetadata) return
    try {
      const result = await window.starMedia.updateVideoMetadata({ id: item.id, durationSeconds, thumbnailDataUrl })
      setLibraryItems(result.data.items)
      setSelectedItem((current) => (current?.id === item.id ? result.item : current))
      setPlayerItem((current) => (current?.id === item.id ? result.item : current))
      if (thumbnailDataUrl) notify('已设为当前帧封面。')
    } catch (error) {
      console.error(error)
      if (thumbnailDataUrl) notify('设为当前帧封面失败。')
    }
  }

  async function updateContainerTags(item: MediaItem, tags: string[]) {
    if (!window.starMedia?.updateContainerTags) return
    try {
      const result = await window.starMedia.updateContainerTags({ id: item.id, tags })
      setLibraryItems(result.data.items)
      setSelectedItem((current) => (current?.id === item.id ? result.item : current))
      setReaderItem((current) => (current?.id === item.id ? result.item : current))
      setPlayerItem((current) => (current?.id === item.id ? result.item : current))
      return true
    } catch (error) {
      console.error(error)
      notify('保存标签失败。')
      return false
    }
  }

  async function updateMediaTags(item: MediaItem, tags: string[]) {
    if (!window.starMedia?.updateMediaTags) return
    try {
      const result = await window.starMedia.updateMediaTags({ id: item.id, tags })
      setLibraryItems(result.data.items)
      setSelectedItem((current) => (current?.id === item.id ? result.item : current))
      setReaderItem((current) => (current?.id === item.id ? result.item : current))
      setPlayerItem((current) => (current?.id === item.id ? result.item : current))
      return true
    } catch (error) {
      console.error(error)
      notify('保存标签失败。')
      return false
    }
  }

  async function addContainerTag(item: MediaItem, tag: string) {
    const value = tag.trim()
    if (!value) return
    const currentTags = Array.isArray(item.tags) ? item.tags : []
    const nextTags = currentTags.includes(value) ? currentTags : [...currentTags, value]
    if (!config.catalog.tags.includes(value)) {
      const nextConfig = { ...config, catalog: { ...config.catalog, tags: [...config.catalog.tags, value] } }
      setConfig(nextConfig)
      if (!(await persistConfig(nextConfig))) {
        notify('标签保存失败。')
        throw new Error('标签保存失败')
      }
    }
    const updateTags = item.library === 'creator' || item.library === 'general' ? updateMediaTags : updateContainerTags
    if (!(await updateTags(item, nextTags))) throw new Error('标签保存失败')
  }

  async function updateVideoEpisode(item: MediaItem, episode: string) {
    if (!window.starMedia?.updateVideoEpisode) return
    try {
      const result = await window.starMedia.updateVideoEpisode({ id: item.id, episode })
      setLibraryItems(result.data.items)
      setSelectedItem((current) => (current?.id === item.id ? result.item : current))
      setReaderItem((current) => (current?.id === item.id ? result.item : current))
      setPlayerItem((current) => (current?.id === item.id ? result.item : current))
      notify('已保存视频名称。')
      return result.item
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? `保存视频名称失败：${error.message}` : '保存视频名称失败。')
      throw error
    }
  }

  async function clearEmptyMediaDirectories() {
    if (!window.starMedia?.clearEmptyMediaDirectories) return
    if (!config.mediaRoot.trim()) {
      notify('请先设置媒体数据总目录。')
      return
    }
    if (!window.confirm('只会清理未配置为媒体库路径的空文件夹；媒体库根目录及其中的文件不会删除。是否继续？')) return
    try {
      const result = await window.starMedia.clearEmptyMediaDirectories()
      notify(result.removedCount > 0 ? `已清理 ${result.removedCount} 个空文件夹。` : '没有发现可清理的空文件夹。')
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? `清理空文件夹失败：${error.message}` : '清理空文件夹失败。')
    }
  }

  async function clearInvalidRecords() {
    if (!window.starMedia?.getLibrary) return
    if (!(await flushConfigSave())) {
      notify('路径配置尚未保存，已取消清理。')
      return
    }
    if (
      !window.confirm(
        '会清理当前可访问的受管理媒体库中主文件已不存在的记录。媒体库根目录不可访问时会保留记录，不会删除任何实际文件。是否继续？',
      )
    )
      return
    try {
      const previousIds = new Set(libraryItems.map((item) => item.id))
      const result = await window.starMedia.getLibrary()
      const currentIds = new Set(result.data.items.map((item) => item.id))
      const removedCount = [...previousIds].filter((id) => !currentIds.has(id)).length
      setLibraryItems(result.data.items)
      setSelectedMediaIds((current) => current.filter((id) => currentIds.has(id)))
      setSelectedItem((current) => (current && currentIds.has(current.id) ? current : null))
      if (readerItem && !currentIds.has(readerItem.id)) closeBookReader()
      if (playerItem && !currentIds.has(playerItem.id)) closeVideoPlayer()
      notify(removedCount > 0 ? `已清理 ${removedCount} 条失效记录。` : '没有发现需要清理的失效记录。')
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? `清理失效记录失败：${error.message}` : '清理失效记录失败。')
    }
  }

  async function updateContainerNote(item: MediaItem, note: string) {
    if (!window.starMedia?.updateContainerInfo) return
    try {
      const result = await window.starMedia.updateContainerInfo({ id: item.id, note })
      setLibraryItems(result.data.items)
      setSelectedItem((current) => (current?.id === item.id ? result.item : current))
      setReaderItem((current) => (current?.id === item.id ? result.item : current))
      setPlayerItem((current) => (current?.id === item.id ? result.item : current))
      notify('已保存简介。')
    } catch (error) {
      console.error(error)
      notify('保存简介失败。')
    }
  }

  async function updateContainerMetadata(item: MediaItem, metadata: ContainerMetadata) {
    if (!window.starMedia?.updateContainerInfo) return item
    const oldAffiliation = getMediaAffiliation(item)
    const oldShelf = getMediaShelf(item)
    try {
      const containerMetadata =
        item.kind === 'book' || item.library === 'creator'
          ? { id: item.id, name: metadata.name }
          : {
              id: item.id,
              name: metadata.name,
              originalTitle: metadata.originalTitle,
              studio: metadata.studio,
              firstAiredAt: metadata.firstAiredAt,
            }
      const result = await window.starMedia.updateContainerInfo(containerMetadata)
      if (item.library === 'creator' && metadata.name.trim() && !config.catalog.creators.includes(metadata.name.trim())) {
        const nextConfig = { ...config, catalog: { ...config.catalog, creators: [...config.catalog.creators, metadata.name.trim()] } }
        setConfig(nextConfig)
        await persistConfig(nextConfig)
      }
      setLibraryItems(result.data.items)
      setSelectedItem((current) => (current?.id === item.id ? result.item : current))
      setReaderItem((current) => (current?.id === item.id ? result.item : current))
      setPlayerItem((current) => (current?.id === item.id ? result.item : current))
      if (selectedAffiliation === oldAffiliation && result.item.affiliation) setSelectedAffiliation(result.item.affiliation)
      if (selectedShelf === oldShelf && result.item.shelf) setSelectedShelf(result.item.shelf)
      notify(item.kind === 'book' ? '已保存书架资料。' : '已保存合集资料。')
      return result.item
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? error.message : '保存合集资料失败。')
      throw error
    }
  }

  async function updateBookMetadata(item: MediaItem, metadata: { creator: string; releaseDate: string }) {
    if (!window.starMedia?.updateMediaInfo) return
    try {
      const result = await window.starMedia.updateMediaInfo({ id: item.id, ...metadata })
      const creator = metadata.creator.trim()
      if (creator && !config.catalog.creators.includes(creator)) {
        const nextConfig = { ...config, catalog: { ...config.catalog, creators: [...config.catalog.creators, creator] } }
        setConfig(nextConfig)
        await persistConfig(nextConfig)
      }
      setLibraryItems(result.data.items)
      setSelectedItem((current) => (current?.id === item.id ? result.item : current))
      setReaderItem((current) => (current?.id === item.id ? result.item : current))
      notify('已保存本子资料。')
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? error.message : '保存本子资料失败。')
      throw error
    }
  }

  async function updateVideoReleaseDate(item: MediaItem, releaseDate: string) {
    if (!window.starMedia?.updateMediaInfo) return item
    try {
      const result = await window.starMedia.updateMediaInfo({ id: item.id, releaseDate })
      setLibraryItems(result.data.items)
      setSelectedItem((current) => (current?.id === item.id ? result.item : current))
      setPlayerItem((current) => (current?.id === item.id ? result.item : current))
      notify('已保存单集日期。')
      return result.item
    } catch (error) {
      console.error(error)
      notify(error instanceof Error ? `保存单集日期失败：${error.message}` : '保存单集日期失败。')
      throw error
    }
  }

  async function searchBangumiSubjects(query: string) {
    if (!window.starMedia?.searchBangumiSubjects) throw new Error('当前运行环境无法访问 Bangumi。')
    const result = await window.starMedia.searchBangumiSubjects({ query })
    return result.subjects
  }

  async function previewBangumiSubject(subjectId: number) {
    if (!window.starMedia?.previewBangumiSubject) throw new Error('当前运行环境无法读取 Bangumi 资料。')
    const result = await window.starMedia.previewBangumiSubject({ subjectId })
    return result.preview
  }

  async function applyBangumiSubject(
    item: MediaItem,
    subjectId: number,
    fields: StarMediaScrapeFields,
  ): Promise<StarMediaBangumiSubject | undefined> {
    if (!window.starMedia?.applyBangumiSubject) throw new Error('当前运行环境无法访问 Bangumi。')
    const previousAffiliation = getMediaAffiliation(item)
    const result = await window.starMedia.applyBangumiSubject({ id: item.id, subjectId, fields })
    setLibraryItems(result.data.items)
    const scrapedItem = result.item
    if (scrapedItem) {
      setSelectedItem((current) => (current?.id === scrapedItem.id ? scrapedItem : current))
      setPlayerItem((current) => (current?.id === scrapedItem.id ? scrapedItem : current))
      setSelectedAffiliation((current) => (current === previousAffiliation && scrapedItem.affiliation ? scrapedItem.affiliation : current))
    }
    notify('已按选择的字段应用 Bangumi 资料。')
    return result.subject
  }

  async function searchHanimeSubjects(query: string, source: 'freeanimehentai' | 'hanime1') {
    const sourceLabel = source === 'hanime1' ? 'Hanime1' : 'FreeAnimeHentai'
    if (!window.starMedia?.searchHanimeSubjects) throw new Error(`当前运行环境无法访问 ${sourceLabel}。`)
    const result = await window.starMedia.searchHanimeSubjects({ query, source })
    return result.subjects
  }

  async function previewHanimeSubject(subjectId: number, source: 'freeanimehentai' | 'hanime1') {
    const sourceLabel = source === 'hanime1' ? 'Hanime1' : 'FreeAnimeHentai'
    if (!window.starMedia?.previewHanimeSubject) throw new Error(`当前运行环境无法读取 ${sourceLabel} 资料。`)
    const result = await window.starMedia.previewHanimeSubject({ subjectId, source })
    return result.preview
  }

  async function applyHanimeSubject(
    item: MediaItem,
    subjectId: number,
    source: 'freeanimehentai' | 'hanime1',
    fields: StarMediaScrapeFields,
  ): Promise<StarMediaHanimeSubject | undefined> {
    const sourceLabel = source === 'hanime1' ? 'Hanime1' : 'FreeAnimeHentai'
    if (!window.starMedia?.applyHanimeSubject) throw new Error(`当前运行环境无法访问 ${sourceLabel}。`)
    const result = await window.starMedia.applyHanimeSubject({ id: item.id, subjectId, source, fields })
    setLibraryItems(result.data.items)
    const scrapedItem = result.item
    if (scrapedItem) {
      setSelectedItem((current) => (current?.id === scrapedItem.id ? scrapedItem : current))
      setPlayerItem((current) => (current?.id === scrapedItem.id ? scrapedItem : current))
    }
    notify(`已按选择的字段应用 ${sourceLabel} 资料。`)
    return result.subject
  }

  async function openBangumiTokenPage() {
    if (!window.starMedia?.openBangumiTokenPage) {
      notify('当前运行环境无法打开 Bangumi 登录页。')
      return
    }
    try {
      await window.starMedia.openBangumiTokenPage()
      notify('已打开 Bangumi 登录页；生成令牌后复制回“访问令牌”即可。')
    } catch (error) {
      console.error(error)
      notify('无法打开 Bangumi 登录页。')
    }
  }

  async function verifyBangumiToken() {
    if (!window.starMedia?.verifyBangumiToken) throw new Error('当前运行环境无法验证 Bangumi 令牌。')
    return window.starMedia.verifyBangumiToken()
  }

  async function testNetworkProxy(configToTest: StarMediaConfig) {
    if (!window.starMedia?.testNetworkProxy) throw new Error('当前运行环境无法测试应用代理。')
    if (!(await persistConfig(configToTest))) throw new Error('代理配置保存失败。')
    return window.starMedia.testNetworkProxy()
  }

  function updateMediaRoot(mediaRoot: string) {
    setConfig((current) => ({
      ...current,
      mediaRoot,
      libraries: makeLibraryRoots(mediaRoot, current.libraries),
    }))
  }

  return (
    <div className={`app-shell theme-${config.theme}`}>
      <aside className="sidebar">
        <div className="brand-row">
          <img className="brand-mark" src={logoUrl} alt="" />
          <div className="brand-name">StarMedia</div>
        </div>

        <nav className="library-nav" aria-label="媒体库导航">
          <div className="nav-label">媒体库</div>
          {libraries.map((library) => (
            <NavigationButton
              key={library.id}
              label={library.label}
              icon={<library.icon size={20} />}
              active={activeNavigation === library.id}
              onClick={() => selectNavigation(library.id)}
            />
          ))}
        </nav>

        <div className="sidebar-footer">
          <NavigationButton
            label="资源导入"
            icon={<FolderInput size={20} />}
            active={activeNavigation === 'import'}
            onClick={() => selectNavigation('import')}
          />
          <NavigationButton
            label="分类标签"
            icon={<Tags size={20} />}
            active={activeNavigation === 'vocabularies'}
            onClick={() => selectNavigation('vocabularies')}
          />
          <NavigationButton
            label="应用设置"
            icon={<Settings size={20} />}
            active={activeNavigation === 'settings'}
            onClick={() => selectNavigation('settings')}
          />
        </div>
      </aside>

      <main className="main-content">
        {!readerItem && !playerItem && (
          <header className={`topbar ${activeLibrary ? 'media-topbar' : 'window-topbar'}`}>
            {activeLibrary ? (
              <>
                <div className="search-shell">
                  <Search size={18} aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索标题、作者、作品、标签…"
                    aria-label="搜索媒体"
                  />
                  {query && (
                    <button className="search-clear" onClick={() => setQuery('')} aria-label="清除搜索">
                      <X size={16} />
                    </button>
                  )}
                </div>
                <DropdownSelect
                  className="scope-dropdown"
                  value={scope}
                  onChange={(value) => setScope(value as Scope)}
                  options={[
                    { value: 'all', label: '全部媒体库' },
                    ...(activeLibrary ? [{ value: 'current', label: `当前：${activeLibrary.label}` }] : []),
                    ...libraries.map((library) => ({ value: library.id, label: library.label })),
                  ]}
                />
              </>
            ) : (
              <div className="window-drag-region" aria-hidden="true" />
            )}
            <WindowControls onRequestClose={requestCloseWindow} />
          </header>
        )}

        {activeNavigation === 'settings' ? (
          <SettingsView
            config={config}
            configMeta={configMeta}
            appVersion={appVersion}
            capabilities={settingsCapabilities}
            onChange={setConfig}
            onPickMediaRoot={chooseMediaRoot}
            onPickLibraryRoot={chooseLibraryRoot}
            onMediaRootChange={updateMediaRoot}
            onClearImportedRecords={clearImportedRecords}
            onClearEmptyMediaDirectories={clearEmptyMediaDirectories}
            onClearInvalidRecords={clearInvalidRecords}
            onExportAppData={exportAppData}
            exportingAppData={exportingAppData}
            onImportAppData={importAppData}
            onInstallLocalUpdate={installLocalUpdate}
            installingLocalUpdate={installingLocalUpdate}
            githubUpdate={githubUpdate}
            githubUpdateProgress={githubUpdateProgress}
            checkingGitHubUpdate={checkingGitHubUpdate}
            onCheckGitHubUpdate={checkGitHubUpdate}
            onInstallGitHubUpdate={installGitHubUpdate}
            onRegenerateThumbnails={regenerateThumbnails}
            onClearCaches={clearCaches}
            onOpenBangumiTokenPage={openBangumiTokenPage}
            onVerifyBangumiToken={verifyBangumiToken}
            onTestNetworkProxy={testNetworkProxy}
          />
        ) : activeNavigation === 'vocabularies' ? (
          <VocabularyView config={config} onChange={setConfig} />
        ) : activeNavigation === 'import' ? (
          <ImportView
            sourcePaths={importSources}
            targetLibrary={importLibrary}
            onTargetLibraryChange={setImportLibrary}
            plan={importPlan}
            status={importStatus}
            error={importError}
            apiAvailable={apiAvailable}
            onSourcePathsChange={updateImportSources}
            onPickSource={chooseImportSource}
            onGeneratePlan={generateImportPlan}
            onScanManagedLibraries={scanManagedLibraries}
            onImportRecords={importMediaRecords}
            importOperation={importOperation}
            importProgress={importProgress}
            onPlanItemChange={updateImportPlanItem}
            onPlanItemsChange={updateImportPlanItems}
          />
        ) : (
          <LibraryBrowser
            activeLibrary={activeLibrary}
            queryActive={Boolean(query.trim())}
            visibleItems={visibleItems}
            isAffiliationLibrary={isAffiliationLibrary}
            isShelfLibrary={isShelfLibrary}
            selectedAffiliation={selectedAffiliation}
            selectedShelf={selectedShelf}
            selectedIds={selectedMediaIds}
            viewMode="large"
            primaryFilter={primaryFilter}
            tagFilter={tagFilter}
            sortMode={sortMode}
            sortDirection={sortDirection}
            primaryOptions={primaryOptions}
            tagOptions={tagOptions}
            sortOptions={sortOptions}
            onBrowseStateChange={updateBrowseState}
            onReset={() => {
              resetBrowseFilters()
              setQuery('')
            }}
            onClearSelection={() => {
              setSelectedMediaIds([])
              setMediaBatchMenu(null)
            }}
            onOpenAffiliation={(affiliation) => {
              setSelectedAffiliation(affiliation)
              setSelectedMediaIds([])
            }}
            onOpenShelf={(shelf) => {
              setSelectedShelf(shelf)
              setSelectedMediaIds([])
            }}
            onOpenItem={setSelectedItem}
            onToggleSelection={toggleMediaSelection}
            onOpenBatchMenu={openMediaBatchMenu}
            onOpenBatchMenuForItems={openMediaBatchMenuForItems}
            onSelectMany={selectMediaItems}
            affiliationOverview={
              selectedAffiliation && (
                <ContainerOverview
                  kind="affiliation"
                  name={selectedAffiliation}
                  items={affiliationItems}
                  availableTags={config.catalog.tags}
                  onContainerImport={() => void importIntoContainer(activeLibrary?.id ?? 'general', selectedAffiliation)}
                  importing={directImporting}
                  onBack={() => {
                    setSelectedAffiliation(null)
                    setSelectedMediaIds([])
                  }}
                  onOpen={setSelectedItem}
                  onSaveNote={updateContainerNote}
                  onSaveMetadata={updateContainerMetadata}
                  onSaveTags={updateContainerTags}
                  onAddTag={addContainerTag}
                  onSearchBangumi={searchBangumiSubjects}
                  onPreviewBangumi={previewBangumiSubject}
                  onApplyBangumi={applyBangumiSubject}
                  onSearchHanime={searchHanimeSubjects}
                  onPreviewHanime={previewHanimeSubject}
                  onApplyHanime={applyHanimeSubject}
                  selectedIds={selectedMediaIds}
                  onToggleSelection={toggleMediaSelection}
                  onOpenBatchMenu={openMediaBatchMenu}
                  onSelectMany={selectMediaItems}
                />
              )
            }
            shelfOverview={
              selectedShelf && (
                <ContainerOverview
                  kind="shelf"
                  name={selectedShelf}
                  items={shelfItems}
                  availableTags={config.catalog.tags}
                  onContainerImport={() => void importIntoContainer(activeLibrary?.id ?? 'books', selectedShelf)}
                  importing={directImporting}
                  onBack={() => {
                    setSelectedShelf(null)
                    setSelectedMediaIds([])
                  }}
                  onOpen={setSelectedItem}
                  onSaveNote={updateContainerNote}
                  onSaveMetadata={updateContainerMetadata}
                  onSaveTags={updateContainerTags}
                  onAddTag={addContainerTag}
                  selectedIds={selectedMediaIds}
                  onToggleSelection={toggleMediaSelection}
                  onOpenBatchMenu={openMediaBatchMenu}
                  onSelectMany={selectMediaItems}
                />
              )
            }
          />
        )}
      </main>

      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          availableTags={config.catalog.tags}
          classifications={config.catalog.classifications}
          availableCreators={config.catalog.creators}
          availableAffiliations={[
            ...new Set(
              libraryItems.filter((entry) => entry.kind === 'video' && entry.library === selectedItem.library).map(getMediaAffiliation),
            ),
          ]}
          onUpdateTags={(item, tags) =>
            void (item.library === 'creator' || item.library === 'general' ? updateMediaTags(item, tags) : updateContainerTags(item, tags))
          }
          onAddTag={addContainerTag}
          onUpdateBookMetadata={updateBookMetadata}
          onUpdateVideoEpisode={updateVideoEpisode}
          onUpdateVideoReleaseDate={updateVideoReleaseDate}
          onMoveVideo={moveSingleVideo}
          onTrash={trashSingleMedia}
          onReplaceVideo={(item) => void importIntoContainer(item.library, getMediaAffiliation(item), item.id)}
          onClose={() => setSelectedItem(null)}
          onRead={openBookReader}
          onPlayVideo={openVideoPlayer}
          onOpenExternal={openVideoExternally}
        />
      )}
      {readerItem && (
        <BookReader
          item={readerItem}
          sessionId={readerSessionId}
          pages={readerPages}
          status={readerStatus}
          errorMessage={readerError}
          onClose={closeBookReader}
        />
      )}
      {playerItem && (
        <VideoPlayer
          item={playerItem}
          sourceUrl={videoUrl}
          mimeType={videoMimeType}
          subtitles={videoSubtitles}
          status={videoPlayerStatus}
          errorMessage={videoPlayerError}
          onClose={closeVideoPlayer}
          onOpenExternal={openVideoExternally}
          onMetadata={saveVideoMetadata}
          onFeedback={notify}
        />
      )}
      {mediaBatchMenu && selectedMediaIds.length > 0 && (
        <MediaBatchMenu
          position={mediaBatchMenu}
          items={libraryItems.filter((item) => selectedMediaIds.includes(item.id))}
          onApplyShelf={updateBookShelves}
          onTransfer={transferSelectedMedia}
          onTrash={trashSelectedMedia}
          onClose={() => setMediaBatchMenu(null)}
        />
      )}
      {notice && (
        <div className="notice" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
    </div>
  )
}

function WindowControls({ onRequestClose }: { onRequestClose: () => Promise<void> }) {
  return (
    <div className="window-controls">
      <button className="window-control-button" onClick={() => void window.starMedia?.minimizeWindow?.()} aria-label="最小化">
        <Minus size={16} />
      </button>
      <button className="window-control-button" onClick={() => void window.starMedia?.toggleMaximizeWindow?.()} aria-label="最大化或还原">
        <Maximize2 size={15} />
      </button>
      <button className="window-control-button close" onClick={() => void onRequestClose()} aria-label="退出应用">
        <X size={16} />
      </button>
    </div>
  )
}

function isLibraryNavigation(id: SectionId): id is LibraryId {
  return id !== 'import' && id !== 'settings' && id !== 'vocabularies'
}

function joinWindowsPath(root: string, child: string) {
  const trimmed = root.trim().replace(/[\\/]+$/, '')
  return trimmed ? `${trimmed}\\${child}` : ''
}

function pathDirectory(value: string) {
  const normalized = value.replace(/\//g, '\\')
  const index = normalized.lastIndexOf('\\')
  return index >= 0 ? normalized.slice(0, index) : ''
}

function NavigationButton({
  label,
  icon,
  active = false,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  active?: boolean
  onClick: () => void
}) {
  return (
    <button className={`navigation-button ${active ? 'active' : ''}`} onClick={onClick} title={label}>
      <span className="navigation-icon">{icon}</span>
      <span className="navigation-label">{label}</span>
    </button>
  )
}

export default App
