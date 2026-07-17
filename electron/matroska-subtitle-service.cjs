const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')

const IDS = {
  segment: 0x18538067,
  info: 0x1549a966,
  timestampScale: 0x2ad7b1,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackType: 0x83,
  flagDefault: 0x88,
  defaultDuration: 0x23e383,
  codecId: 0x86,
  codecPrivate: 0x63a2,
  name: 0x536e,
  language: 0x22b59c,
  languageIetf: 0x22b59d,
  cluster: 0x1f43b675,
  timestamp: 0xe7,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
  blockDuration: 0x9b,
}

const supportedSubtitleCodecs = new Set(['S_TEXT/ASS', 'S_TEXT/SSA', 'S_TEXT/UTF8', 'S_TEXT/WEBVTT'])
const maximumElementBuffer = 16 * 1024 * 1024
const maximumSubtitlePayload = 4 * 1024 * 1024
const maximumCueCount = 100_000
const maximumSubtitleTextBytes = 32 * 1024 * 1024

function parseVint(buffer, offset, keepMarker = false) {
  if (offset >= buffer.length || buffer[offset] === 0) return null
  let width = 1
  let marker = 0x80
  while (width <= 8 && (buffer[offset] & marker) === 0) {
    width += 1
    marker >>= 1
  }
  if (width > 8 || offset + width > buffer.length) return null
  let value = BigInt(keepMarker ? buffer[offset] : buffer[offset] & (marker - 1))
  for (let index = 1; index < width; index += 1) value = (value << 8n) | BigInt(buffer[offset + index])
  const unknown = !keepMarker && value === (1n << BigInt(width * 7)) - 1n
  return { width, value, unknown }
}

