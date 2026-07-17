const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { fileURLToPath } = require('node:url')
const { convertAssToWebVtt, convertSrtToWebVtt, createSubtitlePlaybackTracks } = require('./subtitle-cache-service.cjs')

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-subtitle-cache-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

test('converts SRT and ASS subtitles into WebVTT cues', () => {
  assert.equal(convertSrtToWebVtt('1\n00:00:01,250 --> 00:00:02,500\nHello'), 'WEBVTT\n\n00:00:01.250 --> 00:00:02.500\nHello')
  assert.equal(
    convertAssToWebVtt('Dialogue: 0,0:00:01.2,0:00:02.34,Default,,0,0,0,,{\\i1}Hello\\NWorld'),
    'WEBVTT\n\n00:00:01.200 --> 00:00:02.340\nHello\nWorld',
  )
})

test('preserves common ASS style attributes in generated WebVTT style rules', () => {
  const vtt = convertAssToWebVtt(
    '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Main,Noto Sans CJK,32,&H0000FFFF,&H00000000,&H00000000,&H80000000,-1,-1,1,0,100,100,0,0,1,2,1,2,10,10,10,1\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Main,,0,0,0,,Styled line',
  )

  assert.match(vtt, /::cue\(.ass-main\)/)
  assert.match(vtt, /font-family:"Noto Sans CJK"/)
  assert.match(vtt, /font-size:32px/)
  assert.match(vtt, /font-weight:700/)
  assert.match(vtt, /font-style:italic/)
  assert.match(vtt, /text-decoration:underline/)
  assert.match(vtt, /<c.ass-main>Styled line<\/c>/)
})

test('caches converted tracks, preserves native VTT files, and protects active cache files while pruning', async (t) => {
  const root = await createSandbox(t)
  const cacheDir = path.join(root, 'cache~encoded')
  const srtPath = path.join(root, 'episode.zh.srt')
  const vttPath = path.join(root, 'episode.en.vtt')
  await fs.writeFile(srtPath, '1\n00:00:01,000 --> 00:00:02,000\n你好')
  await fs.writeFile(vttPath, 'WEBVTT')
  const touched = []
  const pruned = []

  const tracks = await createSubtitlePlaybackTracks({
    subtitles: [
      { path: srtPath, extension: '.srt', label: '中文' },
      { path: vttPath, extension: '.vtt', label: 'English' },
    ],
    cacheDir,
    touchCacheFile: async (filePath) => touched.push(filePath),
    pruneCache: async (protectedPaths) => pruned.push(...protectedPaths),
  })

  assert.equal(tracks.length, 2)
  const cachePath = fileURLToPath(tracks[0].url)
  assert.match(cachePath, /cache~encoded[\\/]subtitles/)
  assert.match(fileURLToPath(tracks[1].url), /episode\.en\.vtt$/)
  assert.deepEqual(touched, pruned)
  assert.match(await fs.readFile(cachePath, 'utf8'), /00:00:01\.000/)
})

test('skips unreadable subtitle files without preventing the video from receiving valid tracks', async (t) => {
  const root = await createSandbox(t)
  const cacheDir = path.join(root, 'cache')
  const validPath = path.join(root, 'valid.srt')
  await fs.writeFile(validPath, '1\n00:00:01,000 --> 00:00:02,000\nValid')
  const warnings = []

  const tracks = await createSubtitlePlaybackTracks({
    subtitles: [
      { path: path.join(root, 'missing.srt'), extension: '.srt', label: 'Missing' },
      { path: validPath, extension: '.srt', label: 'Valid' },
    ],
    cacheDir,
    touchCacheFile: async () => {},
    pruneCache: async () => {},
    onWarning: (message) => warnings.push(message),
  })

  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].label, 'Valid')
  assert.match(warnings[0], /Missing/)
})

test('converts embedded ASS content and protects its extraction manifest while pruning', async (t) => {
  const root = await createSandbox(t)
  const cacheDir = path.join(root, 'cache~encoded')
  const manifestPath = path.join(cacheDir, 'subtitles', 'embedded', 'track.json')
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(manifestPath, '{}')
  let protectedPaths = []

  const tracks = await createSubtitlePlaybackTracks({
    subtitles: [
      {
        extension: '.ass',
        label: '内嵌字幕 1',
        content: 'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,内嵌字幕',
      },
    ],
    cacheDir,
    protectedPaths: [manifestPath],
    touchCacheFile: async () => {},
    pruneCache: async (paths) => {
      protectedPaths = paths
    },
  })

  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].label, '内嵌字幕 1')
  assert.equal(protectedPaths.includes(manifestPath), true)
  assert.equal(
    protectedPaths.some((filePath) => filePath.endsWith('.vtt')),
    true,
  )
  const vttPath = fileURLToPath(tracks[0].url)
  assert.match(await fs.readFile(vttPath, 'utf8'), /内嵌字幕/)
})
