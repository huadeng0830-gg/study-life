// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { code, cloudExists, lastError, localChanged, pullFromCloud, remoteRevision, syncPreview } from '../src/composables/cloudSync.js'
import { encryptData } from '../src/utils/crypto.js'
import { buildSyncManifest, hashSyncValue, readSyncMetadata, saveSyncBaseline, validateSyncManifest } from '../src/composables/syncMetadata.js'
import { clearSyncSpaceSettings } from '../src/composables/syncSpace.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

// 用户上报：手机上一条业务记录都无法拉取/覆盖，提示“云端 manifest 与数据内容不一致”。
// 旧版客户端把 sl_food_filters 当同步 singleton 写进 manifest，本版已退休该键，
// 于是每个已存在的云端 envelope 都会命中 manifest-singleton-hash-mismatch 而 fail closed。
function legacyEnvelope(values, { tombstones = [], drift = null } = {}) {
  const manifest = buildSyncManifest(values, { tombstones })
  delete manifest.hashVersion
  manifest.singletons.sl_food_filters = hashSyncValue({ spicy: false })
  if (drift) manifest.entities[drift.key][drift.id] = { entityType: drift.entityType || 'Task', hash: 'deadbeef', updatedAt: '' }
  return { format: 'study-life-sync', version: 3, values, manifest, meta: { id: 'old-device', name: '旧版客户端' } }
}

async function stubPull(envelope) {
  const encrypted = await encryptData(envelope, code.value)
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ exists: true, revision: 2, data: encrypted }),
  })))
}

describe('同步 manifest 跨版本兼容', () => {
  beforeEach(() => {
    localStorage.clear()
    code.value = ''
    remoteRevision.value = null
    cloudExists.value = false
    localChanged.value = false
    syncPreview.value = null
    clearSyncSpaceSettings()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('旧版 manifest 里的退休 singleton 键不再阻断拉取', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    const local = [{ id: 'compat-task', title: '本机旧值' }]
    tasks.value = local
    flushStoredWrites()
    // 已建立基线的设备才能把“只有云端变化”判定为 remote-only 并直接落地。
    saveSyncBaseline({ sl_tasks: local }, { remoteRevision: 1, tombstones: [] })
    code.value = '123456'
    const values = { sl_tasks: [{ id: 'compat-task', title: '云端新值' }], sl_theme: 'blue' }
    await stubPull(legacyEnvelope(values))

    expect(await pullFromCloud()).toBe(true)
    expect(tasks.value).toEqual([{ id: 'compat-task', title: '云端新值' }])
    expect(lastError.value).not.toContain('manifest')
    expect(readSyncMetadata().hasBaseline).toBe(true)
  })

  it('旧算法的指纹差异提示但继续合并，用户不会被永久锁死在同步空间外', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    const local = [{ id: 'compat-task', title: '本机旧值' }]
    tasks.value = local
    flushStoredWrites()
    saveSyncBaseline({ sl_tasks: local }, { remoteRevision: 1, tombstones: [] })
    code.value = '123456'
    const values = { sl_tasks: [{ id: 'compat-task', title: '云端新值' }] }
    await stubPull(legacyEnvelope(values, { drift: { key: 'sl_tasks', id: 'compat-task' } }))

    expect(await pullFromCloud()).toBe(true)
    expect(tasks.value).toEqual([{ id: 'compat-task', title: '云端新值' }])
    expect(lastError.value).toContain('旧版本客户端')
  })

  it('退休键本身不产生噪声，旧算法的指纹差异标记为可继续（fatal=false）', () => {
    const values = { sl_tasks: [{ id: 'compat-task', title: '云端新值' }] }
    const envelope = legacyEnvelope(values)

    // 退休的 sl_food_filters 本版本无法验证：既不能据此判定损坏，也不该刷出无意义告警。
    expect(validateSyncManifest(values, envelope.manifest).map((issue) => issue.reason))
      .not.toContain('manifest-singleton-hash-mismatch')

    // 旧算法算出的指纹（例如含 undefined 属性的实体）与本版本不同：提示但不阻断。
    envelope.manifest.entities.sl_tasks['compat-task'] = { entityType: 'Task', hash: 'deadbeef', updatedAt: '' }
    const issues = validateSyncManifest(values, envelope.manifest)

    expect(issues.map((issue) => issue.reason)).toContain('manifest-entity-hash-mismatch')
    expect(issues.every((issue) => issue.fatal === false)).toBe(true)
  })

  it('同一版本的 manifest 指纹不一致仍然致命，防篡改不被削弱', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const tasks = useStoredRef('sl_tasks', [])
    tasks.value = [{ id: 'tamper-task', title: '本机值' }]
    flushStoredWrites()
    code.value = '123456'
    const values = { sl_tasks: [{ id: 'tamper-task', title: '云端值' }] }
    await stubPull({
      format: 'study-life-sync',
      version: 3,
      values,
      manifest: buildSyncManifest({ sl_tasks: [{ id: 'tamper-task', title: '被替换的值' }] }, { tombstones: [] }),
    })

    expect(await pullFromCloud()).toBe(false)
    expect(lastError.value).toContain('manifest')
    expect(tasks.value).toEqual([{ id: 'tamper-task', title: '本机值' }])
  })

  it('结构损坏与稳定 ID 问题始终致命', () => {
    const values = { sl_tasks: [{ title: '缺少 id' }] }
    const manifest = buildSyncManifest({ sl_tasks: [] }, { tombstones: [] })
    const issues = validateSyncManifest(values, manifest)

    expect(issues.some((issue) => issue.fatal && issue.reason === 'manifest-missing-id')).toBe(true)
    expect(validateSyncManifest(values, { ...manifest, version: 9 }).every((issue) => issue.fatal)).toBe(true)
    expect(validateSyncManifest({}, { version: 1, entities: {}, singletons: {} }).every((issue) => issue.fatal)).toBe(true)
  })

  it('指纹在加密两端完全一致：undefined 属性、数组空洞与 Date 都不再制造假差异', () => {
    const payload = {
      sl_tasks: [{ id: 'round-trip-task', title: '复习', courseId: undefined, tags: ['a', undefined] }],
      sl_semester: { start: '2026-09-01', end: undefined },
      sl_appearance: { updatedAt: new Date('2026-09-01T00:00:00.000Z') },
    }
    const manifest = buildSyncManifest(payload, { tombstones: [] })
    // 加密 = JSON.stringify，解密 = JSON.parse。manifest 必须在往返之后依然成立。
    const envelope = JSON.parse(JSON.stringify({ format: 'study-life-sync', version: 3, values: payload, manifest }))

    expect(validateSyncManifest(envelope.values, envelope.manifest)).toEqual([])
    expect(hashSyncValue(payload.sl_tasks[0])).toBe(hashSyncValue(envelope.values.sl_tasks[0]))
  })
})