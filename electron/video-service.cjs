const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { supportedVideoExtensions } = require('./import-service.cjs')

const subtitleExtensions = new Set(['.srt', '.vtt', '.ass', '.ssa'])
const internalPlaybackMimeTypes = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.mov', 'video/mp4'],
  ['.mkv', 'video/matroska'],
  ['.webm', 'video/webm'],
])

function readMp4Box(buffer, offset, limit) {
  if (offset + 8 > limit) return null
  let size = buffer.readUInt32BE(offset)
  const type = buffer.toString('ascii', offset + 4, offset + 8)
  let headerSize = 8
  if (size === 1) {
    if (offset + 16 > limit) return null
    size = Number(buffer.readBigUInt64BE(offset + 8))
    headerSize = 16
  } else if (size === 0) {
    size = limit - offset
  }
  if (!Number.isSafeInteger(size) || size < headerSize || offset + size > limit) return null
  return { type, start: offset, contentStart: offset + headerSize, end: offset + size }
}

function findMp4Boxes(buffer, start, end, type) {
  const boxes = []
  for (let offset = start; offset < end;) {
    const box = readMp4Box(buffer, offset, end)
    if (!box) return boxes
    if (box.type === type) boxes.push(box)
    offset = box.end
  }
  return boxes
}

function getMp4TrackSampleEntries(buffer, track) {
  const mdia = findMp4Boxes(buffer, track.contentStart, track.end, 'mdia')[0]
  if (!mdia) return { handlerType: '', entries: [] }
  const hdlr = findMp4Boxes(buffer, mdia.contentStart, mdia.end, 'hdlr')[0]
  const handlerType =
    hdlr && hdlr.contentStart + 12 <= hdlr.end ? buffer.toString('ascii', hdlr.contentStart + 8, hdlr.contentStart + 12) : ''
  const minf = findMp4Boxes(buffer, mdia.contentStart, mdia.end, 'minf')[0]
  const stbl = minf && findMp4Boxes(buffer, minf.contentStart, minf.end, 'stbl')[0]
  const stsd = stbl && findMp4Boxes(buffer, stbl.contentStart, stbl.end, 'stsd')[0]
  if (!stsd || stsd.contentStart + 8 > stsd.end) return { handlerType, entries: [] }

  const entryCount = buffer.readUInt32BE(stsd.contentStart + 4)
  const entries = []
  for (let offset = stsd.contentStart + 8, index = 0; index < entryCount; index += 1) {
    const entry = readMp4Box(buffer, offset, stsd.end)
    if (!entry) break
    entries.push(entry)
    offset = entry.end
  }
  return { handlerType, entries }
}

async function isChromiumVideoIsoBmff(sourcePath) {
  if (!['.mp4', '.m4v', '.mov'].includes(path.extname(sourcePath).toLowerCase())) return false
  const stat = await fs.stat(sourcePath)
  if (!stat.isFile() || stat.size < 16 || stat.size > 64 * 1024 * 1024 * 1024) return false

  const handle = await fs.open(sourcePath, 'r')
  try {
    let moov = null
    for (let offset = 0; offset + 8 <= stat.size;) {
      const header = Buffer.alloc(16)
      const { bytesRead } = await handle.read(header, 0, header.length, offset)
      if (bytesRead < 8) return false
      let size = header.readUInt32BE(0)
      let headerSize = 8
      if (size === 1) {
        if (bytesRead < 16) return false
        size = Number(header.readBigUInt64BE(8))
        headerSize = 16
      } else if (size === 0) {
        size = stat.size - offset
      }
      if (!Number.isSafeInteger(size) || size < headerSize || offset + size > stat.size) return false
      if (header.toString('ascii', 4, 8) === 'moov') {
        if (size > 64 * 1024 * 1024) return false
        moov = Buffer.alloc(size)
        const result = await handle.read(moov, 0, size, offset)
        if (result.bytesRead !== size) return false
        break
      }
      offset += size
    }
    if (!moov) return false

    const moovBox = readMp4Box(moov, 0, moov.length)
    if (!moovBox || moovBox.type !== 'moov') return false
    const tracks = findMp4Boxes(moov, moovBox.contentStart, moovBox.end, 'trak').map((track) => getMp4TrackSampleEntries(moov, track))
    const chromiumVideoEntries = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp08', 'vp09'])
    return tracks.some((track) => track.handlerType === 'vide' && track.entries.some((entry) => chromiumVideoEntries.has(entry.type)))
  } catch {
    return false
  } finally {
    await handle.close()
  }
}

async function isMatroskaVideo(sourcePath) {
  if (!['.mkv', '.webm'].includes(path.extname(sourcePath).toLowerCase())) return false
  try {
    const stat = await fs.stat(sourcePath)
    if (!stat.isFile() || stat.size < 4 || stat.size > 64 * 1024 * 1024 * 1024) return false
    const handle = await fs.open(sourcePath, 'r')
    try {
      const header = Buffer.alloc(4)
      const { bytesRead } = await handle.read(header, 0, header.length, 0)
      return bytesRead === header.length && header.readUInt32BE(0) === 0x1a45dfa3
    } finally {
      await handle.close()
    }
  } catch {
    return false
  }
}

