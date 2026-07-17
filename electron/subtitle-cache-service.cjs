const fs = require('node:fs/promises')
const { createHash } = require('node:crypto')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

function convertAssTimeToVtt(value) {
  const match = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(String(value).trim())
  if (!match) return ''
  const milliseconds = match[4].padEnd(3, '0').slice(0, 3)
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}:${match[3]}.${milliseconds}`
}

function convertAssToWebVtt(content) {
  const cues = []
  for (const line of String(content).split(/\r?\n/)) {
    const match = /^Dialogue:\s*[^,]*,([^,]*),([^,]*),(?:[^,]*,){6}(.*)$/i.exec(line)
    if (!match) continue
    const start = convertAssTimeToVtt(match[1])
    const end = convertAssTimeToVtt(match[2])
    const text = match[3]
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/gi, '\n')
      .replace(/\\h/gi, ' ')
      .trim()
    if (start && end && text) cues.push(`${start} --> ${end}\n${text}`)
  }
  return `WEBVTT\n\n${cues.join('\n\n')}`
}

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
      if (subtitle.extension === '.vtt' && typeof subtitle.content !== 'string') {
        await fileSystem.access(subtitle.path)
        tracks.push({ url: pathToFileURL(subtitle.path).toString(), label: subtitle.label })
        continue
      }
      const content = typeof subtitle.content === 'string' ? subtitle.content : await fileSystem.readFile(subtitle.path, 'utf8')
      const converted =
        subtitle.extension === '.vtt' ? content : subtitle.extension === '.srt' ? convertSrtToWebVtt(content) : convertAssToWebVtt(content)
      const subtitleCacheDir = path.join(cacheDir, 'subtitles')
      await fileSystem.mkdir(subtitleCacheDir, { recursive: true })
      const sourceKey = typeof subtitle.path === 'string' ? subtitle.path : `embedded:${subtitle.label}`
      const cachePath = path.join(subtitleCacheDir, `${createHash('sha1').update(`${sourceKey}:${content}`).digest('hex')}.vtt`)
      try {
        await fileSystem.access(cachePath)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        await fileSystem.writeFile(cachePath, converted, 'utf8')
      }
      await touchCacheFile(cachePath)
      protectedPaths.push(cachePath)
      tracks.push({ url: pathToFileURL(cachePath).toString(), label: subtitle.label })
    } catch (error) {
      onWarning(`无法加载字幕「${subtitle.label}」：${error.message}`)
    }
  }
  await pruneCache(protectedPaths)
  return tracks
}

module.exports = { convertAssTimeToVtt, convertAssToWebVtt, convertSrtToWebVtt, createSubtitlePlaybackTracks }
