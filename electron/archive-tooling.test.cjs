const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { replaceFileAtomically, summarize7zError } = require('./archive-tooling.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-archive-tooling-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

test('replaces an existing file atomically', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'source.zip')
  const targetPath = path.join(root, 'target.zip')
  await fs.writeFile(sourcePath, 'new archive')
  await fs.writeFile(targetPath, 'old archive')

  await replaceFileAtomically(sourcePath, targetPath)

  assert.equal(await fs.readFile(targetPath, 'utf8'), 'new archive')
  await assert.rejects(fs.access(sourcePath), { code: 'ENOENT' })
  assert.deepEqual(
    (await fs.readdir(root)).filter((name) => name.includes('.old')),
    [],
  )
})

test('restores the prior target when replacement rename fails', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'source.zip')
  const targetPath = path.join(root, 'target.zip')
  await fs.writeFile(sourcePath, 'new archive')
  await fs.writeFile(targetPath, 'old archive')
  let replacementAttempted = false
  const fileSystem = {
    ...fs,
    async rename(from, to) {
      if (from === sourcePath && to === targetPath) {
        replacementAttempted = true
        throw new Error('injected replacement failure')
      }
      return fs.rename(from, to)
    },
  }

  await assert.rejects(replaceFileAtomically(sourcePath, targetPath, fileSystem), /injected replacement failure/)
  assert.equal(replacementAttempted, true)
  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'new archive')
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'old archive')
})

test('summarizes actionable 7-Zip error lines', () => {
  assert.equal(summarize7zError('header\nWARNING: damaged archive\nfooter'), 'WARNING: damaged archive')
  assert.equal(summarize7zError(''), '7-Zip 操作失败')
})
