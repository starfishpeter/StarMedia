const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

test('copies regular and bold CJK fallback fonts for libass', async (t) => {
  const workspaceRoot = path.resolve(__dirname, '..')
  const targetDirectory = path.join(workspaceRoot, 'public', 'libass', 'fonts')
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-libass-fonts-'))
  t.after(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  })

  execFileSync(process.execPath, [path.join(workspaceRoot, 'scripts', 'copy-libass-assets.cjs')], { windowsHide: true })
  const fonts = JSON.parse(await fs.readFile(path.join(targetDirectory, 'noto-sans-cjk-sc-fonts.json'), 'utf8'))

  assert.deepEqual(fonts, ['NotoSansCJKsc-Regular.otf', 'NotoSansCJKsc-Bold.otf'])
  for (const font of fonts) assert.ok((await fs.stat(path.join(targetDirectory, font))).size > 1024 * 1024)
})
