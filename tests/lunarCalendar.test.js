// @vitest-environment node
//
// 农历模块（src/composables/lunar.js）验证。全部为纯逻辑断言：不联网、不读外部文件、不新增依赖。
//
// 证据来源（按重要性）：
//   A. 仓库内 LUNAR_FESTIVAL_DATES（src/composables/festive.js L108–L145）：2015–2050 每年 7 个节日的
//      公历日期，文件注释写明由 lunar-javascript 一次性生成后固化。其中 5 个是农历节日
//      （春节/元宵/端午/中秋/重阳），清明与冬至是**节气**（按太阳黄经定，不是农历月日），必须排除。
//      本文件直接 import 这个导出对象来做比对——不做任何文本解析，所以不存在
//      "注释里的字面量造假命中"的问题（无需剥注释）。
//   B. 我先验知识里广为人知的春节公历日期，硬编码为独立 fixture（见下方 fixture 用例的注释）。
//   C. 香港天文台《公曆與農曆對照表》逐日数据，开发期人工比对：
//      https://www.weather.gov.hk/en/gts/time/calendar/text/files/T2050e.txt
//      https://www.weather.gov.hk/en/gts/time/calendar/text/files/T2051e.txt
//      https://www.weather.gov.hk/en/gts/time/calendar/text/files/T2100e.txt
//      这三年的 13 个月长度、闰月位置与本模块完全一致（2050 闰三月 30 天、2051 春节 02-11、
//      2100 春节 02-09）。本模块最初的 2050 表项写成了 0x04b63（闰三月当 29 天），
//      正是同时被 A（2050 端午/中秋/重阳各差 1 天）与 C 抓到，才改为 0x14b63。

import { describe, expect, it } from 'vitest'
import { LUNAR_FESTIVAL_DATES } from '../src/composables/festive.js'
import {
  GREGORIAN_SUPPORT_LAST_DATE,
  GREGORIAN_SUPPORT_RANGE,
  LUNAR_INFO,
  LUNAR_SUPPORT_RANGE,
  gregorianToLunar,
  isGregorianDateSupported,
  isLunarYearSupported,
  lunarLeapMonth,
  lunarLeapMonthDays,
  lunarMonthDayOccurrences,
  lunarMonthDayToGregorian,
  lunarMonthDays,
  lunarToGregorian,
  lunarYearDays,
  nextLunarMonthDayOnOrAfter,
} from '../src/composables/lunar.js'

const pad2 = (value) => String(value).padStart(2, '0')
const monthDay = (date) => (date ? `${pad2(date.month)}-${pad2(date.day)}` : null)
const fullDate = (date) => (date ? `${date.year}-${pad2(date.month)}-${pad2(date.day)}` : null)

// 农历节日的农历月日定义。清明（qingming）/冬至（winter）故意不在这里：它们是节气。
const LUNAR_FESTIVALS = Object.freeze([
  { key: 'spring', name: '春节', month: 1, day: 1 },
  { key: 'lantern', name: '元宵节', month: 1, day: 15 },
  { key: 'dragon', name: '端午节', month: 5, day: 5 },
  { key: 'midautumn', name: '中秋节', month: 8, day: 15 },
  { key: 'chongyang', name: '重阳节', month: 9, day: 9 },
])
const SOLAR_TERM_KEYS = Object.freeze(['qingming', 'winter'])
const FESTIVAL_YEARS = Object.keys(LUNAR_FESTIVAL_DATES)
  .map(Number)
  .sort((a, b) => a - b)

