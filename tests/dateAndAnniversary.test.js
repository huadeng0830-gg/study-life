// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createdDateKey, timestampOf } from '../src/composables/settingsPolicy.js'
import { buildLedgerIndex, computeFrequentFromIndex, ledgerMonthCategoryTotalsFromIndex, ledgerMonthIncomeFromIndex, ledgerPeriodStatsFromIndex, ledgerWeekTotalFromIndex } from '../src/composables/ledger.js'
import { daySnapshot } from '../src/composables/retrospective.js'
import { builtInFestivalTable, festiveFor, normalizeFestiveConfig } from '../src/composables/festive.js'
import { monthMoodSummary, weatherOfMood } from '../src/composables/mood.js'

/* 时间戳解析、闰日周年、情绪聚合的回归测试。 */

const NOW = new Date('2026-09-01T12:00:00Z').getTime()

describe('时间戳解析统一', () => {
  it('数字、数字字符串与 ISO 字符串都能解析', () => {
    const iso = '2026-08-28T09:00:00.000Z'
    expect(timestampOf(1756000000000)).toBe(1756000000000)
    expect(timestampOf('1756000000000')).toBe(1756000000000)
    expect(timestampOf(iso)).toBe(Date.parse(iso))
  })

  it('空值与垃圾值归零，而不是 NaN', () => {
    expect(timestampOf(null)).toBe(0)
    expect(timestampOf(undefined)).toBe(0)
    expect(timestampOf('')).toBe(0)
    expect(timestampOf('   ')).toBe(0)
    expect(timestampOf('不是时间')).toBe(0)
    expect(timestampOf(Number.NaN)).toBe(0)
    expect(timestampOf(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('createdDateKey 按应用时区取日期，而不是直接切 UTC 字符串', () => {
    // 直接 slice(0,10) 会得到 2026-03-02；上海时区下实际已是 03-03。
    expect(createdDateKey('2026-03-02T20:30:00.000Z', 'Asia/Shanghai')).toBe('2026-03-03')
    // 反过来，UTC 的 00:30 在上海是当天上午，切字符串会误判成前一天。
    expect(createdDateKey('2026-03-02T00:30:00.000Z', 'Asia/Shanghai')).toBe('2026-03-02')
    expect(createdDateKey('', 'Asia/Shanghai')).toBe('')
    expect(createdDateKey(1756000000000, 'Asia/Shanghai')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('账本索引读取器的兜底', () => {
  it('残缺或未构建的索引不会抛错，而是返回空统计', () => {
    const broken = [undefined, null, {}, { monthStats: null, dayTotals: 'x', monthCategories: 3, frequentEntries: 'nope' }]
    for (const index of broken) {
      expect(ledgerPeriodStatsFromIndex(index, '2026-08-28')).toEqual({ monthTotal: 0, monthCount: 0, todayTotal: 0 })
      expect(ledgerMonthIncomeFromIndex(index, '2026-08-28')).toBe(0)
      expect(ledgerWeekTotalFromIndex(index, '2026-08-28')).toBe(0)
      expect(ledgerMonthCategoryTotalsFromIndex(index, '2026-08')).toEqual(new Map())
      expect(computeFrequentFromIndex(index, { pinned: [], hidden: [] }, 6, NOW)).toEqual([])
    }
  })

  it('正常索引的统计结果不受影响', () => {
    const index = buildLedgerIndex([
      { id: 'a', name: '午饭', amount: 18, cat: 'food', date: '2026-08-28', time: '12:00' },
    ])
    expect(ledgerPeriodStatsFromIndex(index, '2026-08-28')).toMatchObject({ monthTotal: 18, monthCount: 1, todayTotal: 18 })
    expect(ledgerMonthCategoryTotalsFromIndex(index, '2026-08').get('food')).toBe(18)
  })

  it('非法日期不会让周统计抛错', () => {
    const index = buildLedgerIndex([])
    expect(ledgerWeekTotalFromIndex(index, '')).toBe(0)
    expect(ledgerWeekTotalFromIndex(index, '不是日期')).toBe(0)
  })
})

describe('账本「常记」的时间加权', () => {
  it('数字型 createdAt 不再被算成 0', () => {
    const recent = NOW - 86400000
    const index = buildLedgerIndex([
      { id: 'n1', name: '咖啡', amount: 12, cat: 'food', date: '2026-08-20', createdAt: '2026-08-20T09:00:00.000Z' },
      { id: 'n2', name: '咖啡', amount: 15, cat: 'food', date: '2026-08-31', createdAt: recent },
    ])
    const [entry] = computeFrequentFromIndex(index, { pinned: [], hidden: [] }, 6, NOW)
    expect(entry.name).toBe('咖啡')
    expect(entry.count).toBe(2)
    // 「最近一次」应当取到最新的那笔。旧实现把数字型解析成 0，
    // 于是它会被更早的 ISO 记录压过去，last 变成 8-20 的时间。
    expect(entry.last).toBe(recent)
  })

  it('完全没有 createdAt 时回退到 date + time', () => {
    const index = buildLedgerIndex([
      { id: 'm1', name: '地铁', amount: 3, cat: 'transit', date: '2026-08-20', time: '08:00' },
      { id: 'm2', name: '地铁', amount: 3, cat: 'transit', date: '2026-08-28', time: '08:00' },
    ])
    const [entry] = computeFrequentFromIndex(index, { pinned: [], hidden: [] }, 6, NOW)
    expect(entry.last).toBe(Date.parse('2026-08-28T08:00:00'))
  })
})

describe('回顾里的笔记日期', () => {
  it('数字型 createdAt 的笔记会算进正确的那一天', () => {
    const stamp = Date.parse('2026-03-02T20:30:00.000Z')
    const data = { notes: [{ id: 'x', title: '一段想法', createdAt: stamp }] }
    const day = createdDateKey(stamp)
    expect(day).not.toBe('')
    expect(daySnapshot(day, data).notes).toHaveLength(1)
  })

  it('数字型 createdAt 不再让笔记从所有日期里消失', () => {
    const data = { notes: [{ id: 'x', createdAt: 1756000000000 }] }
    // 旧实现下 slice(0,10) 取的是 "1756000000"，任何一天都匹配不到。
    expect(daySnapshot('1970-01-01', data).notes).toHaveLength(0)
    expect(daySnapshot(createdDateKey(1756000000000), data).notes).toHaveLength(1)
  })
})

describe('闰日生日与安装周年', () => {
  it('02-29 安装日在非闰年落到 02-28，并算出正确的年数', () => {
    const config = { enabled: true, installDate: '2028-02-29' }
    // 2029 不是闰年。旧实现整年不命中，下一次命中要等到 2032，年数会变成 4。
    const first = festiveFor('2029-02-28', config)
    expect(first.key).toBe('anniversary-start')
    expect(first.message).toBe('与你初见满一年啦，谢谢一路陪伴。')

    const later = festiveFor('2032-02-29', config)
    expect(later.message).toBe('已经一起走过 4 年，感谢始终相伴。')

    // 非闰年的 03-01 不该命中。
    expect(festiveFor('2029-03-01', config)).toBeNull()
  })

  it('02-29 生日在非闰年落到 02-28', () => {
    const config = { enabled: true, birthday: '02-29' }
    expect(festiveFor('2029-02-28', config).key).toBe('birthday')
    expect(festiveFor('2029-03-01', config)).toBeNull()
  })

  it('普通日期不受影响', () => {
    const config = { enabled: true, birthday: '05-20' }
    expect(festiveFor('2029-05-20', config).key).toBe('birthday')
    expect(festiveFor('2029-05-21', config)).toBeNull()
  })

  it('归一化时用真实日历校验，02-31 / 04-31 这类死配置被丢弃', () => {
    expect(normalizeFestiveConfig({ birthday: '02-31' }).birthday).toBe('')
    expect(normalizeFestiveConfig({ birthday: '04-31' }).birthday).toBe('')
    expect(normalizeFestiveConfig({ birthday: '02-29' }).birthday).toBe('02-29')
    expect(normalizeFestiveConfig({ installDate: '2026-02-29' }).installDate).toBe('')
    expect(normalizeFestiveConfig({ installDate: '2028-02-29' }).installDate).toBe('2028-02-29')
    expect(normalizeFestiveConfig({
      anniversaries: [{ date: '04-31', label: '不存在' }, { date: '02-29', label: '闰日' }],
    }).anniversaries).toEqual([{ date: '02-29', label: '闰日' }])
  })
})

describe('内置节日对照表的年份兜底', () => {
  it('空值与 NaN 退回当前年，而不是得到 0 年前后的空表', () => {
    const currentYear = new Date().getFullYear()
    for (const input of [undefined, '', null, Number.NaN, 'abc', 0]) {
      const table = builtInFestivalTable(input)
      expect(table.lunar).toHaveLength(13)
      expect(table.lunar[6].year).toBe(currentYear)
    }
  })

  it('显式年份仍然照常展开前后六年', () => {
    const table = builtInFestivalTable(2026)
    expect(table.lunar.map((row) => row.year)).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032])
    expect(table.lunar[6].cells.spring).toBeTruthy()
  })
})

describe('月度情绪聚合的新增字段', () => {
  const log = {
    '2026-03-01': { mood: '🙂' },
    '2026-03-02': { mood: '🙂' },
    '2026-03-03': { mood: '😄' },
    '2026-03-04': { mood: '😞' },
    '2026-03-05': { mood: '🔥' },
    '2026-04-01': { mood: '😄' },
  }

  it('原有的五个字段保持完全不变', () => {
    const summary = monthMoodSummary('2026-03', log)
    expect(summary.sunny).toBe(3) // 🙂×2 + 😄×1，天气层面依旧塌缩
    expect(summary.cloudy).toBe(1) // 🔥 静默归多云
    expect(summary.rain).toBe(1)
    expect(summary.dominant).toBe('sunny')
    expect(summary.themeColor).toBe('#f59e0b')
  })

  it('countsByMood 能区分被塌缩的具体情绪，且只在当月计数', () => {
    const summary = monthMoodSummary('2026-03', log)
    expect(summary.countsByMood).toEqual({ '😞': 1, '😐': 0, '🙂': 2, '😄': 1 })
    expect(summary.dominantMood).toBe('🙂')
    expect(summary.days).toBe(5)
  })

  it('非标准 emoji 被列出，便于提示「已按多云统计」', () => {
    expect(monthMoodSummary('2026-03', log).unknownMoods).toEqual(['🔥'])
    expect(monthMoodSummary('2026-04', log).unknownMoods).toEqual([])
  })

  it('weatherOfMood 的返回值仍限定在三种天气内（否则计数会变 NaN）', () => {
    for (const mood of ['😄', '😐', '😞', '🔥', '', '任意文字', null]) {
      expect(['sunny', 'cloudy', 'rain']).toContain(weatherOfMood(mood))
    }
    const summary = monthMoodSummary('2026-03', { '2026-03-05': { mood: '🔥' } })
    expect(Number.isNaN(summary.cloudy)).toBe(false)
    expect(summary.cloudy).toBe(1)
  })

  it('空月份不会给出主导情绪', () => {
    const summary = monthMoodSummary('2026-05', log)
    expect(summary.dominant).toBe('')
    expect(summary.dominantMood).toBe('')
    expect(summary.days).toBe(0)
    expect(summary.themeColor).toBe('')
  })
})