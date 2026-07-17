const fs = require('node:fs/promises')
const path = require('node:path')
const { defaultLibraryFolderNames, libraryIds } = require('./library-definitions.cjs')
const { writeFileAtomically } = require('./library-store.cjs')

function createConfigService({ getConfigPaths, defaultHanime1Endpoint, now = () => new Date() }) {
  if (typeof getConfigPaths !== 'function') throw new Error('配置路径服务不可用')

  function createDefaultConfig() {
    return {
      schemaVersion: 3,
      updatedAt: now().toISOString(),
      mediaRoot: '',
      theme: 'dark',
      cacheLimitMb: 4096,
      confirmBeforeClose: true,
      scraping: {
        bangumiToken: '',
        bangumiEndpoint: 'https://api.bgm.tv',
        hanime1Endpoint: defaultHanime1Endpoint,
      },
      libraries: Object.fromEntries(libraryIds.map((id) => [id, { rootPath: '', enabled: true }])),
      catalog: {
        tags: [],
        classifications: [],
        studios: [],
        creators: [],
      },
    }
  }

  function normalizeCacheLimitMb(value, fallback) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(128, Math.min(8192, Math.round(parsed)))
  }

  function normalizeList(value, fallback) {
    const source = Array.isArray(value) ? value : fallback
    const seen = new Set()
    const result = []

    for (const item of source) {
      const text = String(item ?? '').trim()
      if (!text || seen.has(text)) continue
      seen.add(text)
      result.push(text)
    }

    return result.length > 0 ? result : fallback
  }

  function normalizeClassifications(value, tags) {
    const source = Array.isArray(value) ? value : []
    const tagSet = new Set(tags)
    const seenIds = new Set()
    const seenNames = new Set()
    const results = []

    for (const [index, item] of source.entries()) {
      if (!item || typeof item !== 'object') continue
      const name = String(item.name ?? '').trim()
      if (!name || name.length > 80 || seenNames.has(name)) continue
      const id = String(item.id ?? `classification-${index + 1}`).trim() || `classification-${index + 1}`
      if (seenIds.has(id)) continue
      const itemTags = normalizeList(item.tags, []).filter((tag) => tagSet.has(tag))
      const classificationLibraryIds = Array.isArray(item.libraryIds)
        ? [...new Set(item.libraryIds.filter((libraryId) => libraryIds.includes(libraryId)))]
        : []
      seenIds.add(id)
      seenNames.add(name)
      results.push({ id, name, tags: itemTags, libraryIds: classificationLibraryIds })
    }

    return results
  }

  function migrateLegacyClassifications(vocabularies) {
    const keyByLibrary = {
      erAnime: 'erAnimeCategories',
      anime: 'animeCategories',
      creator: 'creatorCategories',
      books: 'booksCategories',
      comics: 'comicsCategories',
      general: 'generalCategories',
    }
    const classifications = new Map()
    for (const [libraryId, key] of Object.entries(keyByLibrary)) {
      for (const name of normalizeList(vocabularies?.[key], [])) {
        if (name === '未分类') continue
        const current = classifications.get(name) ?? { id: `legacy-${classifications.size + 1}`, name, tags: [], libraryIds: [] }
        if (!current.libraryIds.includes(libraryId)) current.libraryIds.push(libraryId)
        classifications.set(name, current)
      }
    }
    return [...classifications.values()]
  }

  function sanitizeConfig(input) {
    const defaults = createDefaultConfig()
    const config = input && typeof input === 'object' ? input : {}
    const inputLibraries = config.libraries && typeof config.libraries === 'object' ? config.libraries : {}
    const libraries = {}

    for (const id of libraryIds) {
      const library = inputLibraries[id] && typeof inputLibraries[id] === 'object' ? inputLibraries[id] : {}
      libraries[id] = {
        rootPath: typeof library.rootPath === 'string' ? library.rootPath.trim() : '',
        enabled: typeof library.enabled === 'boolean' ? library.enabled : true,
      }
    }

    const vocabularies = config.vocabularies && typeof config.vocabularies === 'object' ? config.vocabularies : {}
    const catalogInput = config.catalog && typeof config.catalog === 'object' ? config.catalog : {}
    const scraping = config.scraping && typeof config.scraping === 'object' ? config.scraping : {}
    const tags = normalizeList(catalogInput.tags, normalizeList(vocabularies.tags, defaults.catalog.tags))
    const classifications = normalizeClassifications(
      Array.isArray(catalogInput.classifications) ? catalogInput.classifications : migrateLegacyClassifications(vocabularies),
      tags,
    )

    return {
      schemaVersion: 3,
      updatedAt: typeof config.updatedAt === 'string' ? config.updatedAt : defaults.updatedAt,
      mediaRoot: typeof config.mediaRoot === 'string' ? config.mediaRoot.trim() : '',
      theme: ['dark', 'light', 'blue'].includes(config.theme) ? config.theme : 'dark',
      cacheLimitMb: normalizeCacheLimitMb(config.cacheLimitMb, defaults.cacheLimitMb),
      confirmBeforeClose: typeof config.confirmBeforeClose === 'boolean' ? config.confirmBeforeClose : defaults.confirmBeforeClose,
      scraping: {
        bangumiToken: typeof scraping.bangumiToken === 'string' ? scraping.bangumiToken.trim() : '',
        bangumiEndpoint:
          typeof scraping.bangumiEndpoint === 'string' && scraping.bangumiEndpoint.trim()
            ? scraping.bangumiEndpoint.trim()
            : defaults.scraping.bangumiEndpoint,
        hanime1Endpoint:
          typeof scraping.hanime1Endpoint === 'string' && scraping.hanime1Endpoint.trim()
            ? scraping.hanime1Endpoint.trim()
            : defaults.scraping.hanime1Endpoint,
      },
      libraries,
      catalog: {
        tags,
        classifications,
        studios: normalizeList(catalogInput.studios, []),
        creators: normalizeList(catalogInput.creators, []),
      },
    }
  }

  function applyMediaRootLibraryDefaults(config) {
    if (!config.mediaRoot) return config
    for (const id of libraryIds) {
      if (!config.libraries[id].rootPath) config.libraries[id].rootPath = path.join(config.mediaRoot, defaultLibraryFolderNames[id])
    }
    return config
  }

  async function loadConfig() {
    const { configPath } = getConfigPaths()
    try {
      return sanitizeConfig(JSON.parse(await fs.readFile(configPath, 'utf8')))
    } catch (error) {
      if (error?.code === 'ENOENT') return createDefaultConfig()
      throw error
    }
  }

  async function saveConfig(input) {
    const paths = getConfigPaths()
    const config = applyMediaRootLibraryDefaults(sanitizeConfig({ ...input, updatedAt: now().toISOString() }))
    if (config.mediaRoot && !path.isAbsolute(config.mediaRoot)) throw new Error('媒体数据总目录必须使用绝对路径')
    for (const id of libraryIds) {
      const rootPath = config.libraries[id].rootPath
      if (rootPath && !path.isAbsolute(rootPath)) throw new Error(`${id} 的受管理根目录必须使用绝对路径`)
    }

    await fs.mkdir(path.dirname(paths.configPath), { recursive: true })
    await Promise.all(
      [
        config.mediaRoot ? fs.mkdir(config.mediaRoot, { recursive: true }) : undefined,
        ...libraryIds.map((id) =>
          config.libraries[id].rootPath ? fs.mkdir(config.libraries[id].rootPath, { recursive: true }) : undefined,
        ),
      ].filter(Boolean),
    )

    try {
      await fs.access(paths.configPath)
      await fs.mkdir(paths.backupDir, { recursive: true })
      const stamp = now().toISOString().replace(/[:.]/g, '-')
      await fs.copyFile(paths.configPath, path.join(paths.backupDir, `starmedia-config-${stamp}.json`))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    await writeFileAtomically(paths.configPath, `${JSON.stringify(config, null, 2)}\n`)
    return { config, ...paths }
  }

  return {
    applyMediaRootLibraryDefaults,
    createDefaultConfig,
    loadConfig,
    sanitizeConfig,
    saveConfig,
  }
}

module.exports = { createConfigService }
