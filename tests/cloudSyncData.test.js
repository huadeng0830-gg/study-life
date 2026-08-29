import { describe, expect, it } from 'vitest'
import { mergeSyncValue, sanitizeSyncPayload, validateSyncPayload } from '../src/composables/cloudSyncData.js'
import { normalizeStoredValue } from '../src/composables/store'

describe('云同步数据保护', () => {
  it('拒绝会让页面崩溃的错误字段类型', () => {
    expect(() => validateSyncPayload({ sl_tasks: { 0: { id: 1 } } })).toThrow('格式异常')
    expect(() => validateSyncPayload({ sl_semester: [] })).toThrow('格式异常')
  })

  it('拉取时跳过异常设置但保留可用记录', () => {
    const result = sanitizeSyncPayload({ sl_tasks: [{ id: 1 }], sl_semester: [], sl_timecfg: {} })
    expect(result.values.sl_tasks).toEqual([{ id: 1 }])
    expect(result.invalidKeys).toEqual(['sl_timecfg', 'sl_semester'])
  })

  it('允许同步特殊日期，并忽略加密包中的设备元数据字段', () => {
    const result = sanitizeSyncPayload({
      sl_schedule_exceptions: [{ id: 'off', date: '2026-10-01', type: 'off' }],
      __sync_meta: { name: '我的 iPhone' },
    })
    expect(result.values.sl_schedule_exceptions).toHaveLength(1)
    expect(result.invalidKeys).toEqual([])
  })

  it('远程空数组不会删除本机已有记录', () => {
    const local = [{ id: 'local', title: '本机待办' }]
    expect(mergeSyncValue(local, [])).toEqual(local)
  })

  it('相同 id 优先保留更新时间较新的记录', () => {
    const local = [{ id: 1, title: '新版', updatedAt: '2026-08-27T10:00:00.000Z' }]
    const remote = [{ id: 1, title: '旧版', updatedAt: '2026-08-26T10:00:00.000Z' }]
    expect(mergeSyncValue(local, remote)[0].title).toBe('新版')
  })

  it('可从被错误转成对象的数组中找回数字索引记录', () => {
    const corrupted = { 0: { id: 1 }, 1: { id: 2 }, unexpected: true }
    expect(normalizeStoredValue(corrupted, [])).toEqual({
      value: [{ id: 1 }, { id: 2 }],
      repaired: true,
    })
  })

  it('对象设置缺少字段时自动补回默认结构', () => {
    expect(normalizeStoredValue({ start: '2026-09-01' }, { start: '', mode: 'school' })).toEqual({
      value: { start: '2026-09-01', mode: 'school' },
      repaired: true,
    })
  })
})
