const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { IPC_CHANNELS, IPC_INVOKE_CHANNELS } = require('./ipc-channels.cjs')

function loadMainWithElectronMock(t) {
  const workspaceRoot = path.resolve(__dirname, '..')
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'starmedia-main-ipc-test-'))
  const handlers = new Map()
  const windows = []
  const proxyConfigurations = []
  const bangumiProxyConfigurations = []
  const networkRequests = []
  const bangumiSession = { setProxy: async (configuration) => bangumiProxyConfigurations.push(configuration) }
  class BrowserWindow {
    constructor(options) {
      this.options = options
      this.destroyed = false
      this.closed = false
      this.maximized = false
      this.minimized = false
      this.webContents = {
        isDestroyed: () => false,
        mainFrame: { url: pathToFileURL(path.join(workspaceRoot, 'dist', 'index.html')).toString() },
        send: () => {},
        setWindowOpenHandler: () => {},
        on: () => {},
      }
      windows.push(this)
    }

    static getAllWindows() {
      return windows
    }

    static fromWebContents(webContents) {
      return windows.find((window) => window.webContents === webContents) ?? null
    }

    isDestroyed() {
      return this.destroyed
    }

    isMinimized() {
      return this.minimized
    }

    minimize() {
      this.minimized = true
    }

    maximize() {
      this.maximized = true
    }

    unmaximize() {
      this.maximized = false
    }

    isMaximized() {
      return this.maximized
    }

    show() {}
    focus() {}
    restore() {}
    on() {}
    loadFile() {}
    loadURL() {}
    close() {
      this.closed = true
    }
  }
  const electron = {
    app: {
      isPackaged: true,
      setPath: () => {},
      getPath: () => dataRoot,
      getVersion: () => 'test',
      getAppPath: () => workspaceRoot,
      on: () => {},
      quit: () => {},
      whenReady: async () => {},
      setName: () => {},
      setAppUserModelId: () => {},
    },
    BrowserWindow,
    Menu: { setApplicationMenu: () => {} },
    dialog: {
      showSaveDialog: async () => ({ canceled: true }),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showMessageBox: async () => ({}),
    },
    ipcMain: { handle: (channel, listener) => handlers.set(channel, listener) },
    net: {
      fetch: async (url, options) => {
        networkRequests.push({ url, options })
        return new Response(JSON.stringify({ data: [] }), { headers: { 'content-type': 'application/json' } })
      },
    },
    session: {
      defaultSession: { setProxy: async (configuration) => proxyConfigurations.push(configuration) },
      fromPartition: () => bangumiSession,
    },
    shell: { trashItem: async () => {}, openPath: async () => '', openExternal: async () => '' },
  }
  const mainPath = path.join(workspaceRoot, 'electron', 'main.cjs')
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electron
    return originalLoad.call(this, request, parent, isMain)
  }
  delete require.cache[mainPath]
  let main
  try {
    main = require(mainPath)
  } finally {
    Module._load = originalLoad
  }
  t.after(() => {
    delete require.cache[mainPath]
    return fsPromises.rm(dataRoot, { recursive: true, force: true })
  })
  return { bangumiProxyConfigurations, bangumiSession, dataRoot, handlers, main, networkRequests, proxyConfigurations, windows }
}

test('registers every declared IPC handler and rejects untrusted senders before parsing requests', async (t) => {
  const { handlers, main, proxyConfigurations, windows } = loadMainWithElectronMock(t)
  main.createWindow()
  main.registerIpc()

  assert.equal(windows[0].options.webPreferences.contextIsolation, true)
  assert.equal(windows[0].options.webPreferences.nodeIntegration, false)
  assert.equal(windows[0].options.webPreferences.sandbox, false)
  assert.deepEqual([...handlers.keys()].sort(), [...IPC_INVOKE_CHANNELS].sort())
  for (const handler of handlers.values()) {
    await assert.rejects(handler({}), /非受信任页面/)
  }

  const window = windows[0]
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
  await handlers.get(IPC_CHANNELS.windowMinimize)(event)
  assert.equal(window.minimized, true)
  assert.equal(await handlers.get(IPC_CHANNELS.windowToggleMaximize)(event), false)
  assert.equal(await handlers.get(IPC_CHANNELS.windowToggleMaximize)(event), true)
  await assert.rejects(handlers.get(IPC_CHANNELS.configSave)(event, {}), /IPC 请求无效/)
  assert.equal(await handlers.get(IPC_CHANNELS.windowClose)(event), 'blocked')
  assert.equal(window.closed, false)
  const config = await handlers.get(IPC_CHANNELS.configLoad)(event)
  config.config.confirmBeforeClose = false
  config.config.libraries.anime.sortMode = 'firstAired'
  config.config.libraries.anime.sortDirection = 'descending'
  await handlers.get(IPC_CHANNELS.configSave)(event, config.config)
  assert.deepEqual(proxyConfigurations.at(-1), { mode: 'direct' })
  const persistedConfig = await handlers.get(IPC_CHANNELS.configLoad)(event)
  assert.deepEqual(persistedConfig.config.libraries.anime, {
    ...config.config.libraries.anime,
    sortMode: 'firstAired',
    sortDirection: 'descending',
  })
  persistedConfig.config.libraries.general.sortMode = 'firstAired'
  await assert.rejects(handlers.get(IPC_CHANNELS.configSave)(event, persistedConfig.config), /general 排序方式无效/)
  config.config.network = { proxyEnabled: true, proxyUrl: 'http://127.0.0.1:8390' }
  await handlers.get(IPC_CHANNELS.configSave)(event, config.config)
  assert.deepEqual(proxyConfigurations.at(-1), { mode: 'fixed_servers', proxyRules: 'http=127.0.0.1:8390;https=127.0.0.1:8390' })
  assert.equal(await handlers.get(IPC_CHANNELS.windowClose)(event), 'closed')
  assert.equal(window.closed, true)
})

