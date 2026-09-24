// 农历（夏历）与公历互转：纯函数、零依赖、零网络、零存储。
//
// 数据来源：业界通行的农历位压缩表（`lunarInfo`，公历 1900–2100，共 201 项）。
// 该编码是 1900–2100 年常见实现（calendar.js / lunar-javascript 等）共用的
// 同一张紫金山天文台历表，本文件把它内联固化，运行时不拉取任何数据。
//
// 每一位的含义：
//   bit 0–3    （& 0xf）：闰月月份，0 表示该农历年无闰月，1–12 表示闰几月。
//   bit 4–15   （& 0x10000 >> m）：第 m 个平月的天数，置位 30 天，否则 29 天。
//   bit 16     （& 0x10000）：闰月的天数，置位 30 天，否则 29 天。
// 时间基准：农历 1900 年正月初一 == 公历 1900-01-31（UTC 日序号基准）。
//
// 已知边界（明确声明，不做静默兜底）：
//   - 只覆盖公历 1900-01-31 ~ 2101-01-28（即农历 1900 年正月初一 ~ 农历 2100 年腊月最后一天）。
//     超出该区间的输入一律返回 null，既不抛异常，也不猜测、不回退到邻近日期。
//   - 1900 年之前的农历数据不在表内，无法转换。
//   - 农历年与公历年不同：春节前属于上一个农历年（例如 2026-01-15 属于农历 2025 年腊月）。
//     需要"某个公历年内这个农历月日是哪天"时用 lunarMonthDayToGregorian()。
//   - 闰月是独立月份，不并入平月：isLeapMonth=true 时若该农历年没有这个闰月，返回 null。
//   - 农历月有大小月（29/30 天），因此"腊月三十""正月三十"这类日期并非每年都存在。

// 公历 1900–2100 农历数据表（下标 0 == 1900 年）。
export const LUNAR_INFO = Object.freeze([
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b5a0, 0x195a6, // 1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
  0x0d520, // 2100
])

const LUNAR_YEAR_MIN = 1900
const LUNAR_YEAR_MAX = 2100

// 农历年区间。对应可转换的公历日期区间见 GREGORIAN_SUPPORT_RANGE。
export const LUNAR_SUPPORT_RANGE = Object.freeze({ min: LUNAR_YEAR_MIN, max: LUNAR_YEAR_MAX })

const MS_PER_DAY = 86400000
// 农历 1900 年正月初一 == 公历 1900-01-31（UTC 零点，全程用 UTC 运算以避开时区与夏令时）。
const EPOCH_UTC = Date.UTC(1900, 0, 31)

const GREGORIAN_MONTH_DAYS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])

function isGregorianLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function gregorianMonthDays(year, month) {
  if (month === 2 && isGregorianLeapYear(year)) return 29
  return GREGORIAN_MONTH_DAYS[month - 1]
}

function isValidGregorianYmd(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > gregorianMonthDays(year, month)) return false
  return true
}

/** 把 Date / 'YYYY-MM-DD' / {year,month,day} 归一为公历年月日；无法解析返回 null。 */
function toGregorianYmd(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() }
  }
  if (typeof value === 'string') {
    const matched = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim())
    if (!matched) return null
    const year = Number(matched[1])
    const month = Number(matched[2])
    const day = Number(matched[3])
    return isValidGregorianYmd(year, month, day) ? { year, month, day } : null
  }
  if (value && typeof value === 'object') {
    const year = Number(value.year)
    const month = Number(value.month)
    const day = Number(value.day)
    return isValidGregorianYmd(year, month, day) ? { year, month, day } : null
  }
  return null
}

