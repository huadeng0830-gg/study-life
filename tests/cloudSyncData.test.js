import { describe, expect, it } from 'vitest'
import {
  SYNC_KEYS,
  SYNC_MODULES,
  mergeSyncValue,
  moduleKeysFor,
  normalizePullKeys,
  pickSyncValues,
  sanitizeSyncPayload,
  validateSyncPayload,
} from '../src/composables/cloudSyncData.js'
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

describe('选择性拉取的分组与范围', () => {
  it('模块分组恰好覆盖全部同步键，不重不漏', () => {
    const grouped = SYNC_MODULES.flatMap((mod) => mod.keys)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...new Set(grouped)].sort()).toEqual([...SYNC_KEYS].sort())
  })

  it('moduleKeysFor 只展开勾选模块的键', () => {
    expect(moduleKeysFor(['tasks'])).toEqual(['sl_tasks', 'sl_events', 'sl_quick_notes', 'sl_quick_record_settings', 'sl_capture_enabled'])
    expect(moduleKeysFor(['tasks', 'countdown'])).toEqual(['sl_tasks', 'sl_events', 'sl_quick_notes', 'sl_quick_record_settings', 'sl_capture_enabled', 'sl_exams', 'sl_countdown_show_past'])
    expect(moduleKeysFor(['focus'])).toEqual(['sl_focus_sessions', 'sl_focus_settings'])
    expect(moduleKeysFor(['no-such-module'])).toEqual([])
  })

  it('normalizePullKeys 空值表示全量，数组去重且只留合法键', () => {
    expect(normalizePullKeys(undefined)).toEqual([...SYNC_KEYS])
    expect(normalizePullKeys(null)).toEqual([...SYNC_KEYS])
    expect(normalizePullKeys(['sl_tasks', 'sl_tasks', 'not-a-key'])).toEqual(['sl_tasks'])
    expect(normalizePullKeys([])).toEqual([])
  })

  it('pickSyncValues 只挑出选中键且忽略未知键', () => {
    expect(pickSyncValues({ sl_tasks: [], sl_courses: [], __sync_meta: {} }, ['sl_tasks'])).toEqual({ sl_tasks: [] })
  })

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
})