test('uses legacy development data only when the current data root has no index', (t) => {
  const { main } = loadMainWithElectronMock(t)
  const appPath = path.join('C:', 'StarMedia')
  const currentConfig = path.join(appPath, 'StarMediaData', 'starmedia-config.json')
  const legacyLibrary = path.join(appPath, 'scripts', 'StarMediaData', 'starmedia-library.json')
  const resolve = (existingPaths) =>
    main.resolvePortableDataRoot({
      development: true,
      appPath,
      executablePath: path.join(appPath, 'StarMedia.exe'),
      pathExists: (candidate) => existingPaths.has(candidate),
    })

  assert.equal(resolve(new Set([legacyLibrary])), path.join(appPath, 'scripts', 'StarMediaData'))
  assert.equal(resolve(new Set([legacyLibrary, currentConfig])), path.join(appPath, 'StarMediaData'))
  assert.equal(
    main.resolvePortableDataRoot({
      development: false,
      appPath,
      executablePath: path.join('D:', 'Portable', 'StarMedia.exe'),
      pathExists: () => false,
    }),
    path.join('D:', 'Portable', 'StarMediaData'),
  )
})

test('routes Bangumi requests through the dedicated direct Electron session', async (t) => {
  const { bangumiProxyConfigurations, bangumiSession, handlers, main, networkRequests, windows } = loadMainWithElectronMock(t)
  main.createWindow()
  main.registerIpc()
  const event = { sender: windows[0].webContents, senderFrame: windows[0].webContents.mainFrame }

  await handlers.get(IPC_CHANNELS.bangumiSearchSubjects)(event, { query: 'Example' })

  assert.deepEqual(bangumiProxyConfigurations, [{ mode: 'direct' }])
  assert.equal(networkRequests[0].options.session, bangumiSession)
})

test('removes records whose managed media files no longer exist when loading the library', async (t) => {
  const { dataRoot, handlers, main, windows } = loadMainWithElectronMock(t)
  main.createWindow()
  main.registerIpc()
  const event = { sender: windows[0].webContents, senderFrame: windows[0].webContents.mainFrame }
  const config = await main.loadConfig()
  const mediaRoot = path.join(os.tmpdir(), `starmedia-main-library-prune-${Date.now()}`)
  const libraryRoot = path.join(mediaRoot, 'general')
  const missingPath = path.join(libraryRoot, 'removed.zip')
  t.after(() => fsPromises.rm(mediaRoot, { recursive: true, force: true }))
  await fsPromises.mkdir(libraryRoot, { recursive: true })
  config.mediaRoot = mediaRoot
  config.libraries.general.rootPath = libraryRoot
  await handlers.get(IPC_CHANNELS.configSave)(event, config)
  await fsPromises.writeFile(
    path.join(dataRoot, 'starmedia-library.json'),
    `${JSON.stringify({
      items: [{ id: 'book:removed', library: 'general', kind: 'book', title: 'Removed', sourcePath: missingPath }],
      operations: [],
    })}\n`,
  )

  const loaded = await handlers.get(IPC_CHANNELS.libraryLoad)(event)
  assert.deepEqual(loaded.data.items, [])
  assert.deepEqual(JSON.parse(await fsPromises.readFile(path.join(dataRoot, 'starmedia-library.json'), 'utf8')).items, [])
})

