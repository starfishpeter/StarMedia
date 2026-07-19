const path = require('node:path')
const { libraryIds, librarySortModes } = require('./library-definitions.cjs')
const { normalizeProxyUrl } = require('./system-network-service.cjs')

const MAX_ID_LENGTH = 4096
const MAX_PATH_LENGTH = 32767
const MAX_TEXT_LENGTH = 1200
const MAX_BATCH_ITEMS = 1000
const MAX_IMPORT_SOURCES = 100
const MAX_THUMBNAIL_DATA_URL_LENGTH = 4 * 1024 * 1024
const knownLibraryIds = new Set(libraryIds)
const scrapeSources = new Set(['freeanimehentai', 'hanime1'])
const scrapeModes = new Set(['cover', 'metadata', 'both'])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function fail(message) {
  throw new Error(`IPC 请求无效：${message}`)
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function object(value, label, keys) {
  if (!isPlainObject(value)) fail(`${label}必须是对象`)
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${label}包含不支持的字段：${key}`)
  }
  return value
}

function string(value, label, { min = 0, max = MAX_TEXT_LENGTH, trim = false } = {}) {
  if (typeof value !== 'string') fail(`${label}必须是字符串`)
  const result = trim ? value.trim() : value
  if (result.length < min) fail(`${label}不能为空`)
  if (result.length > max) fail(`${label} 过长`)
  return result
}

function id(value, label = 'ID') {
  return string(value, label, { min: 1, max: MAX_ID_LENGTH, trim: true })
}

function absolutePath(value, label) {
  const result = string(value, label, { min: 1, max: MAX_PATH_LENGTH, trim: true })
  if (!path.isAbsolute(result)) fail(`${label}必须是绝对路径`)
  return result
}

function positiveInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) fail(`${label}必须是有效的正整数`)
  return value
}

function nonNegativeInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(`${label}必须是有效的非负整数`)
  return value
}

function enumValue(value, values, label) {
  if (typeof value !== 'string' || !values.has(value)) fail(`${label}无效`)
  return value
}

function optionalEnum(value, values, label) {
  return value === undefined ? undefined : enumValue(value, values, label)
}

function list(value, label, { min = 0, max = MAX_BATCH_ITEMS, item }) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label}数量无效`)
  return value.map((entry, index) => item(entry, `${label}[${index}]`))
}

function uniqueIds(value, label, { min = 1, max = MAX_BATCH_ITEMS } = {}) {
  const values = list(value, label, { min, max, item: (entry, itemLabel) => id(entry, itemLabel) })
  if (new Set(values).size !== values.length) fail(`${label}不能包含重复项`)
  return values
}

function noArguments(args) {
  if (args.length !== 0) fail('此操作不接受参数')
  return []
}

function oneArgument(args, parser) {
  if (args.length !== 1) fail('参数数量不正确')
  return [parser(args[0])]
}

function parseLibraryId(value, label = '目标媒体库') {
  return enumValue(value, knownLibraryIds, label)
}

function parseTags(value, label = '标签') {
  const tags = list(value, label, {
    max: 100,
    item: (entry, itemLabel) => string(entry, itemLabel, { min: 1, max: 80, trim: true }),
  })
  if (new Set(tags).size !== tags.length) fail(`${label}不能包含重复项`)
  return tags
}

function parseFields(value) {
  const fields = object(value, 'fields', ['cover', 'affiliation', 'originalTitle', 'studio', 'firstAiredAt', 'releaseDate', 'note'])
  const result = {}
  if (fields.cover !== undefined) {
    if (typeof fields.cover !== 'boolean') fail('fields.cover必须是布尔值')
    result.cover = fields.cover
  }
  for (const key of ['affiliation', 'originalTitle', 'studio']) {
    if (fields[key] !== undefined) result[key] = string(fields[key], `fields.${key}`, { max: 200, trim: true })
  }
  for (const key of ['firstAiredAt', 'releaseDate']) {
    if (fields[key] !== undefined) result[key] = string(fields[key], `fields.${key}`, { max: 40, trim: true })
  }
  if (fields.note !== undefined) result.note = string(fields.note, 'fields.note', { max: 1200, trim: true })
  return result
}

