const os = require('node:os')
const path = require('node:path')

function createDesktopDialogService({
  showSaveDialog,
  showOpenDialog,
  showMessageBox,
  getDefaultOwner = () => null,
  exportBackup,
  runLocked,
  homeDirectory = os.homedir,
  now = () => new Date(),
}) {
  if (
    typeof showSaveDialog !== 'function' ||
    typeof showOpenDialog !== 'function' ||
    typeof showMessageBox !== 'function' ||
    typeof exportBackup !== 'function' ||
    typeof runLocked !== 'function'
  )
    throw new Error('桌面对话框服务依赖不可用')

  let exportPromise = null
  let warningPromise = null

  function withOwner(owner, invoke) {
    return invoke(owner ?? null)
  }

  async function createPortableDataBackup(owner = getDefaultOwner()) {
    const defaultPath = path.join(homeDirectory(), `StarMedia-数据备份-${now().toISOString().slice(0, 10)}.zip`)
    const result = await withOwner(owner, (dialogOwner) =>
      showSaveDialog(dialogOwner, {
        title: '导出 StarMedia 应用数据',
        defaultPath,
        filters: [{ name: 'StarMedia 数据备份', extensions: ['zip'] }],
      }),
    )
    if (result.canceled || !result.filePath) return { canceled: true }
    return { canceled: false, ...(await exportBackup(result.filePath)) }
  }

  function startPortableDataExport(owner) {
    if (exportPromise) return exportPromise
    exportPromise = runLocked(() => createPortableDataBackup(owner))
    exportPromise = exportPromise.finally(() => {
      exportPromise = null
    })
    return exportPromise
  }

  function isPortableDataExportInProgress() {
    return Boolean(exportPromise)
  }

  function showPortableExportWarning(owner) {
    if (warningPromise) return warningPromise
    const options = {
      type: 'info',
      title: '正在导出应用数据',
      message: '正在导出应用数据，请等待导出结束后再关闭应用。',
      buttons: ['知道了'],
    }
    warningPromise = withOwner(owner, (dialogOwner) => showMessageBox(dialogOwner, options))
    warningPromise = warningPromise.finally(() => {
      warningPromise = null
    })
    return warningPromise
  }

  async function chooseDirectory(owner) {
    const result = await withOwner(owner, (dialogOwner) =>
      showOpenDialog(dialogOwner, { title: '选择文件夹', properties: ['openDirectory', 'createDirectory'] }),
    )
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  async function chooseImportSources(owner) {
    const result = await withOwner(owner, (dialogOwner) =>
      showOpenDialog(dialogOwner, { title: '选择文件或文件夹', properties: ['openFile', 'openDirectory', 'multiSelections'] }),
    )
    return result.canceled ? [] : result.filePaths
  }

  async function chooseAppDataBackup(owner) {
    const result = await withOwner(owner, (dialogOwner) =>
      showOpenDialog(dialogOwner, {
        title: '选择 StarMedia 应用数据备份',
        properties: ['openFile'],
        filters: [{ name: 'StarMedia 数据备份', extensions: ['zip'] }],
      }),
    )
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  return {
    chooseAppDataBackup,
    chooseDirectory,
    chooseImportSources,
    createPortableDataBackup,
    isPortableDataExportInProgress,
    showPortableExportWarning,
    startPortableDataExport,
  }
}

module.exports = { createDesktopDialogService }
