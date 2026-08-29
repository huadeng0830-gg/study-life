// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  code,
  connectCloud,
  connectionState,
  deriveSyncRelationship,
  localChanged,
  pullFromCloud,
  pushToCloud,
  refreshCloudMetadata,
  remoteRevision,
} from '../src/composables/cloudSync.js'
import { encryptData } from '../src/utils/crypto.js'

describe('云同步长任务控制', () => {
  beforeEach(() => {
    localStorage.clear()
    code.value = ''
    remoteRevision.value = null
    localChanged.value = false
    connectionState.value = 'disconnected'
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('连接请求取消时会真正中断 fetch 并恢复为未连接', async () => {
    const fetchMock = vi.fn((_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const pending = connectCloud('123456', { signal: controller.signal })
    controller.abort()
    const result = await pending
    expect(result).toMatchObject({ ok: false })
    expect(result.error).toContain('取消')
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    expect(connectionState.value).toBe('disconnected')
  })

  it('输入访问码只请求 verify metadata，不会拉取或推送业务数据', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ exists: true, revision: 3, updatedAt: '2026-08-28T00:00:00.000Z', updatedByDeviceName: '我的 iPad' }) }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await connectCloud('123456')).toMatchObject({ ok: true, revision: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/verify')
  })

  it('刷新云端状态只请求 metadata，不触碰业务数据', async () => {
    code.value = '123456'
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 9, updatedAt: '2026-08-28T01:00:00.000Z' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshCloudMetadata()).resolves.toMatchObject({ ok: true, revision: 9 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/verify')
  })

  it('拉取空云端时只报告真实发生的请求阶段', async () => {
    code.value = '123456'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: null, updatedAt: null }),
    })))
    const events = []
    expect(await pullFromCloud({ onProgress: (event) => events.push(event) })).toBe(true)
    expect(events.map((event) => event.step)).toEqual(['request'])
  })

  it('推送按收集、加密、上传、确认的真实阶段上报', async () => {
    code.value = '123456'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: false, revision: null, updatedAt: '2026-08-28T00:00:00.000Z' }),
    })))
    const events = []
    expect(await pushToCloud({ onProgress: (event) => events.push(event) })).toBe(true)
    expect(events.map((event) => event.step)).toEqual(['collect', 'check', 'encrypt', 'upload', 'confirm'])
  })

  it('以 revision 和本地 dirty 状态判断四种同步关系，不比较时间', () => {
    const base = { exists: true, revision: 17 }
    expect(deriveSyncRelationship(base, { hasBase: true, baseRevision: 17, localDirty: false })).toBe('synced')
    expect(deriveSyncRelationship(base, { hasBase: true, baseRevision: 17, localDirty: true })).toBe('local-changes')
    expect(deriveSyncRelationship({ ...base, revision: 18 }, { hasBase: true, baseRevision: 17, localDirty: false })).toBe('cloud-updated')
    expect(deriveSyncRelationship({ ...base, revision: 18 }, { hasBase: true, baseRevision: 17, localDirty: true })).toBe('both-changed')
  })

  it('推送由服务端原子校验 revision，冲突时停止且刷新云端状态', async () => {
    code.value = '123456'
    remoteRevision.value = 7
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ conflict: true, error: '云端刚刚发生了变化', exists: true, revision: 8, updatedAt: '2026-08-28T00:00:00.000Z', updatedByDeviceName: '我的 iPad' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await pushToCloud()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sync/push')
    expect(remoteRevision.value).toBe(8)
  })

  it('拉取后立刻编辑同一模块仍会标记为本机修改', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    flushStoredWrites()
    localChanged.value = false
    code.value = '123456'
    const encrypted = await encryptData({ sl_tasks: [{ id: 'remote', title: '云端任务' }] }, code.value)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 12, data: encrypted, updatedAt: '2026-08-28T02:00:00.000Z' }),
    })))

    expect(await pullFromCloud()).toBe(true)
    const tasks = useStoredRef('sl_tasks', [])
    tasks.value.push({ id: 'local', title: '刚刚新增' })
    flushStoredWrites()

    expect(localChanged.value).toBe(true)
  })

})
