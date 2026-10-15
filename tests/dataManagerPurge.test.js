// @vitest-environment happy-dom
//
// 数据管理的闭环回归。
//
// 【这个文件覆盖的四类问题】
//   1. **清空本机数据没有入口**：以前只能靠「退出账号」间接清空，而退出账号
//      一定清数据 —— 没登录的人、共用设备上想保留账号的人，都被堵死了。
//   2. **版本判断给出误导性提示**：v17 的备份落进兜底分支，报的是
//      「这不是有效的控制台备份文件」。用户会去重装应用，而真正要做的只是升级。
//   3. **导入只检查类型不检查结构**：`tasks: [null, "x", {}]` 能通过校验并被
//      写进 sl_tasks，等页面读它时才崩 —— 那已经发生在恢复之后了。
//   4. **「其它本机设置」恢复点存得进、恢复不出**：伪分区 other 不在
//      BACKUP_MODULES 里，按分区过滤存储键时它的键被整个漏掉，界面却一切正常。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'

import { BACKUP_ARCHIVE_VERSION, SUPPORTED_BACKUP_VERSIONS, parseBackupArchive } from '../src/composables/backupArchive.js'
import { measureLocalBusinessStorage, readStorageQuota } from '../src/composables/localStorageUsage.js'

const BASE = { app: 'study-life', schema: 'study-life.backup/v1', ownerId: '' }
/** 只在应急导出里出现、常规备份不带的那几个已退役键。 */
const RETIREMENT_ONLY_KEYS = ['sl_food_places', 'sl_food_history', 'sl_food_filters', 'sl_packages']

/** 与 parseBackupArchive 同样的序列化方式，构造一个校验能通过的归档。 */
async function archive(data, overrides = {}) {
  const value = { ...BASE, version: BACKUP_ARCHIVE_VERSION, exportedAt: '2026-10-15T00:00:00.000Z', ...overrides, data: { __owner_id: '', ...data } }
  const serialized = JSON.stringify(value.data)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized))
  return { ...value, checksum: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') }
}

beforeEach(() => {
  globalThis.localStorage.clear()
})

describe('备份导入的版本判断', () => {
  it('来自更新版本的备份要提示升级，而不是说文件坏了', async () => {
    const value = await archive({ courses: [], countdowns: [] }, { version: BACKUP_ARCHIVE_VERSION + 1 })
    await expect(parseBackupArchive(value)).rejects.toThrow(/更新的版本/)
    await expect(parseBackupArchive(value)).rejects.not.toThrow(/不是有效/)
  })

  it('非本应用的文件仍然报「不是有效」', async () => {
    await expect(parseBackupArchive({ app: 'other', version: 1, data: {} })).rejects.toThrow('这不是有效的控制台备份文件')
    await expect(parseBackupArchive(null)).rejects.toThrow('这不是有效的控制台备份文件')
    await expect(parseBackupArchive({ app: 'study-life', version: 1 })).rejects.toThrow('这不是有效的控制台备份文件')
    // 版本号不是整数（0 / 负数 / 字符串）都不放行。
    await expect(parseBackupArchive({ app: 'study-life', version: 0, data: {} })).rejects.toThrow('这不是有效的控制台备份文件')
    await expect(parseBackupArchive({ app: 'study-life', version: '16', data: {} })).rejects.toThrow('这不是有效的控制台备份文件')
  })

  it('支持版本清单覆盖当前版本的全部历史版本', () => {
    expect(SUPPORTED_BACKUP_VERSIONS).toContain(BACKUP_ARCHIVE_VERSION)
    expect(SUPPORTED_BACKUP_VERSIONS[0]).toBe(1)
    expect(SUPPORTED_BACKUP_VERSIONS).toHaveLength(BACKUP_ARCHIVE_VERSION)
  })

  it('校验和不符时停止恢复', async () => {
    const value = await archive({ courses: [], countdowns: [] })
    await expect(parseBackupArchive({ ...value, checksum: 'deadbeef' })).rejects.toThrow(/校验失败/)
  })
})