function parseScrapeRequest(value, { includeItemId = false, allowSource = false } = {}) {
  const keys = ['subjectId']
  if (allowSource) keys.push('source')
  if (includeItemId) keys.push('id', 'mode', 'fields')
  const input = object(value, '请求', keys)
  const result = { subjectId: positiveInteger(input.subjectId, '条目 ID', 2_147_483_647) }
  if (allowSource && input.source !== undefined) result.source = enumValue(input.source, scrapeSources, '刮削来源')
  if (includeItemId) {
    result.id = id(input.id, '媒体 ID')
    if (input.mode !== undefined) result.mode = enumValue(input.mode, scrapeModes, '刮削模式')
    if (input.fields !== undefined) result.fields = parseFields(input.fields)
  }
  return result
}

function parseConfig(value) {
  const config = object(value, '配置', [
    'schemaVersion',
    'updatedAt',
    'mediaRoot',
    'theme',
    'cacheLimitMb',
    'confirmBeforeClose',
    'showExternalSubtitleBadges',
    'network',
    'scraping',
    'libraries',
    'catalog',
  ])
  if (config.schemaVersion !== 3) fail('配置版本无效')
  string(config.updatedAt, '配置更新时间', { min: 1, max: 80, trim: true })
  if (!['dark', 'light', 'blue'].includes(config.theme)) fail('主题无效')
  if (!Number.isFinite(config.cacheLimitMb) || config.cacheLimitMb < 128 || config.cacheLimitMb > 8192) fail('缓存上限无效')
  if (typeof config.confirmBeforeClose !== 'boolean') fail('关闭确认设置无效')
  if (typeof config.showExternalSubtitleBadges !== 'boolean') fail('外挂字幕角标设置无效')

  const network = object(config.network, '网络配置', ['proxyEnabled', 'proxyUrl'])
  if (typeof network.proxyEnabled !== 'boolean') fail('代理开关无效')
  const proxyUrl = string(network.proxyUrl, '代理地址', { max: 2000, trim: true })
  if (network.proxyEnabled) {
    try {
      normalizeProxyUrl(proxyUrl)
    } catch (error) {
      fail(error.message)
    }
  }

  const mediaRoot = string(config.mediaRoot, '媒体数据总目录', { max: MAX_PATH_LENGTH, trim: true })
  if (mediaRoot && !path.isAbsolute(mediaRoot)) fail('媒体数据总目录必须是绝对路径')
  const scraping = object(config.scraping, '刮削配置', ['bangumiToken', 'bangumiEndpoint', 'hanime1Endpoint'])
  string(scraping.bangumiToken, 'Bangumi 令牌', { max: 4096, trim: true })
  string(scraping.bangumiEndpoint, 'Bangumi 地址', { min: 1, max: 2000, trim: true })
  string(scraping.hanime1Endpoint, 'Hanime1 地址', { min: 1, max: 2000, trim: true })

  const libraries = object(config.libraries, '媒体库配置', libraryIds)
  for (const libraryId of libraryIds) {
    const library = object(libraries[libraryId], `${libraryId} 媒体库配置`, ['rootPath', 'enabled', 'sortMode', 'sortDirection'])
    const rootPath = string(library.rootPath, `${libraryId} 根目录`, { max: MAX_PATH_LENGTH, trim: true })
    if (rootPath && !path.isAbsolute(rootPath)) fail(`${libraryId} 根目录必须是绝对路径`)
    if (typeof library.enabled !== 'boolean') fail(`${libraryId} 启用状态无效`)
    if (!librarySortModes[libraryId].includes(library.sortMode)) fail(`${libraryId} 排序方式无效`)
    if (!['ascending', 'descending'].includes(library.sortDirection)) fail(`${libraryId} 排序方向无效`)
  }

  const catalog = object(config.catalog, '词汇配置', ['tags'])
  parseTags(catalog.tags, '词汇标签')
  return config
}

