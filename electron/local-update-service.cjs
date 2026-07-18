const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')

const updateDirectoryPrefix = 'StarMedia-local-update-'
const updaterReadyTimeoutMs = 60 * 1000
const requiredPackagePaths = [
  'StarMedia.exe',
  path.join('resources', 'app', 'package.json'),
  path.join('resources', 'app', 'electron', 'main.cjs'),
  path.join('resources', 'app', 'dist', 'index.html'),
]

function parseArchiveEntries(output) {
  const entries = []
  let entriesStarted = false
  for (const line of String(output).split(/\r?\n/)) {
    if (line.trim() === '----------') {
      entriesStarted = true
      continue
    }
    if (!entriesStarted || !line.startsWith('Path = ')) continue
    const entry = line.slice('Path = '.length).trim().replace(/\\/g, '/')
    if (entry) entries.push(entry)
  }
  return entries
}

function validateArchiveEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('升级包中没有可安装的文件')
  let fileCount = 0
  for (const entry of entries) {
    if (entry === '.' || entry.endsWith('/')) continue
    fileCount += 1
    const segments = entry.split('/')
    if (entry.startsWith('/') || /^[A-Za-z]:\//.test(entry) || segments.includes('..')) throw new Error('升级包包含无效路径')
    if (segments[0] !== 'StarMedia') throw new Error('升级包必须只包含顶层 StarMedia 文件夹')
    if (segments.some((segment) => segment.toLocaleLowerCase() === 'starmediadata'))
      throw new Error('升级包不得包含 StarMediaData 数据目录')
  }
  if (fileCount === 0) throw new Error('升级包中没有可安装的文件')
}

function parseVersion(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) throw new Error(`版本号格式无效：${value}`)
  return match.slice(1).map(Number)
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1
  }
  return 0
}

async function validateExtractedTree(root, fileSystem = fs) {
  async function visit(directory) {
    const entries = await fileSystem.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('升级包不支持符号链接')
      if (entry.isDirectory()) await visit(path.join(directory, entry.name))
    }
  }
  await visit(root)
}

