const test = require('node:test')
const assert = require('node:assert/strict')
const { IPC_CHANNELS, IPC_INVOKE_CHANNELS } = require('./ipc-channels.cjs')
const { createPreloadBridge } = require('./preload-bridge.cjs')

test('maps every public invoke API to exactly one declared IPC channel', async () => {
  const calls = []
  const bridge = createPreloadBridge({
    invoke: async (channel, ...args) => {
      calls.push({ channel, args })
      return { channel, args }
    },
    subscribe: () => () => {},
    getPathForFile: () => 'C:\\Media\\file.mp4',
  })
  const callsByChannel = {
    [IPC_CHANNELS.configLoad]: () => bridge.getConfig(),
    [IPC_CHANNELS.configSave]: () => bridge.saveConfig({}),
    [IPC_CHANNELS.importCreatePlan]: () => bridge.createImportPlan({}),
    [IPC_CHANNELS.libraryLoad]: () => bridge.getLibrary(),
    [IPC_CHANNELS.libraryGetUsage]: () => bridge.getLibraryUsage('anime'),
    [IPC_CHANNELS.libraryImportMedia]: () => bridge.importMedia({}),
    [IPC_CHANNELS.libraryClearRecords]: () => bridge.clearImportedRecords(),
    [IPC_CHANNELS.appExportData]: () => bridge.exportAppData(),
    [IPC_CHANNELS.appImportData]: () => bridge.importAppData('C:\\backup.zip'),
    [IPC_CHANNELS.appInstallLocalUpdate]: () => bridge.installLocalUpdate(),
    [IPC_CHANNELS.appCheckGitHubUpdate]: () => bridge.checkGitHubUpdate(),
    [IPC_CHANNELS.appInstallGitHubUpdate]: () => bridge.installGitHubUpdate(),
    [IPC_CHANNELS.appTestNetworkProxy]: () => bridge.testNetworkProxy(),
    [IPC_CHANNELS.bookOpen]: () => bridge.openBook('book:1'),
    [IPC_CHANNELS.bookGetPage]: () => bridge.getBookPage('00000000-0000-4000-8000-000000000000', 1, { force: true }),
    [IPC_CHANNELS.bookClose]: () => bridge.closeBook('00000000-0000-4000-8000-000000000000'),
    [IPC_CHANNELS.videoGetPlayback]: () => bridge.getVideoPlayback('video:1'),
    [IPC_CHANNELS.videoGetPlaybackSupport]: () => bridge.getVideoPlaybackSupport('video:1'),
    [IPC_CHANNELS.videoOpenExternal]: () => bridge.openVideoExternally('video:1'),
    [IPC_CHANNELS.videoUpdateMetadata]: () => bridge.updateVideoMetadata({}),
    [IPC_CHANNELS.libraryUpdateContainerTags]: () => bridge.updateContainerTags({}),
    [IPC_CHANNELS.libraryUpdateMediaTags]: () => bridge.updateMediaTags({}),
    [IPC_CHANNELS.libraryUpdateContainerInfo]: () => bridge.updateContainerInfo({}),
    [IPC_CHANNELS.libraryUpdateMediaInfo]: () => bridge.updateMediaInfo({}),
    [IPC_CHANNELS.libraryUpdateVideoEpisode]: () => bridge.updateVideoEpisode({}),
    [IPC_CHANNELS.libraryUpdateBookShelves]: () => bridge.updateBookShelves({}),
    [IPC_CHANNELS.libraryTransferItems]: () => bridge.transferLibraryItems({}),
    [IPC_CHANNELS.libraryMoveVideoAffiliation]: () => bridge.moveVideoToAffiliation({}),
    [IPC_CHANNELS.libraryTrashItems]: () => bridge.trashLibraryItems({}),
    [IPC_CHANNELS.libraryTrashVideoContainer]: () => bridge.trashVideoContainer({}),
    [IPC_CHANNELS.libraryRegenerateThumbnails]: () => bridge.regenerateThumbnails(),
    [IPC_CHANNELS.libraryClearCaches]: () => bridge.clearCaches(),
    [IPC_CHANNELS.libraryClearEmptyMediaDirectories]: () => bridge.clearEmptyMediaDirectories(),
    [IPC_CHANNELS.systemOpenPath]: () => bridge.openPath('C:\\Media'),
    [IPC_CHANNELS.systemOpenExternalUrl]: () => bridge.openExternalUrl('https://bgm.tv/subject/1'),
    [IPC_CHANNELS.bangumiSearchSubjects]: () => bridge.searchBangumiSubjects({}),
    [IPC_CHANNELS.bangumiPreviewSubject]: () => bridge.previewBangumiSubject({}),
    [IPC_CHANNELS.bangumiApplySubject]: () => bridge.applyBangumiSubject({}),
    [IPC_CHANNELS.bangumiAssignEpisodes]: () => bridge.assignBangumiEpisodes({}),
    [IPC_CHANNELS.bangumiApplyEpisode]: () => bridge.applyBangumiEpisode({}),
    [IPC_CHANNELS.bangumiOpenTokenPage]: () => bridge.openBangumiTokenPage(),
    [IPC_CHANNELS.bangumiVerifyToken]: () => bridge.verifyBangumiToken(),
    [IPC_CHANNELS.hanimeSearchSubjects]: () => bridge.searchHanimeSubjects({}),
    [IPC_CHANNELS.hanimePreviewSubject]: () => bridge.previewHanimeSubject({}),
    [IPC_CHANNELS.hanimeApplySubject]: () => bridge.applyHanimeSubject({}),
    [IPC_CHANNELS.windowMinimize]: () => bridge.minimizeWindow(),
    [IPC_CHANNELS.windowToggleMaximize]: () => bridge.toggleMaximizeWindow(),
    [IPC_CHANNELS.windowClose]: () => bridge.closeWindow(),
    [IPC_CHANNELS.dialogChooseDirectory]: () => bridge.chooseDirectory(),
    [IPC_CHANNELS.dialogChooseImportSources]: () => bridge.chooseImportSources(),
    [IPC_CHANNELS.dialogChooseVideoFile]: () => bridge.chooseVideoFile(),
    [IPC_CHANNELS.dialogChooseAppDataBackup]: () => bridge.chooseAppDataBackup(),
  }

  assert.deepEqual(Object.keys(callsByChannel).sort(), [...IPC_INVOKE_CHANNELS].sort())
  for (const invoke of Object.values(callsByChannel)) await invoke()
  assert.deepEqual(calls.map((call) => call.channel).sort(), [...IPC_INVOKE_CHANNELS].sort())
  assert.equal(bridge.getPathForFile({}), 'C:\\Media\\file.mp4')
})

