const fs = require('node:fs/promises')
const fssync = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { path7za } = require('7zip-bin')

const workspaceRoot = path.resolve(__dirname, '..')
const packageJson = require(path.join(workspaceRoot, 'package.json'))
const productName = 'StarMedia'
const version = packageJson.version
const releaseDirectory = path.join(workspaceRoot, 'release')
const stagingDirectory = path.join(releaseDirectory, `${productName}-${version}-staging`)
const productDirectory = path.join(stagingDirectory, productName)
const archivePath = path.join(releaseDirectory, `${productName}-${version}-win.zip`)

function assertImmediateChild(target, parent) {
  const relative = path.relative(parent, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error(`拒绝清理预期范围之外的路径：${target}`)
  }
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

async function copyDirectory(source, destination) {
  await fs.cp(source, destination, { recursive: true, force: true })
}

async function verifyElectronSyntax(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await verifyElectronSyntax(entryPath)
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.cjs')) {
      execFileSync(process.execPath, ['--check', entryPath], { stdio: 'inherit', windowsHide: true })
    }
  }
}

async function normalizeStagingTimestamps() {
  const timestamp = new Date()
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(entryPath)
      await fs.utimes(entryPath, timestamp, timestamp)
    }
  }
  await visit(stagingDirectory)
  await fs.utimes(stagingDirectory, timestamp, timestamp)
}

async function verifyStagingTimestamps() {
  const minimumYear = 2020
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      const stat = await fs.stat(entryPath)
      if (stat.mtime.getFullYear() < minimumYear) throw new Error(`打包文件时间戳异常：${entryPath}`)
      if (entry.isDirectory()) await visit(entryPath)
    }
  }
  await visit(stagingDirectory)
}

async function clearReleaseDirectory() {
  const entries = await fs.readdir(releaseDirectory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(releaseDirectory, entry.name)
    assertImmediateChild(entryPath, releaseDirectory)
    await fs.rm(entryPath, { recursive: true, force: true })
  }
}

