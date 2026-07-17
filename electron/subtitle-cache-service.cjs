const fs = require('node:fs/promises')
const { createHash } = require('node:crypto')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const subtitleCacheVersion = '2'

function convertAssTimeToVtt(value) {
  const match = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(String(value).trim())
  if (!match) return ''
  const milliseconds = match[4].padEnd(3, '0').slice(0, 3)
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}:${match[3]}.${milliseconds}`
}

function escapeVttText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function splitAssFields(value, count) {
  const fields = []
  let remainder = String(value)
  while (fields.length < count - 1) {
    const separator = remainder.indexOf(',')
    if (separator < 0) return []
    fields.push(remainder.slice(0, separator).trim())
    remainder = remainder.slice(separator + 1)
  }
  fields.push(remainder.trim())
  return fields
}

function assColorToCss(value) {
  const hex = String(value ?? '')
    .replace(/^&H/i, '')
    .replace(/[^0-9a-f]/gi, '')
    .padStart(8, '0')
    .slice(-8)
  if (!/^[0-9a-f]{8}$/i.test(hex)) return ''
  const alpha = 1 - Number.parseInt(hex.slice(0, 2), 16) / 255
  const blue = Number.parseInt(hex.slice(2, 4), 16)
  const green = Number.parseInt(hex.slice(4, 6), 16)
  const red = Number.parseInt(hex.slice(6, 8), 16)
  return `rgba(${red}, ${green}, ${blue}, ${Math.round(alpha * 1000) / 1000})`
}

function assClassName(name) {
  const normalized = String(name ?? 'Default')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `ass-${normalized || 'default'}`
}

function createOutlineShadows(width, color) {
  const distance = Math.max(0, Number(width) || 0)
  if (distance === 0) return []
  const steps = Math.max(16, Math.ceil(distance * Math.PI * 2))
  return Array.from({ length: steps }, (_, index) => {
    const angle = (Math.PI * 2 * index) / steps
    const x = Math.round(Math.cos(angle) * distance * 100) / 100
    const y = Math.round(Math.sin(angle) * distance * 100) / 100
    return `${x}px ${y}px 0 ${color}`
  })
}

function parseAssStyles(content) {
  const styles = new Map()
  let inStyleSection = false
  let fields = []
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (/^\[v4\+? styles\]$/i.test(line)) {
      inStyleSection = true
      continue
    }
    if (/^\[.+\]$/.test(line)) {
      inStyleSection = false
      continue
    }
    if (!inStyleSection) continue
    const format = /^Format:\s*(.+)$/i.exec(line)
    if (format) {
      fields = format[1].split(',').map((field) => field.trim().toLowerCase())
      continue
    }
    const style = /^Style:\s*(.+)$/i.exec(line)
    if (!style || fields.length === 0) continue
    const values = splitAssFields(style[1], fields.length)
    if (values.length !== fields.length) continue
    const source = Object.fromEntries(fields.map((field, index) => [field, values[index]]))
    const name = source.name || 'Default'
    const className = assClassName(name)
    const fontSize = Math.max(10, Math.min(96, Math.round(Number(source.fontsize) || 24)))
    const primaryColor = assColorToCss(source.primarycolour) || 'rgba(255, 255, 255, 1)'
    const outlineColor = assColorToCss(source.outlinecolour) || 'rgba(0, 0, 0, 0.88)'
    const shadowColor = assColorToCss(source.backcolour) || 'rgba(0, 0, 0, 0.62)'
    const outline = Math.max(0, Math.min(8, Number(source.outline) || 0))
    const shadow = Math.max(0, Math.min(8, Number(source.shadow) || 0))
    const shadows = []
    if (outline > 0) shadows.push(...createOutlineShadows(outline, outlineColor))
    if (shadow > 0) shadows.push(`${shadow}px ${shadow}px ${shadowColor}`)
    const rules = [
      `color:${primaryColor}`,
      'background-color:transparent',
      `font-family:"${String(source.fontname ?? 'sans-serif').replace(/["\\{};]/g, '')}"`,
      `font-size:${fontSize}px`,
    ]
    if (Number(source.bold) !== 0) rules.push('font-weight:700')
    if (Number(source.italic) !== 0) rules.push('font-style:italic')
    if (Number(source.underline) !== 0) rules.push('text-decoration:underline')
    if (shadows.length > 0) rules.push(`text-shadow:${shadows.join(',')}`)
    if (Number(source.borderstyle) === 3) rules.push(`background-color:${shadowColor}`)
    styles.set(String(name).trim().toLowerCase(), { className, rules: rules.join(';') })
  }
  return styles
}

function convertAssToWebVtt(content) {
  const styles = parseAssStyles(content)
  const cues = []
  for (const line of String(content).split(/\r?\n/)) {
    const match = /^Dialogue:\s*[^,]*,([^,]*),([^,]*),([^,]*),(?:[^,]*,){5}(.*)$/i.exec(line)
    if (!match) continue
    const start = convertAssTimeToVtt(match[1])
    const end = convertAssTimeToVtt(match[2])
    const style = styles.get(match[3].trim().toLowerCase()) ?? styles.get('default')
    const text = escapeVttText(match[4])
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/gi, '\n')
      .replace(/\\h/gi, ' ')
      .trim()
    if (start && end && text) cues.push(`${start} --> ${end}\n${style ? `<c.${style.className}>${text}</c>` : text}`)
  }
  const styleSheet = [...styles.values()].map((style) => `::cue(.${style.className}) { ${style.rules} }`).join('\n')
  return `WEBVTT${styleSheet ? `\n\nSTYLE\n${styleSheet}` : ''}\n\n${cues.join('\n\n')}`
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
      const cachePath = path.join(
        subtitleCacheDir,
        `${createHash('sha1').update(`${subtitleCacheVersion}:${sourceKey}:${content}`).digest('hex')}.vtt`,
      )
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
