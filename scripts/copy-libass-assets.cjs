const fs = require('node:fs/promises')
const path = require('node:path')

const workspaceRoot = path.resolve(__dirname, '..')
const sourceDirectory = path.join(workspaceRoot, 'node_modules', 'libass-wasm', 'dist', 'js')
const targetDirectory = path.join(workspaceRoot, 'public', 'libass')
const fontSourceDirectory = path.join(workspaceRoot, 'node_modules', '@fontpkg', 'noto-sans-cjk-sc')
const fontTargetDirectory = path.join(targetDirectory, 'fonts')
const fallbackFontFile = 'NotoSansCJKsc-Regular.otf'
const assets = ['subtitles-octopus.js', 'subtitles-octopus-worker.js', 'subtitles-octopus-worker.wasm', 'COPYRIGHT']

async function copyLibassAssets() {
  await fs.mkdir(targetDirectory, { recursive: true })
  for (const asset of assets) await fs.copyFile(path.join(sourceDirectory, asset), path.join(targetDirectory, asset))
  await fs.rm(fontTargetDirectory, { recursive: true, force: true })
  await fs.mkdir(fontTargetDirectory, { recursive: true })
  await fs.copyFile(path.join(fontSourceDirectory, fallbackFontFile), path.join(fontTargetDirectory, fallbackFontFile))
  await fs.writeFile(path.join(fontTargetDirectory, 'noto-sans-cjk-sc-fonts.json'), JSON.stringify([fallbackFontFile]), 'utf8')
  await fs.copyFile(
    path.join(workspaceRoot, 'node_modules', '@fontsource-variable', 'noto-sans-sc', 'LICENSE'),
    path.join(fontTargetDirectory, 'Noto-Sans-CJK-SC-OFL.txt'),
  )
}

copyLibassAssets().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
