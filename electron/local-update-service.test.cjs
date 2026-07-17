const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const {
  compareVersions,
  createLocalUpdateService,
  parseArchiveEntries,
  updaterReadyTimeoutMs,
  validateArchiveEntries,
  waitForUpdaterReady,
} = require('./local-update-service.cjs')
const execFileAsync = promisify(execFile)

function archiveListing(entries) {
  return ['archive metadata', '----------', ...entries.map((entry) => `Path = ${entry}`)].join('\n')
}

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-local-update-test-'))
  const installDirectory = path.join(root, 'StarMedia')
  const dataRoot = path.join(installDirectory, 'StarMediaData')
  const archivePath = path.join(root, 'StarMedia-update.zip')
  const updaterScriptPath = path.join(root, 'runner.ps1')
  const updaterLauncherPath = path.join(root, 'launcher.cmd')
  await fs.mkdir(dataRoot, { recursive: true })
  await fs.writeFile(archivePath, 'zip placeholder')
  await fs.writeFile(updaterScriptPath, 'param([string]$PlanPath)')
  await fs.writeFile(
    updaterLauncherPath,
    '@echo off\nstart "" /b powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~1" -PlanPath "%~2" -StatusPath "%~3" >nul 2>nul\n',
  )
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { root, installDirectory, dataRoot, archivePath, updaterLauncherPath, updaterScriptPath }
}

function createRun7zStub(version, entries) {
  return async (args) => {
    if (args[0] === 'l') return archiveListing(entries)
    if (args[0] !== 'x') return 'Everything is Ok'
    const output = args.find((argument) => argument.startsWith('-o')).slice(2)
    const applicationRoot = path.join(output, 'StarMedia')
    await fs.mkdir(path.join(applicationRoot, 'resources', 'app', 'electron'), { recursive: true })
    await fs.mkdir(path.join(applicationRoot, 'resources', 'app', 'dist'), { recursive: true })
    await fs.writeFile(path.join(applicationRoot, 'StarMedia.exe'), 'fake executable')
    await fs.writeFile(path.join(applicationRoot, 'resources', 'app', 'package.json'), JSON.stringify({ name: 'starmedia', version }))
    await fs.writeFile(path.join(applicationRoot, 'resources', 'app', 'electron', 'main.cjs'), '')
    await fs.writeFile(path.join(applicationRoot, 'resources', 'app', 'dist', 'index.html'), '')
    return 'Everything is Ok'
  }
}

const validEntries = [
  'StarMedia\\StarMedia.exe',
  'StarMedia\\resources\\app\\package.json',
  'StarMedia\\resources\\app\\electron\\main.cjs',
  'StarMedia\\resources\\app\\dist\\index.html',
]

test('parses and validates portable application archive entries', () => {
  const entries = parseArchiveEntries(archiveListing(validEntries))
  assert.deepEqual(
    entries,
    validEntries.map((entry) => entry.replaceAll('\\', '/')),
  )
  assert.doesNotThrow(() => validateArchiveEntries(entries))
  assert.throws(() => validateArchiveEntries(['../StarMedia.exe']), /无效路径/)
  assert.throws(() => validateArchiveEntries(['StarMedia/StarMediaData/starmedia-config.json']), /不得包含 StarMediaData/)
  assert.throws(() => validateArchiveEntries(['unexpected.txt']), /顶层 StarMedia/)
})

test('compares semantic release versions and rejects malformed versions', () => {
  assert.equal(compareVersions('0.6.20', '0.6.19'), 1)
  assert.equal(compareVersions('0.6.20', '0.6.20'), 0)
  assert.equal(compareVersions('0.6.19', '0.6.20'), -1)
  assert.throws(() => compareVersions('development', '0.6.20'), /版本号格式无效/)
})

test('waits for updater readiness and surfaces initialization failures', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-updater-ready-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const statusPath = path.join(root, 'status.txt')
  await fs.writeFile(statusPath, 'ready')
  await assert.doesNotReject(waitForUpdaterReady({ statusPath }))
  await fs.writeFile(statusPath, 'failed:PowerShell 被安全策略阻止')
  await assert.rejects(waitForUpdaterReady({ statusPath }), /安全策略阻止/)
  await fs.rm(statusPath)
  await assert.rejects(waitForUpdaterReady({ statusPath, timeoutMs: 0 }), /0 秒/)
  assert.equal(updaterReadyTimeoutMs, 60 * 1000)
})

test('PowerShell runner reports an invalid plan through the handshake file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-updater-runner-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const planPath = path.join(root, 'plan.json')
  const statusPath = path.join(root, 'status.txt')
  await fs.writeFile(planPath, JSON.stringify({ format: 'invalid' }))
  await assert.rejects(
    execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(__dirname, 'local-update-runner.ps1'),
      '-PlanPath',
      planPath,
      '-StatusPath',
      statusPath,
    ]),
  )
  assert.match((await fs.readFile(statusPath, 'utf8')).replace(/^\uFEFF/, '').trim(), /^failed:Invalid update plan format/)
})

