const test = require('node:test')
const assert = require('node:assert/strict')
const { createNetworkProxyService, createSystemNetworkFetch, normalizeProxyUrl } = require('./system-network-service.cjs')

test('normalizes supported proxy addresses and applies direct or fixed proxy modes', async () => {
  const configurations = []
  const service = createNetworkProxyService({
    electronSession: {
      setProxy: async (configuration) => configurations.push(configuration),
    },
  })

  assert.equal(normalizeProxyUrl('127.0.0.1:8390'), 'http://127.0.0.1:8390')
  assert.equal(normalizeProxyUrl('socks5://127.0.0.1:8390'), 'socks5://127.0.0.1:8390')
  assert.equal(normalizeProxyUrl('https://https://127.0.0.1:8390'), 'http://127.0.0.1:8390')
  assert.throws(() => normalizeProxyUrl('ftp://127.0.0.1:8390'), /仅支持/)
  assert.throws(() => normalizeProxyUrl('http://127.0.0.1:8390/path'), /格式无效/)

  await service.configure({ network: { proxyEnabled: true, proxyUrl: '127.0.0.1:8390' } })
  assert.deepEqual(configurations[0], { mode: 'fixed_servers', proxyRules: 'http=127.0.0.1:8390;https=127.0.0.1:8390' })
  assert.equal(service.isEnabled(), true)

  await service.configure({ network: { proxyEnabled: false, proxyUrl: 'http://127.0.0.1:8390' } })
  assert.deepEqual(configurations[1], { mode: 'direct' })
  assert.equal(service.isEnabled(), false)
})

test('falls back when Electron network fetching fails', async () => {
  const calls = []
  const fetchWithSystemNetwork = createSystemNetworkFetch({
    electronFetch: async () => {
      calls.push('electron')
      throw new Error('proxy unavailable')
    },
    fallbackFetch: async () => {
      calls.push('fallback')
      return { ok: true }
    },
  })

  assert.deepEqual(await fetchWithSystemNetwork('https://example.test'), { ok: true })
  assert.deepEqual(calls, ['electron', 'fallback'])
})

test('retains both errors when neither network path succeeds', async () => {
  const fetchWithSystemNetwork = createSystemNetworkFetch({
    electronFetch: async () => {
      throw new Error('system failure')
    },
    fallbackFetch: async () => {
      throw new Error('fallback failure')
    },
  })

  await assert.rejects(fetchWithSystemNetwork('https://example.test'), /system failure；fallback failure/)
})

test('does not fall back to a direct request while the application proxy is enabled', async () => {
  let fallbackCalled = false
  const fetchWithSystemNetwork = createSystemNetworkFetch({
    electronFetch: async () => {
      throw new Error('proxy connection refused')
    },
    fallbackFetch: async () => {
      fallbackCalled = true
      return { ok: true }
    },
    isProxyEnabled: () => true,
  })

  await assert.rejects(fetchWithSystemNetwork('https://example.test'), /通过应用代理连接失败：proxy connection refused/)
  assert.equal(fallbackCalled, false)
})