function toSafeNumber(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label}超出安全范围`)
  return Number(value)
}

function createBufferedReader(handle, fileSize, pageSize = 4 * 1024 * 1024) {
  let pageStart = -1
  let page = Buffer.alloc(0)
  async function read(offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > fileSize)
      throw new Error('Matroska 读取范围无效')
    if (length === 0) return Buffer.alloc(0)
    if (offset >= pageStart && offset + length <= pageStart + page.length)
      return page.subarray(offset - pageStart, offset - pageStart + length)
    const readLength = Math.min(fileSize - offset, Math.max(pageSize, length))
    page = Buffer.alloc(readLength)
    const result = await handle.read(page, 0, readLength, offset)
    page = page.subarray(0, result.bytesRead)
    pageStart = offset
    if (length > page.length) throw new Error('Matroska 文件提前结束')
    return page.subarray(0, length)
  }
  return { read }
}

async function readElementHeader(reader, offset, limit) {
  if (offset >= limit) return null
  const header = await reader.read(offset, Math.min(16, limit - offset))
  const id = parseVint(header, 0, true)
  if (!id) return null
  const size = parseVint(header, id.width)
  if (!size) return null
  const dataOffset = offset + id.width + size.width
  if (dataOffset > limit) return null
  const dataSize = size.unknown ? limit - dataOffset : toSafeNumber(size.value, 'Matroska 元素大小')
  if (dataSize < 0 || dataOffset + dataSize > limit) return null
  return {
    id: toSafeNumber(id.value, 'Matroska 元素 ID'),
    offset,
    dataOffset,
    dataSize,
    end: dataOffset + dataSize,
    unknownSize: size.unknown,
  }
}

function readBufferElements(buffer, start = 0, end = buffer.length) {
  const elements = []
  for (let offset = start; offset < end;) {
    const id = parseVint(buffer, offset, true)
    if (!id) break
    const size = parseVint(buffer, offset + id.width)
    if (!size || size.unknown) break
    const dataOffset = offset + id.width + size.width
    const dataSize = toSafeNumber(size.value, 'Matroska 内部元素大小')
    const elementEnd = dataOffset + dataSize
    if (elementEnd > end) break
    elements.push({ id: toSafeNumber(id.value, 'Matroska 内部元素 ID'), dataOffset, dataSize, end: elementEnd })
    offset = elementEnd
  }
  return elements
}

function readUnsigned(buffer, start, end) {
  let value = 0n
  for (let offset = start; offset < end; offset += 1) value = (value << 8n) | BigInt(buffer[offset])
  return toSafeNumber(value, 'Matroska 整数')
}

function readText(buffer, start, end) {
  return buffer.toString('utf8', start, end).replace(/\0+$/g, '').trim()
}

function parseTrackEntries(buffer) {
  const tracks = new Map()
  for (const entry of readBufferElements(buffer).filter((element) => element.id === IDS.trackEntry)) {
    const values = {
      number: 0,
      type: 0,
      default: true,
      defaultDurationNs: 0,
      codecId: '',
      codecPrivate: '',
      name: '',
      language: '',
    }
    for (const child of readBufferElements(buffer, entry.dataOffset, entry.end)) {
      if (child.id === IDS.trackNumber) values.number = readUnsigned(buffer, child.dataOffset, child.end)
      else if (child.id === IDS.trackType) values.type = readUnsigned(buffer, child.dataOffset, child.end)
      else if (child.id === IDS.flagDefault) values.default = readUnsigned(buffer, child.dataOffset, child.end) !== 0
      else if (child.id === IDS.defaultDuration) values.defaultDurationNs = readUnsigned(buffer, child.dataOffset, child.end)
      else if (child.id === IDS.codecId) values.codecId = readText(buffer, child.dataOffset, child.end)
      else if (child.id === IDS.codecPrivate) values.codecPrivate = buffer.toString('utf8', child.dataOffset, child.end)
      else if (child.id === IDS.name) values.name = readText(buffer, child.dataOffset, child.end)
      else if (child.id === IDS.language || child.id === IDS.languageIetf) values.language = readText(buffer, child.dataOffset, child.end)
    }
    if (values.number > 0 && values.type === 0x11 && supportedSubtitleCodecs.has(values.codecId)) {
      tracks.set(values.number, { ...values, cues: [], textBytes: 0 })
    }
  }
  return tracks
}

function parseBlockHeader(buffer) {
  const track = parseVint(buffer, 0)
  if (!track || track.width + 3 > buffer.length) return null
  return {
    trackNumber: toSafeNumber(track.value, 'Matroska 轨道编号'),
    relativeTimestamp: buffer.readInt16BE(track.width),
    lacing: (buffer[track.width + 2] & 0x06) >> 1,
    payloadOffset: track.width + 3,
  }
}

async function readSubtitleBlock({ reader, element, tracks, clusterTimestamp, timestampScale }) {
  const prefix = await reader.read(element.dataOffset, Math.min(element.dataSize, 16))
  const block = parseBlockHeader(prefix)
  if (!block || block.lacing !== 0) return null
  const track = tracks.get(block.trackNumber)
  if (!track) return null
  const payloadSize = element.dataSize - block.payloadOffset
  if (payloadSize <= 0 || payloadSize > maximumSubtitlePayload) return null
  if (track.cues.length >= maximumCueCount || track.textBytes + payloadSize > maximumSubtitleTextBytes) return null
  const payload = await reader.read(element.dataOffset + block.payloadOffset, payloadSize)
  const text = payload.toString('utf8').replace(/\0+$/g, '')
  if (!text.trim()) return null
  track.textBytes += payloadSize
  const cue = {
    startMs: ((clusterTimestamp + block.relativeTimestamp) * timestampScale) / 1_000_000,
    durationMs: track.defaultDurationNs > 0 ? track.defaultDurationNs / 1_000_000 : 0,
    text,
  }
  track.cues.push(cue)
  return cue
}

async function parseBlockGroup({ reader, group, tracks, clusterTimestamp, timestampScale }) {
  let cue = null
  let durationMs = 0
  for (let offset = group.dataOffset; offset < group.end;) {
    const child = await readElementHeader(reader, offset, group.end)
    if (!child) break
    if (child.id === IDS.block) cue = await readSubtitleBlock({ reader, element: child, tracks, clusterTimestamp, timestampScale })
    else if (child.id === IDS.blockDuration && child.dataSize <= 8) {
      const value = await reader.read(child.dataOffset, child.dataSize)
      durationMs = (readUnsigned(value, 0, value.length) * timestampScale) / 1_000_000
    }
    offset = child.end
  }
  if (cue && durationMs > 0) cue.durationMs = durationMs
}

async function parseCluster({ reader, cluster, tracks, timestampScale }) {
  let clusterTimestamp = 0
  for (let offset = cluster.dataOffset; offset < cluster.end;) {
    const child = await readElementHeader(reader, offset, cluster.end)
    if (!child) break
    if (child.id === IDS.timestamp && child.dataSize <= 8) {
      const value = await reader.read(child.dataOffset, child.dataSize)
      clusterTimestamp = readUnsigned(value, 0, value.length)
    } else if (child.id === IDS.simpleBlock) {
      await readSubtitleBlock({ reader, element: child, tracks, clusterTimestamp, timestampScale })
    } else if (child.id === IDS.blockGroup) {
      await parseBlockGroup({ reader, group: child, tracks, clusterTimestamp, timestampScale })
    }
    offset = child.end
  }
}

function formatAssTime(milliseconds) {
  const centiseconds = Math.max(0, Math.round(milliseconds / 10))
  const hours = Math.floor(centiseconds / 360_000)
  const minutes = Math.floor((centiseconds % 360_000) / 6_000)
  const seconds = Math.floor((centiseconds % 6_000) / 100)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`
}

