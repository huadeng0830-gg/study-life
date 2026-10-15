// 备份范围与同步范围是**两个不同的问题**，不该用同一张表回答：
//
//   备份 = 「把这台设备完整搬到另一台」
//   同步 = 「两台设备保持一致」
//
// 所以有几个键进得了备份、进不了同步（正在计时的专注、快捷记录日志）。
// 以前这个差异只存在于事实里，没有任何地方说明，于是后来的维护者
// 看到「备份里有、同步里没有」只会当成漏写，然后去补 —— 而补上去是错的：
// 让另一台设备冒出一段不存在的计时，比不同步糟糕得多。
//
// 这个文件把两边的差集固定下来。新增一个备份字段时，它必须落在
// SYNC_DEFAULTS 或 BACKUP_ONLY_KEYS 其中之一，不能两边都没有。
import { describe, expect, it } from 'vitest'

import { BACKUP_STORAGE_KEYS, BACKUP_MODULES } from '../src/composables/backupArchive.js'
import { BACKUP_ONLY_KEYS, SYNC_DEFAULTS, SYNC_KEYS } from '../src/composables/syncKeys.js'
import { emergencyBackupKeys } from '../src/composables/emergencyExport.js'

const BACKUP_KEYS = Object.values(BACKUP_STORAGE_KEYS)

describe('备份与同步的范围各自说得清', () => {
  it('每个备份键要么同步，要么写明为什么不跟着同步', () => {
    const sync = new Set(SYNC_KEYS)
    for (const key of BACKUP_KEYS) {
      expect(sync.has(key) || Object.hasOwn(BACKUP_ONLY_KEYS, key), `${key} 既不同步也没说明理由`).toBe(true)
    }
  })

  it('每个明确不同步的键都真的在备份里，且理由非空', () => {
    for (const [key, reason] of Object.entries(BACKUP_ONLY_KEYS)) {
      expect(BACKUP_KEYS, key).toContain(key)
      expect(reason.trim().length, key).toBeGreaterThan(0)
      // 明确不同步的键也绝不能偷偷出现在同步清单里。
      expect(SYNC_KEYS, key).not.toContain(key)
    }
  })

  it('应急导出不多不少：全部备份字段 + 退休专用键', () => {
    const { RETIRED_FOOD_KEYS, RETIRED_PACKAGE_KEYS } = { RETIRED_FOOD_KEYS: ['sl_food_places', 'sl_food_history', 'sl_food_filters'], RETIRED_PACKAGE_KEYS: ['sl_packages'] }
    const expected = [...BACKUP_KEYS, ...RETIRED_FOOD_KEYS, ...RETIRED_PACKAGE_KEYS].sort()
    expect(emergencyBackupKeys().sort()).toEqual(expected)
  })

  it('每个备份键都归属某个分区，不留游离键', () => {
    const categorized = new Set(BACKUP_MODULES.flatMap((module) => module.keys))
    for (const key of BACKUP_KEYS) {
      // 游离键会落在恢复预览的「其它本机设置」里，而且不计入分区统计。
      expect(categorized.has(key), `${key} 不属于任何 BACKUP_MODULES 分区`).toBe(true)
    }
  })

  it('同步默认值本身不是空壳', () => {
    for (const [key, value] of Object.entries(SYNC_DEFAULTS)) {
      expect(SYNC_KEYS).toContain(key)
      expect(value, key).not.toBeUndefined()
    }
  })
})