describe('lunar.js（农历 ↔ 公历互转）', () => {
  it('A. 2015–2050 × 5 个农历节日：180 个比对点与 festive.js 权威表全部一致', () => {
    const rowsChecked = []
    const foundEntries = []
    const mismatches = []
    let points = 0

    for (const gregorianYear of FESTIVAL_YEARS) {
      const row = LUNAR_FESTIVAL_DATES[gregorianYear]
      rowsChecked.push(gregorianYear)
      for (const festival of LUNAR_FESTIVALS) {
        const entry = Object.entries(row).find(([, key]) => key === festival.key)
        if (!entry) {
          mismatches.push(`${gregorianYear} ${festival.name}: 权威表里没有这个键`)
          continue
        }
        foundEntries.push(`${gregorianYear}-${festival.key}`)
        const expectedMonthDay = entry[0]
        const actual = lunarToGregorian(gregorianYear, festival.month, festival.day, false)
        points += 1
        if (monthDay(actual) !== expectedMonthDay) {
          mismatches.push(
            `${gregorianYear} ${festival.name}（农历${festival.month}月${festival.day}日）: ` +
              `权威表 ${expectedMonthDay}，本模块 ${monthDay(actual) ?? 'null'}`
          )
        }
      }
    }

    // 比对点数量断言：防止循环写错导致"零比对也算绿"。
    expect(FESTIVAL_YEARS).toHaveLength(36)
    expect(foundEntries).toHaveLength(180)
    expect(points).toBe(180)
    expect(rowsChecked[0]).toBe(2015)
    expect(rowsChecked[rowsChecked.length - 1]).toBe(2050)
    expect(mismatches).toEqual([])
  })

  it('A2. 同一批 180 个点经 lunarMonthDayToGregorian（纪念日入口）复验，同样全绿', () => {
    const mismatches = []
    let points = 0

    for (const gregorianYear of FESTIVAL_YEARS) {
      const row = LUNAR_FESTIVAL_DATES[gregorianYear]
      for (const festival of LUNAR_FESTIVALS) {
        const entry = Object.entries(row).find(([, key]) => key === festival.key)
        if (!entry) {
          mismatches.push(`${gregorianYear} ${festival.name}: 权威表里没有这个键`)
          continue
        }
        points += 1
        const actual = lunarMonthDayToGregorian(gregorianYear, festival.month, festival.day)
        if (monthDay(actual) !== entry[0]) {
          mismatches.push(
            `${gregorianYear} ${festival.name}: 权威表 ${entry[0]}，lunarMonthDayToGregorian ${monthDay(actual) ?? 'null'}`
          )
        }
      }
    }

    expect(points).toBe(180)
    expect(mismatches).toEqual([])
  })

  it('A3. 每年恰好 7 个节日 = 5 个农历节日 + 2 个节气；清明/冬至不是固定农历月日（所以必须排除）', () => {
    const lunarKeyCounts = []
    const solarTermLunarMonthDays = { qingming: new Set(), winter: new Set() }

    for (const gregorianYear of FESTIVAL_YEARS) {
      const row = LUNAR_FESTIVAL_DATES[gregorianYear]
      expect(Object.keys(row)).toHaveLength(7)
      lunarKeyCounts.push(Object.values(row).filter((key) => LUNAR_FESTIVALS.some((f) => f.key === key)).length)
      for (const key of SOLAR_TERM_KEYS) {
        const entry = Object.entries(row).find(([, value]) => value === key)
        expect(entry).toBeTruthy()
        const lunar = gregorianToLunar(`${gregorianYear}-${entry[0]}`)
        expect(lunar).toBeTruthy()
        solarTermLunarMonthDays[key].add(`${lunar.month}-${lunar.day}${lunar.isLeapMonth ? 'L' : ''}`)
      }
    }

    expect(lunarKeyCounts.every((count) => count === 5)).toBe(true)
    expect(lunarKeyCounts.reduce((sum, count) => sum + count, 0)).toBe(180)
    // 节气落在农历上的月日在 36 年里是变化的（清明跨二月/三月、冬至跨十一月各日），
    // 因此它们不可能是"固定的农历月-日"，把它们拿来验证农历实现是错的。
    expect(solarTermLunarMonthDays.qingming.size).toBeGreaterThan(1)
    expect(solarTermLunarMonthDays.winter.size).toBeGreaterThan(1)
  })

  it('B. 广为人知的春节公历日期（先验知识硬编码 fixture，独立于 festive.js；如需请人工复核）', () => {
    // 下列日期来自我的先验知识（公开常识级的中文万年历事实），不是从本仓库任何文件推导出来的。
    // 其中 1998/2000/2005/2012 落在 festive.js 表的覆盖区间（2015–2050）之外，属于独立证据。
    const fixtures = [
      { year: 1998, expected: '1998-01-28', note: '戊寅虎年春节' },
      { year: 2000, expected: '2000-02-05', note: '庚辰龙年春节' },
      { year: 2005, expected: '2005-02-09', note: '乙酉鸡年春节' },
      { year: 2012, expected: '2012-01-23', note: '壬辰龙年春节' },
      { year: 2020, expected: '2020-01-25', note: '庚子鼠年春节' },
      { year: 2024, expected: '2024-02-10', note: '甲辰龙年春节' },
    ]

    const mismatches = []
    for (const fixture of fixtures) {
      const actual = lunarToGregorian(fixture.year, 1, 1, false)
      if (fullDate(actual) !== fixture.expected) {
        mismatches.push(`${fixture.year}（${fixture.note}）: 期望 ${fixture.expected}，实际 ${fullDate(actual) ?? 'null'}`)
      }
      // 反向也必须一致
      const back = gregorianToLunar(fixture.expected)
      if (back?.month !== 1 || back?.day !== 1 || back?.year !== fixture.year || back?.isLeapMonth !== false) {
        mismatches.push(`${fixture.expected} 反解结果不对: ${JSON.stringify(back)}`)
      }
    }

    expect(fixtures.length).toBeGreaterThanOrEqual(4)
    expect(mismatches).toEqual([])
  })

  it('C. 香港天文台对照表抽查（2050 / 2051 / 2100）逐项一致', () => {
    // 2050（HKO T2050e）：正月初一 01-23、五月初一 06-19（端午 06-23）、八月初一 09-16（中秋 09-30）、
    // 九月初一 10-16（重阳 10-24）、闰三月初一 04-21、四月初一 05-21 → 闰三月 30 天。
    expect(fullDate(lunarToGregorian(2050, 1, 1))).toBe('2050-01-23')
    expect(fullDate(lunarToGregorian(2050, 5, 5))).toBe('2050-06-23')
    expect(fullDate(lunarToGregorian(2050, 8, 15))).toBe('2050-09-30')
    expect(fullDate(lunarToGregorian(2050, 9, 9))).toBe('2050-10-24')
    expect(lunarLeapMonth(2050)).toBe(3)
    expect(lunarLeapMonthDays(2050)).toBe(30)
    expect(fullDate(lunarToGregorian(2050, 3, 1, true))).toBe('2050-04-21')
    expect(fullDate(lunarToGregorian(2050, 4, 1, false))).toBe('2050-05-21')
    // 2051（HKO T2051e）：正月初一 02-11、腊月初一（2051-01-13 属上一农历年）……
    expect(fullDate(lunarToGregorian(2051, 1, 1))).toBe('2051-02-11')
    expect(fullDate(lunarToGregorian(2050, 12, 1))).toBe('2051-01-13')
    // 2100（HKO T2100e）：正月初一 02-09，且 2100 无闰月；腊月初一 12-31。
    expect(fullDate(lunarToGregorian(2100, 1, 1))).toBe('2100-02-09')
    expect(lunarLeapMonth(2100)).toBe(0)
    expect(fullDate(lunarToGregorian(2100, 12, 1))).toBe('2100-12-31')
    // 2100 年 12 个月长度（HKO 逐月核对：30,30,29,30,29,30,29,30,29,29,30,29）
    const lengths2100 = Array.from({ length: 12 }, (_, index) => lunarMonthDays(2100, index + 1))
    expect(lengths2100).toEqual([30, 30, 29, 30, 29, 30, 29, 30, 29, 29, 30, 29])
  })

  it('闰月：确实存在、天数正确，且"无此闰月"必须返回 null（不回退平月）', () => {
    // 广为人知的闰月：2012 闰四月、2017 闰六月、2020 闰四月、2023 闰二月、2025 闰六月、
    // 2033 闰十一月（"2033 年问题"）、2044 闰七月、2050 闰三月（HKO 见上）。
    const knownLeapMonths = [
      [2012, 4],
      [2017, 6],
      [2020, 4],
      [2023, 2],
      [2025, 6],
      [2033, 11],
      [2044, 7],
      [2050, 3],
    ]
    for (const [year, month] of knownLeapMonths) {
      expect({ year, leap: lunarLeapMonth(year) }).toEqual({ year, leap: month })
      expect([29, 30]).toContain(lunarLeapMonthDays(year))
    }

    // 2020 闰四月初一 = 2020-05-23（公开事实），平四月初一 = 2020-04-23：两者必须不同，
    // 证明闰月没有被静默当成平月。
    expect(fullDate(lunarToGregorian(2020, 4, 1, true))).toBe('2020-05-23')
    expect(fullDate(lunarToGregorian(2020, 4, 1, false))).toBe('2020-04-23')
    expect(fullDate(lunarToGregorian(2020, 4, 1, true))).not.toBe(fullDate(lunarToGregorian(2020, 4, 1, false)))

    // 反向必须标出 isLeapMonth
    expect(gregorianToLunar('2020-05-23')).toEqual({ year: 2020, month: 4, day: 1, isLeapMonth: true })
    expect(gregorianToLunar('2020-04-23')).toEqual({ year: 2020, month: 4, day: 1, isLeapMonth: false })

    // 显式断言：该年无此闰月 → null（2021 全年无闰月；2020 的闰月是四月不是五月；2026 无闰月）
    expect(lunarToGregorian(2021, 4, 1, true)).toBeNull()
    expect(lunarToGregorian(2020, 5, 1, true)).toBeNull()
    expect(lunarToGregorian(2020, 1, 1, true)).toBeNull()
    expect(lunarToGregorian(2026, 6, 1, true)).toBeNull()
    expect(lunarLeapMonth(2021)).toBe(0)

    // 穷举性质（不依赖任何外部数据，可自证）：1900–2100 每个农历年，除该年唯一的闰月之外，
    // 任何月份带 isLeapMonth=true 都必须返回 null；闰月的 day 1 反解必须标 isLeapMonth=true。
    let nonexistentLeapChecks = 0
    let leapDayOneChecks = 0
    let leapYearCount = 0
    for (let year = LUNAR_SUPPORT_RANGE.min; year <= LUNAR_SUPPORT_RANGE.max; year += 1) {
      const leap = lunarLeapMonth(year)
      if (leap > 0) {
        leapYearCount += 1
        expect(leap).toBeGreaterThanOrEqual(1)
        expect(leap).toBeLessThanOrEqual(12)
        const date = lunarToGregorian(year, leap, 1, true)
        expect(date).toBeTruthy()
        expect(gregorianToLunar(date)).toEqual({ year, month: leap, day: 1, isLeapMonth: true })
        leapDayOneChecks += 1
      }
      for (let month = 1; month <= 12; month += 1) {
        if (month === leap) continue
        nonexistentLeapChecks += 1
        expect(lunarToGregorian(year, month, 1, true)).toBeNull()
      }
    }
    expect(nonexistentLeapChecks).toBe(2338)
    expect(leapDayOneChecks).toBe(leapYearCount)
    // 1900–2100 共 201 年，其中 74 个闰月年（本表实测值；区间断言避免写死）
    expect(leapYearCount).toBe(74)
    expect(leapYearCount).toBeGreaterThan(0)
  })

  it('往返一致性：公历→农历→公历（跨全区间抽样）与农历→公历→农历（穷举含闰月）', () => {
    // 公历侧：1900-01-31 ~ 2101-01-28 每 3 天抽一个
    const step = 3 * 86400000
    let gregorianSamples = 0
    const gregorianFailures = []
    for (let utc = Date.UTC(1900, 0, 31); utc <= Date.UTC(2101, 0, 28); utc += step) {
      const probe = new Date(utc)
      const source = { year: probe.getUTCFullYear(), month: probe.getUTCMonth() + 1, day: probe.getUTCDate() }
      const lunar = gregorianToLunar(source)
      const back = lunar ? lunarToGregorian(lunar.year, lunar.month, lunar.day, lunar.isLeapMonth) : null
      gregorianSamples += 1
      if (!back || back.year !== source.year || back.month !== source.month || back.day !== source.day) {
        gregorianFailures.push(`${fullDate(source)} -> ${JSON.stringify(lunar)} -> ${fullDate(back)}`)
      }
    }
    expect(gregorianSamples).toBeGreaterThan(20000)
    expect(gregorianFailures).toEqual([])

    // 农历侧：1900–2100 每年每个月（含闰月）取 1 日/15 日/当月最后一日
    let lunarSamples = 0
    const lunarFailures = []
    for (let year = LUNAR_SUPPORT_RANGE.min; year <= LUNAR_SUPPORT_RANGE.max; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const variants = [[lunarMonthDays(year, month), false]]
        if (lunarLeapMonth(year) === month) variants.push([lunarLeapMonthDays(year), true])
        for (const [monthLength, isLeapMonth] of variants) {
          for (const day of new Set([1, 15, monthLength])) {
            const gregorian = lunarToGregorian(year, month, day, isLeapMonth)
            const back = gregorian ? gregorianToLunar(gregorian) : null
            lunarSamples += 1
            const same =
              back &&
              back.year === year &&
              back.month === month &&
              back.day === day &&
              back.isLeapMonth === isLeapMonth
            if (!same) {
              lunarFailures.push(`${year}-${month}-${day}${isLeapMonth ? '(闰)' : ''} -> ${JSON.stringify(gregorian)} -> ${JSON.stringify(back)}`)
            }
          }
        }
      }
    }
    expect(lunarSamples).toBeGreaterThan(7000)
    expect(lunarFailures).toEqual([])
  })

  it('边界：超出支持区间返回 null（不抛异常、不猜值）', () => {
    expect(LUNAR_SUPPORT_RANGE).toEqual({ min: 1900, max: 2100 })
    expect(GREGORIAN_SUPPORT_RANGE).toEqual({ min: 1900, max: 2101 })
    expect(GREGORIAN_SUPPORT_LAST_DATE).toBe('2101-01-28')
    expect(LUNAR_INFO).toHaveLength(201)

    expect(isLunarYearSupported(1899)).toBe(false)
    expect(isLunarYearSupported(1900)).toBe(true)
    expect(isLunarYearSupported(2100)).toBe(true)
    expect(isLunarYearSupported(2101)).toBe(false)

    expect(lunarToGregorian(1899, 1, 1)).toBeNull()
    expect(lunarToGregorian(2101, 1, 1)).toBeNull()
    expect(lunarToGregorian(0, 1, 1)).toBeNull()
    expect(lunarYearDays(1899)).toBe(0)
    expect(lunarMonthDays(2101, 1)).toBe(0)

    // 起始边界：1900-01-30 还不属于本表（1900-01-31 才是农历 1900 年正月初一）
    expect(isGregorianDateSupported('1900-01-30')).toBe(false)
    expect(gregorianToLunar('1900-01-30')).toBeNull()
    expect(gregorianToLunar('1899-12-31')).toBeNull()
    expect(isGregorianDateSupported('1900-01-31')).toBe(true)
    expect(gregorianToLunar('1900-01-31')).toEqual({ year: 1900, month: 1, day: 1, isLeapMonth: false })

    // 结束边界：2101-01-28 是表内最后一天，再往后一天就超出
    expect(isGregorianDateSupported(GREGORIAN_SUPPORT_LAST_DATE)).toBe(true)
    expect(gregorianToLunar(GREGORIAN_SUPPORT_LAST_DATE)).toEqual({
      year: 2100,
      month: 12,
      day: 29,
      isLeapMonth: false,
    })
    expect(gregorianToLunar('2101-01-29')).toBeNull()
    expect(gregorianToLunar('2101-06-01')).toBeNull()
    expect(isGregorianDateSupported('2101-01-29')).toBe(false)

    // 非法参数：一律 null，绝不抛异常
    const invalidCalls = [
      () => lunarToGregorian(2026, 0, 1),
      () => lunarToGregorian(2026, 13, 1),
      () => lunarToGregorian(2026, 1, 0),
      () => lunarToGregorian(2026, 1, 31),
      () => lunarToGregorian(2026, 1.5, 1),
      () => lunarToGregorian(2026, 1, 1.5),
      () => lunarToGregorian('2026', 1, 1),
      () => lunarToGregorian(2026, null, 1),
      () => gregorianToLunar('not-a-date'),
      () => gregorianToLunar('2026-02-30'),
      () => gregorianToLunar('2026-13-01'),
      () => gregorianToLunar(''),
      () => gregorianToLunar(null),
      () => gregorianToLunar(undefined),
      () => gregorianToLunar({}),
      () => gregorianToLunar(new Date('invalid')),
      () => lunarMonthDayToGregorian(2026, 13, 1),
      () => nextLunarMonthDayOnOrAfter('not-a-date', 1, 1),
    ]
    for (const call of invalidCalls) {
      let result
      expect(() => {
        result = call()
      }).not.toThrow()
      expect(result === null || (Array.isArray(result) && result.length === 0)).toBe(true)
    }

    // 小月（29 天）的"三十"不存在 → null。挑一个确定是 29 天的月份，避免写死年份。
    const shortMonthYear = 2026
    const shortMonth = Array.from({ length: 12 }, (_, index) => index + 1).find(
      (month) => lunarMonthDays(shortMonthYear, month) === 29
    )
    expect(shortMonth).toBeTruthy()
    expect(lunarToGregorian(shortMonthYear, shortMonth, 30)).toBeNull()
    expect(lunarToGregorian(shortMonthYear, shortMonth, 29)).toBeTruthy()
  })

  it('判别力：不是恒等映射，且同一农历日在不同公历年落在不同公历日期', () => {
    // 恒等映射（农历月日 == 公历月日）会在这段区间里命中全部 13149 天；本模块实测命中 0 天。
    let totalDays = 0
    let identityDays = 0
    for (let utc = Date.UTC(2015, 0, 1); utc < Date.UTC(2051, 0, 1); utc += 86400000) {
      const probe = new Date(utc)
      const lunar = gregorianToLunar(`${probe.getUTCFullYear()}-${pad2(probe.getUTCMonth() + 1)}-${pad2(probe.getUTCDate())}`)
      expect(lunar).toBeTruthy()
      totalDays += 1
      if (lunar.month === probe.getUTCMonth() + 1 && lunar.day === probe.getUTCDate()) identityDays += 1
    }
    expect(totalDays).toBe(13149)
    expect(identityDays).toBeLessThan(totalDays * 0.05)

    // 单点硬断言：2026-02-17 是农历 2026 年正月初一（公历 2 月 17 日 ≠ 农历 1 月 1 日）
    expect(gregorianToLunar('2026-02-17')).toEqual({ year: 2026, month: 1, day: 1, isLeapMonth: false })
    expect(gregorianToLunar('2024-02-10')).toEqual({ year: 2024, month: 1, day: 1, isLeapMonth: false })

    // 同一农历日（正月初一）在不同公历年的公历日期必须变化
    const springMonthDays = new Set()
    for (const year of FESTIVAL_YEARS) {
      springMonthDays.add(monthDay(lunarToGregorian(year, 1, 1)))
    }
    expect(springMonthDays.size).toBe(25)
    expect(springMonthDays.size).toBeGreaterThan(10)
    expect(monthDay(lunarToGregorian(2015, 1, 1))).toBe('02-19')
    expect(monthDay(lunarToGregorian(2026, 1, 1))).toBe('02-17')
    expect(monthDay(lunarToGregorian(2028, 1, 1))).toBe('01-26')
    expect(monthDay(lunarToGregorian(2015, 1, 1))).not.toBe(monthDay(lunarToGregorian(2026, 1, 1)))
  })

  it('农历月日 → 公历年的辅助函数：年内定位、年内两次出现的歧义、以及不存在的月日', () => {
    // 常规：2026 中秋（八月十五）落在 2026 年内，且与权威表一致
    expect(fullDate(lunarMonthDayToGregorian(2026, 8, 15))).toBe('2026-09-25')
    expect(fullDate(lunarMonthDayToGregorian(2026, 1, 15))).toBe('2026-03-03')
    // 该年没有这个闰月 → null
    expect(lunarMonthDayToGregorian(2026, 4, 1, true)).toBeNull()
    expect(lunarMonthDayOccurrences(2026, 4, 1, true)).toEqual([])

    // 公历年内可能出现两次同一农历月日（农历年 G-1 的年末 + 农历年 G 的年末）。
    // 例如 1901 年：十一月十五 出现在 01-05（属农历 1900 年）与 12-25（属农历 1901 年）。
    const twice = lunarMonthDayOccurrences(1901, 11, 15)
    expect(twice).toHaveLength(2)
    expect(twice.map(fullDate)).toEqual(['1901-01-05', '1901-12-25'])
    // 文档化语义：lunarMonthDayToGregorian 取该公历年内**最早**一次出现
    expect(lunarMonthDayToGregorian(1901, 11, 15)).toEqual(twice[0])

    // 穷举性质：1900–2100 × 12 个月 × {1,15,30} 日 × {平月, 闰月}
    let occurrenceChecks = 0
    for (let year = LUNAR_SUPPORT_RANGE.min; year <= LUNAR_SUPPORT_RANGE.max; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        for (const day of [1, 15, 30]) {
          for (const isLeapMonth of [false, true]) {
            occurrenceChecks += 1
            const occurrences = lunarMonthDayOccurrences(year, month, day, isLeapMonth)
            // 最多两次：只可能来自农历年 G-1 与 G
            expect(occurrences.length).toBeLessThanOrEqual(2)
            for (const occurrence of occurrences) expect(occurrence.year).toBe(year)
            const sorted = [...occurrences].sort(
              (a, b) => a.month - b.month || a.day - b.day
            )
            expect(occurrences).toEqual(sorted)
            const first = lunarMonthDayToGregorian(year, month, day, isLeapMonth)
            expect(first).toEqual(occurrences.length > 0 ? occurrences[0] : null)
          }
        }
      }
    }
    expect(occurrenceChecks).toBe(14472)

    // 不存在的月日：2025 / 2026 / 2027 / 2028 农历年腊月只有 29 天 —— 这正是公开报道的
    // "2025–2029 连续五年没有大年三十"（除夕为腊月廿九）。
    for (const year of [2024, 2025, 2026, 2027, 2028]) {
      expect({ year, days: lunarMonthDays(year, 12) }).toEqual({ year, days: 29 })
      expect(lunarToGregorian(year, 12, 30)).toBeNull()
      expect(lunarMonthDayToGregorian(year + 1, 12, 30)).toBeNull()
    }
    // 2030 年的除夕回到腊月三十（农历 2029 年腊月 30 天）
    expect(lunarMonthDays(2029, 12)).toBe(30)
    expect(fullDate(lunarToGregorian(2029, 12, 30))).toBe('2030-02-02')

    // 从某天起的下一次出现（纪念日倒计时）
    expect(fullDate(nextLunarMonthDayOnOrAfter('2026-01-01', 1, 15))).toBe('2026-03-03')
    expect(fullDate(nextLunarMonthDayOnOrAfter('2026-03-03', 1, 15))).toBe('2026-03-03')
    expect(fullDate(nextLunarMonthDayOnOrAfter('2026-03-04', 1, 15))).toBe('2027-02-20')
    expect(fullDate(nextLunarMonthDayOnOrAfter('2026-06-01', 8, 15))).toBe('2026-09-25')
  })
})