function parseImportPlanRequest(value) {
  const input = object(value, '导入计划', [
    'sourcePath',
    'sourcePaths',
    'targetLibrary',
    'affiliation',
    'shelf',
    'replacementItemId',
    'scanManagedLibraries',
  ])
  if (input.scanManagedLibraries !== undefined && typeof input.scanManagedLibraries !== 'boolean') fail('媒体库扫描选项无效')
  if (input.scanManagedLibraries === true) {
    if (input.sourcePath !== undefined || input.sourcePaths !== undefined) fail('扫描媒体库时不能同时指定来源路径')
    if (input.targetLibrary !== 'auto') fail('扫描媒体库必须使用自动分配')
    if (input.affiliation !== undefined || input.shelf !== undefined || input.replacementItemId !== undefined)
      fail('扫描媒体库时不能指定合集、书架或替换目标')
    return { sourcePaths: [], targetLibrary: 'auto', scanManagedLibraries: true }
  }
  const hasSourcePath = input.sourcePath !== undefined
  const hasSourcePaths = input.sourcePaths !== undefined
  if (hasSourcePath === hasSourcePaths) fail('必须提供一个来源路径或来源路径列表')
  const sourcePaths = hasSourcePaths
    ? list(input.sourcePaths, '来源路径', { min: 1, max: MAX_IMPORT_SOURCES, item: absolutePath })
    : [absolutePath(input.sourcePath, '来源路径')]
  if (new Set(sourcePaths.map((sourcePath) => path.resolve(sourcePath).toLocaleLowerCase())).size !== sourcePaths.length)
    fail('来源路径不能重复')
  const targetLibrary = input.targetLibrary === 'auto' ? 'auto' : parseLibraryId(input.targetLibrary)
  const result = { sourcePaths, targetLibrary }
  if (input.affiliation !== undefined) result.affiliation = string(input.affiliation, '合集名称', { max: 200, trim: true })
  if (input.shelf !== undefined) result.shelf = string(input.shelf, '书架名称', { max: 200, trim: true })
  if (input.replacementItemId !== undefined) result.replacementItemId = id(input.replacementItemId, '替换媒体 ID')
  return result
}

function parseImportMediaRequest(value) {
  const input = object(value, '导入请求', ['planId', 'items'])
  const planId = string(input.planId, '导入计划 ID', { min: 1, max: 80, trim: true })
  if (!uuidPattern.test(planId)) fail('导入计划 ID 无效')
  const items = list(input.items, '导入项目', {
    max: MAX_BATCH_ITEMS,
    item: (entry, label) => {
      const item = object(entry, label, ['id', 'library', 'affiliation', 'shelf', 'episode', 'replacementItemId'])
      const result = { id: id(item.id, `${label}.id`) }
      if (item.library !== undefined) result.library = parseLibraryId(item.library, `${label}.library`)
      if (item.affiliation !== undefined) result.affiliation = string(item.affiliation, `${label}.affiliation`, { max: 200, trim: true })
      if (item.shelf !== undefined) result.shelf = string(item.shelf, `${label}.shelf`, { max: 200, trim: true })
      if (item.episode !== undefined) result.episode = string(item.episode, `${label}.episode`, { max: 200, trim: true })
      if (item.replacementItemId !== undefined) result.replacementItemId = id(item.replacementItemId, `${label}.replacementItemId`)
      return result
    },
  })
  if (new Set(items.map((item) => item.id)).size !== items.length) fail('导入项目不能重复')
  return { planId, items }
}

function parseContainerInfo(value) {
  const input = object(value, '合集资料', ['id', 'tags', 'note', 'name', 'originalTitle', 'studio', 'firstAiredAt', 'releaseDate'])
  const result = { id: id(input.id, '媒体 ID') }
  if (input.tags !== undefined) result.tags = parseTags(input.tags)
  if (input.note !== undefined) result.note = string(input.note, '备注', { max: 1200, trim: true })
  if (input.name !== undefined) result.name = string(input.name, '名称', { min: 1, max: 200, trim: true })
  if (input.originalTitle !== undefined) result.originalTitle = string(input.originalTitle, '原名', { max: 200, trim: true })
  if (input.studio !== undefined) result.studio = string(input.studio, '制作公司', { max: 200, trim: true })
  if (input.firstAiredAt !== undefined) result.firstAiredAt = string(input.firstAiredAt, '首播日期', { max: 40, trim: true })
  if (input.releaseDate !== undefined) result.releaseDate = string(input.releaseDate, '发售日期', { max: 40, trim: true })
  if (Object.keys(result).length === 1) fail('没有需要保存的合集资料')
  return result
}