describe('备份导入的结构校验', () => {
  it('数组里混入 null / 字符串 / 嵌套数组时停止恢复', async () => {
    for (const bad of [[null], ['字符串'], [[]], [1], [{ id: 'a' }, null]]) {
      const value = await archive({ courses: [], countdowns: [], tasks: bad })
      await expect(parseBackupArchive(value), JSON.stringify(bad)).rejects.toThrow(/格式不正确的条目/)
    }
  })

  it('空对象是弱记录而不是类型损坏，仍然放行', async () => {
    // 备份字段的身份键并不统一（账本分类用 key，课程用 id），
    // 所以只守住「必须是对象」这一条；字段缺失交给各分区的 normalize 处理。
    // 强行要求 id 会把历史备份挡在门外。
    const value = await archive({ courses: [], countdowns: [], tasks: [{}] })
    await expect(parseBackupArchive(value)).resolves.toBeTruthy()
  })

  it('正常记录能通过，且带出实际携带的字段', async () => {
    const value = await archive({ courses: [], countdowns: [], tasks: [{ id: 'a', title: '甲' }], bills: [{ id: 'b' }] })
    const parsed = await parseBackupArchive(value)
    expect(parsed.data.tasks).toEqual([{ id: 'a', title: '甲' }])
    expect(parsed.providedFields).toEqual(expect.arrayContaining(['courses', 'countdowns', 'tasks', 'bills']))
  })

  it('空数组是合法的：用户确实可能没有这类记录', async () => {
    const value = await archive({ courses: [], countdowns: [], tasks: [], expenses: [] })
    await expect(parseBackupArchive(value)).resolves.toBeTruthy()
  })
})

describe('本机存储用量', () => {
  it('只统计 sl_ 业务键，并如实标记为估算', () => {
    localStorage.setItem('sl_courses', JSON.stringify([{ id: 'a' }]))
    localStorage.setItem('sl_tasks', '[]')
    localStorage.setItem('study-life-data-owner', '不应计入')
    localStorage.setItem('theme', '也不应计入')
    const usage = measureLocalBusinessStorage(localStorage)
    expect(usage.keyCount).toBe(2)
    expect(usage.chars).toBeGreaterThan(0)
    // 不支持 estimate() 的浏览器必须看到这是估算，不能拿它冒充真实配额。
    expect(usage.estimated).toBe(true)
    expect(Number.isInteger(usage.percent)).toBe(true)
  })

  it('浏览器给出真实配额时按真实值算，并覆盖 IndexedDB', async () => {
    const original = globalThis.navigator.storage
    Object.defineProperty(globalThis.navigator, 'storage', {
      configurable: true,
      value: { estimate: async () => ({ usage: 40, quota: 100 }) },
    })
    try {
      const quota = await readStorageQuota()
      expect(quota).toMatchObject({ usage: 40, quota: 100, percent: 40, warning: false })
    } finally {
      if (original === undefined) delete globalThis.navigator.storage
      else Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: original })
    }
  })

  it('没有 estimate() 时返回 null，调用方据此退回估算', async () => {
    const original = globalThis.navigator.storage
    Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: undefined })
    try {
      await expect(readStorageQuota()).resolves.toBeNull()
    } finally {
      if (original === undefined) delete globalThis.navigator.storage
      else Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: original })
    }
  })

  it('estimate 抛错或返回 0 配额时退回估算', async () => {
    const original = globalThis.navigator.storage
    for (const estimate of [async () => { throw new Error('nope') }, async () => ({ usage: 1, quota: 0 })]) {
      Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: { estimate } })
      await expect(readStorageQuota()).resolves.toBeNull()
    }
    if (original === undefined) delete globalThis.navigator.storage
    else Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: original })
  })
})

describe('备份键表只有一个来源', () => {
  it('应急导出覆盖全部常规备份字段，没有遗漏也没有多余', async () => {
    const { emergencyBackupKeys } = await import('../src/composables/emergencyExport.js')
    const { BACKUP_STORAGE_KEYS } = await import('../src/composables/backupArchive.js')
    // 应急导出曾经自带一张 47 条的键表。新增备份字段时漏改那一份，
    // 用户在保存失败时导出的「应急备份」就会静默缺数据 —— 而那正是最需要它完整的时刻。
    expect(emergencyBackupKeys().sort()).toEqual([...Object.values(BACKUP_STORAGE_KEYS), ...RETIREMENT_ONLY_KEYS].sort())
  })

  it('退休专用键确实只在应急导出里，且都是退休流程要清的键', async () => {
    const { RETIRED_FOOD_KEYS, RETIRED_PACKAGE_KEYS } = await import('../src/composables/retiredData.js')
    const { BACKUP_STORAGE_KEYS } = await import('../src/composables/backupArchive.js')
    const retired = [...RETIRED_FOOD_KEYS, ...RETIRED_PACKAGE_KEYS]
    expect(RETIREMENT_ONLY_KEYS.sort()).toEqual(retired.sort())
    for (const key of RETIREMENT_ONLY_KEYS) {
      // 退休流程必须在删除旧记录之前拿到可恢复的副本，所以它们不能只活在应急导出里被清掉。
      expect(Object.values(BACKUP_STORAGE_KEYS), key).not.toContain(key)
    }
  })
})

