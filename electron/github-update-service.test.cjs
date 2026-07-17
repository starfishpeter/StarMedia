const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createGitHubUpdateService } = require('./github-update-service.cjs')

function releaseResponse(bytes, overrides = {}) {
  return {
    tag_name: 'v0.6.21',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/starfishpeter/StarMedia/releases/tag/v0.6.21',
    published_at: '2026-07-17T00:00:00Z',
    assets: [
      {
        name: 'StarMedia-0.6.21-win.zip',
        state: 'uploaded',
        size: bytes.length,
        digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        browser_download_url: 'https://github.com/starfishpeter/StarMedia/releases/download/v0.6.21/StarMedia-0.6.21-win.zip',
        ...overrides,
      },
    ],
  }
}

test('checks a formal release and downloads only a matching SHA-256 ZIP', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-github-update-test-'))
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }))
  const bytes = Buffer.from('verified zip content')
  const requests = []
  const service = createGitHubUpdateService({
    appVersion: '0.6.20',
    temporaryDirectory: () => tempRoot,
    randomId: () => 'fixture',
    fetchWithNetwork: async (url, options) => {
      requests.push({ url, options })
      return requests.length === 1
        ? new Response(JSON.stringify(releaseResponse(bytes)), { status: 200 })
        : new Response(bytes, { status: 200 })
    },
  })

  const release = await service.checkLatestRelease()
  assert.equal(release.updateAvailable, true)
  assert.equal(release.latestVersion, '0.6.21')
  const downloaded = await service.downloadLatestRelease(release)
  assert.deepEqual(await fs.readFile(downloaded.archivePath), bytes)
  assert.equal(requests[0].options.headers['X-GitHub-Api-Version'], '2026-03-10')
  await service.discardDownloadedArchive(downloaded.archivePath)
  await assert.rejects(fs.stat(downloaded.archivePath), { code: 'ENOENT' })
})

test('rejects missing digests and removes a download whose digest does not match', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'starmedia-github-update-test-'))
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }))
  const expected = Buffer.from('expected zip')
  const actual = Buffer.from('tampered zip')
  let responseIndex = 0
  const service = createGitHubUpdateService({
    appVersion: '0.6.20',
    temporaryDirectory: () => tempRoot,
    randomId: () => 'tampered',
    fetchWithNetwork: async () => {
      responseIndex += 1
      return responseIndex === 1
        ? new Response(JSON.stringify(releaseResponse(actual, { digest: `sha256:${createHash('sha256').update(expected).digest('hex')}` })))
        : new Response(actual)
    },
  })
  const release = await service.checkLatestRelease()
  await assert.rejects(service.downloadLatestRelease(release), /SHA-256/)
  await assert.rejects(fs.stat(path.join(tempRoot, 'StarMedia-github-update-tampered.zip')), { code: 'ENOENT' })

  const invalid = createGitHubUpdateService({
    appVersion: '0.6.20',
    fetchWithNetwork: async () => new Response(JSON.stringify(releaseResponse(expected, { digest: null }))),
  })
  await assert.rejects(invalid.checkLatestRelease(), /SHA-256/)
})