test('forwards event payloads and unsubscribes listeners from their specific channels', () => {
  const subscriptions = []
  const bridge = createPreloadBridge({
    invoke: async () => {},
    subscribe: (channel, listener) => {
      const entry = { channel, listener, removed: false }
      subscriptions.push(entry)
      return () => {
        entry.removed = true
      }
    },
    getPathForFile: () => '',
  })
  const progress = []
  const thumbnails = []
  const updates = []
  const stopProgress = bridge.onImportProgress((value) => progress.push(value))
  const stopThumbnails = bridge.onLibraryThumbnailsUpdated((value) => thumbnails.push(value))
  const stopUpdates = bridge.onGitHubUpdateProgress((value) => updates.push(value))

  subscriptions[0].listener({ current: 1 })
  subscriptions[1].listener([{ id: 'video:1' }])
  subscriptions[2].listener({ stage: 'downloading', downloadedBytes: 1, totalBytes: 2 })
  stopProgress()
  stopThumbnails()
  stopUpdates()

  assert.deepEqual(progress, [{ current: 1 }])
  assert.deepEqual(thumbnails, [[{ id: 'video:1' }]])
  assert.deepEqual(updates, [{ stage: 'downloading', downloadedBytes: 1, totalBytes: 2 }])
  assert.deepEqual(
    subscriptions.map(({ channel, removed }) => ({ channel, removed })),
    [
      { channel: IPC_CHANNELS.importProgress, removed: true },
      { channel: IPC_CHANNELS.libraryThumbnailsUpdated, removed: true },
      { channel: IPC_CHANNELS.appGitHubUpdateProgress, removed: true },
    ],
  )
})
