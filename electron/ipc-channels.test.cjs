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
  assert.throws(
    () => parseIpcRequest(IPC_CHANNELS.bangumiAssignEpisodes, [{ id: 'video:1', subjectId: 0 }]),
    /Bangumi ID必须是有效的正整数/,
  )
  assert.throws(() => parseIpcRequest(IPC_CHANNELS.libraryTrashVideoContainer, [{ id: '' }]), /媒体 ID不能为空/)
  assert.throws(
    () => parseIpcRequest(IPC_CHANNELS.libraryUpdateContainerInfo, [{ id: 'video:1', hasEmbeddedSubtitles: 'yes' }]),
    /内嵌字幕状态无效/,
  )
  assert.throws(
    () => parseIpcRequest(IPC_CHANNELS.libraryUpdateVideoEpisode, [{ id: 'video:1', episode: '#01', episodeTitle: '' }]),
    /单集显示标题不能为空/,
  )
  assert.throws(
    () => parseIpcRequest(IPC_CHANNELS.libraryUpdateVideoEpisode, [{ id: 'video:1', episode: '#01', episodeTitleSource: 'unknown' }]),
    /单集显示标题来源无效/,
  )
  assert.throws(
    () =>
      parseIpcRequest(IPC_CHANNELS.configSave, [
        {
          schemaVersion: 3,
          updatedAt: '2026-07-19T00:00:00.000Z',
          mediaRoot: '',
          theme: 'dark',
          cacheLimitMb: 4096,
          confirmBeforeClose: true,
          defaultPlaybackMode: 'contain',
          defaultReadingMode: 'page',
          showExternalSubtitleBadges: 'yes',
          network: { proxyEnabled: false, proxyUrl: '' },
          scraping: { bangumiToken: '', bangumiEndpoint: 'https://api.bgm.tv', hanime1Endpoint: 'https://hanime1.com' },
          libraries: Object.fromEntries(
            ['erAnime', 'anime', 'creator', 'books', 'comics', 'general'].map((id) => [
              id,
              { rootPath: '', enabled: true, sortMode: 'title', sortDirection: 'ascending' },
            ]),
          ),
          catalog: { tags: [] },
        },
      ]),
    /外挂字幕角标设置无效/,
  )
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

  const [containerTrashRequest] = parseIpcRequest(IPC_CHANNELS.libraryTrashVideoContainer, [{ id: 'video:anime:item' }])
  assert.deepEqual(containerTrashRequest, { id: 'video:anime:item' })
})