function utcToGregorianYmd(utc) {
  const date = new Date(utc)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

function gregorianYmdToUtc({ year, month, day }) {
  return Date.UTC(year, month - 1, day)
}

function ymdValue({ year, month, day }) {
  return year * 10000 + month * 100 + day
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** 公历日期（'YYYY-MM-DD' / Date / {year,month,day}）是否落在可转换区间内。 */
export function isGregorianDateSupported(value) {
  const ymd = toGregorianYmd(value)
  if (!ymd) return false
  const utc = gregorianYmdToUtc(ymd)
  return utc >= EPOCH_UTC && utc <= GREGORIAN_SUPPORT_LAST_UTC
}

/** 农历年份（不是公历年份）是否在表覆盖范围内。 */
export function isLunarYearSupported(year) {
  return Number.isInteger(year) && year >= LUNAR_YEAR_MIN && year <= LUNAR_YEAR_MAX
}

/** 该农历年的闰月月份；0 表示无闰月。年份越界返回 0。 */
export function lunarLeapMonth(year) {
  if (!isLunarYearSupported(year)) return 0
  return LUNAR_INFO[year - LUNAR_YEAR_MIN] & 0xf
}

/** 该农历年闰月的天数；无闰月或年份越界返回 0。 */
export function lunarLeapMonthDays(year) {
  if (!lunarLeapMonth(year)) return 0
  return LUNAR_INFO[year - LUNAR_YEAR_MIN] & 0x10000 ? 30 : 29
}

/** 该农历年第 month 个**平月**的天数（29 / 30）；参数非法返回 0。闰月请用 lunarLeapMonthDays。 */
export function lunarMonthDays(year, month) {
  if (!isLunarYearSupported(year)) return 0
  if (!Number.isInteger(month) || month < 1 || month > 12) return 0
  return LUNAR_INFO[year - LUNAR_YEAR_MIN] & (0x10000 >> month) ? 30 : 29
}

/** 该农历年的总天数（353–385）；年份越界返回 0。 */
export function lunarYearDays(year) {
  if (!isLunarYearSupported(year)) return 0
  let sum = 348
  for (let bit = 0x8000; bit > 0x8; bit >>= 1) {
    if (LUNAR_INFO[year - LUNAR_YEAR_MIN] & bit) sum += 1
  }
  return sum + lunarLeapMonthDays(year)
}

const TOTAL_DAYS_TO_2100_END = (() => {
  let total = 0
  for (let year = LUNAR_YEAR_MIN; year <= LUNAR_YEAR_MAX; year += 1) total += lunarYearDays(year)
  return total
})()

const GREGORIAN_SUPPORT_LAST_UTC = EPOCH_UTC + (TOTAL_DAYS_TO_2100_END - 1) * MS_PER_DAY

// 实际可转换的公历年份区间：1900（自 1900-01-31 起）~ 表内最后一个农历日所在的公历年。
export const GREGORIAN_SUPPORT_RANGE = Object.freeze({
  min: utcToGregorianYmd(EPOCH_UTC).year,
  max: utcToGregorianYmd(GREGORIAN_SUPPORT_LAST_UTC).year,
})

/** 可转换区间的最后一天（公历 'YYYY-MM-DD'）。 */
export const GREGORIAN_SUPPORT_LAST_DATE = (() => {
  const { year, month, day } = utcToGregorianYmd(GREGORIAN_SUPPORT_LAST_UTC)
  return `${year}-${pad2(month)}-${pad2(day)}`
})()

/**
 * 农历 → 公历。
 *
 * @param {number} year 农历年
 * @param {number} month 农历月 1–12
 * @param {number} day 农历日 1–30
 * @param {boolean} [isLeapMonth=false] 是否为闰月；该年无此闰月时返回 null（绝不回退到平月）
 * @returns {{year:number, month:number, day:number}|null} 公历年月日；不存在 / 越界 / 参数非法均返回 null
 */
export function lunarToGregorian(year, month, day, isLeapMonth = false) {
  if (!isLunarYearSupported(year)) return null
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  if (!Number.isInteger(day) || day < 1 || day > 30) return null

  const leap = lunarLeapMonth(year)
  if (isLeapMonth) {
    // 闰月必须真实存在，且天数按闰月自身的大小月判定。
    if (leap !== month) return null
    if (day > lunarLeapMonthDays(year)) return null
  } else if (day > lunarMonthDays(year, month)) {
    return null
  }

  let offset = 0
  for (let y = LUNAR_YEAR_MIN; y < year; y += 1) offset += lunarYearDays(y)
  for (let m = 1; m < month; m += 1) {
    offset += lunarMonthDays(year, m)
    // 闰月排在同名平月之后。
    if (leap === m) offset += lunarLeapMonthDays(year)
  }
  if (isLeapMonth) offset += lunarMonthDays(year, month)
  offset += day - 1

  return utcToGregorianYmd(EPOCH_UTC + offset * MS_PER_DAY)
}

/**
 * 公历 → 农历。
 *
 * @param {Date|string|{year:number,month:number,day:number}} date 公历日期（'YYYY-MM-DD' 按字面量解析，不经时区）
 * @returns {{year:number, month:number, day:number, isLeapMonth:boolean}|null}
 */
export function gregorianToLunar(date) {
  const ymd = toGregorianYmd(date)
  if (!ymd) return null
  const offset = Math.round((gregorianYmdToUtc(ymd) - EPOCH_UTC) / MS_PER_DAY)
  if (offset < 0 || offset >= TOTAL_DAYS_TO_2100_END) return null

  let remaining = offset
  let year = LUNAR_YEAR_MIN
  while (year <= LUNAR_YEAR_MAX) {
    const days = lunarYearDays(year)
    if (remaining < days) break
    remaining -= days
    year += 1
  }
  if (year > LUNAR_YEAR_MAX) return null

  const leap = lunarLeapMonth(year)
  let month = 1
  let isLeapMonth = false
  while (month <= 12) {
    const days = lunarMonthDays(year, month)
    if (remaining < days) break
    remaining -= days
    if (leap === month) {
      const leapDays = lunarLeapMonthDays(year)
      if (remaining < leapDays) {
        isLeapMonth = true
        break
      }
      remaining -= leapDays
    }
    month += 1
  }
  if (month > 12) return null

  return { year, month, day: remaining + 1, isLeapMonth }
}

/**
 * 某个**公历年**内该农历「月-日」出现的所有公历日期（升序）。
 *
 * 公历年 G 内可能出现两次同一农历月日：农历年 G-1 的年末（腊月/冬月，落在 G 的 1–3 月）
 * 与农历年 G 的年末（落在 G 的 12 月）。因此这里返回列表而非单值。
 */
export function lunarMonthDayOccurrences(gregorianYear, lunarMonth, lunarDay, isLeapMonth = false) {
  if (!Number.isInteger(gregorianYear)) return []
  const occurrences = []
  // 与公历年 G 有交集的农历年只有 G-1 与 G。
  for (let lunarYear = gregorianYear - 1; lunarYear <= gregorianYear; lunarYear += 1) {
    const date = lunarToGregorian(lunarYear, lunarMonth, lunarDay, isLeapMonth)
    if (!date) continue
    if (date.year === gregorianYear) occurrences.push(date)
  }
  return occurrences.sort((a, b) => ymdValue(a) - ymdValue(b))
}

/**
 * 纪念日辅助：某个公历年内该农历「月-日」对应哪一天（取该年内**最早**一次出现）。
 *
 * 例：lunarMonthDayToGregorian(2026, 8, 15) → 2026 年中秋（公历 2026-09-25）。
 * 例：lunarMonthDayToGregorian(2026, 4, 1, true) → 2026 年无闰四月 → null。
 * 若关心一年内两次出现（仅腊月/冬月等年末月份可能发生），用 lunarMonthDayOccurrences。
 *
 * @returns {{year:number, month:number, day:number}|null}
 */
export function lunarMonthDayToGregorian(gregorianYear, lunarMonth, lunarDay, isLeapMonth = false) {
  const occurrences = lunarMonthDayOccurrences(gregorianYear, lunarMonth, lunarDay, isLeapMonth)
  return occurrences.length > 0 ? occurrences[0] : null
}

/**
 * 纪念日辅助：从 from 当天起的下一次该农历「月-日」（含 from 当天）。
 *
 * 农历大小月会让「腊月三十」之类的日期在某些年份根本不存在，这里最多向后找 5 个公历年，
 * 找不到（或超出支持区间）返回 null。
 *
 * @param {Date|string|{year:number,month:number,day:number}} from
 * @returns {{year:number, month:number, day:number}|null}
 */
export function nextLunarMonthDayOnOrAfter(from, lunarMonth, lunarDay, isLeapMonth = false) {
  const ymd = toGregorianYmd(from)
  if (!ymd) return null
  if (!isGregorianDateSupported(ymd)) return null
  if (!Number.isInteger(lunarMonth) || lunarMonth < 1 || lunarMonth > 12) return null
  if (!Number.isInteger(lunarDay) || lunarDay < 1 || lunarDay > 30) return null

  const fromValue = ymdValue(ymd)
  const lastYear = Math.min(ymd.year + 5, GREGORIAN_SUPPORT_RANGE.max)
  for (let year = ymd.year; year <= lastYear; year += 1) {
    for (const occurrence of lunarMonthDayOccurrences(year, lunarMonth, lunarDay, isLeapMonth)) {
      if (ymdValue(occurrence) >= fromValue) return occurrence
    }
  }
  return null
}