function formatVttTime(milliseconds) {
  const value = Math.max(0, Math.round(milliseconds))
  const hours = Math.floor(value / 3_600_000)
  const minutes = Math.floor((value % 3_600_000) / 60_000)
  const seconds = Math.floor((value % 60_000) / 1_000)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(value % 1_000).padStart(3, '0')}`
}

function finalizedCues(track) {
  const cues = [...track.cues].sort((left, right) => left.startMs - right.startMs)
  return cues.map((cue, index) => {
    const nextStart = cues[index + 1]?.startMs
    const inferred = Number.isFinite(nextStart) && nextStart > cue.startMs ? Math.min(10_000, nextStart - cue.startMs) : 5_000
    return { ...cue, durationMs: cue.durationMs > 0 ? cue.durationMs : Math.max(1_000, inferred) }
  })
}

function buildAssContent(track) {
  const header = track.codecPrivate.trim()
  const prefix = header || '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  const lines = finalizedCues(track).map((cue) => {
    const firstComma = cue.text.indexOf(',')
    const remainder = firstComma >= 0 ? cue.text.slice(firstComma + 1) : `0,Default,,0,0,0,,${cue.text}`
    const layerComma = remainder.indexOf(',')
    const layer = layerComma >= 0 ? remainder.slice(0, layerComma) : '0'
    const tail = layerComma >= 0 ? remainder.slice(layerComma + 1) : `Default,,0,0,0,,${remainder}`
    return `Dialogue: ${layer},${formatAssTime(cue.startMs)},${formatAssTime(cue.startMs + cue.durationMs)},${tail}`
  })
  return `${prefix}\n${lines.join('\n')}`
}

function buildVttContent(track) {
  const cues = finalizedCues(track).map(
    (cue) => `${formatVttTime(cue.startMs)} --> ${formatVttTime(cue.startMs + cue.durationMs)}\n${cue.text}`,
  )
  return `WEBVTT\n\n${cues.join('\n\n')}`
}

function serializeTracks(tracks) {
  return [...tracks.values()]
    .filter((track) => track.cues.length > 0)
    .map((track, index) => ({
      extension: track.codecId === 'S_TEXT/ASS' || track.codecId === 'S_TEXT/SSA' ? '.ass' : '.vtt',
      label: track.name || (track.language && track.language !== 'und' ? track.language : '') || `内嵌字幕 ${index + 1}`,
      content: track.codecId === 'S_TEXT/ASS' || track.codecId === 'S_TEXT/SSA' ? buildAssContent(track) : buildVttContent(track),
    }))
}

async function scanMatroskaSubtitles(sourcePath, fileSystem = fs) {
  const stat = await fileSystem.stat(sourcePath)
  if (!stat.isFile() || stat.size < 4) return []
  const handle = await fileSystem.open(sourcePath, 'r')
  try {
    const reader = createBufferedReader(handle, stat.size)
    let segment = null
    for (let offset = 0; offset < stat.size;) {
      const element = await readElementHeader(reader, offset, stat.size)
      if (!element) return []
      if (element.id === IDS.segment) {
        segment = element
        break
      }
      offset = element.end
    }
    if (!segment) return []

    let timestampScale = 1_000_000
    let tracks = new Map()
    for (let offset = segment.dataOffset; offset < segment.end;) {
      const element = await readElementHeader(reader, offset, segment.end)
      if (!element) break
      if (element.id === IDS.info && element.dataSize <= maximumElementBuffer) {
        const info = await reader.read(element.dataOffset, element.dataSize)
        const scale = readBufferElements(info).find((child) => child.id === IDS.timestampScale)
        if (scale) timestampScale = readUnsigned(info, scale.dataOffset, scale.end)
      } else if (element.id === IDS.tracks && element.dataSize <= maximumElementBuffer) {
        tracks = parseTrackEntries(await reader.read(element.dataOffset, element.dataSize))
      }
      if (tracks.size > 0 && element.id === IDS.cluster) break
      offset = element.end
    }
    if (tracks.size === 0) return []

    for (let offset = segment.dataOffset; offset < segment.end;) {
      const element = await readElementHeader(reader, offset, segment.end)
      if (!element) break
      if (element.id === IDS.cluster) await parseCluster({ reader, cluster: element, tracks, timestampScale })
      offset = element.end
    }
    return serializeTracks(tracks)
  } finally {
    await handle.close()
  }
}

async function extractMatroskaSubtitles({ sourcePath, cacheDir, fileSystem = fs, touchCacheFile = async () => {} }) {
  if (path.extname(sourcePath).toLowerCase() !== '.mkv') return { subtitles: [], protectedPaths: [] }
  const stat = await fileSystem.stat(sourcePath)
  const fingerprint = createHash('sha1')
    .update(`${path.resolve(sourcePath)}:${stat.size}:${stat.mtimeMs}:v1`)
    .digest('hex')
  const embeddedCacheDir = path.join(cacheDir, 'subtitles', 'embedded')
  const cachePath = path.join(embeddedCacheDir, `${fingerprint}.json`)
  let tracks
  try {
    tracks = JSON.parse(await fileSystem.readFile(cachePath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    tracks = await scanMatroskaSubtitles(sourcePath, fileSystem)
    await fileSystem.mkdir(embeddedCacheDir, { recursive: true })
    await fileSystem.writeFile(cachePath, JSON.stringify(tracks), 'utf8')
  }
  await touchCacheFile(cachePath)
  return {
    subtitles: Array.isArray(tracks) ? tracks : [],
    protectedPaths: [cachePath],
  }
}

module.exports = {
  extractMatroskaSubtitles,
  scanMatroskaSubtitles,
  parseTrackEntries,
  serializeTracks,
}
