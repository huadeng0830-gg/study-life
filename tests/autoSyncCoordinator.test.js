// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_SYNC_BACKOFF_MS, AUTO_SYNC_DEBOUNCE_MS, EVENT_COALESCE_MS, MAX_CAS_RETRIES, autoSyncState, computeRetryDelay, shouldRetrySyncError, startAutoSyncCoordinator, stopAutoSyncCoordinator, syncNow } from '../src/composables/autoSyncCoordinator.js'
import { clearSyncError, connectionState, disconnectCloud, lastError, localChanged, remoteRevision, cloudExists, syncErrorKind, syncRecovery, syncStorageKey, syncStatus } from '../src/composables/cloudSync.js'
import { autoSyncEnabled, clearSyncSpaceSettings, randomSecret, saveSyncSpaceSettings, syncSpaceSettings } from '../src/composables/syncSpace.js'

describe('AutoSyncCoordinator 生命周期与调度', () => {
  beforeEach(async () => {
    stopAutoSyncCoordinator()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    localStorage.clear()
    localStorage.removeItem('study_life_auto_sync_leader')
    clearSyncSpaceSettings()
    localChanged.value = false
    remoteRevision.value = null
    cloudExists.value = false
    syncRecovery.value = { status: 'idle', marker: null, message: '' }
    clearSyncError()
    syncStatus.value = 'idle'
    autoSyncState.value = 'disabled'
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('使用 4 秒 debounce，把连续 dirty 合并为一次 revision check + 一次 push', async () => {
    vi.useFakeTimers()
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: true })
    localChanged.value = true
    const fetchMock = vi.fn(async (url) => {
      if (url.endsWith('/revision')) return { ok: true, json: async () => ({ exists: false, revision: null, spaceId: 'AB7K-P9M2-X4DQ' }) }
      return { ok: true, json: async () => ({ ok: true, exists: true, revision: 1, updatedAt: new Date().toISOString() }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    startAutoSyncCoordinator()
    window.dispatchEvent(new CustomEvent('study-life:sync-dirty'))
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_DEBOUNCE_MS - 1)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(autoSyncState.value).toBe('synced')
    stopAutoSyncCoordinator()
    vi.useRealTimers()
  })

  it('后台停止轮询，回到前台立即检查；重试间隔使用受控退避', async () => {
    expect(AUTO_SYNC_BACKOFF_MS).toEqual([5000, 15000, 30000, 60000, 300000])
    expect(AUTO_SYNC_DEBOUNCE_MS).toBe(4000)
    vi.useFakeTimers()
    const previousHidden = document.hidden
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: true })
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ exists: false, revision: null }) }))
    vi.stubGlobal('fetch', fetchMock)
    startAutoSyncCoordinator()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock).not.toHaveBeenCalled()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(EVENT_COALESCE_MS)
    expect(fetchMock).toHaveBeenCalled()
    stopAutoSyncCoordinator()
    Object.defineProperty(document, 'hidden', { configurable: true, value: previousHidden })
    vi.useRealTimers()
  })

  it('401/403 授权类错误不进入自动 retry，暂时性错误仍可退避', () => {
    expect(shouldRetrySyncError('credential-invalid')).toBe(false)
    expect(shouldRetrySyncError('permission-denied')).toBe(false)
    expect(shouldRetrySyncError('invalid-request')).toBe(false)
    expect(shouldRetrySyncError('payload-too-large')).toBe(false)
    expect(shouldRetrySyncError('version-mismatch')).toBe(false)
    expect(shouldRetrySyncError('rate-limited')).toBe(true)
    expect(shouldRetrySyncError('error')).toBe(true)
  })

  it('自动同步关闭且本机有修改时，立即同步仍执行完整检查与推送并保持关闭', async () => {
    const spaceId = 'AB7K-P9M2-X4DQ'
    saveSyncSpaceSettings({ spaceId, deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: false })
    connectionState.value = 'connected'
    localStorage.setItem(syncStorageKey('study_life_sync_history', spaceId), JSON.stringify({ hasBase: true, baseRevision: 1, localDirty: true }))
    localChanged.value = true
    const fetchMock = vi.fn(async (url) => url.endsWith('/revision')
      ? { ok: true, json: async () => ({ exists: true, revision: 1, spaceId }) }
      : { ok: true, json: async () => ({ ok: true, exists: true, revision: 2, updatedAt: new Date().toISOString(), spaceId }) })
    vi.stubGlobal('fetch', fetchMock)

    expect(await syncNow()).toBe(true)
    expect(autoSyncEnabled.value).toBe(false)
    expect(localChanged.value).toBe(false)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/sync/space/revision', '/api/sync/push'])
    stopAutoSyncCoordinator()
  })

  it('Retry-After 优先于客户端退避，并只叠加小幅 jitter', () => {
    expect(computeRetryDelay(0, { retryAfterMs: 7000, random: () => 0 })).toBe(7000)
    expect(computeRetryDelay(0, { retryAfterMs: 7000, random: () => 0.99 })).toBeLessThanOrEqual(7700)
    expect(computeRetryDelay(0, { retryAfterMs: -1, random: () => 0 })).toBe(5000)
  })

  it('单个自动同步 transaction 的 CAS retry 有明确上限', () => {
    expect(MAX_CAS_RETRIES).toBe(2)
  })

  it('反复 stop/rebind 十次不会留下重复的同步监听器', () => {
    const addWindow = vi.spyOn(window, 'addEventListener')
    const removeWindow = vi.spyOn(window, 'removeEventListener')
    const addDocument = vi.spyOn(document, 'addEventListener')
    const removeDocument = vi.spyOn(document, 'removeEventListener')
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: false })

    for (let index = 0; index < 10; index++) {
      startAutoSyncCoordinator()
      stopAutoSyncCoordinator()
    }

    expect(addWindow.mock.calls.filter(([type]) => ['study-life:sync-dirty', 'online', 'offline', 'focus', 'pageshow', 'storage'].includes(type))).toHaveLength(60)
    expect(removeWindow.mock.calls.filter(([type]) => ['study-life:sync-dirty', 'online', 'offline', 'focus', 'pageshow', 'storage'].includes(type))).toHaveLength(60)
    expect(addDocument.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(10)
    expect(removeDocument.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(10)
  })

  it('领导租约包含 owner、lease、fencing 与过期时间，并可安全释放', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ exists: false, revision: null }) })))
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: true })
    startAutoSyncCoordinator()
    const lease = JSON.parse(localStorage.getItem('study_life_auto_sync_leader'))
    expect(lease).toEqual(expect.objectContaining({
      ownerId: expect.any(String),
      leaseId: expect.any(String),
      fencingToken: expect.any(Number),
      expiresAt: expect.any(Number),
    }))
    stopAutoSyncCoordinator()
    expect(localStorage.getItem('study_life_auto_sync_leader')).toBeNull()
  })

  it('模拟 24 小时自动同步只按 60 秒轮询，停止后不再增长且无残留 timer', async () => {
    vi.useFakeTimers()
    // 让上一条被取消的异步 cycle 完成其 finally；不能让它与本测试的
    // 新 coordinator 共享同一条微任务链。
    await Promise.resolve()
    await Promise.resolve()
    disconnectCloud()
    const previousHidden = document.hidden
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    const spaceId = 'AB7K-P9M2-X4DQ'
    saveSyncSpaceSettings({ spaceId, deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: true })
    localStorage.setItem(`study_life_sync_history:${spaceId}`, JSON.stringify({ hasBase: true, baseRevision: 1, localDirty: false }))
    remoteRevision.value = 1
    cloudExists.value = true
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ exists: true, revision: 1, spaceId }) }))
    vi.stubGlobal('fetch', fetchMock)

    startAutoSyncCoordinator()
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)

    const revisionCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/revision')).length
    expect(revisionCalls).toBeGreaterThan(0)
    expect(revisionCalls).toBeLessThanOrEqual(24 * 60 + 2)
    expect(autoSyncState.value).toBe('synced')
    stopAutoSyncCoordinator()
    const callsAfterStop = fetchMock.mock.calls.length
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterStop)
    Object.defineProperty(document, 'hidden', { configurable: true, value: previousHidden })
    vi.useRealTimers()
  })
})
