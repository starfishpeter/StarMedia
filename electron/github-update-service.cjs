const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createHash, randomUUID, timingSafeEqual } = require('node:crypto')
const { compareVersions } = require('./local-update-service.cjs')

const repositoryOwner = 'starfishpeter'
const repositoryName = 'StarMedia'
const latestReleaseEndpoint = `https://api.github.com/repos/${repositoryOwner}/${repositoryName}/releases/latest`
const maximumArchiveBytes = 1024 * 1024 * 1024

function parseReleaseVersion(tagName) {
  const match = String(tagName ?? '')
    .trim()
    .match(/^v?(\d+\.\d+\.\d+)$/)
  if (!match) throw new Error('GitHub Release 版本号格式无效')
  return match[1]
}

function parseSha256Digest(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^sha256:([a-f\d]{64})$/i)
  if (!match) throw new Error('GitHub Release ZIP 缺少有效的 SHA-256 校验值')
  return match[1].toLocaleLowerCase()
}

function isExpectedDownloadUrl(value, version, assetName) {
  try {
    const url = new URL(value)
    const expectedPath = `/${repositoryOwner}/${repositoryName}/releases/download/v${version}/${assetName}`
    const alternatePath = `/${repositoryOwner}/${repositoryName}/releases/download/${version}/${assetName}`
    return url.protocol === 'https:' && url.hostname === 'github.com' && [expectedPath, alternatePath].includes(url.pathname)
  } catch {
    return false
  }
}

function createGitHubUpdateService({
  appVersion,
  fetchWithNetwork,
  fileSystem = fs,
  temporaryDirectory = os.tmpdir,
  randomId = randomUUID,
  maxArchiveBytes = maximumArchiveBytes,
}) {
  if (typeof fetchWithNetwork !== 'function') throw new Error('GitHub 更新服务网络依赖不可用')

  const requestHeaders = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': `StarMedia/${appVersion}`,
  }

  async function checkLatestRelease() {
    const response = await fetchWithNetwork(latestReleaseEndpoint, { headers: requestHeaders, redirect: 'error' })
    if (response.status === 404) return { currentVersion: appVersion, updateAvailable: false, releaseFound: false }
    if (!response.ok) throw new Error(`检查 GitHub 更新失败（HTTP ${response.status}）`)
    const release = await response.json()
    if (!release || release.draft || release.prerelease) throw new Error('GitHub 最新 Release 不是可安装的正式版本')

    const latestVersion = parseReleaseVersion(release.tag_name)
    const assetName = `StarMedia-${latestVersion}-win.zip`
    const asset = Array.isArray(release.assets) ? release.assets.find((candidate) => candidate?.name === assetName) : null
    if (!asset || asset.state !== 'uploaded') throw new Error(`GitHub Release 缺少 ${assetName}`)
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxArchiveBytes) throw new Error('GitHub Release ZIP 体积无效')
    if (!isExpectedDownloadUrl(asset.browser_download_url, latestVersion, assetName)) throw new Error('GitHub Release ZIP 下载地址无效')
    const sha256 = parseSha256Digest(asset.digest)

    return {
      currentVersion: appVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, appVersion) > 0,
      releaseFound: true,
      releaseUrl: typeof release.html_url === 'string' ? release.html_url : '',
      publishedAt: typeof release.published_at === 'string' ? release.published_at : '',
      assetName,
      assetSize: asset.size,
      asset: { downloadUrl: asset.browser_download_url, sha256, size: asset.size },
    }
  }

  async function discardDownloadedArchive(archivePath) {
    if (!archivePath) return
    const resolved = path.resolve(archivePath)
    const tempRoot = path.resolve(temporaryDirectory())
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('StarMedia-github-update-'))
      throw new Error('拒绝清理预期范围之外的 GitHub 更新文件')
    await fileSystem.rm(resolved, { force: true })
  }

  async function downloadLatestRelease(release) {
    if (!release?.updateAvailable || !release?.asset) throw new Error('当前没有可下载的 GitHub 更新')
    const archivePath = path.join(temporaryDirectory(), `StarMedia-github-update-${randomId()}.zip`)
    let fileHandle
    try {
      const response = await fetchWithNetwork(release.asset.downloadUrl, { headers: requestHeaders, redirect: 'follow' })
      if (!response.ok || !response.body) throw new Error(`下载 GitHub 更新失败（HTTP ${response.status}）`)
      fileHandle = await fileSystem.open(archivePath, 'wx')
      const hash = createHash('sha256')
      const reader = response.body.getReader()
      let downloadedBytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        downloadedBytes += chunk.length
        if (downloadedBytes > release.asset.size || downloadedBytes > maxArchiveBytes) throw new Error('GitHub 更新下载体积超过预期')
        hash.update(chunk)
        await fileHandle.write(chunk)
      }
      await fileHandle.close()
      fileHandle = null
      if (downloadedBytes !== release.asset.size) throw new Error('GitHub 更新下载不完整')
      const actualDigest = Buffer.from(hash.digest('hex'), 'hex')
      const expectedDigest = Buffer.from(release.asset.sha256, 'hex')
      if (actualDigest.length !== expectedDigest.length || !timingSafeEqual(actualDigest, expectedDigest))
        throw new Error('GitHub 更新 SHA-256 校验失败')
      return { archivePath, downloadedBytes, sha256: release.asset.sha256 }
    } catch (error) {
      if (fileHandle) await fileHandle.close().catch(() => {})
      await discardDownloadedArchive(archivePath).catch(() => {})
      throw error
    }
  }

  return { checkLatestRelease, discardDownloadedArchive, downloadLatestRelease }
}

module.exports = {
  createGitHubUpdateService,
  isExpectedDownloadUrl,
  latestReleaseEndpoint,
  parseReleaseVersion,
  parseSha256Digest,
}