function runRcedit(executablePath) {
  const rceditPath = path.join(workspaceRoot, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe')
  const iconPath = path.join(workspaceRoot, 'build', 'icon.ico')
  if (!fssync.existsSync(rceditPath)) throw new Error('未找到 rcedit，无法写入 Windows 图标资源')
  if (!fssync.existsSync(iconPath)) throw new Error('未找到 build/icon.ico')
  execFileSync(
    rceditPath,
    [
      executablePath,
      '--set-icon',
      iconPath,
      '--set-version-string',
      'ProductName',
      productName,
      '--set-version-string',
      'FileDescription',
      'StarMedia 本地媒体库',
      '--set-version-string',
      'FileVersion',
      version,
      '--set-version-string',
      'ProductVersion',
      version,
    ],
    { stdio: 'inherit', windowsHide: true },
  )
}

async function verifyPortableApplication(rootDirectory) {
  const executablePath = path.join(rootDirectory, `${productName}.exe`)
  const applicationRoot = path.join(rootDirectory, 'resources', 'app')
  const requiredPaths = [
    executablePath,
    path.join(applicationRoot, 'package.json'),
    path.join(applicationRoot, 'electron', 'main.cjs'),
    path.join(applicationRoot, 'electron', 'local-update-launcher.cmd'),
    path.join(applicationRoot, 'electron', 'local-update-launcher.vbs'),
    path.join(applicationRoot, 'electron', 'local-update-runner.ps1'),
    path.join(applicationRoot, 'dist', 'index.html'),
    path.join(applicationRoot, 'dist', 'libass', 'subtitles-octopus.js'),
    path.join(applicationRoot, 'dist', 'libass', 'subtitles-octopus-worker.js'),
    path.join(applicationRoot, 'dist', 'libass', 'subtitles-octopus-worker.wasm'),
    path.join(applicationRoot, 'dist', 'libass', 'fonts', 'noto-sans-cjk-sc-fonts.json'),
    path.join(applicationRoot, 'dist', 'libass', 'fonts', 'Noto-Sans-CJK-SC-OFL.txt'),
    path.join(applicationRoot, 'dist', 'libass', 'fonts', 'NotoSansCJKsc-Regular.otf'),
    path.join(applicationRoot, 'node_modules', '7zip-bin', 'index.js'),
    path.join(applicationRoot, 'node_modules', 'libass-wasm', 'dist', 'js', 'subtitles-octopus.js'),
    path.join(applicationRoot, 'node_modules', 'yauzl', 'index.js'),
    path.join(applicationRoot, 'node_modules', 'pend', 'index.js'),
  ]
  for (const requiredPath of requiredPaths) {
    await fs.access(requiredPath)
  }
  const executableStat = await fs.stat(executablePath)
  if (executableStat.size < 20 * 1024 * 1024) throw new Error('StarMedia.exe 体积异常，可能不是 Electron 运行时')
}

async function verifyArchive() {
  const verificationDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-package-verify-'))
  try {
    execFileSync(path7za, ['t', '-y', archivePath], { stdio: 'inherit', windowsHide: true })
    execFileSync(path7za, ['x', '-y', archivePath, `-o${verificationDirectory}`], { stdio: 'inherit', windowsHide: true })
    await verifyPortableApplication(path.join(verificationDirectory, productName))
  } finally {
    await fs.rm(verificationDirectory, { recursive: true, force: true })
  }
}

async function packagePortableApplication() {
  await verifyElectronSyntax(path.join(workspaceRoot, 'electron'))
  await fs.mkdir(releaseDirectory, { recursive: true })
  await clearReleaseDirectory()

  const electronRuntime = path.join(workspaceRoot, 'node_modules', 'electron', 'dist')
  await copyDirectory(electronRuntime, productDirectory)
  const electronExecutable = path.join(productDirectory, 'electron.exe')
  const applicationExecutable = path.join(productDirectory, `${productName}.exe`)
  await fs.rename(electronExecutable, applicationExecutable)

  const applicationRoot = path.join(productDirectory, 'resources', 'app')
  await fs.mkdir(applicationRoot, { recursive: true })
  await copyDirectory(path.join(workspaceRoot, 'dist'), path.join(applicationRoot, 'dist'))
  await copyDirectory(path.join(workspaceRoot, 'electron'), path.join(applicationRoot, 'electron'))
  await copyDirectory(path.join(workspaceRoot, 'build'), path.join(applicationRoot, 'build'))
  await copyDirectory(path.join(workspaceRoot, 'src', 'assets'), path.join(applicationRoot, 'src', 'assets'))
  await fs.copyFile(path.join(workspaceRoot, 'package.json'), path.join(applicationRoot, 'package.json'))

  const runtimeModules = ['7zip-bin', 'libass-wasm', 'yauzl', 'pend']
  for (const moduleName of runtimeModules) {
    await copyDirectory(path.join(workspaceRoot, 'node_modules', moduleName), path.join(applicationRoot, 'node_modules', moduleName))
  }

  runRcedit(applicationExecutable)
  await verifyPortableApplication(productDirectory)
  await normalizeStagingTimestamps()
  await verifyStagingTimestamps()

  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -LiteralPath ${quotePowerShell(productDirectory)} -DestinationPath ${quotePowerShell(archivePath)} -Force`,
    ],
    { stdio: 'inherit', windowsHide: true },
  )

  const archiveStat = await fs.stat(archivePath)
  if (archiveStat.size < 30 * 1024 * 1024) throw new Error('生成的 ZIP 体积异常')
  await verifyArchive()
  await fs.rm(stagingDirectory, { recursive: true, force: true })
  const remainingEntries = await fs.readdir(releaseDirectory)
  if (remainingEntries.length !== 1 || remainingEntries[0] !== path.basename(archivePath))
    throw new Error('打包目录未按规则清理，必须只保留最新绿色 ZIP')
  console.log(`已生成绿色版：${archivePath}`)
}

packagePortableApplication().catch(async (error) => {
  await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {})
  await fs.rm(archivePath, { force: true }).catch(() => {})
  console.error(error)
  process.exitCode = 1
})
