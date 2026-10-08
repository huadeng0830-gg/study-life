import { describe, expect, it } from 'vitest'
import {
  sanitizeSyncPayload,
  validateSyncPayload,
} from '../src/composables/accountSyncData.js'
import { normalizeStoredValue } from '../src/composables/store'

describe('账号同步数据保护', () => {
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

describe('账号同步兼容与资源保护', () => {
  it('拉取时归一化氛围与心情两个新键', () => {
    const result = sanitizeSyncPayload({
      sl_festive_config: {
        enabled: false,
        birthday: '02-14',
        installDate: 'bad-date',
        anniversaries: [{ date: '10-01', label: '纪念日' }, { date: 'xx', label: '' }],
      },
      sl_mood_log: { '2026-08-29': '😊', 'bad-day': { mood: '😄' } },
    })
    expect(result.invalidKeys).toEqual([])
    expect(result.values.sl_festive_config).toEqual({
      enabled: false,
      birthday: '02-14',
      installDate: '',
      anniversaries: [{ date: '10-01', label: '纪念日' }],
    })
    expect(result.values.sl_mood_log).toEqual({ '2026-08-29': { mood: '😊', note: '' } })
  })

  it('同步 OCR 词库、设备偏好与完整生日日期，坏日期会被清空', () => {
    const result = sanitizeSyncPayload({
      sl_ocr_vocabulary: { courses: ['高数'], teachers: [], rooms: [], campuses: [] },
      sl_performance_mode: 'auto',
      sl_festive_birthday_full: 'bad-date',
    })
    expect(result.invalidKeys).toEqual([])
    expect(result.values.sl_ocr_vocabulary.courses).toEqual(['高数'])
    expect(result.values.sl_festive_birthday_full).toBe('')
  })

  it('同步时迁移旧版流畅模式并拒绝未知值', () => {
    expect(sanitizeSyncPayload({ sl_performance_mode: 'low' }).values.sl_performance_mode).toBe('on')
    expect(sanitizeSyncPayload({ sl_performance_mode: 'high' }).values.sl_performance_mode).toBe('off')
    expect(sanitizeSyncPayload({ sl_performance_mode: 'turbo' }).invalidKeys).toEqual(['sl_performance_mode'])
  })

  it('拒绝超大集合和过深嵌套，避免同步资源耗尽', () => {
    const tooMany = Array.from({ length: 100001 }, (_, index) => ({ id: `task-${index}` }))
    expect(sanitizeSyncPayload({ sl_tasks: tooMany }).invalidKeys).toEqual(['sl_tasks'])
    let nested = 'value'
    for (let index = 0; index < 30; index++) nested = { nested }
    expect(sanitizeSyncPayload({ sl_appearance: nested }).invalidKeys).toEqual(['sl_appearance'])
    expect(() => validateSyncPayload({ sl_tasks: tooMany })).toThrow('格式异常')
  })
})
