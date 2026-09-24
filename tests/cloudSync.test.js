// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  code,
  connectCloud,
  connectSyncSpace,
  connectionState,
  cloudExists,
  deriveSyncRelationship,
  disconnectCloud,
  isSyncing,
  lastError,
  lastCheckedAt,
  lastSyncedAt,
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
  syncUndoStorageKey,
} from '../src/composables/cloudSync.js'
import { encryptData } from '../src/utils/crypto.js'
import { SYNC_DEFAULTS, SYNC_KEYS } from '../src/composables/cloudSyncData.js'
import { buildSyncManifest, hashSyncValue, readSyncMetadata, saveSyncBaseline } from '../src/composables/syncMetadata.js'
import { clearSyncSpaceSettings, randomSecret, saveSyncSpaceSettings, syncSpaceSettings } from '../src/composables/syncSpace.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

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
    lastCheckedAt.value = null
    lastSyncedAt.value = null
    clearSyncSpaceSettings()
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

  it('把最后检查与最近同步分开记录，刷新 metadata 不冒充一次业务同步', async () => {
    code.value = '123456'
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 9, updatedAt: '2026-08-28T01:00:00.000Z' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await refreshCloudMetadata()
    expect(lastCheckedAt.value).toEqual(expect.any(String))
    expect(lastSyncedAt.value).toBeNull()
  })

  it('撤销快照按同步空间命名，切换空间不会读取另一空间的恢复点', () => {
    const spaceA = 'AB7K-P9M2-X4DQ'
    const spaceB = 'CDE4-FGH5-JK67'
    saveSyncSpaceSettings({ spaceId: spaceA, deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: false })
    const keyA = syncUndoStorageKey()
    localStorage.setItem(keyA, JSON.stringify({ version: 1, createdAt: '2026-09-01T00:00:00.000Z', values: {} }))

    saveSyncSpaceSettings({ spaceId: spaceB, deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: false })
    expect(syncUndoStorageKey()).not.toBe(keyA)
    expect(localStorage.getItem(keyA)).not.toBeNull()
  })

  it('revision check 与另一个同步入口共享 single-flight，不会并发发起两个请求', async () => {
    code.value = '123456'
    const resolvers = []
    const fetchMock = vi.fn(() => new Promise((resolve) => { resolvers.push(resolve) }))
    vi.stubGlobal('fetch', fetchMock)

    const first = refreshCloudMetadata()
    await Promise.resolve()
    const second = refreshCloudMetadata()
    await Promise.resolve()
    resolvers.forEach((resolve) => resolve({ ok: true, json: async () => ({ exists: true, revision: 1 }) }))
    await expect(first).resolves.toMatchObject({ ok: true, revision: 1 })
    await expect(second).resolves.toMatchObject({ ok: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recovery-required 时手动 revision check 也被锁定，不触发网络同步', async () => {
    code.value = '123456'
    syncRecovery.value = { status: 'recovery-required', marker: { operationId: 'recovery-lock' }, message: '请先恢复本机数据' }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshCloudMetadata()).resolves.toMatchObject({ ok: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('recovery-required 时手动拉取不会遗留同步互斥锁', async () => {
    code.value = '123456'
    syncRecovery.value = { status: 'recovery-required', marker: { operationId: 'recovery-lock' }, message: '请先恢复本机数据' }

    expect(await pullFromCloud()).toBe(false)
    expect(isSyncing.value).toBe(false)
    syncRecovery.value = { status: 'idle', marker: null, message: '' }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ exists: false, revision: null }) })))
    expect(await refreshCloudMetadata()).toMatchObject({ ok: true })
  })

  it('重连验证占用同一同步 guard，期间手动 revision 不会并发发请求', async () => {
    const settings = { spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: false }
    saveSyncSpaceSettings(settings)
    let release
    const fetchMock = vi.fn(() => new Promise((resolve) => { release = resolve }))
    vi.stubGlobal('fetch', fetchMock)

    const reconnect = connectSyncSpace({ ...settings, persist: false })
    await Promise.resolve()
    expect(await refreshCloudMetadata()).toMatchObject({ ok: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release({ ok: true, json: async () => ({ ok: true, spaceId: settings.spaceId, exists: false, revision: null }) })
    expect(await reconnect).toMatchObject({ ok: true })
  })

  it('空间切换后迟到的旧空间响应不会提交到新空间', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    tasks.value = [{ id: 'space-b-task', title: 'B 的任务' }]
    flushStoredWrites()
    const spaceAKey = randomSecret()
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: spaceAKey, autoSyncEnabled: false })
    connectionState.value = 'connected'
    const values = { sl_tasks: [{ id: 'space-a-task', title: 'A 的任务' }] }
    const encrypted = await encryptData({
      format: 'study-life-sync', version: 3, values,
      manifest: buildSyncManifest(values, { tombstones: [] }),
    }, spaceAKey)
    let resolveRequest
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveRequest = resolve })))

    const pending = pullFromCloud()
    await Promise.resolve()
    const spaceBKey = randomSecret()
    const oldSpaceId = syncSpaceSettings.value.spaceId
    disconnectCloud()
    saveSyncSpaceSettings({ spaceId: 'CDE4-FGH5-JK67', deviceCredential: randomSecret(), payloadKey: spaceBKey, autoSyncEnabled: false })
    connectionState.value = 'connected'
    resolveRequest({ ok: true, json: async () => ({ exists: true, revision: 2, data: encrypted }) })

    expect(await pending).toBe(false)
    expect(syncSpaceSettings.value.spaceId).not.toBe(oldSpaceId)
    expect(tasks.value).toEqual([{ id: 'space-b-task', title: 'B 的任务' }])
    disconnectCloud()
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
    const { flushStoredWrites } = await import('../src/composables/store')
    flushStoredWrites()
    localChanged.value = false
    code.value = '123456'
    const encrypted = await encryptData({ sl_tasks: [{ id: 'remote', title: '云端任务' }] }, code.value)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 12, data: encrypted, updatedAt: '2026-08-28T02:00:00.000Z' }),
    })))

    expect(await pullFromCloud()).toBe(true)
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    useDomainCommands().createTask({ id: 'local', title: '刚刚新增' })
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

  it('选择性拉取只合并所选模块的墓碑，后续全量推送不会传播未选模块删除', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    const courses = useStoredRef('sl_courses', [])
    const course = { id: 'local-course-tombstone', name: '本地课程', updatedAt: '2026-08-01T00:00:00.000Z' }
    tasks.value = [{ id: 'local-task', title: '本地待办', updatedAt: '2026-08-01T00:00:00.000Z' }]
    courses.value = [course]
    flushStoredWrites()
    saveSyncBaseline({ sl_tasks: tasks.value, sl_courses: courses.value }, { remoteRevision: 1, tombstones: [] })
    code.value = '123456'

    const remoteValues = {
      sl_tasks: [{ id: 'remote-task', title: '云端待办', updatedAt: '2026-09-01T00:00:00.000Z' }],
      sl_courses: [],
    }
    const courseTombstone = {
      tombstoneId: 'remote-course-delete-1', entityType: 'Course', entityId: course.id,
      baseHash: hashSyncValue(course), deletedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    }
    const encrypted = await encryptData({
      format: 'study-life-sync', version: 3, values: remoteValues,
      manifest: buildSyncManifest(remoteValues, { tombstones: [courseTombstone] }),
    }, code.value)
    let pushBody
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (url.endsWith('/pull')) return { ok: true, json: async () => ({ exists: true, revision: 2, data: encrypted }) }
      pushBody = JSON.parse(init.body)
      return { ok: true, json: async () => ({ exists: true, revision: 3, updatedAt: '2026-09-02T00:00:00.000Z' }) }
    }))

    expect(await pullFromCloud({ keys: ['sl_tasks'] })).toBe(true)
    expect(courses.value).toEqual([course])
    expect(readSyncMetadata().tombstones).toEqual([])

    localChanged.value = true
    expect(await pushToCloud()).toBe(true)
    expect(readSyncMetadata().tombstones).toEqual([])
    if (pushBody) {
      const pushed = await (await import('../src/utils/crypto.js')).decryptData(pushBody.data, code.value)
      expect(pushed.manifest.tombstones).toEqual([])
    }
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
    expect(await resolvePendingMerge({})).toBe(false)
    expect(lastError.value).toContain('仍有 1 个冲突')
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

  it('未知同步 envelope version fail closed，不更新本地 Base 或已知 revision', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store/cloudAccess.js')
    const tasks = useStoredRef('sl_tasks', [])
    tasks.value = [{ id: 'unknown-version-task', title: '本机值' }]
    flushStoredWrites()
    code.value = '123456'
    const encrypted = await encryptData({
      format: 'study-life-sync', version: 999,
      values: { sl_tasks: [{ id: 'remote', title: '未知版本' }] },
    }, code.value)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 99, data: encrypted }),
    })))

    expect(await pullFromCloud()).toBe(false)
    expect(lastError.value).toContain('版本')
    expect(tasks.value).toEqual([{ id: 'unknown-version-task', title: '本机值' }])
    expect(readSyncMetadata().hasBaseline).toBe(false)
    expect(remoteRevision.value).toBeNull()
  })

  it('无 format 的未知对象不降级为 Legacy，且不更新本地同步元数据', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store/cloudAccess.js')
    const tasks = useStoredRef('sl_tasks', [])
    const before = [{ id: 'legacy-shape-task', title: '本机值' }]
    tasks.value = before
    flushStoredWrites()
    code.value = '123456'
    const encrypted = await encryptData({ wrapper: { sl_tasks: [{ id: 'remote' }] } }, code.value)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ exists: true, revision: 88, data: encrypted }),
    })))

    expect(await pullFromCloud()).toBe(false)
    expect(tasks.value).toEqual(before)
    expect(readSyncMetadata().hasBaseline).toBe(false)
    expect(remoteRevision.value).toBeNull()
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

  it('当前 sync payload 与 Base 相同，即使 dirty 被误标也不发起 Push', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    const value = [{ id: 'same-as-base', title: '基线任务' }]
    tasks.value = value
    flushStoredWrites()
    const states = Object.fromEntries(SYNC_KEYS.map((key) => [key, useStoredRef(key, SYNC_DEFAULTS[key])]))
    saveSyncBaseline({ ...Object.fromEntries(SYNC_KEYS.map((key) => [key, states[key].value])), sl_tasks: value }, { remoteRevision: 4, tombstones: [] })
    code.value = '123456'
    cloudExists.value = true
    remoteRevision.value = 4
    localChanged.value = true
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await pushToCloud()).toBe(true)
    expect(lastError.value).toContain('没有需要推送')
    expect(localChanged.value).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

})
