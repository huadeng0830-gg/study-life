// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { autoSyncError, autoSyncState, startAutoSyncCoordinator, stopAutoSyncCoordinator, syncNow } from '../src/composables/autoSyncCoordinator.js'
import { clearSyncError, localChanged, syncRecovery } from '../src/composables/cloudSync.js'
import { clearSyncSpaceSettings, randomSecret, saveSyncSpaceSettings } from '../src/composables/syncSpace.js'

/* 跨标签页同步通道的加固：协议版本、同步空间归属、错误文本长度、假成功。 */

const SPACE = 'AB7K-P9M2-X4DQ'
const OTHER_SPACE = 'ZZ9Q-W1T3-R7ML'
const LEADER_KEY = 'study_life_auto_sync_leader'

class FakeChannel {
  static last = null

  constructor(name) {
    this.name = name
    this.listeners = []
    this.closed = false
    this.sent = []
    FakeChannel.last = this
  }

  addEventListener(type, handler) {
    if (type === 'message') this.listeners.push(handler)
  }

  removeEventListener(type, handler) {
    this.listeners = this.listeners.filter((item) => item !== handler)
  }

  postMessage(data) {
    if (this.closed) throw new Error('channel closed')
    this.sent.push(data)
  }

  close() {
    this.closed = true
  }

  emit(data) {
    for (const handler of [...this.listeners]) handler({ data })
  }
}

// 让"另一个标签页"持有未过期的租约，于是本页一定不是 leader。
function giveLeaseToAnotherTab() {
  localStorage.setItem(LEADER_KEY, JSON.stringify({
    ownerId: 'tab-somewhere-else',
    leaseId: 'lease-elsewhere',
    fencingToken: 42,
    expiresAt: Date.now() + 60000,
  }))
}

