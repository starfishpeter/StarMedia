const fs = require('node:fs/promises')
const { execFile } = require('node:child_process')
const { path7za } = require('7zip-bin')

function summarize7zError(value) {
  const lines = String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const important = lines.filter((line) => /error|unexpected|cannot|failed|warning|not found|invalid/i.test(line))
  const selected = (important.length > 0 ? important : lines).slice(-4)
  return selected.join('；').slice(-1200) || '7-Zip 操作失败'
}

function run7z(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(path7za, ['-sccUTF-8', ...args], { windowsHide: true, maxBuffer: 1024 * 1024 * 128, ...options }, (error, stdout, stderr) => {
      if (error) reject(new Error(summarize7zError(stderr || stdout || error.message)))
      else resolve(stdout)
    })
  })
}

async function replaceFileAtomically(sourcePath, targetPath, fileSystem = fs) {
  const oldPath = `${targetPath}.${process.pid}.${Date.now()}.old`
  let movedOld = false
  try {
    await fileSystem.rename(targetPath, oldPath)
    movedOld = true
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }

  try {
    await fileSystem.rename(sourcePath, targetPath)
    if (movedOld) await fileSystem.rm(oldPath, { force: true })
  } catch (error) {
    if (movedOld) {
      await fileSystem.rm(targetPath, { force: true }).catch(() => {})
      await fileSystem.rename(oldPath, targetPath).catch(() => {})
    }
    throw error
  }
}

module.exports = {
  replaceFileAtomically,
  run7z,
  summarize7zError,
}
