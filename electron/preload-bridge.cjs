const { IPC_CHANNELS } = require('./ipc-channels.cjs')
const { IPC_CONTRACTS } = require('./ipc-contracts.cjs')

function createPreloadBridge({ invoke, subscribe, getPathForFile }) {
  if (typeof invoke !== 'function' || typeof subscribe !== 'function' || typeof getPathForFile !== 'function')
    throw new Error('Preload bridge dependencies are unavailable')

  function call(channel, ...args) {
    if (!IPC_CONTRACTS[channel]) throw new Error(`未定义的 IPC 通道：${channel}`)
    return invoke(channel, ...args)
  }

  return {
    prototype: true,
    getConfig: () => call(IPC_CHANNELS.configLoad),
    saveConfig: (config) => call(IPC_CHANNELS.configSave, config),
    createImportPlan: (input) => call(IPC_CHANNELS.importCreatePlan, input),
    onImportProgress: (listener) => subscribe(IPC_CHANNELS.importProgress, listener),
    onLibraryThumbnailsUpdated: (listener) => subscribe(IPC_CHANNELS.libraryThumbnailsUpdated, listener),
    onGitHubUpdateProgress: (listener) => subscribe(IPC_CHANNELS.appGitHubUpdateProgress, listener),
    getLibrary: () => call(IPC_CHANNELS.libraryLoad),
    getLibraryUsage: (libraryId) => call(IPC_CHANNELS.libraryGetUsage, libraryId),
    importMedia: (input) => call(IPC_CHANNELS.libraryImportMedia, input),
    clearImportedRecords: () => call(IPC_CHANNELS.libraryClearRecords),
    exportAppData: () => call(IPC_CHANNELS.appExportData),
    chooseAppDataBackup: () => call(IPC_CHANNELS.dialogChooseAppDataBackup),
    importAppData: (backupPath) => call(IPC_CHANNELS.appImportData, backupPath),
    installLocalUpdate: () => call(IPC_CHANNELS.appInstallLocalUpdate),
    checkGitHubUpdate: () => call(IPC_CHANNELS.appCheckGitHubUpdate),
    installGitHubUpdate: () => call(IPC_CHANNELS.appInstallGitHubUpdate),
    testNetworkProxy: () => call(IPC_CHANNELS.appTestNetworkProxy),
    openBook: (id) => call(IPC_CHANNELS.bookOpen, id),
    getBookPage: (sessionId, index, options) =>
      options === undefined ? call(IPC_CHANNELS.bookGetPage, sessionId, index) : call(IPC_CHANNELS.bookGetPage, sessionId, index, options),
    closeBook: (sessionId) => call(IPC_CHANNELS.bookClose, sessionId),
    getVideoPlayback: (id) => call(IPC_CHANNELS.videoGetPlayback, id),
    getVideoPlaybackSupport: (id) => call(IPC_CHANNELS.videoGetPlaybackSupport, id),
    openVideoExternally: (id) => call(IPC_CHANNELS.videoOpenExternal, id),
    updateVideoMetadata: (input) => call(IPC_CHANNELS.videoUpdateMetadata, input),
    updateContainerTags: (input) => call(IPC_CHANNELS.libraryUpdateContainerTags, input),
    updateMediaTags: (input) => call(IPC_CHANNELS.libraryUpdateMediaTags, input),
    updateContainerInfo: (input) => call(IPC_CHANNELS.libraryUpdateContainerInfo, input),
    updateMediaInfo: (input) => call(IPC_CHANNELS.libraryUpdateMediaInfo, input),
    updateVideoEpisode: (input) => call(IPC_CHANNELS.libraryUpdateVideoEpisode, input),
    updateBookShelves: (input) => call(IPC_CHANNELS.libraryUpdateBookShelves, input),
    transferLibraryItems: (input) => call(IPC_CHANNELS.libraryTransferItems, input),
    moveVideoToAffiliation: (input) => call(IPC_CHANNELS.libraryMoveVideoAffiliation, input),
    trashLibraryItems: (input) => call(IPC_CHANNELS.libraryTrashItems, input),
    trashVideoContainer: (input) => call(IPC_CHANNELS.libraryTrashVideoContainer, input),
    regenerateThumbnails: () => call(IPC_CHANNELS.libraryRegenerateThumbnails),
    clearCaches: () => call(IPC_CHANNELS.libraryClearCaches),
    clearEmptyMediaDirectories: () => call(IPC_CHANNELS.libraryClearEmptyMediaDirectories),
    openPath: (targetPath) => call(IPC_CHANNELS.systemOpenPath, targetPath),
    openExternalUrl: (url) => call(IPC_CHANNELS.systemOpenExternalUrl, url),
    searchBangumiSubjects: (input) => call(IPC_CHANNELS.bangumiSearchSubjects, input),
    previewBangumiSubject: (input) => call(IPC_CHANNELS.bangumiPreviewSubject, input),
    applyBangumiSubject: (input) => call(IPC_CHANNELS.bangumiApplySubject, input),
    assignBangumiEpisodes: (input) => call(IPC_CHANNELS.bangumiAssignEpisodes, input),
    applyBangumiEpisode: (input) => call(IPC_CHANNELS.bangumiApplyEpisode, input),
    searchHanimeSubjects: (input) => call(IPC_CHANNELS.hanimeSearchSubjects, input),
    previewHanimeSubject: (input) => call(IPC_CHANNELS.hanimePreviewSubject, input),
    applyHanimeSubject: (input) => call(IPC_CHANNELS.hanimeApplySubject, input),
    openBangumiTokenPage: () => call(IPC_CHANNELS.bangumiOpenTokenPage),
    verifyBangumiToken: () => call(IPC_CHANNELS.bangumiVerifyToken),
    minimizeWindow: () => call(IPC_CHANNELS.windowMinimize),
    toggleMaximizeWindow: () => call(IPC_CHANNELS.windowToggleMaximize),
    closeWindow: () => call(IPC_CHANNELS.windowClose),
    chooseDirectory: () => call(IPC_CHANNELS.dialogChooseDirectory),
    chooseImportSources: () => call(IPC_CHANNELS.dialogChooseImportSources),
    chooseVideoFile: () => call(IPC_CHANNELS.dialogChooseVideoFile),
    getPathForFile,
  }
}

module.exports = { createPreloadBridge }
