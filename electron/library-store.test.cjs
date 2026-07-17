const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { clearImportedRecords, loadLibraryFile, restoreLibraryBackup, saveLibraryFile, writeFileAtomically } = require('./library-store.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-library-store-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return {
    libraryPath: path.join(root, 'data', 'starmedia-library.json'),
    backupDir: path.join(root, 'data', 'backups'),
  }
}

test('saves normalized library data atomically and backs up the previous index', async (t) => {
  const { libraryPath, backupDir } = await createSandbox(t)
  const initial = { items: [{ id: 'first' }], operations: [{ id: 'operation-first' }] }
  await fs.mkdir(path.dirname(libraryPath), { recursive: true })
  await fs.writeFile(libraryPath, `${JSON.stringify(initial)}\n`, 'utf8')

  const next = { items: [{ id: 'second' }], operations: [{ id: 'operation-second' }] }
  const result = await saveLibraryFile({ libraryPath, backupDir, data: next, backupExisting: true })
  const raw = await fs.readFile(libraryPath, 'utf8')
  const backupNames = await fs.readdir(backupDir)

  assert.deepEqual(result.data, next)
  assert.deepEqual(JSON.parse(raw), next)
  assert.equal(raw.endsWith('\n'), true)
  assert.equal(backupNames.length, 1)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(backupDir, backupNames[0]), 'utf8')), initial)
  assert.equal(await fs.readdir(path.dirname(libraryPath)).then((entries) => entries.some((entry) => entry.endsWith('.tmp'))), false)
})

test('normalizes malformed library data and reports empty or invalid indexes without throwing', async (t) => {
  const { libraryPath } = await createSandbox(t)
  assert.deepEqual(await loadLibraryFile(libraryPath), { items: [], operations: [], issue: 'missing' })

  await fs.mkdir(path.dirname(libraryPath), { recursive: true })
  await fs.writeFile(libraryPath, '   \n', 'utf8')
  assert.deepEqual(await loadLibraryFile(libraryPath), { items: [], operations: [], issue: 'empty' })

  await fs.writeFile(libraryPath, '{not json', 'utf8')
  assert.deepEqual(await loadLibraryFile(libraryPath), { items: [], operations: [], issue: 'invalid' })

  await fs.writeFile(libraryPath, JSON.stringify({ items: 'invalid', operations: null }), 'utf8')
  assert.deepEqual(await loadLibraryFile(libraryPath), { items: [], operations: [], issue: null })
})

test('clears records while preserving a restorable backup of the previous library', async (t) => {
  const { libraryPath, backupDir } = await createSandbox(t)
  const previous = { items: [{ id: 'media-1' }], operations: [{ id: 'import-1' }] }
  await saveLibraryFile({ libraryPath, backupDir, data: previous, backupExisting: false })

  const result = await clearImportedRecords({ libraryPath, backupDir })
  const backupNames = await fs.readdir(backupDir)

  assert.deepEqual(result.data, { items: [], operations: [] })
  assert.deepEqual(JSON.parse(await fs.readFile(libraryPath, 'utf8')), { items: [], operations: [] })
  assert.equal(backupNames.length, 1)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(backupDir, backupNames[0]), 'utf8')), previous)
})

test('restores a backup atomically while preserving the pre-restore index as a backup', async (t) => {
  const { libraryPath, backupDir } = await createSandbox(t)
  const current = { items: [{ id: 'current' }], operations: [{ id: 'current-operation' }] }
  const restored = { items: [{ id: 'restored' }], operations: [{ id: 'restored-operation' }] }
  await saveLibraryFile({ libraryPath, backupDir, data: current, backupExisting: false })
  const restoreSourcePath = path.join(path.dirname(libraryPath), 'restore-source.json')
  await fs.writeFile(restoreSourcePath, JSON.stringify(restored), 'utf8')

  const result = await restoreLibraryBackup({ libraryPath, backupDir, backupPath: restoreSourcePath })
  const backupNames = await fs.readdir(backupDir)

  assert.deepEqual(result.data, restored)
  assert.deepEqual(JSON.parse(await fs.readFile(libraryPath, 'utf8')), restored)
  assert.equal(backupNames.length, 1)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(backupDir, backupNames[0]), 'utf8')), current)
})

test('replaces a file atomically without leaving temporary artifacts', async (t) => {
  const { libraryPath } = await createSandbox(t)
  await fs.mkdir(path.dirname(libraryPath), { recursive: true })
  await fs.writeFile(libraryPath, 'previous', 'utf8')

  await writeFileAtomically(libraryPath, 'next')

  assert.equal(await fs.readFile(libraryPath, 'utf8'), 'next')
  assert.equal(await fs.readdir(path.dirname(libraryPath)).then((entries) => entries.some((entry) => entry.endsWith('.tmp'))), false)
})