describe('跨标签页同步通道加固', () => {
  beforeEach(async () => {
    stopAutoSyncCoordinator()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    localStorage.clear()
    clearSyncSpaceSettings()
    localChanged.value = false
    syncRecovery.value = { status: 'idle', marker: null, message: '' }
    clearSyncError()
    autoSyncState.value = 'disabled'
    FakeChannel.last = null
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.stubGlobal('BroadcastChannel', FakeChannel)
    saveSyncSpaceSettings({ spaceId: SPACE, deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: true })
  })

  it('接受同版本、同空间的 state 消息', () => {
    giveLeaseToAnotherTab()
    startAutoSyncCoordinator()
    const channel = FakeChannel.last
    expect(channel).toBeTruthy()

    channel.emit({ v: 1, spaceId: SPACE, source: 'tab-other', type: 'state', state: 'conflict', error: '有 2 项修改需要确认。' })
    expect(autoSyncState.value).toBe('conflict')
    expect(autoSyncError.value).toBe('有 2 项修改需要确认。')
    stopAutoSyncCoordinator()
  })

  it('协议版本不符的消息被丢弃', () => {
    giveLeaseToAnotherTab()
    startAutoSyncCoordinator()
    const channel = FakeChannel.last
    channel.emit({ v: 1, spaceId: SPACE, source: 'tab-other', type: 'state', state: 'conflict', error: '起点' })

    // 没有版本号（旧版标签页）或版本号不同，都不应该改动状态。
    channel.emit({ spaceId: SPACE, source: 'tab-other', type: 'state', state: 'synced' })
    expect(autoSyncState.value).toBe('conflict')
    channel.emit({ v: 0, spaceId: SPACE, source: 'tab-other', type: 'state', state: 'synced' })
    expect(autoSyncState.value).toBe('conflict')
    channel.emit({ v: 2, spaceId: SPACE, source: 'tab-other', type: 'state', state: 'synced' })
    expect(autoSyncState.value).toBe('conflict')
    stopAutoSyncCoordinator()
  })

  it('属于另一个同步空间的 state 消息被丢弃', () => {
    giveLeaseToAnotherTab()
    startAutoSyncCoordinator()
    const channel = FakeChannel.last
    channel.emit({ v: 1, spaceId: SPACE, source: 'tab-other', type: 'state', state: 'conflict', error: '起点' })

    channel.emit({ v: 1, spaceId: OTHER_SPACE, source: 'tab-other', type: 'state', state: 'synced' })
    expect(autoSyncState.value).toBe('conflict')
    // 空 spaceId 的消息同样不可信。
    channel.emit({ v: 1, spaceId: '', source: 'tab-other', type: 'state', state: 'synced' })
    expect(autoSyncState.value).toBe('conflict')
    stopAutoSyncCoordinator()
  })

  it('未知状态值与畸形数据不会污染状态', () => {
    giveLeaseToAnotherTab()
    startAutoSyncCoordinator()
    const channel = FakeChannel.last
    channel.emit({ v: 1, spaceId: SPACE, source: 'tab-other', type: 'state', state: 'conflict', error: '起点' })

    channel.emit({ v: 1, spaceId: SPACE, source: 'tab-other', type: 'state', state: '随便写的' })
    expect(autoSyncState.value).toBe('conflict')
    channel.emit('纯字符串')
    channel.emit(null)
    channel.emit(42)
    expect(autoSyncState.value).toBe('conflict')
    stopAutoSyncCoordinator()
  })

  it('来自另一个标签页的错误文本被截断后再进 UI', () => {
    giveLeaseToAnotherTab()
    startAutoSyncCoordinator()
    const channel = FakeChannel.last
    channel.emit({ v: 1, spaceId: SPACE, source: 'tab-other', type: 'state', state: 'error', error: 'x'.repeat(5000) })
    expect(autoSyncState.value).toBe('error')
    expect(autoSyncError.value).toHaveLength(200)
    stopAutoSyncCoordinator()
  })

  it('自己发出去的消息不会回灌', () => {
    giveLeaseToAnotherTab()
    startAutoSyncCoordinator()
    const channel = FakeChannel.last
    // 先让本页进入一个已知状态，再用本页自己的 source 发一条不同的状态。
    channel.emit({ v: 1, spaceId: SPACE, source: 'tab-other', type: 'state', state: 'conflict', error: '' })
    const own = channel.sent[0]?.source
    channel.emit({ v: 1, spaceId: SPACE, source: own, type: 'state', state: 'synced' })
    expect(autoSyncState.value).toBe('conflict')
    stopAutoSyncCoordinator()
  })

  it('广播内容带上版本与同步空间，便于接收方过滤', () => {
    giveLeaseToAnotherTab()
    startAutoSyncCoordinator()
    const channel = FakeChannel.last
    expect(channel.sent.length).toBeGreaterThan(0)
    for (const message of channel.sent) {
      expect(message.v).toBe(1)
      expect(message.spaceId).toBe(SPACE)
      expect(typeof message.source).toBe('string')
    }
    stopAutoSyncCoordinator()
  })

  it('没有 BroadcastChannel 时 syncNow 不再返回假成功', async () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    giveLeaseToAnotherTab()
    startAutoSyncCoordinator()
    expect(FakeChannel.last).toBeNull()

    // 本页不是 leader，又没有可用的跨标签页通道：请求发不出去，
    // 必须返回 false 并给出原因，而不是让按钮显示"已同步"。
    expect(await syncNow()).toBe(false)
    expect(autoSyncState.value).toBe('error')
    expect(autoSyncError.value).toContain('不允许跨标签页同步')
    stopAutoSyncCoordinator()
  })

  it('通道可用时，转发给 leader 的请求返回成功', async () => {
    giveLeaseToAnotherTab()
    startAutoSyncCoordinator()
    const channel = FakeChannel.last
    const before = channel.sent.length
    expect(await syncNow()).toBe(true)
    expect(channel.sent.length).toBe(before + 1)
    expect(channel.sent.at(-1).type).toBe('sync-now')
    stopAutoSyncCoordinator()
  })
})