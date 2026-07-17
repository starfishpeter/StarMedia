const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { scanImportSources } = require('./import-plan-scan-service.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-import-plan-scan-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

test('excludes a source file that disappears before its import-plan entry is created', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'episode.mp4')
  await fs.writeFile(sourcePath, 'video')
  let statCalls = 0
  const fileSystem = {
    ...fs,
    stat: async (targetPath) => {
      statCalls += 1
      if (targetPath === sourcePath && statCalls === 2) {
        const error = new Error('file disappeared')
        error.code = 'ENOENT'
        throw error
      }
      return fs.stat(targetPath)
    },
  }

  const result = await scanImportSources({ sourcePaths: [sourcePath], maxFiles: 100, maxErrors: 10, fileSystem })

  assert.equal(result.totalFiles, 1)
  assert.deepEqual(result.scannedFiles, [])
  assert.match(result.errors[0], /file disappeared/)
})

test('skips symbolic links and enforces the configured source-file limit', async (t) => {
  const root = await createSandbox(t)
  await fs.writeFile(path.join(root, 'first.mp4'), 'first')
  await fs.writeFile(path.join(root, 'second.mp4'), 'second')
  const result = await scanImportSources({ sourcePaths: [root], maxFiles: 1, maxErrors: 10 })

  assert.equal(result.scannedFiles.length, 1)
  assert.equal(result.truncated, true)
})
