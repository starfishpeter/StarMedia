function describeNetworkError(error) {
  const primary = String(error?.message ?? '').trim()
  const cause = error?.cause
  const detail = String(cause?.code ?? cause?.message ?? '').trim()
  return detail && detail !== primary ? `${primary}（${detail}）` : primary || '未知网络错误'
}

function createSystemNetworkFetch({ electronFetch, fallbackFetch = globalThis.fetch }) {
  if (typeof electronFetch !== 'function' || typeof fallbackFetch !== 'function') throw new Error('系统网络服务依赖不可用')

  return async function fetchWithSystemNetwork(url, options = {}) {
    let systemError
    try {
      return await electronFetch(url, options)
    } catch (error) {
      systemError = error
    }
    try {
      return await fallbackFetch(url, options)
    } catch (error) {
      throw new Error(`${describeNetworkError(systemError)}；${describeNetworkError(error)}`, { cause: error })
    }
  }
}

module.exports = { createSystemNetworkFetch, describeNetworkError }