const IPC_CONTRACTS = Object.freeze({
  'config:load': { request: [], response: 'StarMediaConfigResult', parse: noArguments },
  'config:save': { request: ['StarMediaConfig'], response: 'StarMediaConfigResult', parse: (args) => oneArgument(args, parseConfig) },
  'import:createPlan': {
    request: ['StarMediaImportPlanRequest'],
    response: 'StarMediaImportPlan',
    parse: (args) => oneArgument(args, parseImportPlanRequest),
  },
  'library:load': { request: [], response: 'StarMediaLibraryResult', parse: noArguments },
  'library:getUsage': {
    request: ['libraryId'],
    response: 'StarMediaLibraryUsage',
    parse: (args) => oneArgument(args, (value) => parseLibraryId(value, '媒体库 ID')),
  },
  'library:importMedia': {
    request: ['StarMediaImportMediaRequest'],
    response: 'StarMediaImportResult',
    parse: (args) => oneArgument(args, parseImportMediaRequest),
  },
  'library:clearRecords': { request: [], response: 'StarMediaLibraryResult', parse: noArguments },
  'video:getPlayback': {
    request: ['mediaId'],
    response: 'StarMediaVideoPlayback',
    parse: (args) => oneArgument(args, (value) => id(value, '媒体 ID')),
  },
  'video:getPlaybackSupport': {
    request: ['mediaId'],
    response: 'boolean',
    parse: (args) => oneArgument(args, (value) => id(value, '媒体 ID')),
  },
  'video:openExternal': {
    request: ['mediaId'],
    response: 'StarMediaExternalOpenResult',
    parse: (args) => oneArgument(args, (value) => id(value, '媒体 ID')),
  },
  'video:updateMetadata': {
    request: ['StarMediaVideoMetadataRequest'],
    response: 'StarMediaLibraryResult & { item: MediaItem }',
    parse: (args) =>
      oneArgument(args, (value) => {
        const input = object(value, '视频资料', ['id', 'durationSeconds', 'thumbnailDataUrl'])
        const durationSeconds = input.durationSeconds
        if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 604800)
          fail('视频时长无效')
        const result = { id: id(input.id, '媒体 ID'), durationSeconds }
        if (input.thumbnailDataUrl !== undefined)
          result.thumbnailDataUrl = string(input.thumbnailDataUrl, '视频缩略图', { min: 1, max: MAX_THUMBNAIL_DATA_URL_LENGTH })
        return result
      }),
  },
  'app:exportData': { request: [], response: 'StarMediaAppExportResult', parse: noArguments },
  'app:importData': {
    request: ['backupPath'],
    response: 'StarMediaAppImportResult',
    parse: (args) => oneArgument(args, (value) => absolutePath(value, '备份路径')),
  },
  'app:installLocalUpdate': { request: [], response: 'StarMediaLocalUpdateResult', parse: noArguments },
  'app:checkGitHubUpdate': { request: [], response: 'StarMediaGitHubUpdateResult', parse: noArguments },
  'app:installGitHubUpdate': { request: [], response: 'StarMediaLocalUpdateResult', parse: noArguments },
  'app:testNetworkProxy': { request: [], response: '{ status: number }', parse: noArguments },
  'book:open': {
    request: ['mediaId'],
    response: 'StarMediaBookOpenResult',
    parse: (args) => oneArgument(args, (value) => id(value, '媒体 ID')),
  },
  'book:getPage': {
    request: ['sessionId', 'index', 'options?'],
    response: 'StarMediaBookPage',
    parse: (args) => {
      if (args.length < 2 || args.length > 3) fail('参数数量不正确')
      const sessionId = string(args[0], '阅读会话 ID', { min: 1, max: 80, trim: true })
      if (!uuidPattern.test(sessionId)) fail('阅读会话 ID 无效')
      const index = nonNegativeInteger(args[1], '页码', 100000)
      if (args[2] === undefined) return [sessionId, index, undefined]
      const options = object(args[2], '阅读选项', ['force'])
      if (options.force !== undefined && typeof options.force !== 'boolean') fail('阅读选项无效')
      return [sessionId, index, options.force === true ? { force: true } : {}]
    },
  },
  'book:close': {
    request: ['sessionId'],
    response: 'void',
    parse: (args) =>
      oneArgument(args, (value) => {
        const sessionId = string(value, '阅读会话 ID', { min: 1, max: 80, trim: true })
        if (!uuidPattern.test(sessionId)) fail('阅读会话 ID 无效')
        return sessionId
      }),
  },
  'library:updateContainerTags': {
    request: ['StarMediaContainerTagsRequest'],
    response: 'StarMediaLibraryResult & { item: MediaItem }',
    parse: (args) =>
      oneArgument(args, (value) => {
        const input = object(value, '合集标签', ['id', 'tags'])
        return { id: id(input.id, '媒体 ID'), tags: parseTags(input.tags) }
      }),
  },
  'library:updateMediaTags': {
    request: ['StarMediaMediaTagsRequest'],
    response: 'StarMediaLibraryResult & { item: MediaItem }',
    parse: (args) =>
      oneArgument(args, (value) => {
        const input = object(value, '媒体标签', ['id', 'tags'])
        return { id: id(input.id, '媒体 ID'), tags: parseTags(input.tags) }
      }),
  },
  'library:updateContainerInfo': {
    request: ['StarMediaContainerInfoRequest'],
    response: 'StarMediaLibraryResult & { item: MediaItem }',
    parse: (args) => oneArgument(args, parseContainerInfo),
  },
  'library:updateMediaInfo': {
    request: ['StarMediaMediaInfoRequest'],
    response: 'StarMediaLibraryResult & { item: MediaItem }',
    parse: (args) =>
      oneArgument(args, (value) => {
        const input = object(value, '媒体资料', ['id', 'creator', 'releaseDate'])
        const result = { id: id(input.id, '媒体 ID') }
        if (input.creator !== undefined) result.creator = string(input.creator, '创作者', { max: 200, trim: true })
        if (input.releaseDate !== undefined) result.releaseDate = string(input.releaseDate, '发售日期', { max: 40, trim: true })
        if (Object.keys(result).length === 1) fail('没有需要保存的媒体资料')
        return result
      }),
  },
  'library:updateVideoEpisode': {
    request: ['StarMediaVideoEpisodeRequest'],
    response: 'StarMediaLibraryResult & { item: MediaItem }',
    parse: (args) =>
      oneArgument(args, (value) => {
        const input = object(value, '选集资料', ['id', 'episode'])
        return { id: id(input.id, '媒体 ID'), episode: string(input.episode, '选集名称', { min: 1, max: 200, trim: true }) }
      }),
  },
  'library:updateBookShelves': {
    request: ['StarMediaBookShelvesRequest'],
    response: 'StarMediaLibraryResult & { changedCount: number; shelf: string }',
    parse: (args) =>
      oneArgument(args, (value) => {
        const input = object(value, '书架资料', ['ids', 'shelf'])
        return { ids: uniqueIds(input.ids, '媒体 ID'), shelf: string(input.shelf, '书架名称', { max: 160, trim: true }) }
      }),
  },
  'library:transferItems': {
    request: ['StarMediaTransferRequest'],
    response: 'StarMediaLibraryResult & { movedCount: number; targetLibrary: LibraryId }',
    parse: (args) =>
      oneArgument(args, (value) => {
        const input = object(value, '转移请求', ['ids', 'targetLibrary'])
        return { ids: uniqueIds(input.ids, '媒体 ID'), targetLibrary: parseLibraryId(input.targetLibrary) }
      }),
  },
  'library:moveVideoAffiliation': {
    request: ['StarMediaMoveVideoRequest'],
    response: 'StarMediaLibraryResult & { movedCount: number; item: MediaItem }',
    parse: (args) =>
      oneArgument(args, (value) => {
        const input = object(value, '移动请求', ['id', 'affiliation'])
        return { id: id(input.id, '媒体 ID'), affiliation: string(input.affiliation, '目标合集名称', { min: 1, max: 200, trim: true }) }
      }),
  },
  'library:trashItems': {
    request: ['StarMediaTrashRequest'],
    response: 'StarMediaLibraryResult & { deletedCount: number; recordOnlyCount: number; failedCount?: number; errors?: string[] }',
    parse: (args) =>
      oneArgument(args, (value) => {
        const input = object(value, '删除请求', ['ids'])
        return { ids: uniqueIds(input.ids, '媒体 ID') }
      }),
  },
  'library:regenerateThumbnails': {
    request: [],
    response: 'StarMediaLibraryResult & { generatedCount: number; failedCount: number }',
    parse: noArguments,
  },
  'library:clearCaches': { request: [], response: 'StarMediaLibraryResult & { clearedCoverCount: number }', parse: noArguments },
  'library:clearEmptyMediaDirectories': { request: [], response: '{ removedCount: number }', parse: noArguments },
  'system:openPath': {
    request: ['targetPath'],
    response: '{ path: string }',
    parse: (args) => oneArgument(args, (value) => absolutePath(value, '目标路径')),
  },
  'bangumi:searchSubjects': {
    request: ['StarMediaSearchRequest'],
    response: '{ subjects: StarMediaBangumiSubject[] }',
    parse: (args) =>
      oneArgument(args, (value) => {
        const input = object(value, 'Bangumi 搜索请求', ['query'])
        return { query: string(input.query, '搜索词', { min: 1, max: 100, trim: true }) }
      }),
  },
  'bangumi:previewSubject': {
    request: ['StarMediaSubjectRequest'],
    response: '{ preview: StarMediaScrapePreview }',
    parse: (args) => oneArgument(args, (value) => parseScrapeRequest(value)),
  },
  'bangumi:applySubject': {
    request: ['StarMediaScrapeApplyRequest'],
    response: 'StarMediaLibraryResult & { item?: MediaItem; subject: StarMediaBangumiSubject }',
    parse: (args) => oneArgument(args, (value) => parseScrapeRequest(value, { includeItemId: true })),
  },
  'bangumi:openTokenPage': { request: [], response: '{ url: string }', parse: noArguments },
  'bangumi:verifyToken': { request: [], response: '{ valid: boolean; expiresAt: string | null; userName: string }', parse: noArguments },
  'hanime:searchSubjects': {
    request: ['StarMediaHanimeSearchRequest'],
    response: '{ subjects: StarMediaHanimeSubject[] }',
    parse: (args) =>
      oneArgument(args, (value) => {
        const input = object(value, 'Hanime 搜索请求', ['query', 'source'])
        const result = { query: string(input.query, '搜索词', { min: 1, max: 100, trim: true }) }
        if (input.source !== undefined) result.source = optionalEnum(input.source, scrapeSources, '刮削来源')
        return result
      }),
  },
  'hanime:previewSubject': {
    request: ['StarMediaHanimeSubjectRequest'],
    response: '{ preview: StarMediaScrapePreview }',
    parse: (args) => oneArgument(args, (value) => parseScrapeRequest(value, { allowSource: true })),
  },
  'hanime:applySubject': {
    request: ['StarMediaHanimeScrapeApplyRequest'],
    response: 'StarMediaLibraryResult & { item?: MediaItem; subject: StarMediaHanimeSubject }',
    parse: (args) => oneArgument(args, (value) => parseScrapeRequest(value, { includeItemId: true, allowSource: true })),
  },
  'window:minimize': { request: [], response: 'void', parse: noArguments },
  'window:toggleMaximize': { request: [], response: 'boolean', parse: noArguments },
  'window:close': { request: [], response: "'closed' | 'blocked'", parse: noArguments },
  'dialog:chooseDirectory': { request: [], response: 'string | null', parse: noArguments },
  'dialog:chooseImportSources': { request: [], response: 'string[]', parse: noArguments },
  'dialog:chooseVideoFile': { request: [], response: 'string | null', parse: noArguments },
  'dialog:chooseAppDataBackup': { request: [], response: 'string | null', parse: noArguments },
})

const IPC_EVENT_CONTRACTS = Object.freeze({
  'import:progress': { payload: 'StarMediaImportProgress' },
  'library:thumbnailsUpdated': { payload: 'MediaItem[]' },
  'app:githubUpdateProgress': { payload: 'StarMediaGitHubUpdateProgress' },
})

function parseIpcRequest(channel, args) {
  const contract = IPC_CONTRACTS[channel]
  if (!contract) throw new Error(`未定义的 IPC 通道：${channel}`)
  if (!Array.isArray(args)) throw new Error('IPC 请求参数必须是数组')
  return contract.parse(args)
}

module.exports = {
  IPC_CONTRACTS,
  IPC_EVENT_CONTRACTS,
  parseIpcRequest,
}
