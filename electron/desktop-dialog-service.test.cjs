const test = require('node:test')
const assert = require('node:assert/strict')
const { createDesktopDialogService } = require('./desktop-dialog-service.cjs')

function createService(overrides = {}) {
  return createDesktopDialogService({
    showSaveDialog: async () => ({ canceled: false, filePath: 'backup.zip' }),
    showOpenDialog: async () => ({ canceled: false, filePaths: ['selected'] }),
    showMessageBox: async () => ({}),
    exportBackup: async (backupPath) => ({ backupPath, missingMediaCount: 0 }),
    runLocked: (task) => task(),
    homeDirectory: () => 'C:\\Users\\test',
    now: () => new Date('2026-07-17T12:00:00.000Z'),
    ...overrides,
  })
}

test('coalesces concurrent exports before showing a save dialog', async () => {
  let saveDialogs = 0
  let releaseExport
  const service = createService({
    showSaveDialog: async () => {
      saveDialogs += 1
      return { canceled: false, filePath: 'backup.zip' }
    },
    exportBackup: () =>
      new Promise((resolve) => {
        releaseExport = () => resolve({ backupPath: 'backup.zip', missingMediaCount: 0 })
      }),
  })

  const first = service.startPortableDataExport()
  const second = service.startPortableDataExport()
  assert.equal(first, second)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(saveDialogs, 1)
  assert.equal(service.isPortableDataExportInProgress(), true)
  releaseExport()
  await first
  assert.equal(service.isPortableDataExportInProgress(), false)
})

test('returns a canceled export without calling the backup service', async () => {
  let exported = false
  const service = createService({
    showSaveDialog: async () => ({ canceled: true }),
    exportBackup: async () => {
      exported = true
    },
  })

  assert.deepEqual(await service.startPortableDataExport(), { canceled: true })
  assert.equal(exported, false)
})

test('deduplicates export warnings until the active dialog resolves', async () => {
  let showCount = 0
  let releaseWarning
  const service = createService({
    showMessageBox: () => {
      showCount += 1
      return new Promise((resolve) => {
        releaseWarning = resolve
      })
    },
  })

  const first = service.showPortableExportWarning()
  const second = service.showPortableExportWarning()
  assert.equal(first, second)
  assert.equal(showCount, 1)
  releaseWarning({})
  await first
  const third = service.showPortableExportWarning()
  assert.equal(showCount, 2)
  releaseWarning({})
  await third
})

test('chooses one supported video file when replacing an episode', async () => {
  const calls = []
  const service = createService({
    showOpenDialog: async (_owner, options) => {
      calls.push(options)
      return { canceled: false, filePaths: ['C:\\Media\\replacement.mkv'] }
    },
  })

  assert.equal(await service.chooseVideoFile(), 'C:\\Media\\replacement.mkv')
  assert.deepEqual(calls, [
    {
      title: '选择替换视频文件',
      properties: ['openFile'],
      filters: [
        {
          name: '支持的视频文件',
          extensions: [
            '3g2',
            '3gp',
            'asf',
            'avi',
            'divx',
            'dv',
            'f4v',
            'flv',
            'm2ts',
            'm2v',
            'm4v',
            'mkv',
            'mod',
            'mov',
            'mp4',
            'mpe',
            'mpeg',
            'mpg',
            'mts',
            'mxf',
            'ogv',
            'qt',
            'tod',
            'ts',
            'vob',
            'webm',
            'wmv',
          ],
        },
      ],
    },
  ])
})

test('returns null when video replacement selection is canceled', async () => {
  const service = createService({ showOpenDialog: async () => ({ canceled: true, filePaths: [] }) })
  assert.equal(await service.chooseVideoFile(), null)
})
