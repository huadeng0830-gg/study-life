// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  code,
  connectCloud,
  connectionState,
  cloudExists,
  deriveSyncRelationship,
  lastError,
  localChanged,
  pullFromCloud,
  pushToCloud,
  refreshCloudMetadata,
  remoteRevision,
  recoverInterruptedSync,
  syncRecovery,
  SYNC_COMMIT_MARKER_KEY,
  LAST_KNOWN_GOOD_KEY,
  resolvePendingMerge,
  syncPreview,
} from '../src/composables/cloudSync.js'
import { encryptData } from '../src/utils/crypto.js'
import { buildSyncManifest, hashSyncValue, readSyncMetadata, saveSyncBaseline } from '../src/composables/syncMetadata.js'

describe('云同步长任务控制', () => {
  beforeEach(() => {
    localStorage.clear()
    code.value = ''
    remoteRevision.value = null
    cloudExists.value = false
    localChanged.value = false
    syncPreview.value = null
    syncRecovery.value = { status: 'idle', marker: null, message: '' }
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

  it('推送使用带实体 manifest 的新版加密 envelope', async () => {
    code.value = '123456'
    let requestBody
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      requestBody = JSON.parse(init.body)
      return { ok: true, json: async () => ({ exists: true, revision: 1, updatedAt: '2026-08-28T00:00:00.000Z' }) }
    }))
    expect(await pushToCloud()).toBe(true)
    const packageValue = await (await import('../src/utils/crypto.js')).decryptData(requestBody.data, code.value)
    expect(packageValue).toMatchObject({ format: 'study-life-sync', version: 3 })
    expect(packageValue.manifest).toHaveProperty('entities')
    expect(packageValue.manifest).toHaveProperty('tombstones')
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

  it('选择性拉取只应用勾选模块，未勾选模块本地值逐项保持不变', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    const courses = useStoredRef('sl_courses', [])
    tasks.value = [{ id: 'local-task', title: '本地待办' }]
    courses.value = [{ id: 'local-course', name: '本地课程' }]
    flushStoredWrites()

    code.value = '123456'
    const encrypted = await encryptData({
      sl_tasks: [{ id: 'remote-task', title: '云端待办' }],
      sl_courses: [{ id: 'remote-course', name: '云端课程' }],
    }, code.value)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 21, data: encrypted, updatedAt: '2026-08-29T00:00:00.000Z' }),
    })))

    expect(await pullFromCloud({ keys: ['sl_tasks'] })).toBe(true)

    expect(tasks.value).toEqual([{ id: 'remote-task', title: '云端待办' }])
    expect(courses.value).toEqual([{ id: 'local-course', name: '本地课程' }])
  })

  it('新版双改冲突只生成预览，不在用户决策前修改本地', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    const base = { id: 'same-task', title: '基线' }
    tasks.value = [{ ...base, title: '本机修改' }]
    flushStoredWrites()
    saveSyncBaseline({ sl_tasks: [base] }, { remoteRevision: 1, tombstones: [] })
    code.value = '123456'
    const values = { sl_tasks: [{ ...base, title: '云端修改' }] }
    const encrypted = await encryptData({ format: 'study-life-sync', version: 3, values, manifest: buildSyncManifest(values, { tombstones: [] }), meta: { id: 'remote-device', name: '另一台设备', pushedAt: '2026-09-02T00:00:00.000Z' } }, code.value)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 2, data: encrypted, updatedAt: '2026-09-02T00:00:00.000Z' }),
    })))

    expect(await pullFromCloud({ keys: ['sl_tasks'] })).toBe(false)
    expect(tasks.value).toEqual([{ ...base, title: '本机修改' }])
    expect(syncPreview.value.conflicts).toHaveLength(1)
    expect(await resolvePendingMerge({ 'sl_tasks:same-task': 'remote' })).toBe(true)
    expect(tasks.value).toEqual([{ ...base, title: '云端修改' }])
  })

  it('选择保留本机后把最终选择写入 Base，下一次同步不重复产生同一冲突', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    const base = { id: 'base-task', title: '基线' }
    const local = { ...base, title: '本机选择' }
    const remote = { ...base, title: '云端旧值' }
    tasks.value = [local]
    flushStoredWrites()
    saveSyncBaseline({ sl_tasks: [base] }, { remoteRevision: 1, tombstones: [] })
    code.value = '123456'
    const encrypted = await encryptData({
      format: 'study-life-sync', version: 3,
      values: { sl_tasks: [remote] },
      manifest: buildSyncManifest({ sl_tasks: [remote] }, { tombstones: [] }),
    }, code.value)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 2, data: encrypted }),
    })))

    expect(await pullFromCloud()).toBe(false)
    expect(await resolvePendingMerge({ 'sl_tasks:base-task': 'local' })).toBe(true)
    expect(readSyncMetadata().baseline.entities.sl_tasks['base-task'].hash).toBe(hashSyncValue(local))
  })

  it('纯拉取不会把本机误标为有未同步修改', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    const value = { id: 'clean-task', title: '云端任务' }
    tasks.value = [value]
    flushStoredWrites()
    saveSyncBaseline({ sl_tasks: [value] }, { remoteRevision: 1, tombstones: [] })
    localChanged.value = false
    code.value = '123456'
    const encrypted = await encryptData({
      format: 'study-life-sync', version: 3,
      values: { sl_tasks: [value] },
      manifest: buildSyncManifest({ sl_tasks: [value] }, { tombstones: [] }),
    }, code.value)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 2, data: encrypted }),
    })))

    expect(await pullFromCloud()).toBe(true)
    expect(localChanged.value).toBe(false)
  })

  it('提交成功后清除 marker 和 lastKnownGood', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    tasks.value = [{ id: 'marker-task', title: '本地任务' }]
    flushStoredWrites()
    localChanged.value = true
    code.value = '123456'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 1, updatedAt: '2026-09-02T00:00:00.000Z' }),
    })))

    expect(await pushToCloud()).toBe(true)
    expect(localStorage.getItem(SYNC_COMMIT_MARKER_KEY)).toBeNull()
    expect(localStorage.getItem(LAST_KNOWN_GOOD_KEY)).toBeNull()
  })

  it('启动发现未完成 commit 时恢复同步前快照，不自动拉取或推送', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    tasks.value = [{ id: 'recovery-task', title: '同步前' }]
    flushStoredWrites()
    localStorage.setItem(LAST_KNOWN_GOOD_KEY, JSON.stringify({
      version: 1,
      createdAt: '2026-09-02T00:00:00.000Z',
      values: { sl_tasks: [{ id: 'recovery-task', title: '同步前' }] },
      syncMetadata: { version: 1, hasBaseline: false, baseline: { entities: {}, singletons: {} }, tombstones: [] },
      syncHistoryRaw: null,
      localChangedAtRaw: null,
    }))
    localStorage.setItem(SYNC_COMMIT_MARKER_KEY, JSON.stringify({ version: 1, operationId: 'recovery-op', startedAt: '2026-09-02T00:00:00.000Z', phase: 'writing-metadata' }))
    tasks.value = [{ id: 'recovery-task', title: '半提交数据' }]
    expect((await recoverInterruptedSync()).ok).toBe(true)
    expect(tasks.value).toEqual([{ id: 'recovery-task', title: '同步前' }])
    expect(syncRecovery.value.status).toBe('recovered')
    expect(localStorage.getItem(SYNC_COMMIT_MARKER_KEY)).toBeNull()
    expect(localStorage.getItem(LAST_KNOWN_GOOD_KEY)).toBeNull()
  })

  it('恢复自身失败时保留 marker 和 lastKnownGood，并锁定同步', async () => {
    localStorage.setItem(LAST_KNOWN_GOOD_KEY, JSON.stringify({ version: 1, values: { sl_tasks: {} } }))
    localStorage.setItem(SYNC_COMMIT_MARKER_KEY, JSON.stringify({ version: 1, operationId: 'failed-recovery', startedAt: new Date().toISOString(), phase: 'writing-business' }))

    const result = await recoverInterruptedSync()
    expect(result.ok).toBe(false)
    expect(syncRecovery.value.status).toBe('recovery-required')
    expect(localStorage.getItem(SYNC_COMMIT_MARKER_KEY)).not.toBeNull()
    expect(localStorage.getItem(LAST_KNOWN_GOOD_KEY)).not.toBeNull()
  })

  it('首次完整拉取建立基线后保持干净状态', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    tasks.value = [{ id: 'initial-task', title: '云端初始任务' }]
    flushStoredWrites()
    localChanged.value = true
    code.value = '123456'
    const values = { sl_tasks: [{ id: 'initial-task', title: '云端初始任务' }] }
    const encrypted = await encryptData({
      format: 'study-life-sync', version: 3,
      values,
      manifest: buildSyncManifest(values, { tombstones: [] }),
    }, code.value)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 2, data: encrypted }),
    })))

    expect(await pullFromCloud()).toBe(true)
    expect(localChanged.value).toBe(false)
    expect(readSyncMetadata().hasBaseline).toBe(true)
  })

  it('恢复 Delete-Update 冲突后 Base 使用恢复实体且墓碑被解除', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    const base = { id: 'deleted-task', title: '基线任务' }
    const local = { ...base, title: '离线修改' }
    const tombstone = {
      entityType: 'Task', entityId: base.id, baseHash: hashSyncValue(base),
      deletedAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
    }
    tasks.value = [local]
    flushStoredWrites()
    saveSyncBaseline({ sl_tasks: [base] }, { remoteRevision: 1, tombstones: [] })
    code.value = '123456'
    const values = { sl_tasks: [] }
    const encrypted = await encryptData({
      format: 'study-life-sync', version: 3,
      values,
      manifest: buildSyncManifest(values, { tombstones: [tombstone] }),
    }, code.value)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 2, data: encrypted }),
    })))

    expect(await pullFromCloud()).toBe(false)
    expect(syncPreview.value.conflicts[0].status).toBe('delete-update-conflict')
    expect(await resolvePendingMerge({ 'sl_tasks:deleted-task': 'restore-local' })).toBe(true)
    expect(tasks.value).toEqual([local])
    expect(readSyncMetadata().baseline.entities.sl_tasks['deleted-task'].hash).toBe(hashSyncValue(local))
    expect(readSyncMetadata().tombstones).toEqual([])
  })

  it('未选择任何模块时直接成功返回且不发起网络请求', async () => {
    code.value = '123456'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await pullFromCloud({ keys: [] })).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('manifest 与 payload 不一致时取消拉取，不提交任何本地值', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store/cloudAccess.js')
    const tasks = useStoredRef('sl_tasks', [])
    const original = [{ id: 'manifest-task', title: '本机值' }]
    tasks.value = original
    flushStoredWrites()
    code.value = '123456'
    const remoteValues = { sl_tasks: [{ id: 'manifest-task', title: '云端值' }] }
    const staleManifest = buildSyncManifest({ sl_tasks: [{ id: 'manifest-task', title: '旧云端值' }] }, { tombstones: [] })
    const encrypted = await encryptData({ format: 'study-life-sync', version: 3, values: remoteValues, manifest: staleManifest }, code.value)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 2, data: encrypted }),
    })))

    expect(await pullFromCloud()).toBe(false)
    expect(tasks.value).toEqual(original)
    expect(lastError.value).toContain('manifest')
  })

  it('已建立干净基线后重复 Push 不产生新的 remote revision', async () => {
    code.value = '123456'
    cloudExists.value = true
    remoteRevision.value = 4
    localChanged.value = false
    localStorage.setItem('study_life_sync_history', JSON.stringify({ hasBase: true, baseRevision: 4, localDirty: false }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await pushToCloud()).toBe(true)
    expect(lastError.value).toContain('没有需要推送')
    expect(fetchMock).not.toHaveBeenCalled()
  })

})
