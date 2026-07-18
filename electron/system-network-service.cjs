function describeNetworkError(error) {
  const primary = String(error?.message ?? '').trim()
  const cause = error?.cause
  const detail = String(cause?.code ?? cause?.message ?? '').trim()
  return detail && detail !== primary ? `${primary}（${detail}）` : primary || '未知网络错误'
}

const defaultNetworkTimeoutMs = 30_000

function createNetworkTimeoutError(timeoutMs, cause) {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000))
  return new Error(`网络请求超时（${seconds} 秒）`, cause === undefined ? undefined : { cause })
}

async function fetchWithTimeout(fetcher, url, options = {}, timeoutMs = defaultNetworkTimeoutMs) {
  if (typeof fetcher !== 'function') throw new Error('网络请求函数不可用')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('网络请求超时时间无效')

  const controller = new globalThis.AbortController()
  const upstreamSignal = options.signal
  let timedOut = false
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason)
  if (upstreamSignal?.aborted) abortFromUpstream()
  else upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  let cleanedUp = false
  const cleanUp = () => {
    if (cleanedUp) return
    cleanedUp = true
    globalThis.clearTimeout(timeout)
    upstreamSignal?.removeEventListener('abort', abortFromUpstream)
  }
  const withTimeoutError = (error) => (timedOut ? createNetworkTimeoutError(timeoutMs, error) : error)

  let response
  try {
    response = await fetcher(url, { ...options, signal: controller.signal })
  } catch (error) {
    cleanUp()
    throw withTimeoutError(error)
  }
  cleanUp()
  return response
}

function normalizeProxyUrl(value) {
  const source = String(value ?? '')
    .trim()
    .replace(/^(?:https?:\/\/)+/i, 'http://')
  if (!source) throw new Error('代理地址不能为空')

  let url
  try {
    url = new URL(source.includes('://') ? source : `http://${source}`)
  } catch {
    throw new Error('代理地址格式无效')
  }
  if (!['http:', 'socks5:'].includes(url.protocol)) throw new Error('代理地址仅支持 http:// 或 socks5://')
  if (!url.hostname || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash)
    throw new Error('代理地址格式无效')
  return `${url.protocol}//${url.host}`
}

function createNetworkProxyService({ electronSession }) {
  if (!electronSession || typeof electronSession.setProxy !== 'function') throw new Error('应用网络代理服务不可用')
  let enabled = false

  async function configure(config) {
    const network = config?.network
    if (!network?.proxyEnabled) {
      await electronSession.setProxy({ mode: 'direct' })
      enabled = false
      return { enabled, proxyUrl: '' }
    }

    const proxyUrl = normalizeProxyUrl(network.proxyUrl)
    const url = new URL(proxyUrl)
    const proxyRules = url.protocol === 'socks5:' ? proxyUrl : `http=${url.host};https=${url.host}`
    enabled = true
    await electronSession.setProxy({ mode: 'fixed_servers', proxyRules })
    return { enabled, proxyUrl }
  }

  return { configure, isEnabled: () => enabled }
}

function createSystemNetworkFetch({
  electronFetch,
  fallbackFetch = globalThis.fetch,
  isProxyEnabled = () => false,
  timeoutMs = defaultNetworkTimeoutMs,
}) {
  if (typeof electronFetch !== 'function' || typeof fallbackFetch !== 'function') throw new Error('系统网络服务依赖不可用')
  if (typeof isProxyEnabled !== 'function') throw new Error('系统网络代理状态依赖不可用')

  return async function fetchWithSystemNetwork(url, options = {}) {
    let systemError
    try {
      return await fetchWithTimeout(electronFetch, url, options, timeoutMs)
    } catch (error) {
      systemError = error
    }
    if (isProxyEnabled()) throw new Error(`通过应用代理连接失败：${describeNetworkError(systemError)}`, { cause: systemError })
    try {
      return await fetchWithTimeout(fallbackFetch, url, options, timeoutMs)
    } catch (error) {
      throw new Error(`${describeNetworkError(systemError)}；${describeNetworkError(error)}`, { cause: error })
    }
  }
}

module.exports = {
  createNetworkProxyService,
  createNetworkTimeoutError,
  createSystemNetworkFetch,
  defaultNetworkTimeoutMs,
  describeNetworkError,
  fetchWithTimeout,
  normalizeProxyUrl,
}
