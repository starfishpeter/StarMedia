const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { extractMatroskaSubtitles, scanMatroskaSubtitles } = require('./matroska-subtitle-service.cjs')

function encodeId(id) {
  const hex = id.toString(16).padStart(Math.ceil(id.toString(16).length / 2) * 2, '0')
  return Buffer.from(hex, 'hex')
}

function encodeSize(size) {
  for (let width = 1; width <= 8; width += 1) {
    if (BigInt(size) < (1n << BigInt(width * 7)) - 1n) {
      const output = Buffer.alloc(width)
      let value = BigInt(size)
      for (let index = width - 1; index >= 0; index -= 1) {
        output[index] = Number(value & 0xffn)
        value >>= 8n
      }
      output[0] |= 1 << (8 - width)
      return output
    }
  }
  throw new Error('test element is too large')
}

function element(id, payload = Buffer.alloc(0)) {
  return Buffer.concat([encodeId(id), encodeSize(payload.length), payload])
}

function unsigned(id, value) {
  const bytes = []
  let remaining = BigInt(value)
  do {
    bytes.unshift(Number(remaining & 0xffn))
    remaining >>= 8n
  } while (remaining > 0)
  return element(id, Buffer.from(bytes))
}

function text(id, value) {
  return element(id, Buffer.from(value, 'utf8'))
}

function blockGroup(relativeTimestamp, duration, subtitle) {
  const blockHeader = Buffer.from([0x81, (relativeTimestamp >> 8) & 0xff, relativeTimestamp & 0xff, 0x00])
  return element(
    0xa0,
    Buffer.concat([element(0xa1, Buffer.concat([blockHeader, Buffer.from(subtitle, 'utf8')])), unsigned(0x9b, duration)]),
  )
}

function createMatroskaWithAssSubtitles() {
  const codecPrivate =
    '[Script Info]\nTitle: Embedded\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  const track = element(
    0xae,
    Buffer.concat([
      unsigned(0xd7, 1),
      unsigned(0x83, 0x11),
      text(0x86, 'S_TEXT/ASS'),
      text(0x536e, '简体中文'),
      text(0x22b59c, 'zho'),
      text(0x63a2, codecPrivate),
    ]),
  )
  const info = element(0x1549a966, unsigned(0x2ad7b1, 1_000_000))
  const tracks = element(0x1654ae6b, track)
  const cluster = element(
    0x1f43b675,
    Buffer.concat([
      unsigned(0xe7, 20_000),
      blockGroup(0, 2_000, '1,0,Default,,0,0,0,,第一句'),
      blockGroup(2_500, 1_500, '2,0,Default,,0,0,0,,{\\i1}第二句'),
    ]),
  )
  return element(0x18538067, Buffer.concat([info, tracks, cluster]))
}

async function createSandbox(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-matroska-subtitle-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

test('extracts ASS subtitle cues and their Matroska block durations', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'episode.mkv')
  await fs.writeFile(sourcePath, createMatroskaWithAssSubtitles())

  const tracks = await scanMatroskaSubtitles(sourcePath)

  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].label, '简体中文')
  assert.equal(tracks[0].extension, '.ass')
  assert.match(tracks[0].content, /Dialogue: 0,0:00:20\.00,0:00:22\.00,Default,,0,0,0,,第一句/)
  assert.match(tracks[0].content, /Dialogue: 0,0:00:22\.50,0:00:24\.00,Default,,0,0,0,,\{\\i1\}第二句/)
})

test('caches embedded subtitle scans by the source file fingerprint', async (t) => {
  const root = await createSandbox(t)
  const sourcePath = path.join(root, 'episode.mkv')
  const cacheDir = path.join(root, 'cache')
  await fs.writeFile(sourcePath, createMatroskaWithAssSubtitles())
  const touched = []

  const first = await extractMatroskaSubtitles({ sourcePath, cacheDir, touchCacheFile: async (filePath) => touched.push(filePath) })
  const second = await extractMatroskaSubtitles({ sourcePath, cacheDir, touchCacheFile: async (filePath) => touched.push(filePath) })

  assert.deepEqual(second, first)
  assert.equal(touched.length, 2)
  assert.equal(touched[0], touched[1])
  assert.equal(first.subtitles.length, 1)
  assert.deepEqual(first.protectedPaths, [touched[0]])
  assert.equal((await fs.readdir(path.join(cacheDir, 'subtitles', 'embedded'))).length, 1)
})
