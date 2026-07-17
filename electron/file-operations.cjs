const fs = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const path = require('node:path')

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function normalizeFolderName(value, fallback, label = '目录名') {
  const folderName = String(value ?? '').trim() || fallback
  if (folderName === '.' || folderName === '..' || /[\\/:*?"<>|\u0000-\u001F]/.test(folderName) || /[. ]$/.test(folderName)) {
    throw new Error(`${label}包含 Windows 不允许的目录字符`)
  }
  return folderName
}

function buildManagedTargetPath({ rootPath, folderName, fallbackFolderName, category, fallbackCategory, sourcePath, flat = false }) {
  if (typeof rootPath !== 'string' || !rootPath.trim()) throw new Error('目标媒体库尚未设置受管理根目录')
  const fileName = path.basename(sourcePath)
  if (!fileName || fileName === '.' || fileName === '..') throw new Error('来源文件名无效')

  const targetPath = flat
    ? path.resolve(rootPath, fileName)
    : path.resolve(rootPath, normalizeFolderName(folderName ?? category, fallbackFolderName ?? fallbackCategory, '归属'), fileName)
  if (!isPathInside(rootPath, targetPath)) throw new Error('目标路径超出受管理根目录')
  return targetPath
}

async function verifyFileSize(filePath, expectedSize) {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('目标不是文件')
  if (stat.size !== expectedSize) throw new Error('文件大小校验失败')
}

async function moveFileSafely(sourcePath, targetPath) {
  const source = path.resolve(sourcePath)
  const target = path.resolve(targetPath)
  const sourceStat = await fs.stat(source)
  if (!sourceStat.isFile()) throw new Error('来源不是文件')
  const samePath = process.platform === 'win32' ? source.toLocaleLowerCase() === target.toLocaleLowerCase() : source === target
  if (samePath) return { moved: false, sourcePath: source, targetPath: target, size: sourceStat.size }

  await fs.mkdir(path.dirname(target), { recursive: true })
  try {
    await fs.access(target)
    throw new Error('目标文件已存在，已中止且未覆盖')
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }

  let renamed = false
  try {
    await fs.rename(source, target)
    renamed = true
    await verifyFileSize(target, sourceStat.size)
    return { moved: true, sourcePath: source, targetPath: target, size: sourceStat.size }
  } catch (error) {
    if (renamed) {
      try {
        await fs.rename(target, source)
        await verifyFileSize(source, sourceStat.size)
      } catch (rollbackError) {
        throw new Error(`${error.message}；同卷移动回退失败：${rollbackError.message}`, { cause: rollbackError })
      }
      throw error
    }
    if (!error || error.code !== 'EXDEV') throw error
  }

  const temporaryTarget = `${target}.${randomUUID()}.starmedia-partial`
  let finalTargetCreated = false
  try {
    await fs.copyFile(source, temporaryTarget)
    await verifyFileSize(temporaryTarget, sourceStat.size)
    await fs.rename(temporaryTarget, target)
    finalTargetCreated = true
    await verifyFileSize(target, sourceStat.size)
    await fs.unlink(source)
    return { moved: true, sourcePath: source, targetPath: target, size: sourceStat.size }
  } catch (error) {
    await fs.unlink(temporaryTarget).catch(() => {})
    if (finalTargetCreated) {
      let sourceStillExists = true
      try {
        await fs.access(source)
      } catch (rollbackError) {
        if (rollbackError && rollbackError.code === 'ENOENT') sourceStillExists = false
        else throw new Error(`${error.message}；跨卷移动回退失败：${rollbackError.message}`, { cause: rollbackError })
      }
      if (!sourceStillExists) {
        await verifyFileSize(target, sourceStat.size)
        return { moved: true, sourcePath: source, targetPath: target, size: sourceStat.size }
      }
      try {
        await fs.unlink(target)
      } catch (rollbackError) {
        throw new Error(`${error.message}；跨卷移动回退失败：${rollbackError.message}`, { cause: rollbackError })
      }
    }
    throw error
  }
}

module.exports = {
  buildManagedTargetPath,
  isPathInside,
  moveFileSafely,
  normalizeFolderName,
}
