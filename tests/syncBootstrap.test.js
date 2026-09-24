// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  code,
  connectionState,
  cancelSyncSpaceBootstrap,
  claimPairingCode,
  createSyncSpace,
  joinSyncSpaceWithRecovery,
  localChanged,
  pullFromCloud,
  pushToCloud,
  recalibrateSyncSpace,
  syncCalibrationRequired,
  syncPreview,
  syncRecovery,
} from '../src/composables/cloudSync.js'
import { flushStoredWrites, useStoredRef } from '../src/composables/store/index.js'
import { buildSyncManifest, readSyncMetadata, saveSyncBaseline } from '../src/composables/syncMetadata.js'
import { encryptData } from '../src/utils/crypto.js'
import { SYNC_DEFAULTS, hasMeaningfulLocalData } from '../src/composables/cloudSyncData.js'
import {
  clearSyncSpaceSettings,
  isSyncSpaceBound,
  pairingPayload,
  randomSecret,
  saveSyncSpaceSettings,
  syncSpaceBootstrapPending,
  syncSpaceSettings,
} from '../src/composables/syncSpace.js'
import { autoSyncState, startAutoSyncCoordinator, stopAutoSyncCoordinator } from '../src/composables/autoSyncCoordinator.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

describe('SyncSpace bootstrap', () => {
  beforeEach(() => {
    stopAutoSyncCoordinator()
    localStorage.clear()
    clearSyncSpaceSettings()
    code.value = ''
    connectionState.value = 'disconnected'
    localChanged.value = false
    syncPreview.value = null
    syncRecovery.value = { status: 'idle', marker: null, message: '' }
    syncSpaceSettings.value = null
    const tasks = useStoredRef('sl_tasks', [])
    tasks.value = []
    flushStoredWrites()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('加入已有空间先进入 bootstrap pending，不把本机数据写成 Base', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    tasks.value = [{ id: 'local-task', title: '本机待办', updatedAt: '2026-09-05T00:00:00.000Z' }]
    flushStoredWrites()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: true, revision: 4, updatedAt: '2026-09-05T00:00:00.000Z' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await joinSyncSpaceWithRecovery({
      spaceId: 'AB7K-P9M2-X4DQ',
      recoverySecret: randomSecret(),
    })

    expect(result.ok).toBe(true)
    expect(isSyncSpaceBound.value).toBe(true)
    expect(syncSpaceBootstrapPending.value).toBe(true)
    expect(readSyncMetadata().hasBaseline).toBe(false)
    expect(tasks.value).toEqual([{ id: 'local-task', title: '本机待办', updatedAt: '2026-09-05T00:00:00.000Z' }])
  })

  it('远端确认前的初始上传失败，不应留下可被后续拉取信任的 Base', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    const phoneTask = { id: 'phone-new', title: '手机刚创建', updatedAt: '2026-09-05T00:00:00.000Z' }
    tasks.value = [phoneTask]
    flushStoredWrites()
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('/space/create')) return {
        ok: true,
        json: async () => ({ ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: false, revision: null }),
      }
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: '模拟远端不可用' }),
      }
    }))

    expect((await createSyncSpace()).ok).toBe(false)
    expect(readSyncMetadata().hasBaseline).toBe(false)
    expect(tasks.value).toEqual([phoneTask])
  })

  it('本机和云端都有修改时先生成初始协调冲突，不提交也不建立 Base', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    const localTask = { id: 'same-task', title: '本机版本', updatedAt: '2026-09-05T00:00:00.000Z' }
    const remoteTask = { id: 'same-task', title: '云端版本', updatedAt: '2026-09-05T00:00:00.000Z' }
    tasks.value = [localTask]
    flushStoredWrites()
    const secret = randomSecret()
    const encrypted = await encryptData({
      format: 'study-life-sync',
      version: 3,
      values: { sl_tasks: [remoteTask] },
      manifest: buildSyncManifest({ sl_tasks: [remoteTask] }, { tombstones: [] }),
    }, secret)
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith('/recover')
        ? { ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: true, revision: 4 }
        : { ok: true, exists: true, revision: 4, data: encrypted },
    })))

    expect((await joinSyncSpaceWithRecovery({ spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: secret })).ok).toBe(true)
    expect(await pullFromCloud({ previewOnly: true })).toBe(false)
    expect(syncPreview.value.conflicts).toHaveLength(1)
    expect(tasks.value).toEqual([localTask])
    expect(readSyncMetadata().hasBaseline).toBe(false)
    expect(syncSpaceBootstrapPending.value).toBe(true)
  })

  it('本机非空且云端为空时只能由明确确认初始化云端', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    const localTask = { id: 'local-task', title: '本机待办', updatedAt: '2026-09-05T00:00:00.000Z' }
    tasks.value = [localTask]
    flushStoredWrites()
    const secret = randomSecret()
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith('/recover')
        ? { ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: false, revision: null }
        : { ok: true, exists: true, revision: 1, updatedAt: '2026-09-05T00:00:00.000Z' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await joinSyncSpaceWithRecovery({ spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: secret })
    expect(syncSpaceBootstrapPending.value).toBe(true)
    expect(await pushToCloud()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await pushToCloud({ bootstrapConfirm: true })).toBe(true)
    expect(syncSpaceBootstrapPending.value).toBe(false)
    expect(readSyncMetadata().hasBaseline).toBe(true)
    expect(tasks.value).toEqual([localTask])
  })

  it('本机为空且云端非空时确认拉取后才建立 Base', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    tasks.value = []
    flushStoredWrites()
    const secret = randomSecret()
    const remoteTask = { id: 'remote-task', title: '云端待办', updatedAt: '2026-09-05T00:00:00.000Z' }
    const encrypted = await encryptData({
      format: 'study-life-sync',
      version: 3,
      values: { sl_tasks: [remoteTask] },
      manifest: buildSyncManifest({ sl_tasks: [remoteTask] }, { tombstones: [] }),
    }, secret)
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith('/recover')
        ? { ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: true, revision: 2 }
        : { ok: true, exists: true, revision: 2, data: encrypted },
    })))

    await joinSyncSpaceWithRecovery({ spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: secret })
    expect(await pullFromCloud({ previewOnly: true })).toBe(true)
    expect(tasks.value).toEqual([])
    expect(readSyncMetadata().hasBaseline).toBe(false)
    expect(await pullFromCloud()).toBe(false)
    expect(tasks.value).toEqual([])
    expect(await pullFromCloud({ bootstrapConfirm: true })).toBe(true)
    expect(tasks.value).toEqual([remoteTask])
    expect(readSyncMetadata().hasBaseline).toBe(true)
    expect(syncSpaceBootstrapPending.value).toBe(false)
  })

  it('本机空数据与云端空数据确认后建立空 Base', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    tasks.value = []
    flushStoredWrites()
    const secret = randomSecret()
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith('/recover')
        ? { ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: false, revision: null }
        : { ok: true, exists: true, revision: 1 },
    })))

    await joinSyncSpaceWithRecovery({ spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: secret })
    expect(await pushToCloud({ bootstrapConfirm: true })).toBe(true)
    expect(readSyncMetadata().hasBaseline).toBe(true)
    expect(syncSpaceBootstrapPending.value).toBe(false)
  })

  it('singleton-only 本机数据也保持 bootstrap pending', async () => {
    const theme = useStoredRef('sl_theme', 'blue')
    theme.value = 'green'
    flushStoredWrites()
    const secret = randomSecret()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: true, revision: 1 }),
    })))

    await joinSyncSpaceWithRecovery({ spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: secret })
    expect(syncSpaceBootstrapPending.value).toBe(true)
    expect(readSyncMetadata().hasBaseline).toBe(false)
  })

  it('hasMeaningfulLocalData 覆盖全部同步键，并识别数组、对象和 singleton 的真实修改', () => {
    const defaults = JSON.parse(JSON.stringify(SYNC_DEFAULTS))
    expect(hasMeaningfulLocalData(defaults)).toBe(false)
    expect(hasMeaningfulLocalData({ ...defaults, sl_tasks: [{ id: 'phone-task', title: '手机记录' }] })).toBe(true)
    expect(hasMeaningfulLocalData({ ...defaults, sl_timecfg: { campuses: [{ id: 'custom', name: '自定义校区' }] } })).toBe(true)
    expect(hasMeaningfulLocalData({ ...defaults, sl_theme: 'green' })).toBe(true)
  })

  it('识别旧错误 Base 后只提供手动重新校准，不猜测并覆盖本机数据', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    const localTask = { id: 'local-survivor', title: '手机数据', updatedAt: '2026-09-05T00:00:00.000Z' }
    tasks.value = [localTask]
    flushStoredWrites()
    const secret = randomSecret()
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: secret, autoSyncEnabled: false })
    saveSyncBaseline({ sl_tasks: [localTask] }, { remoteRevision: null, tombstones: [] })
    connectionState.value = 'connected'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, exists: true, revision: 8, updatedAt: '2026-09-05T00:00:00.000Z' }),
    })))

    expect(syncCalibrationRequired.value).toBe(true)
    expect(await recalibrateSyncSpace()).toMatchObject({ ok: true, revision: 8 })
    expect(syncSpaceBootstrapPending.value).toBe(true)
    expect(readSyncMetadata().hasBaseline).toBe(false)
    expect(tasks.value).toEqual([localTask])
  })

  it('配对加入使用相同的 bootstrap pending 保护', async () => {
    const token = randomSecret()
    const secret = randomSecret()
    const wrappedPayloadKey = await encryptData({ payloadKey: secret }, token)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: false, revision: null, wrappedPayloadKey }),
    })))

    const result = await claimPairingCode(pairingPayload({ spaceId: 'AB7K-P9M2-X4DQ', pairingToken: token, expiresAt: new Date(Date.now() + 60_000).toISOString() }))
    expect(result.ok).toBe(true)
    expect(syncSpaceBootstrapPending.value).toBe(true)
    expect(readSyncMetadata().hasBaseline).toBe(false)
  })

  it('配对路径本机非空且云端为空时，只能明确选择使用本机初始化云端', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    const localTask = { id: 'pair-local', title: '手机待办', updatedAt: '2026-09-05T01:00:00.000Z' }
    tasks.value = [localTask]
    flushStoredWrites()
    const token = randomSecret()
    const secret = randomSecret()
    const wrappedPayloadKey = await encryptData({ payloadKey: secret }, token)
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith('/pair/claim')
        ? { ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: false, revision: null, wrappedPayloadKey }
        : { ok: true, exists: true, revision: 1, updatedAt: '2026-09-05T01:00:00.000Z' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    expect((await claimPairingCode(pairingPayload({ spaceId: 'AB7K-P9M2-X4DQ', pairingToken: token, expiresAt: new Date(Date.now() + 60_000).toISOString() }))).ok).toBe(true)
    expect(await pushToCloud()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await pushToCloud({ bootstrapConfirm: true })).toBe(true)
    expect(tasks.value).toEqual([localTask])
    expect(readSyncMetadata().hasBaseline).toBe(true)
    expect(readSyncMetadata().baseRemoteRevision).toBe(1)
    expect(syncSpaceBootstrapPending.value).toBe(false)
  })

  it('phone-new-data-overwritten-by-old-pc-remote：配对初始协调保留手机新记录与电脑旧记录', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    const phoneTask = { id: 'phone-new', title: '手机新记录', updatedAt: '2026-09-05T02:00:00.000Z' }
    const pcTask = { id: 'pc-old', title: '电脑旧记录', updatedAt: '2026-09-01T02:00:00.000Z' }
    tasks.value = [phoneTask]
    flushStoredWrites()
    const secret = randomSecret()
    const token = randomSecret()
    const wrappedPayloadKey = await encryptData({ payloadKey: secret }, token)
    const remoteValues = { sl_tasks: [pcTask] }
    const encryptedRemote = await encryptData({
      format: 'study-life-sync',
      version: 3,
      values: remoteValues,
      manifest: buildSyncManifest(remoteValues, { tombstones: [] }),
      meta: { id: 'pc', name: '电脑', pushedAt: '2026-09-01T02:00:00.000Z' },
    }, secret)
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith('/pair/claim')
        ? { ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: true, revision: 7, wrappedPayloadKey }
        : { ok: true, exists: true, revision: 7, data: encryptedRemote },
    })))

    const claimed = await claimPairingCode(pairingPayload({ spaceId: 'AB7K-P9M2-X4DQ', pairingToken: token, expiresAt: new Date(Date.now() + 60_000).toISOString() }))
    expect(claimed.ok).toBe(true)
    expect(syncSpaceBootstrapPending.value).toBe(true)
    expect(await pullFromCloud({ previewOnly: true })).toBe(true)
    expect(tasks.value).toEqual([phoneTask])
    expect(syncPreview.value.summary.added).toBe(1)
    expect(await pullFromCloud({ bootstrapConfirm: true })).toBe(true)
    expect(tasks.value).toEqual([phoneTask, pcTask])
    expect(readSyncMetadata().hasBaseline).toBe(true)
    expect(readSyncMetadata().baseRemoteRevision).toBe(7)
    expect(syncSpaceBootstrapPending.value).toBe(false)
  })

  it('无可信 Base 时 singleton 修改必须进入冲突预览，不能静默接受云端旧值', async () => {
    const theme = useStoredRef('sl_theme', 'blue')
    theme.value = 'green'
    flushStoredWrites()
    const secret = randomSecret()
    const encrypted = await encryptData({
      format: 'study-life-sync', version: 3,
      values: { sl_theme: 'blue' },
      manifest: buildSyncManifest({ sl_theme: 'blue' }, { tombstones: [] }),
    }, secret)
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith('/recover')
        ? { ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: true, revision: 2 }
        : { ok: true, exists: true, revision: 2, data: encrypted },
    })))

    await joinSyncSpaceWithRecovery({ spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: secret })
    expect(await pullFromCloud({ previewOnly: true })).toBe(false)
    expect(syncPreview.value.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'sl_theme', status: 'conflict' })]))
    expect(theme.value).toBe('green')
    expect(readSyncMetadata().hasBaseline).toBe(false)
  })

  it('Bootstrap 遇到旧版无 manifest 包时仍执行初始协调，不使用 remote-wins 兼容分支', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    const localTask = { id: 'same-task', title: '手机版本', updatedAt: '2026-09-05T04:00:00.000Z' }
    const remoteTask = { id: 'same-task', title: '电脑版本', updatedAt: '2026-09-01T04:00:00.000Z' }
    tasks.value = [localTask]
    flushStoredWrites()
    const secret = randomSecret()
    const encrypted = await encryptData({ sl_tasks: [remoteTask] }, secret)
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith('/recover')
        ? { ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: true, revision: 4 }
        : { ok: true, exists: true, revision: 4, data: encrypted },
    })))

    await joinSyncSpaceWithRecovery({ spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: secret })
    expect(await pullFromCloud({ previewOnly: true })).toBe(false)
    expect(syncPreview.value.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'sl_tasks', entityId: 'same-task', status: 'conflict' })]))
    expect(tasks.value).toEqual([localTask])
    expect(readSyncMetadata().hasBaseline).toBe(false)
  })

  it('远端缺少实体但没有有效 Tombstone 时只报告本机新增，不判定远端删除', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    const localTask = { id: 'local-only', title: '手机新增', updatedAt: '2026-09-05T03:00:00.000Z' }
    tasks.value = [localTask]
    flushStoredWrites()
    const secret = randomSecret()
    const remoteValues = { sl_tasks: [] }
    const encrypted = await encryptData({
      format: 'study-life-sync', version: 3,
      values: remoteValues,
      manifest: buildSyncManifest(remoteValues, { tombstones: [] }),
    }, secret)
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith('/recover')
        ? { ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: true, revision: 3 }
        : { ok: true, exists: true, revision: 3, data: encrypted },
    })))

    await joinSyncSpaceWithRecovery({ spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: secret })
    expect(await pullFromCloud({ previewOnly: true })).toBe(true)
    expect(tasks.value).toEqual([localTask])
    expect(syncPreview.value.summary.deleted).toBe(0)
    expect(syncPreview.value.changes).toEqual(expect.arrayContaining([expect.objectContaining({ entityId: 'local-only', status: 'local-only-change' })]))
  })

  it('取消 bootstrap 会撤销临时本机绑定并保留业务数据', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    const localTask = { id: 'keep-task', title: '仍在本机', updatedAt: '2026-09-05T00:00:00.000Z' }
    tasks.value = [localTask]
    flushStoredWrites()
    const secret = randomSecret()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: true, revision: 1 }),
    })))

    await joinSyncSpaceWithRecovery({ spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: secret })
    expect(cancelSyncSpaceBootstrap()).toBe(true)
    expect(isSyncSpaceBound.value).toBe(false)
    expect(tasks.value).toEqual([localTask])
    expect(readSyncMetadata().hasBaseline).toBe(false)
  })

  it('云端空数据不会被解释为删除本机独有任务', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    const localTask = { id: 'local-only', title: '本机任务', updatedAt: '2026-09-05T00:00:00.000Z' }
    tasks.value = [localTask]
    flushStoredWrites()
    const secret = randomSecret()
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith('/recover')
        ? { ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: false, revision: null }
        : { ok: true, exists: false, revision: null, data: null },
    })))

    await joinSyncSpaceWithRecovery({ spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: secret })
    expect(await pullFromCloud({ bootstrapConfirm: true })).toBe(true)
    expect(tasks.value).toEqual([localTask])
    expect(readSyncMetadata().hasBaseline).toBe(false)
  })

  it('bootstrap pending 时不会启动 AutoSync 轮询', async () => {
    vi.useFakeTimers()
    const secret = randomSecret()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: true, revision: 1 }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await joinSyncSpaceWithRecovery({ spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: secret })
    startAutoSyncCoordinator()
    await vi.advanceTimersByTimeAsync(65_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(autoSyncState.value).toBe('disabled')
    stopAutoSyncCoordinator()
    vi.useRealTimers()
  })

  it('检测到旧错误 Base 时 AutoSync 进入 calibration-required，不会自动 Pull/Push', async () => {
    vi.useFakeTimers()
    const tasks = useStoredRef('sl_tasks', [])
    const localTask = { id: 'calibration-task', title: '保留本机', updatedAt: '2026-09-05T00:00:00.000Z' }
    tasks.value = [localTask]
    flushStoredWrites()
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: true })
    saveSyncBaseline({ sl_tasks: [localTask] }, { remoteRevision: null, tombstones: [] })
    connectionState.value = 'connected'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    startAutoSyncCoordinator()
    await vi.advanceTimersByTimeAsync(65_000)
    expect(autoSyncState.value).toBe('calibration-required')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tasks.value).toEqual([localTask])
    stopAutoSyncCoordinator()
    vi.useRealTimers()
  })

  it('初始协调确认后 Base 等于最终合并结果', async () => {
    const tasks = useStoredRef('sl_tasks', [])
    const localTask = { id: 'local-task', title: '本机任务', updatedAt: '2026-09-05T00:00:00.000Z' }
    const remoteTask = { id: 'remote-task', title: '云端任务', updatedAt: '2026-09-05T00:00:00.000Z' }
    tasks.value = [localTask]
    flushStoredWrites()
    const secret = randomSecret()
    const encrypted = await encryptData({
      format: 'study-life-sync',
      version: 3,
      values: { sl_tasks: [remoteTask] },
      manifest: buildSyncManifest({ sl_tasks: [remoteTask] }, { tombstones: [] }),
    }, secret)
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith('/recover')
        ? { ok: true, spaceId: 'AB7K-P9M2-X4DQ', exists: true, revision: 3 }
        : { ok: true, exists: true, revision: 3, data: encrypted },
    })))

    await joinSyncSpaceWithRecovery({ spaceId: 'AB7K-P9M2-X4DQ', recoverySecret: secret })
    expect(await pullFromCloud({ previewOnly: true })).toBe(true)
    expect(await pullFromCloud({ bootstrapConfirm: true })).toBe(true)
    expect(tasks.value).toEqual([localTask, remoteTask])
    expect(readSyncMetadata().baseline.entities.sl_tasks).toMatchObject({
      'local-task': expect.any(Object),
      'remote-task': expect.any(Object),
    })
    expect(syncSpaceBootstrapPending.value).toBe(false)
  })
})