test('preserves records when their entire configured library root is unavailable', async (t) => {
  const { dataRoot, handlers, main, windows } = loadMainWithElectronMock(t)
  main.createWindow()
  main.registerIpc()
  const event = { sender: windows[0].webContents, senderFrame: windows[0].webContents.mainFrame }
  const config = await main.loadConfig()
  const unavailableRoot = path.join(os.tmpdir(), `starmedia-main-unavailable-library-${Date.now()}`)
  const missingPath = path.join(unavailableRoot, 'removed.zip')
  config.libraries.general.rootPath = unavailableRoot
  await handlers.get(IPC_CHANNELS.configSave)(event, config)
  await fsPromises.rm(unavailableRoot, { recursive: true, force: true })
  await fsPromises.writeFile(
    path.join(dataRoot, 'starmedia-library.json'),
    `${JSON.stringify({ items: [{ id: 'book:offline', library: 'general', title: 'Offline', sourcePath: missingPath }], operations: [] })}\n`,
  )

  const loaded = await handlers.get(IPC_CHANNELS.libraryLoad)(event)
  assert.deepEqual(
    loaded.data.items.map((item) => item.id),
    ['book:offline'],
  )
  assert.deepEqual(
    JSON.parse(await fsPromises.readFile(path.join(dataRoot, 'starmedia-library.json'), 'utf8')).items.map((item) => item.id),
    ['book:offline'],
  )
})

test('creates import plans through trusted IPC without treating missing sources as ready items', async (t) => {
  const { dataRoot, handlers, main, windows } = loadMainWithElectronMock(t)
  main.createWindow()
  main.registerIpc()
  const window = windows[0]
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
  const config = await main.loadConfig()
  const mediaRoot = path.join(os.tmpdir(), `starmedia-main-import-media-${Date.now()}`)
  const libraryRoot = path.join(mediaRoot, 'general')
  const sourcePath = path.join(mediaRoot, 'source', 'episode.mp4')
  t.after(() => fsPromises.rm(mediaRoot, { recursive: true, force: true }))
  await fsPromises.mkdir(path.dirname(sourcePath), { recursive: true })
  await fsPromises.writeFile(sourcePath, 'video')
  config.mediaRoot = mediaRoot
  config.libraries.general.rootPath = libraryRoot
  await handlers.get(IPC_CHANNELS.configSave)(event, config)

  const plan = await handlers.get(IPC_CHANNELS.importCreatePlan)(event, { sourcePaths: [sourcePath], targetLibrary: 'general' })
  assert.equal(plan.acceptedCount, 1)
  assert.equal(plan.items[0].status, 'ready')
  assert.equal(plan.items[0].targetPath, path.join(libraryRoot, 'episode', 'episode.mp4'))

  const missingPlan = await handlers.get(IPC_CHANNELS.importCreatePlan)(event, {
    sourcePaths: [path.join(mediaRoot, 'source', 'missing.mp4')],
    targetLibrary: 'general',
  })
  assert.equal(missingPlan.acceptedCount, 0)
  assert.deepEqual(missingPlan.items, [])
  assert.equal(missingPlan.errorCount, 1)

  const managedSource = path.join(libraryRoot, 'Existing Series', 'managed.mp4')
  await fsPromises.mkdir(path.dirname(managedSource), { recursive: true })
  await fsPromises.writeFile(managedSource, 'video')
  const managedPlan = await handlers.get(IPC_CHANNELS.importCreatePlan)(event, {
    sourcePaths: [managedSource],
    targetLibrary: 'auto',
  })
  assert.equal(managedPlan.acceptedCount, 1)
  assert.equal(managedPlan.items[0].library, 'general')
  assert.equal(managedPlan.items[0].affiliation, 'Existing Series')
  assert.equal(managedPlan.items[0].targetPath, managedSource)

  const animeRoot = path.join(mediaRoot, 'anime')
  const newManagedSource = path.join(animeRoot, 'New Series', 'episode-01.mkv')
  await fsPromises.mkdir(path.dirname(newManagedSource), { recursive: true })
  await fsPromises.writeFile(newManagedSource, 'video')
  config.libraries.anime.rootPath = animeRoot
  await handlers.get(IPC_CHANNELS.configSave)(event, config)
  await fsPromises.writeFile(
    path.join(dataRoot, 'starmedia-library.json'),
    `${JSON.stringify({
      items: [
        {
          id: 'existing-managed-item',
          library: 'general',
          kind: 'video',
          title: 'managed',
          affiliation: 'Existing Series',
          sourcePath: managedSource,
        },
      ],
      operations: [],
    })}\n`,
  )

  const scanPlan = await handlers.get(IPC_CHANNELS.importCreatePlan)(event, {
    targetLibrary: 'auto',
    scanManagedLibraries: true,
  })
  assert.equal(scanPlan.scanManagedLibraries, true)
  assert.equal(scanPlan.acceptedCount, 1)
  assert.equal(scanPlan.items[0].library, 'anime')
  assert.equal(scanPlan.items[0].affiliation, 'New Series')
  assert.equal(scanPlan.items[0].sourcePath, newManagedSource)
  assert.equal(scanPlan.items[0].managedInPlace, true)
  await assert.rejects(
    handlers.get(IPC_CHANNELS.importCreatePlan)(event, {
      sourcePaths: [newManagedSource],
      targetLibrary: 'auto',
      scanManagedLibraries: true,
    }),
    /IPC 请求无效/,
  )
})