describe('清空本机数据', () => {
  // vi.doMock 的工厂不能是 async，所以 vue 直接在顶层引入（它并没有被 mock）。
  it('文案要说清楚删什么、不删什么，以及唯一的退路', async () => {
    vi.resetModules()
    vi.doMock('../src/composables/accountAuth.js', () => ({ accountUser: shallowRef({ id: 'fictional-account' }) }))
    vi.doMock('../src/composables/accountSyncIdentity.js', () => ({ captureAccountDataIdentity: () => ({ userId: 'fictional-account', ownerId: 'fictional-account' }), setAccountDataOwner: vi.fn() }))
    vi.doMock('../src/composables/accountLocalData.js', () => ({ clearAccountLocalData: vi.fn(async () => {}), withAccountDataLock: async (action) => action(() => {}) }))
    vi.doMock('../src/composables/store/core.js', () => ({ clearStoredDataByPrefix: vi.fn(async () => []), flushStoredWrites: () => ({ ok: true, pendingKeys: [] }) }))
    vi.doMock('../src/composables/wallpaperStorage.js', () => ({ clearAllWallpapers: vi.fn(async () => {}) }))
    vi.doMock('../src/composables/backupReminder.js', () => ({ needsBackup: ref(false) }))

    const { useLocalDataPurge } = await import('../src/composables/localDataPurge.js')
    const purge = useLocalDataPurge()
    const message = purge.confirmMessage.value
    // 不删的东西必须写明，否则用户会以为账号被登出了、云端也被清了。
    expect(message).toContain('不会清除：账号登录状态')
    expect(message).toContain('云端已同步的记录不会删除')
    expect(message).toContain('没有撤销')
    // 壁纸以前连退出账号都漏掉了，所以文案里要点名。
    expect(message).toContain('壁纸图片')
    expect(message).toContain('恢复点')
    vi.doUnmock('../src/composables/accountAuth.js')
    vi.resetModules()
  })

  it('没有近期备份时把警告提到前面，未登录时说清没有账号副本', async () => {
    vi.resetModules()
    vi.doMock('../src/composables/accountAuth.js', () => ({ accountUser: shallowRef(null) }))
    vi.doMock('../src/composables/backupReminder.js', () => ({ needsBackup: ref(true) }))
    const { useLocalDataPurge } = await import('../src/composables/localDataPurge.js')
    const purge = useLocalDataPurge()
    expect(purge.shouldWarnBackup.value).toBe(true)
    expect(purge.confirmMessage.value).toContain('还没有近期备份')
    expect(purge.confirmMessage.value).toContain('本机没有账号副本可删')
    vi.doUnmock('../src/composables/accountAuth.js')
    vi.doUnmock('../src/composables/backupReminder.js')
    vi.resetModules()
  })

  it('有未保存的本机修改时拒绝清空，并把键名列出来', async () => {
    vi.resetModules()
    const flush = { ok: false, pendingKeys: ['sl_courses'] }
    vi.doMock('../src/composables/accountAuth.js', () => ({ accountUser: shallowRef({ id: 'fictional-account' }) }))
    vi.doMock('../src/composables/accountSyncIdentity.js', () => ({ captureAccountDataIdentity: () => ({ userId: 'fictional-account', ownerId: 'fictional-account' }), setAccountDataOwner: vi.fn() }))
    const cleared = { local: 0, wallpaper: 0 }
    vi.doMock('../src/composables/accountLocalData.js', () => ({ clearAccountLocalData: vi.fn(async () => {}), withAccountDataLock: async (action) => action(() => {}) }))
    vi.doMock('../src/composables/store/core.js', () => ({
      clearStoredDataByPrefix: vi.fn(async () => { cleared.local += 1; return [] }),
      flushStoredWrites: () => flush,
    }))
    vi.doMock('../src/composables/wallpaperStorage.js', () => ({ clearAllWallpapers: vi.fn(async () => { cleared.wallpaper += 1 }) }))
    vi.doMock('../src/composables/backupReminder.js', () => ({ needsBackup: ref(false) }))

    const { useLocalDataPurge } = await import('../src/composables/localDataPurge.js')
    const purge = useLocalDataPurge()
    const result = await purge.purgeLocalData()
    // 界面上并没有告诉用户这些修改还没写下去，清空就会把它们静默丢掉。
    expect(result.ok).toBe(false)
    expect(result.message).toContain('sl_courses')
    expect(cleared).toEqual({ local: 0, wallpaper: 0 })
    vi.resetModules()
  })
})