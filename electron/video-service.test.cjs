const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  getVideoPlaybackForLibrary,
  getVideoPlaybackSupportForLibrary,
  openVideoExternallyForLibrary,
  updateVideoMetadataForLibrary,
} = require('./video-service.cjs')

function box(type, payload = Buffer.alloc(0)) {
  const value = Buffer.alloc(8 + payload.length)
  value.writeUInt32BE(value.length, 0)
  value.write(type, 4, 4, 'ascii')
  payload.copy(value, 8)
  return value
}

function createSupportedMp4() {
  const hdlr = (handlerType) => box('hdlr', Buffer.concat([Buffer.alloc(8), Buffer.from(handlerType, 'ascii')]))
  const track = (handlerType, entry) =>
    box(
      'trak',
      box(
        'mdia',
        Buffer.concat([
          hdlr(handlerType),
          box('minf', box('stbl', box('stsd', Buffer.concat([Buffer.alloc(4), Buffer.from([0, 0, 0, 1]), entry])))),
        ]),
      ),
    )
  const avc1 = box('avc1', Buffer.alloc(28))
  const esds = box('esds', Buffer.concat([Buffer.alloc(4), Buffer.from([0x04, 0x01, 0x40])]))
  const mp4a = box('mp4a', Buffer.concat([Buffer.alloc(28), esds]))
  return box('moov', Buffer.concat([track('vide', avc1), track('soun', mp4a)]))
}

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-video-service-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

test('returns every supported sidecar subtitle for internally playable MP4 media', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'episode.mp4')
  await fs.writeFile(sourcePath, createSupportedMp4())
  const item = {
    id: 'video:1',
    kind: 'video',
    title: 'Episode',
    sourcePath,
    sidecars: [
      { fileName: 'episode.zh.srt', sourcePath: path.join(root, 'episode.zh.srt') },
      { fileName: 'episode.en.vtt', sourcePath: path.join(root, 'episode.en.vtt') },
      { fileName: 'episode.ass', sourcePath: path.join(root, 'episode.ass') },
      { fileName: 'episode.idx', sourcePath: path.join(root, 'episode.idx') },
      { sourcePath: null },
    ],
  }
  const library = { items: [item] }

  const playback = await getVideoPlaybackForLibrary({ id: item.id, library })

  assert.equal(await getVideoPlaybackSupportForLibrary({ id: item.id, library }), true)
  assert.deepEqual(
    playback.subtitles.map((subtitle) => subtitle.label),
    ['episode.zh', 'episode.en', 'episode'],
  )
  assert.deepEqual(
    playback.subtitles.map((subtitle) => subtitle.extension),
    ['.srt', '.vtt', '.ass'],
  )
  assert.equal(playback.mimeType, 'video/mp4')
})

test('discovers matching subtitles next to the video even when the index has no sidecars', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'episode.mp4')
  await fs.writeFile(sourcePath, createSupportedMp4())
  await fs.writeFile(path.join(root, 'episode.srt'), 'subtitle')
  await fs.writeFile(path.join(root, 'episode.zh-CN.ass'), 'subtitle')
  await fs.writeFile(path.join(root, 'episode [commentary].vtt'), 'subtitle')
  await fs.writeFile(path.join(root, 'other.srt'), 'subtitle')
  const item = { id: 'video:adjacent-subtitles', kind: 'video', title: 'Episode', sourcePath, sidecars: [] }

  const playback = await getVideoPlaybackForLibrary({ id: item.id, library: { items: [item] } })

  assert.deepEqual(playback.subtitles.map((subtitle) => subtitle.label).sort(), ['episode', 'episode [commentary]', 'episode.zh-CN'].sort())
})

test('supports Chromium-compatible M4V and WebM containers', async (t) => {
  const root = await createSandbox(t)
  const m4vPath = path.join(root, 'episode.m4v')
  const webmPath = path.join(root, 'episode.webm')
  await fs.writeFile(m4vPath, createSupportedMp4())
  await fs.writeFile(webmPath, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]))
  const m4v = { id: 'video:m4v', kind: 'video', title: 'M4V', sourcePath: m4vPath, sidecars: [] }
  const webm = { id: 'video:webm', kind: 'video', title: 'WebM', sourcePath: webmPath, sidecars: [] }
  const library = { items: [m4v, webm] }

  assert.equal(await getVideoPlaybackSupportForLibrary({ id: m4v.id, library }), true)
  assert.equal(await getVideoPlaybackSupportForLibrary({ id: webm.id, library }), true)
  assert.equal((await getVideoPlaybackForLibrary({ id: m4v.id, library })).mimeType, 'video/mp4')
  assert.equal((await getVideoPlaybackForLibrary({ id: webm.id, library })).mimeType, 'video/webm')
})

test('allows an indexed Matroska video to use the internal Chromium player', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'episode.mkv')
  await fs.writeFile(sourcePath, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]))
  const item = { id: 'video:mkv', kind: 'video', title: 'MKV Episode', sourcePath, sidecars: [] }
  const library = { items: [item] }

  assert.equal(await getVideoPlaybackSupportForLibrary({ id: item.id, library }), true)
  const playback = await getVideoPlaybackForLibrary({ id: item.id, library })
  assert.equal(playback.url, pathToFileURL(sourcePath).toString())
  assert.equal(playback.mimeType, 'video/matroska')
  assert.equal(playback.title, item.title)
})

test('rejects a renamed MKV file without an EBML header', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'invalid.mkv')
  await fs.writeFile(sourcePath, 'not a matroska file')
  const item = { id: 'video:invalid-mkv', kind: 'video', title: 'Invalid MKV', sourcePath, sidecars: [] }
  const library = { items: [item] }

  assert.equal(await getVideoPlaybackSupportForLibrary({ id: item.id, library }), false)
  await assert.rejects(() => getVideoPlaybackForLibrary({ id: item.id, library }), /封装或编码不支持应用内播放/)
})

test('opens indexed video media externally and preserves metadata on save', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'episode.mp4')
  await fs.writeFile(sourcePath, createSupportedMp4())
  const item = { id: 'video:1', kind: 'video', title: 'Episode', sourcePath, cover: 'old-cover', episodeCover: '' }
  const library = { items: [item], operations: [] }
  const opened = []
  const externalResult = await openVideoExternallyForLibrary({
    id: item.id,
    library,
    openPath: async (value) => {
      opened.push(value)
      return ''
    },
  })
  let saved
  const updated = await updateVideoMetadataForLibrary({
    id: item.id,
    durationSeconds: 65,
    episodeCover: 'new-cover',
    library,
    saveLibrary: async (data) => {
      saved = data
      return { data, libraryPath: 'index.json' }
    },
  })

  assert.deepEqual(externalResult, { ok: true })
  assert.deepEqual(opened, [item.sourcePath])
  assert.equal(updated.item.duration, '1:05')
  assert.equal(saved.items[0].cover, 'old-cover')
  assert.equal(saved.items[0].episodeCover, 'new-cover')
})