async function isInternallyPlayableVideo(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase()
  if (['.mp4', '.m4v', '.mov'].includes(extension)) return isChromiumVideoIsoBmff(sourcePath)
  // Chromium performs the final codec check. Here we only reject files whose
  // extension claims Matroska/WebM but whose EBML signature is invalid.
  if (['.mkv', '.webm'].includes(extension)) return isMatroskaVideo(sourcePath)
  return false
}

function makeSubtitle(sourcePath, fileName = path.basename(sourcePath)) {
  const extension = path.extname(sourcePath).toLowerCase()
  return { path: sourcePath, extension, label: path.basename(fileName, path.extname(fileName)) || '字幕' }
}

async function findAdjacentSubtitles(sourcePath) {
  const directory = path.dirname(sourcePath)
  const mediaStem = path.basename(sourcePath, path.extname(sourcePath)).toLocaleLowerCase()
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => ({ entry, extension: path.extname(entry.name).toLowerCase() }))
      .filter(({ extension }) => subtitleExtensions.has(extension))
      .filter(({ entry, extension }) => {
        const subtitleStem = path.basename(entry.name, extension).toLocaleLowerCase()
        return (
          subtitleStem === mediaStem ||
          subtitleStem.startsWith(`${mediaStem}.`) ||
          subtitleStem.startsWith(`${mediaStem}[`) ||
          subtitleStem.startsWith(`${mediaStem} [`)
        )
      })
      .map(({ entry }) => makeSubtitle(path.join(directory, entry.name), entry.name))
  } catch {
    return []
  }
}

async function getVideoSubtitles(item) {
  const subtitles = []
  const seen = new Set()
  for (const sidecar of Array.isArray(item.sidecars) ? item.sidecars : []) {
    if (typeof sidecar?.sourcePath !== 'string') continue
    const extension = path.extname(sidecar.sourcePath).toLowerCase()
    if (!subtitleExtensions.has(extension)) continue
    const key = path.resolve(sidecar.sourcePath).toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    subtitles.push(
      makeSubtitle(sidecar.sourcePath, typeof sidecar.fileName === 'string' ? sidecar.fileName : path.basename(sidecar.sourcePath)),
    )
  }
  for (const subtitle of await findAdjacentSubtitles(item.sourcePath)) {
    const key = path.resolve(subtitle.path).toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    subtitles.push(subtitle)
  }
  return subtitles
}

async function getIndexedVideo(id, library) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('视频记录无效')
  const item = library?.items?.find((candidate) => candidate?.id === id && candidate.kind === 'video')
  if (!item || typeof item.sourcePath !== 'string') throw new Error('视频记录不存在')

  const extension = path.extname(item.sourcePath).toLowerCase()
  if (!supportedVideoExtensions.has(extension)) throw new Error('视频格式不受支持')
  const stat = await fs.stat(item.sourcePath)
  if (!stat.isFile()) throw new Error('视频文件不可用')
  return { item, extension }
}

async function getVideoPlaybackForLibrary({ id, library }) {
  const { item, extension } = await getIndexedVideo(id, library)
  if (!(await isInternallyPlayableVideo(item.sourcePath))) throw new Error('当前视频的封装或编码不支持应用内播放，请使用外部播放')
  return {
    url: pathToFileURL(item.sourcePath).toString(),
    sourcePath: item.sourcePath,
    mimeType: internalPlaybackMimeTypes.get(extension),
    title: item.title,
    subtitles: await getVideoSubtitles(item),
  }
}

async function getVideoPlaybackSupportForLibrary({ id, library }) {
  const { item } = await getIndexedVideo(id, library)
  return isInternallyPlayableVideo(item.sourcePath)
}

async function openVideoExternallyForLibrary({ id, library, openPath }) {
  if (typeof openPath !== 'function') throw new Error('外部播放器不可用')
  const { item } = await getIndexedVideo(id, library)
  const error = await openPath(item.sourcePath)
  return error ? { ok: false, error } : { ok: true }
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remaining = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`
}

async function updateVideoMetadataForLibrary({ id, durationSeconds: inputDuration, cover, episodeCover, library, saveLibrary }) {
  const durationSeconds = Number(inputDuration)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('视频时长无效')
  if (typeof saveLibrary !== 'function') throw new Error('资料库保存不可用')
  const index = library?.items?.findIndex((item) => item?.id === id && item.kind === 'video') ?? -1
  if (index < 0) throw new Error('视频记录不存在')

  const items = [...library.items]
  items[index] = {
    ...items[index],
    durationSeconds,
    duration: formatDuration(durationSeconds),
    cover: typeof cover === 'string' && cover ? cover : items[index].cover,
    episodeCover: typeof episodeCover === 'string' && episodeCover ? episodeCover : items[index].episodeCover,
  }
  const result = await saveLibrary(
    { items, operations: Array.isArray(library.operations) ? library.operations : [] },
    { backupExisting: false },
  )
  return { ...result, item: items[index] }
}

module.exports = {
  getVideoPlaybackForLibrary,
  getVideoPlaybackSupportForLibrary,
  openVideoExternallyForLibrary,
  updateVideoMetadataForLibrary,
}