async function copyFileIfPresent(source, destination, fileSystem = fs) {
  try {
    const stat = await fileSystem.stat(source)
    if (!stat.isFile()) throw new Error(`${source} 不是文件`)
    await fileSystem.copyFile(source, destination)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function defaultSpawnUpdater(scriptPath, planPath, statusPath, launcherPath) {
  const child = spawn('cmd.exe', ['/d', '/s', '/c', launcherPath, scriptPath, planPath, statusPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  return child
}

async function waitForUpdaterReady({
  statusPath,
  fileSystem = fs,
  timeoutMs = updaterReadyTimeoutMs,
  pollIntervalMs = 50,
  delay = setTimeout,
}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const status = (await fileSystem.readFile(statusPath, 'utf8')).replace(/^\uFEFF/, '').trim()
      if (status === 'ready') return
      if (status.startsWith('failed:')) throw new Error(status.slice('failed:'.length).trim() || '升级器初始化失败')
    } catch (error) {
      // PowerShell can briefly lock the status file while replacing its text.
      if (error?.code !== 'ENOENT' && error?.code !== 'EBUSY') throw error
    }
    await new Promise((resolve) => delay(resolve, pollIntervalMs))
  }
  throw new Error(`升级器未能在 ${Math.ceil(timeoutMs / 1000)} 秒内启动，请检查安全软件或 PowerShell 设置`)
}

function createLocalUpdateService({
  isPackaged,
  appVersion,
  executablePath,
  processId = process.pid,
  dataRoot,
  run7z,
  updaterScriptPath,
  updaterLauncherPath,
  updaterLauncherScriptPath,
  fileSystem = fs,
  temporaryDirectory = os.tmpdir,
  spawnUpdater = defaultSpawnUpdater,
  waitForReady = waitForUpdaterReady,
  now = () => new Date(),
  minimumExecutableBytes = 20 * 1024 * 1024,
}) {
  if (
    typeof run7z !== 'function' ||
    typeof spawnUpdater !== 'function' ||
    typeof updaterLauncherPath !== 'string' ||
    !updaterLauncherPath ||
    typeof updaterLauncherScriptPath !== 'string' ||
    !updaterLauncherScriptPath
  )
    throw new Error('本地升级服务依赖不可用')
  const installDirectory = path.dirname(executablePath)

  async function discardPreparedUpdate(prepared) {
    if (!prepared?.workDirectory) return
    const resolved = path.resolve(prepared.workDirectory)
    const tempRoot = path.resolve(temporaryDirectory())
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith(updateDirectoryPrefix))
      throw new Error('拒绝清理预期范围之外的升级目录')
    await fileSystem.rm(resolved, { recursive: true, force: true })
  }

  async function prepareUpdate(archivePath) {
    if (!isPackaged) throw new Error('本地 ZIP 升级只能在打包版中使用')
    if (typeof archivePath !== 'string' || !path.isAbsolute(archivePath) || path.extname(archivePath).toLocaleLowerCase() !== '.zip')
      throw new Error('请选择有效的 StarMedia ZIP 升级包')
    const archiveStat = await fileSystem.stat(archivePath)
    if (!archiveStat.isFile() || archiveStat.size === 0) throw new Error('升级包文件无效')

    const workDirectory = path.join(temporaryDirectory(), `${updateDirectoryPrefix}${randomUUID()}`)
    const extractDirectory = path.join(workDirectory, 'extracted')
    const prepared = { workDirectory }
    try {
      await fileSystem.mkdir(extractDirectory, { recursive: true })
      await run7z(['t', '-y', archivePath])
      const archiveEntries = parseArchiveEntries(await run7z(['l', '-slt', archivePath]))
      validateArchiveEntries(archiveEntries)
      await run7z(['x', '-y', archivePath, `-o${extractDirectory}`])
      await validateExtractedTree(extractDirectory, fileSystem)

      const applicationRoot = path.join(extractDirectory, 'StarMedia')
      for (const requiredPath of requiredPackagePaths) {
        const stat = await fileSystem.stat(path.join(applicationRoot, requiredPath))
        if (!stat.isFile()) throw new Error(`升级包缺少必要文件：${requiredPath}`)
      }
      const executableStat = await fileSystem.stat(path.join(applicationRoot, 'StarMedia.exe'))
      if (executableStat.size < minimumExecutableBytes) throw new Error('升级包中的 StarMedia.exe 体积异常')

      const packageJson = JSON.parse(await fileSystem.readFile(path.join(applicationRoot, 'resources', 'app', 'package.json'), 'utf8'))
      if (packageJson.name !== 'starmedia') throw new Error('升级包的应用标识无效')
      const targetVersion = String(packageJson.version ?? '').trim()
      const comparison = compareVersions(targetVersion, appVersion)
      if (comparison < 0) throw new Error(`不能从 ${appVersion} 降级到 ${targetVersion}`)

      return {
        ...prepared,
        archivePath,
        applicationRoot,
        currentVersion: appVersion,
        targetVersion,
        reinstall: comparison === 0,
        archiveSize: archiveStat.size,
      }
    } catch (error) {
      await discardPreparedUpdate(prepared).catch(() => {})
      throw error
    }
  }

  async function createPreUpdateSnapshot(targetVersion) {
    const stamp = now().toISOString().replace(/[:.]/g, '-')
    const snapshotDirectory = path.join(dataRoot, 'backups', `pre-update-${appVersion}-to-${targetVersion}-${stamp}`)
    await fileSystem.mkdir(snapshotDirectory, { recursive: true })
    const copiedFiles = []
    for (const name of ['starmedia-config.json', 'starmedia-library.json']) {
      if (await copyFileIfPresent(path.join(dataRoot, name), path.join(snapshotDirectory, name), fileSystem)) copiedFiles.push(name)
    }
    await fileSystem.writeFile(
      path.join(snapshotDirectory, 'manifest.json'),
      `${JSON.stringify({ format: 'starmedia-pre-update-snapshot', fromVersion: appVersion, toVersion: targetVersion, createdAt: now().toISOString(), copiedFiles }, null, 2)}\n`,
      'utf8',
    )
    return snapshotDirectory
  }

  async function launchPreparedUpdate(prepared) {
    if (!prepared?.workDirectory || !prepared?.applicationRoot || !prepared?.targetVersion) throw new Error('升级准备信息无效')
    const expectedDataRoot = path.join(installDirectory, 'StarMediaData')
    if (path.resolve(dataRoot).toLocaleLowerCase() !== path.resolve(expectedDataRoot).toLocaleLowerCase())
      throw new Error('当前数据目录不在程序目录的 StarMediaData 中，已拒绝升级')

    const updatesDirectory = path.join(dataRoot, 'updates')
    await fileSystem.mkdir(updatesDirectory, { recursive: true })
    const snapshotDirectory = await createPreUpdateSnapshot(prepared.targetVersion)
    const runnerPath = path.join(prepared.workDirectory, 'local-update-runner.ps1')
    const launcherPath = path.join(prepared.workDirectory, 'local-update-launcher.cmd')
    const launcherScriptPath = path.join(prepared.workDirectory, 'local-update-launcher.vbs')
    const planPath = path.join(prepared.workDirectory, 'plan.json')
    const statusPath = path.join(prepared.workDirectory, 'status.txt')
    await fileSystem.copyFile(updaterScriptPath, runnerPath)
    await fileSystem.copyFile(updaterLauncherPath, launcherPath)
    await fileSystem.copyFile(updaterLauncherScriptPath, launcherScriptPath)
    const token = randomUUID()
    const logPath = path.join(updatesDirectory, `update-${now().toISOString().replace(/[:.]/g, '-')}.log`)
    await fileSystem.writeFile(logPath, `${now().toISOString()} Starting update runner.\n`, 'utf8')
    const plan = {
      format: 'starmedia-local-update-plan',
      installDirectory,
      applicationRoot: prepared.applicationRoot,
      dataRoot,
      executableName: path.basename(executablePath),
      processId,
      rollbackDirectory: path.join(installDirectory, `.starmedia-update-rollback-${token}`),
      logPath,
      fromVersion: appVersion,
      toVersion: prepared.targetVersion,
    }
    await fileSystem.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
    const child = await spawnUpdater(runnerPath, planPath, statusPath, launcherPath)
    if (!child || typeof child.pid !== 'number') throw new Error('无法启动独立升级程序')
    await waitForReady({ statusPath, fileSystem })
    return { targetVersion: prepared.targetVersion, reinstall: prepared.reinstall, snapshotDirectory, logPath }
  }

  return { discardPreparedUpdate, launchPreparedUpdate, prepareUpdate }
}

module.exports = {
  compareVersions,
  createLocalUpdateService,
  parseArchiveEntries,
  updaterReadyTimeoutMs,
  validateArchiveEntries,
  waitForUpdaterReady,
}
