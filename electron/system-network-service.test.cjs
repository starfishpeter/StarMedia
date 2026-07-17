const test = require('node:test')
const assert = require('node:assert/strict')
const { createSystemNetworkFetch } = require('./system-network-service.cjs')

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