test('Windows command launcher starts the updater and completes its ready handshake', { skip: process.platform !== 'win32' }, async (t) => {
  const sandbox = await createSandbox(t)
  await fs.writeFile(
    sandbox.updaterScriptPath,
    "param([string]$PlanPath, [string]$StatusPath)\nSet-Content -LiteralPath $StatusPath -Value 'ready' -Encoding UTF8\n",
  )
  const service = createLocalUpdateService({
    isPackaged: true,
    appVersion: '0.6.20',
    executablePath: path.join(sandbox.installDirectory, 'StarMedia.exe'),
    dataRoot: sandbox.dataRoot,
    run7z: createRun7zStub('0.6.21', validEntries),
    updaterLauncherPath: sandbox.updaterLauncherPath,
    updaterScriptPath: sandbox.updaterScriptPath,
    temporaryDirectory: () => sandbox.root,
    minimumExecutableBytes: 1,
  })

  const prepared = await service.prepareUpdate(sandbox.archivePath)
  const result = await service.launchPreparedUpdate(prepared)
  assert.equal(result.targetVersion, '0.6.21')
  await service.discardPreparedUpdate(prepared)
})

test('prepares a validated same-version package for reinstall and rejects downgrades', async (t) => {
  const sandbox = await createSandbox(t)
  const createService = (version) =>
    createLocalUpdateService({
      isPackaged: true,
      appVersion: '0.6.20',
      executablePath: path.join(sandbox.installDirectory, 'StarMedia.exe'),
      dataRoot: sandbox.dataRoot,
      run7z: createRun7zStub(version, validEntries),
      updaterLauncherPath: sandbox.updaterLauncherPath,
      updaterScriptPath: sandbox.updaterScriptPath,
      temporaryDirectory: () => sandbox.root,
      minimumExecutableBytes: 1,
      spawnUpdater: () => ({ pid: 1 }),
    })

  const prepared = await createService('0.6.20').prepareUpdate(sandbox.archivePath)
  assert.equal(prepared.targetVersion, '0.6.20')
  assert.equal(prepared.reinstall, true)
  await createService('0.6.20').discardPreparedUpdate(prepared)
  await assert.rejects(createService('0.6.19').prepareUpdate(sandbox.archivePath), /不能从 0.6.20 降级/)
})

test('creates a pre-update data snapshot and launches the detached runner with a constrained plan', async (t) => {
  const sandbox = await createSandbox(t)
  await fs.writeFile(path.join(sandbox.dataRoot, 'starmedia-config.json'), '{"schemaVersion":3}')
  await fs.writeFile(path.join(sandbox.dataRoot, 'starmedia-library.json'), '{"items":[]}')
  let launch = null
  const service = createLocalUpdateService({
    isPackaged: true,
    appVersion: '0.6.20',
    executablePath: path.join(sandbox.installDirectory, 'StarMedia.exe'),
    processId: 4321,
    dataRoot: sandbox.dataRoot,
    run7z: createRun7zStub('0.6.21', validEntries),
    updaterLauncherPath: sandbox.updaterLauncherPath,
    updaterScriptPath: sandbox.updaterScriptPath,
    temporaryDirectory: () => sandbox.root,
    minimumExecutableBytes: 1,
    now: () => new Date('2026-07-17T12:00:00.000Z'),
    spawnUpdater: async (scriptPath, planPath, statusPath, launcherPath) => {
      launch = { scriptPath, planPath, statusPath, launcherPath }
      await fs.writeFile(statusPath, 'ready')
      return { pid: 9876 }
    },
  })

  const prepared = await service.prepareUpdate(sandbox.archivePath)
  const result = await service.launchPreparedUpdate(prepared)
  assert.equal(result.targetVersion, '0.6.21')
  assert.equal(await fs.readFile(path.join(result.snapshotDirectory, 'starmedia-config.json'), 'utf8'), '{"schemaVersion":3}')
  assert.equal(await fs.readFile(path.join(result.snapshotDirectory, 'starmedia-library.json'), 'utf8'), '{"items":[]}')
  const plan = JSON.parse(await fs.readFile(launch.planPath, 'utf8'))
  assert.equal(plan.processId, 4321)
  assert.equal(plan.dataRoot, sandbox.dataRoot)
  assert.equal(path.dirname(plan.rollbackDirectory), sandbox.installDirectory)
  assert.match(path.basename(plan.rollbackDirectory), /^\.starmedia-update-rollback-/)
  assert.equal(path.dirname(launch.scriptPath), prepared.workDirectory)
  assert.equal(path.dirname(launch.launcherPath), prepared.workDirectory)
  assert.equal(path.dirname(launch.statusPath), prepared.workDirectory)
  assert.match(await fs.readFile(result.logPath, 'utf8'), /^2026-07-17T12:00:00\.000Z Starting update runner\./)
})

test('refuses to launch when the active data root is not the protected sibling directory', async (t) => {
  const sandbox = await createSandbox(t)
  const externalDataRoot = path.join(sandbox.root, 'ExternalData')
  await fs.mkdir(externalDataRoot)
  const service = createLocalUpdateService({
    isPackaged: true,
    appVersion: '0.6.20',
    executablePath: path.join(sandbox.installDirectory, 'StarMedia.exe'),
    dataRoot: externalDataRoot,
    run7z: createRun7zStub('0.6.21', validEntries),
    updaterLauncherPath: sandbox.updaterLauncherPath,
    updaterScriptPath: sandbox.updaterScriptPath,
    temporaryDirectory: () => sandbox.root,
    minimumExecutableBytes: 1,
    spawnUpdater: () => ({ pid: 1 }),
  })
  const prepared = await service.prepareUpdate(sandbox.archivePath)
  await assert.rejects(service.launchPreparedUpdate(prepared), /当前数据目录不在程序目录/)
  await service.discardPreparedUpdate(prepared)
})
