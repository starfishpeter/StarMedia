const fs = require('node:fs/promises')
const { createHash } = require('node:crypto')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const subtitleCacheVersion = '4'

function convertSrtToWebVtt(content) {
  return `WEBVTT\n\n${String(content)
    .replace(/^(\d+)\s*\r?\n/gm, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
}

async function createSubtitlePlaybackTracks({
  subtitles,
  cacheDir,
  pruneCache,
  protectedPaths: initialProtectedPaths = [],
  fileSystem = fs,
  touchCacheFile,
  onWarning = () => {},
}) {
  if (typeof pruneCache !== 'function' || typeof touchCacheFile !== 'function') throw new Error('字幕缓存服务依赖不可用')
  const tracks = []
  const protectedPaths = [...initialProtectedPaths]
  for (const subtitle of subtitles) {
    try {
      if (['.ass', '.ssa'].includes(subtitle.extension) && typeof subtitle.content !== 'string') {
        await fileSystem.access(subtitle.path)
        tracks.push({ format: 'ass', url: pathToFileURL(subtitle.path).toString(), label: subtitle.label })
        continue
      }
      if (subtitle.extension === '.vtt' && typeof subtitle.content !== 'string') {
        await fileSystem.access(subtitle.path)
        tracks.push({ format: 'vtt', url: pathToFileURL(subtitle.path).toString(), label: subtitle.label })
        continue
      }
      const content = typeof subtitle.content === 'string' ? subtitle.content : await fileSystem.readFile(subtitle.path, 'utf8')
      const isAss = ['.ass', '.ssa'].includes(subtitle.extension)
      const converted = isAss ? content : subtitle.extension === '.vtt' ? content : convertSrtToWebVtt(content)
      const subtitleCacheDir = path.join(cacheDir, 'subtitles')
      await fileSystem.mkdir(subtitleCacheDir, { recursive: true })
      const sourceKey = typeof subtitle.path === 'string' ? subtitle.path : `embedded:${subtitle.label}`
      const cachePath = path.join(
        subtitleCacheDir,
        `${createHash('sha1').update(`${subtitleCacheVersion}:${sourceKey}:${content}`).digest('hex')}${isAss ? '.ass' : '.vtt'}`,
      )
      try {
        await fileSystem.access(cachePath)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        await fileSystem.writeFile(cachePath, converted, 'utf8')
      }
      await touchCacheFile(cachePath)
      protectedPaths.push(cachePath)
      tracks.push({ format: isAss ? 'ass' : 'vtt', url: pathToFileURL(cachePath).toString(), label: subtitle.label })
    } catch (error) {
      onWarning(`无法加载字幕「${subtitle.label}」：${error.message}`)
    }
  }
  await pruneCache(protectedPaths)
  return tracks
}

module.exports = { convertSrtToWebVtt, createSubtitlePlaybackTracks }
