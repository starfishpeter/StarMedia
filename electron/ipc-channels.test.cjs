const test = require('node:test')
const assert = require('node:assert/strict')
const { IPC_CHANNELS, IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } = require('./ipc-channels.cjs')
const { IPC_CONTRACTS, IPC_EVENT_CONTRACTS, parseIpcRequest } = require('./ipc-contracts.cjs')

test('IPC contract has unique, namespaced channels', () => {
  const channels = Object.values(IPC_CHANNELS)
  assert.equal(new Set(channels).size, channels.length)
  assert.equal(
    channels.every((channel) => /^[a-z]+:[A-Za-z]+$/.test(channel)),
    true,
  )
})

test('IPC contract partitions invoked and pushed channels', () => {
  const allChannels = new Set(Object.values(IPC_CHANNELS))
  const invokedChannels = new Set(IPC_INVOKE_CHANNELS)
  const eventChannels = new Set(IPC_EVENT_CHANNELS)

  assert.equal(
    [...invokedChannels].every((channel) => allChannels.has(channel)),
    true,
  )
  assert.equal(
    [...eventChannels].every((channel) => allChannels.has(channel)),
    true,
  )
  assert.equal(
    [...eventChannels].some((channel) => invokedChannels.has(channel)),
    false,
  )
  assert.equal(invokedChannels.size + eventChannels.size, allChannels.size)
})

test('every IPC channel has one request or event contract', () => {
  assert.deepEqual(Object.keys(IPC_CONTRACTS).sort(), [...IPC_INVOKE_CHANNELS].sort())
  assert.deepEqual(Object.keys(IPC_EVENT_CONTRACTS).sort(), [...IPC_EVENT_CHANNELS].sort())
  for (const contract of Object.values(IPC_CONTRACTS)) {
    assert.equal(Array.isArray(contract.request), true)
    assert.equal(typeof contract.response, 'string')
    assert.equal(typeof contract.parse, 'function')
  }
})

test('IPC request contracts reject malformed, oversized, and ambiguous input', () => {
  assert.throws(() => parseIpcRequest(IPC_CHANNELS.libraryTrashItems, [{ ids: ['first', 'first'] }]), /不能包含重复项/)
  assert.throws(
    () =>
      parseIpcRequest(IPC_CHANNELS.importCreatePlan, [
        {
          sourcePath: 'C:\\source',
          sourcePaths: ['C:\\other-source'],
          targetLibrary: 'anime',
        },
      ]),
    /必须提供一个来源路径或来源路径列表/,
  )
  assert.throws(
    () =>
      parseIpcRequest(IPC_CHANNELS.importCreatePlan, [
        {
          sourcePaths: ['relative-source'],
          targetLibrary: 'anime',
        },
      ]),
    /必须是绝对路径/,
  )
  assert.throws(
    () =>
      parseIpcRequest(IPC_CHANNELS.videoUpdateMetadata, [
        {
          id: 'video:anime:item',
          durationSeconds: '120',
        },
      ]),
    /视频时长无效/,
  )
  assert.throws(() => parseIpcRequest(IPC_CHANNELS.videoGetPlayback, ['x'.repeat(4097)]), /媒体 ID 过长/)
  assert.throws(() => parseIpcRequest(IPC_CHANNELS.bookGetPage, ['not-a-session', 0]), /阅读会话 ID 无效/)
})

test('IPC request contracts return normalized safe request shapes', () => {
  const [request] = parseIpcRequest(IPC_CHANNELS.libraryTransferItems, [
    {
      ids: ['video:anime:item'],
      targetLibrary: 'general',
    },
  ])

  assert.deepEqual(request, { ids: ['video:anime:item'], targetLibrary: 'general' })

  const [tagRequest] = parseIpcRequest(IPC_CHANNELS.libraryUpdateMediaTags, [{ id: 'video:creator:item', tags: [' 单集标签 '] }])
  assert.deepEqual(tagRequest, { id: 'video:creator:item', tags: ['单集标签'] })
})
