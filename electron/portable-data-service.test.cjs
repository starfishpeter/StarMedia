const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { replaceFileAtomically } = require('./archive-tooling.cjs')
const {
  countMissingMedia,
  createPortableDataService,
  pruneUnavailableMedia,
  rewriteLibraryCoverPaths,
  validateArchiveEntries,
} = require('./portable-data-service.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-portable-data-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

function createPaths(root) {
  return {
    dataRoot: path.join(root, 'data'),
    configPath: path.join(root, 'data', 'starmedia-config.json'),
    libraryPath: path.join(root, 'data', 'starmedia-library.json'),
    backupDir: path.join(root, 'data', 'backups'),
    cacheDir: path.join(root, 'data', 'cache'),
    coversDir: path.join(root, 'data', 'covers'),
  }
}

function createConfig() {
  return { schemaVersion: 3, mediaRoot: '', libraries: {}, catalog: {}, scraping: {} }
}

function createService({ paths, run7z, loadLibrary = async () => ({ items: [], operations: [] }), ...dependencies }) {
  return createPortableDataService({
    getConfigPaths: () => paths,
    loadConfig: async () => createConfig(),
    loadLibrary,
    saveConfig: async (config) => ({ config, ...paths }),
    saveLibrary: async (data) => ({ data, libraryPath: paths.libraryPath }),
    run7z,
    replaceFileAtomically,
    appVersion: 'test',
    temporaryDirectory: () => path.dirname(paths.dataRoot),
    now: () => new Date('2026-07-17T12:00:00.000Z'),
    ...dependencies,
  })
}

async function createImportFiles(extractDir, dataRoot) {
  const sourcePath = path.join(dataRoot, 'media', 'imported.mp4')
  await fs.mkdir(path.dirname(sourcePath), { recursive: true })
  await fs.writeFile(sourcePath, 'media')
  return Promise.all([
    fs.writeFile(path.join(extractDir, 'manifest.json'), JSON.stringify({ format: 'starmedia-data-backup', version: 2, dataRoot }), 'utf8'),
    fs.writeFile(path.join(extractDir, 'starmedia-config.json'), JSON.stringify({ schemaVersion: 3 }), 'utf8'),
    fs.writeFile(
      path.join(extractDir, 'starmedia-library.json'),
      JSON.stringify({ items: [{ id: 'imported', sourcePath }], operations: [] }),
      'utf8',
    ),
  ])
}

test('exports staged config and index then removes staging data', async (t) => {
  const root = await createSandbox(t)
  const paths = createPaths(root)
  const backupPath = path.join(root, 'backup.zip')
  const sourcePath = path.join(root, 'media', 'episode.mp4')
  await fs.mkdir(path.dirname(sourcePath), { recursive: true })
  await fs.writeFile(sourcePath, 'media')
  const calls = []
  const service = createService({
    paths,
    loadLibrary: async () => ({ items: [{ id: 'video:1', sourcePath }], operations: [] }),
    run7z: async (args, options) => {
      calls.push({ args, options })
      if (args[0] === 'a') await fs.writeFile(args[3], 'archive')
      return ''
    },
  })

  const result = await service.exportBackup(backupPath)

  assert.equal(await fs.readFile(backupPath, 'utf8'), 'archive')
  assert.equal(result.missingMediaCount, 0)
  assert.equal(calls.length, 2)
  assert.deepEqual(
    (await fs.readdir(root)).filter((name) => name.startsWith('starmedia-export-')),
    [],
  )
})

test('preserves the previous backup and cleans staging files when replacement fails', async (t) => {
  const root = await createSandbox(t)
  const paths = createPaths(root)
  const backupPath = path.join(root, 'backup.zip')
  await fs.writeFile(backupPath, 'previous archive')
  const service = createService({
    paths,
    run7z: async (args) => {
      if (args[0] === 'a') await fs.writeFile(args[3], 'new archive')
      return ''
    },
    replaceFileAtomically: async () => {
      throw new Error('injected backup replacement failure')
    },
  })

  await assert.rejects(service.exportBackup(backupPath), /导出应用数据失败：injected backup replacement failure/)

  assert.equal(await fs.readFile(backupPath, 'utf8'), 'previous archive')
  assert.deepEqual(
    (await fs.readdir(root)).filter((name) => name.startsWith('starmedia-export-') || name.includes('.tmp')),
    [],
  )
})

test('rejects traversal entries and removes the temporary import directory', async (t) => {
  const root = await createSandbox(t)
  const paths = createPaths(root)
  const backupPath = path.join(root, 'unsafe.zip')
  await fs.writeFile(backupPath, 'archive')
  const service = createService({
    paths,
    run7z: async (args) => (args[0] === 'l' ? '----------\nPath = ../escape.json\n' : ''),
  })

  await assert.rejects(service.importBackup(backupPath), /无效路径/)
  assert.deepEqual(
    (await fs.readdir(root)).filter((name) => name.startsWith('starmedia-import-')),
    [],
  )
})

test('rewrites imported cover paths and counts unavailable media', async (t) => {
  const root = await createSandbox(t)
  const sourceCovers = path.join(root, 'old-data', 'covers')
  const targetCovers = path.join(root, 'new-data', 'covers')
  const presentMedia = path.join(root, 'media', 'present.mp4')
  await fs.mkdir(path.dirname(presentMedia), { recursive: true })
  await fs.writeFile(presentMedia, 'media')
  const data = {
    items: [
      {
        id: 'present',
        sourcePath: presentMedia,
        cover: `url("${require('node:url').pathToFileURL(path.join(sourceCovers, 'video.jpg')).toString()}") center / cover`,
      },
      {
        id: 'missing',
        sourcePath: path.join(root, 'media', 'missing.mp4'),
        sidecars: [{ sourcePath: path.join(root, 'media', 'missing.srt') }],
      },
    ],
    operations: [],
  }

  const rewritten = rewriteLibraryCoverPaths(data, sourceCovers, targetCovers)

  assert.match(rewritten.items[0].cover, /new-data/)
  assert.equal(countMissingMedia(data), 2)
})

test('drops missing media records and unavailable sidecars during data import preparation', async (t) => {
  const root = await createSandbox(t)
  const presentMedia = path.join(root, 'media', 'present.mp4')
  const presentSubtitle = path.join(root, 'media', 'present.srt')
  await fs.mkdir(path.dirname(presentMedia), { recursive: true })
  await fs.writeFile(presentMedia, 'media')
  await fs.writeFile(presentSubtitle, 'subtitle')
  const data = {
    items: [
      {
        id: 'present',
        sourcePath: presentMedia,
        sidecars: [{ sourcePath: presentSubtitle }, { sourcePath: path.join(root, 'media', 'missing.srt') }],
      },
      { id: 'missing', sourcePath: path.join(root, 'media', 'missing.mp4'), sidecars: [{ sourcePath: presentSubtitle }] },
    ],
    operations: [],
  }

  const result = pruneUnavailableMedia(data)

  assert.equal(result.removedMediaCount, 1)
  assert.equal(result.removedSidecarCount, 2)
  assert.deepEqual(
    result.data.items.map((item) => item.id),
    ['present'],
  )
  assert.deepEqual(result.data.items[0].sidecars, [{ sourcePath: presentSubtitle }])
})

test('data import persists only records whose media files are currently available', async (t) => {
  const root = await createSandbox(t)
  const paths = createPaths(root)
  const backupPath = path.join(root, 'restore.zip')
  const presentMedia = path.join(root, 'media', 'present.mp4')
  const presentSubtitle = path.join(root, 'media', 'present.srt')
  const missingMedia = path.join(root, 'media', 'missing.mp4')
  await fs.writeFile(backupPath, 'archive')
  await fs.mkdir(path.dirname(presentMedia), { recursive: true })
  await fs.writeFile(presentMedia, 'media')
  await fs.writeFile(presentSubtitle, 'subtitle')
  let currentLibrary = { items: [{ id: 'previous', sourcePath: presentMedia }], operations: [] }
  const service = createService({
    paths,
    loadLibrary: async () => currentLibrary,
    saveLibrary: async (data) => {
      currentLibrary = data
      return { data, libraryPath: paths.libraryPath }
    },
    run7z: async (args) => {
      if (args[0] === 'l') return '----------\nPath = manifest.json\n'
      if (args[0] === 'x') {
        const extractDir = args.find((value) => String(value).startsWith('-o')).slice(2)
        await fs.writeFile(
          path.join(extractDir, 'manifest.json'),
          JSON.stringify({ format: 'starmedia-data-backup', version: 2, dataRoot: path.join(root, 'old-data') }),
          'utf8',
        )
        await fs.writeFile(path.join(extractDir, 'starmedia-config.json'), JSON.stringify(createConfig()), 'utf8')
        await fs.writeFile(
          path.join(extractDir, 'starmedia-library.json'),
          JSON.stringify({
            items: [
              {
                id: 'present',
                sourcePath: presentMedia,
                sidecars: [{ sourcePath: presentSubtitle }, { sourcePath: path.join(root, 'media', 'missing.srt') }],
              },
              { id: 'missing', sourcePath: missingMedia },
            ],
            operations: [],
          }),
          'utf8',
        )
      }
      return ''
    },
  })

  const result = await service.importBackup(backupPath)

  assert.deepEqual(
    result.data.items.map((item) => item.id),
    ['present'],
  )
  assert.deepEqual(result.data.items[0].sidecars, [{ sourcePath: presentSubtitle }])
  assert.equal(result.removedMediaCount, 1)
  assert.equal(result.removedSidecarCount, 1)
  assert.equal(result.missingMediaCount, 0)
})

test('validates backup archive entry paths', () => {
  assert.doesNotThrow(() => validateArchiveEntries('----------\nPath = covers/video.jpg\n'))
  assert.throws(() => validateArchiveEntries('----------\nPath = C:\\escape.txt\n'), /无效路径/)
})

test('restores the existing config when library restoration fails', async (t) => {
  const root = await createSandbox(t)
  const paths = createPaths(root)
  const backupPath = path.join(root, 'restore.zip')
  await fs.writeFile(backupPath, 'archive')
  const previousConfig = { schemaVersion: 3, marker: 'previous-config' }
  const previousLibrary = { items: [{ id: 'previous' }], operations: [] }
  const savedConfigs = []
  const service = createPortableDataService({
    getConfigPaths: () => paths,
    loadConfig: async () => previousConfig,
    loadLibrary: async () => previousLibrary,
    saveConfig: async (config) => {
      savedConfigs.push(config)
      return { config, ...paths }
    },
    saveLibrary: async () => {
      throw new Error('injected library write failure')
    },
    run7z: async (args) => {
      if (args[0] === 'l') return '----------\nPath = manifest.json\n'
      if (args[0] === 'x')
        await createImportFiles(args.find((value) => String(value).startsWith('-o')).slice(2), path.join(root, 'previous-data'))
      return ''
    },
    replaceFileAtomically,
    appVersion: 'test',
    temporaryDirectory: () => root,
  })

  await assert.rejects(service.importBackup(backupPath), /injected library write failure/)
  assert.deepEqual(savedConfigs, [{ schemaVersion: 3 }, previousConfig])
  assert.deepEqual(
    (await fs.readdir(root)).filter((name) => name.startsWith('starmedia-import-')),
    [],
  )
})

test('rolls config and library back when applying extracted covers fails after both writes', async (t) => {
  const root = await createSandbox(t)
  const paths = createPaths(root)
  const backupPath = path.join(root, 'restore.zip')
  await fs.writeFile(backupPath, 'archive')
  const previousConfig = { schemaVersion: 3, marker: 'previous-config' }
  const previousLibrary = { items: [{ id: 'previous' }], operations: [] }
  const savedConfigs = []
  const savedLibraries = []
  const fileSystem = {
    ...fs,
    cp: async () => {
      throw new Error('injected covers copy failure')
    },
  }
  const service = createPortableDataService({
    getConfigPaths: () => paths,
    loadConfig: async () => previousConfig,
    loadLibrary: async () => previousLibrary,
    saveConfig: async (config) => {
      savedConfigs.push(config)
      return { config, ...paths }
    },
    saveLibrary: async (data, options) => {
      savedLibraries.push({ data, options })
      return { data, libraryPath: paths.libraryPath }
    },
    run7z: async (args) => {
      if (args[0] === 'l') return '----------\nPath = manifest.json\nPath = covers/video.jpg\n'
      if (args[0] === 'x') {
        const extractDir = args.find((value) => String(value).startsWith('-o')).slice(2)
        await createImportFiles(extractDir, path.join(root, 'previous-data'))
        await fs.mkdir(path.join(extractDir, 'covers'), { recursive: true })
        await fs.writeFile(path.join(extractDir, 'covers', 'video.jpg'), 'cover')
      }
      return ''
    },
    replaceFileAtomically,
    appVersion: 'test',
    fileSystem,
    temporaryDirectory: () => root,
  })

  await assert.rejects(service.importBackup(backupPath), /injected covers copy failure/)

  assert.deepEqual(savedConfigs, [{ schemaVersion: 3 }, previousConfig])
  assert.deepEqual(savedLibraries, [
    {
      data: { items: [{ id: 'imported', sourcePath: path.join(root, 'previous-data', 'media', 'imported.mp4') }], operations: [] },
      options: { backupExisting: true },
    },
    { data: previousLibrary, options: { backupExisting: false } },
  ])
  assert.deepEqual(
    (await fs.readdir(root)).filter((name) => name.startsWith('starmedia-import-')),
    [],
  )
})

test('restores copied cover and replacement trees when applying a later tree fails', async (t) => {
  const root = await createSandbox(t)
  const paths = createPaths(root)
  const backupPath = path.join(root, 'restore.zip')
  const replacedDir = path.join(paths.dataRoot, 'replaced')
  await fs.writeFile(backupPath, 'archive')
  await fs.mkdir(paths.coversDir, { recursive: true })
  await fs.mkdir(replacedDir, { recursive: true })
  await fs.writeFile(path.join(paths.coversDir, 'existing-cover.jpg'), 'previous cover')
  await fs.writeFile(path.join(replacedDir, 'existing-file.mp4'), 'previous replacement')
  const previousConfig = { schemaVersion: 3, marker: 'previous-config' }
  const previousLibrary = { items: [{ id: 'previous' }], operations: [] }
  const fileSystem = {
    ...fs,
    cp: async (source, target, options) => {
      if (source.includes('starmedia-import-') && path.basename(source) === 'replaced')
        throw new Error('injected replacements copy failure')
      return fs.cp(source, target, options)
    },
  }
  const service = createPortableDataService({
    getConfigPaths: () => paths,
    loadConfig: async () => previousConfig,
    loadLibrary: async () => previousLibrary,
    saveConfig: async (config) => ({ config, ...paths }),
    saveLibrary: async (data) => ({ data, libraryPath: paths.libraryPath }),
    run7z: async (args) => {
      if (args[0] === 'l') return '----------\nPath = manifest.json\nPath = covers/imported-cover.jpg\nPath = replaced/imported-file.mp4\n'
      if (args[0] === 'x') {
        const extractDir = args.find((value) => String(value).startsWith('-o')).slice(2)
        await createImportFiles(extractDir, path.join(root, 'previous-data'))
        await fs.mkdir(path.join(extractDir, 'covers'), { recursive: true })
        await fs.mkdir(path.join(extractDir, 'replaced'), { recursive: true })
        await fs.writeFile(path.join(extractDir, 'covers', 'imported-cover.jpg'), 'imported cover')
        await fs.writeFile(path.join(extractDir, 'replaced', 'imported-file.mp4'), 'imported replacement')
      }
      return ''
    },
    replaceFileAtomically,
    appVersion: 'test',
    fileSystem,
    temporaryDirectory: () => root,
  })

  await assert.rejects(service.importBackup(backupPath), /injected replacements copy failure/)

  assert.equal(await fs.readFile(path.join(paths.coversDir, 'existing-cover.jpg'), 'utf8'), 'previous cover')
  assert.equal(await fs.readFile(path.join(replacedDir, 'existing-file.mp4'), 'utf8'), 'previous replacement')
  await assert.rejects(fs.access(path.join(paths.coversDir, 'imported-cover.jpg')), { code: 'ENOENT' })
  assert.deepEqual(
    (await fs.readdir(root)).filter((name) => name.startsWith('starmedia-import-') || name.startsWith('starmedia-restore-')),
    [],
  )
})

test('imports cover and replacement trees and rewrites stored cover URLs', async (t) => {
  const root = await createSandbox(t)
  const paths = createPaths(root)
  const backupPath = path.join(root, 'restore.zip')
  const sourceDataRoot = path.join(root, 'source-data')
  const sourceCoverPath = path.join(sourceDataRoot, 'covers', 'poster.jpg')
  const sourceMediaPath = path.join(root, 'media', 'episode.mp4')
  await fs.writeFile(backupPath, 'archive')
  await fs.mkdir(path.dirname(sourceMediaPath), { recursive: true })
  await fs.writeFile(sourceMediaPath, 'media')
  let currentLibrary = { items: [{ id: 'previous' }], operations: [] }
  const savedLibraries = []
  const service = createPortableDataService({
    getConfigPaths: () => paths,
    loadConfig: async () => createConfig(),
    loadLibrary: async () => currentLibrary,
    saveConfig: async (config) => ({ config, ...paths }),
    saveLibrary: async (data, options) => {
      currentLibrary = data
      savedLibraries.push({ data, options })
      return { data, libraryPath: paths.libraryPath }
    },
    run7z: async (args) => {
      if (args[0] === 'l') return '----------\nPath = manifest.json\nPath = covers/poster.jpg\nPath = replaced/old.mp4\n'
      if (args[0] === 'x') {
        const extractDir = args.find((value) => String(value).startsWith('-o')).slice(2)
        await fs.mkdir(path.join(extractDir, 'covers'), { recursive: true })
        await fs.mkdir(path.join(extractDir, 'replaced'), { recursive: true })
        await fs.writeFile(
          path.join(extractDir, 'manifest.json'),
          JSON.stringify({ format: 'starmedia-data-backup', version: 2, dataRoot: sourceDataRoot }),
          'utf8',
        )
        await fs.writeFile(path.join(extractDir, 'starmedia-config.json'), JSON.stringify(createConfig()), 'utf8')
        await fs.writeFile(
          path.join(extractDir, 'starmedia-library.json'),
          JSON.stringify({
            items: [
              {
                id: 'imported',
                sourcePath: sourceMediaPath,
                cover: `url("${require('node:url').pathToFileURL(sourceCoverPath).toString()}") center / cover`,
              },
            ],
            operations: [],
          }),
          'utf8',
        )
        await fs.writeFile(path.join(extractDir, 'covers', 'poster.jpg'), 'poster')
        await fs.writeFile(path.join(extractDir, 'replaced', 'old.mp4'), 'replaced media')
      }
      return ''
    },
    replaceFileAtomically,
    appVersion: 'test',
    temporaryDirectory: () => root,
  })

  const result = await service.importBackup(backupPath)

  assert.equal(await fs.readFile(path.join(paths.coversDir, 'poster.jpg'), 'utf8'), 'poster')
  assert.equal(await fs.readFile(path.join(paths.dataRoot, 'replaced', 'old.mp4'), 'utf8'), 'replaced media')
  assert.match(result.data.items[0].cover, /data[\\/]covers[\\/]poster\.jpg/)
  assert.equal(savedLibraries.length, 1)
  assert.deepEqual(
    (await fs.readdir(root)).filter((name) => name.startsWith('starmedia-import-') || name.startsWith('starmedia-restore-')),
    [],
  )
})
