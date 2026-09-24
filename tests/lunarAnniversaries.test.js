// @vitest-environment node
//
// 农历纪念日纯逻辑层（src/composables/lunarAnniversaries.js）与它在 festive.js 里的接线。
// 全部为纯函数断言：不联网、不读外部文本、不新增依赖。
//
// 关键判据是**不许静默回退**：农历月日"今年不存在"时必须给出明确状态，
// 不能悄悄按平月或邻近日期算。本文件为这条写了两层对照（纯函数层 + 氛围层）。
//
// 交叉验证用第一阶段已建立的资产：festive.js 的 LUNAR_FESTIVAL_DATES（2015–2050，
// 由 lunar-javascript 生成后固化，且已与香港天文台对照表互验过）。

import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_FESTIVE_CONFIG, LUNAR_FESTIVAL_DATES, festiveFor } from '../src/composables/festive.js'
import { gregorianToLunar, lunarMonthDayOccurrences } from '../src/composables/lunar.js'
import {
  LUNAR_ANNIVERSARY_HINT,
  LUNAR_ANNIVERSARY_PRESENTATION,
  LUNAR_ANNIVERSARY_STATUS,
  LUNAR_ANNIVERSARY_STATUS_TEXT,
  findLunarAnniversaryForDate,
  formatLunarDate,
  lunarDayName,
  normalizeLunarAnniversaries,
  publishLunarAnniversaries,
  resetLunarAnniversaryMirror,
  resolveLunarAnniversary,
  resolveLunarAnniversaries,
} from '../src/composables/lunarAnniversaries.js'

const { OK, OUT_OF_RANGE, NO_SUCH_DAY, NO_SUCH_LEAP_MONTH, NOT_IN_YEAR, INVALID } = LUNAR_ANNIVERSARY_STATUS

const pad2 = (value) => String(value).padStart(2, '0')

/** 造一条农历纪念日配置。 */
function entry(overrides = {}) {
  return { label: '纪念日', lunarMonth: 1, lunarDay: 1, ...overrides }
}

/** 解析一条农历纪念日（标签固定，只关心月日）。 */
function resolve(overrides, today) {
  return resolveLunarAnniversary(entry(overrides), today)
}

// 内存镜像会跨用例留存（模块级状态），每个用例后复位，避免互相污染。
afterEach(() => {
  resetLunarAnniversaryMirror()
})

describe('农历纪念日：四种不可用状态各有一条断言', () => {
  it('产品要求的三条文案逐字固定（防止文案漂移）', () => {
    expect(LUNAR_ANNIVERSARY_STATUS_TEXT[OUT_OF_RANGE]).toBe('超出农历支持范围（1900–2101）')
    expect(LUNAR_ANNIVERSARY_STATUS_TEXT[NO_SUCH_DAY]).toBe('该农历年这个月是小月，没有三十')
    expect(LUNAR_ANNIVERSARY_STATUS_TEXT[NO_SUCH_LEAP_MONTH]).toBe('该年没有这个闰月')
    expect(LUNAR_ANNIVERSARY_STATUS_TEXT[OK]).toBe('')
    // 面板上必须写明支持区间与闰月口径
    expect(LUNAR_ANNIVERSARY_HINT.support).toContain('1900–2101')
    expect(LUNAR_ANNIVERSARY_HINT.support).toContain('闰月')
    expect(LUNAR_ANNIVERSARY_HINT.support).toContain('三十')
  })

  it('ok：给出该公历年的日期与距今天数', () => {
    const today = resolve({ lunarMonth: 5, lunarDay: 5 }, '2026-06-19')
    expect(today.status).toBe(OK)
    expect(today.statusText).toBe('')
    expect(today.dateKey).toBe('2026-06-19')
    expect(today.daysFromToday).toBe(0)
    expect(today.relativeText).toBe('就是今天')
    expect(today.lunarText).toBe('五月初五')

    const future = resolve({ lunarMonth: 8, lunarDay: 15 }, '2026-06-19')
    expect(future.dateKey).toBe('2026-09-25')
    expect(future.daysFromToday).toBe(98)
    expect(future.relativeText).toBe('98 天后')

    // 一年内更早的那一次（腊月初八落在本公历年的 1 月），并给出下一次提示
    const past = resolve({ lunarMonth: 12, lunarDay: 8 }, '2026-06-19')
    expect(past.dateKey).toBe('2026-01-26')
    expect(past.daysFromToday).toBe(-144)
    expect(past.relativeText).toBe('已过 144 天')
    expect(past.nextText).toBe('下一次 2027-01-15')
  })

  it('out-of-range：公历年超出农历支持区间（1900–2101）', () => {
    for (const today of ['1899-06-15', '2102-06-15']) {
      const resolved = resolve({}, today)
      expect(resolved.status).toBe(OUT_OF_RANGE)
      expect(resolved.statusText).toBe('超出农历支持范围（1900–2101）')
      expect(resolved.dateKey).toBe('')
      expect(resolved.daysFromToday).toBeNull()
    }
    // 区间边缘仍可用：1900 年（自 1900-01-31 起）与 2101 年（至 2101-01-28）
    expect(resolve({ lunarMonth: 1, lunarDay: 1 }, '1900-06-15').dateKey).toBe('1900-01-31')
    // 2101 年仍受支持（不是 out-of-range）：腊月十五落在 2101-01-14，表内最后一天是 2101-01-28
    expect(resolve({ lunarMonth: 12, lunarDay: 15 }, '2101-01-05').status).toBe(OK)
    expect(resolve({ lunarMonth: 12, lunarDay: 15 }, '2101-01-05').dateKey).toBe('2101-01-14')
    // 而 2101 年不可能有正月初一（下一个春节 2101-01-29 已超出表尾）→ 明确给状态，不猜值
    expect(resolve({ lunarMonth: 1, lunarDay: 1 }, '2101-01-05').status).toBe(NOT_IN_YEAR)
  })

  it('no-such-day：该农历年这个月是小月，没有三十', () => {
    const resolved = resolve({ lunarMonth: 12, lunarDay: 30 }, '2026-06-19')
    expect(resolved.status).toBe(NO_SUCH_DAY)
    expect(resolved.statusText).toBe('该农历年这个月是小月，没有三十')
    expect(resolved.dateKey).toBe('')
    // 2024–2028 农历年腊月都是 29 天 → 2025–2029 连续五年"没有大年三十"，下一次在 2030-02-02
    expect(LUNAR_ANNIVERSARY_STATUS_TEXT[resolved.status]).toBe('该农历年这个月是小月，没有三十')
    expect(resolved.nextDateKey).toBe('2030-02-02')
    expect(resolved.nextText).toBe('下一次 2030-02-02')

    // 原因必须对得上"用户看到的那个年"：1902 年没有二月三十，是农历 1902 年二月为小月，
    // 而不是"落在次年 1 月"（后者只在冬月/腊月等年界月份成立）。
    expect(resolve({ lunarMonth: 2, lunarDay: 30 }, '1902-06-15').status).toBe(NO_SUCH_DAY)
    // 三月只有 29 天的年份：2050 年三月三十同样不存在
    expect(resolve({ lunarMonth: 3, lunarDay: 30 }, '2050-06-15').status).toBe(NO_SUCH_DAY)
  })

  it('no-such-leap-month：勾了闰月但该年没有这个闰月', () => {
    const resolved = resolve({ lunarMonth: 4, lunarDay: 1, isLeapMonth: true }, '2026-06-19')
    expect(resolved.status).toBe(NO_SUCH_LEAP_MONTH)
    expect(resolved.statusText).toBe('该年没有这个闰月')
    expect(resolved.dateKey).toBe('')
    expect(resolved.lunarText).toBe('闰四月初一')

    // 1901 年没有闰月（闰八月在 1900 年，落在 1900 年内）→ 1901 年内找不到闰八月
    expect(resolve({ lunarMonth: 8, lunarDay: 1, isLeapMonth: true }, '1901-06-15').status).toBe(NO_SUCH_LEAP_MONTH)
    // 勾了闰月、该年也确实有闰月，但**不是这个月**：仍然报"没有这个闰月"
    expect(resolve({ lunarMonth: 5, lunarDay: 1, isLeapMonth: true }, '2020-06-15').status).toBe(NO_SUCH_LEAP_MONTH)
  })

  it('not-in-year（第 5 种状态，年界补充）：日期存在但不落在本公历年内', () => {
    const resolved = resolve({ lunarMonth: 12, lunarDay: 8 }, '1900-06-01')
    expect(resolved.status).toBe(NOT_IN_YEAR)
    expect(resolved.statusText).toContain('本公历年内没有这个农历日')
    expect(resolved.nextDateKey).toBe('1901-01-27')

    expect(resolve({ lunarMonth: 11, lunarDay: 25 }, '2101-01-05').status).toBe(NOT_IN_YEAR)

    // 对照：同一个腊月初八在 2026 年是能落到本公历年内的（1 月 26 日）→ ok
    expect(resolve({ lunarMonth: 12, lunarDay: 8 }, '2026-06-19').status).toBe(OK)
  })

  it('invalid：农历月日不合法（防御性，正常会被归一化丢掉）', () => {
    expect(resolve({ lunarMonth: 13, lunarDay: 1 }, '2026-06-19').status).toBe(INVALID)
    expect(resolve({ lunarMonth: 1, lunarDay: 31 }, '2026-06-19').status).toBe(INVALID)
    // 标签为空**不算**错误：面板里刚新建、还没起名的行也要能显示落点
    const unnamed = resolveLunarAnniversary({ label: '', lunarMonth: 5, lunarDay: 5 }, '2026-06-19')
    expect(unnamed.status).toBe(OK)
    expect(unnamed.dateKey).toBe('2026-06-19')
  })
})

describe('农历纪念日：闰月必须真支持，且不许静默回退成平月', () => {
  it('闰月存在时给出正确日期，且该日期确实被标成闰月', () => {
    const leap = resolve({ lunarMonth: 4, lunarDay: 1, isLeapMonth: true }, '2020-06-01')
    expect(leap.status).toBe(OK)
    expect(leap.dateKey).toBe('2020-05-23')
    // 与历法模块互证：2020-05-23 反解回来必须是闰四月初一
    expect(gregorianToLunar('2020-05-23')).toEqual({ year: 2020, month: 4, day: 1, isLeapMonth: true })

    // 2050 年闰三月 30 天（香港天文台对照表逐日核对过），闰三月三十 = 2050-05-20
    const leapThirty = resolve({ lunarMonth: 3, lunarDay: 30, isLeapMonth: true }, '2050-06-15')
    expect(leapThirty.status).toBe(OK)
    expect(leapThirty.dateKey).toBe('2050-05-20')
    expect(leapThirty.lunarText).toBe('闰三月三十')
  })

  it('判别力对照：闰月不存在时返回状态而不是平月日期', () => {
    const today = '2026-06-19'
    const leap = resolve({ lunarMonth: 4, lunarDay: 1, isLeapMonth: true }, today)
    const plain = resolve({ lunarMonth: 4, lunarDay: 1, isLeapMonth: false }, today)

    expect(plain.status).toBe(OK)
    expect(plain.dateKey).toBe('2026-05-17') // 平四月初一本来就在这天
    expect(leap.status).toBe(NO_SUCH_LEAP_MONTH)
    expect(leap.dateKey).toBe('')
    // 若实现"静默当成平月"，这里就会等于平月日期 —— 这条断言就是防它
    expect(leap.dateKey).not.toBe(plain.dateKey)
    expect(leap.dateKey).toBe('')
  })

  it('判别力对照（氛围层）：闰月纪念日不会在平月那天点亮首页', () => {
    publishLunarAnniversaries([{ label: '闰四月纪念', lunarMonth: 4, lunarDay: 1, isLeapMonth: true }])
    // 平四月初一那天：绝不能命中（否则就是偷偷按平月算了）
    expect(festiveFor('2026-05-17', DEFAULT_FESTIVE_CONFIG)).toBeNull()
    // 平四月十五、闰四月初一之外的日期同样不命中
    expect(festiveFor('2026-05-31', DEFAULT_FESTIVE_CONFIG)).toBeNull()
    // 真有闰四月的那一年（2020）才命中
    const hit = festiveFor('2020-05-23', DEFAULT_FESTIVE_CONFIG)
    expect(hit?.key).toBe('anniversary')
    expect(hit?.name).toBe('闰四月纪念')
  })

  it('穷举：1900–2101 每个公历年 × 12 个月 × 4 个日子 × 平/闰，状态自洽', () => {
    const allowed = new Set([OK, OUT_OF_RANGE, NO_SUCH_DAY, NO_SUCH_LEAP_MONTH, NOT_IN_YEAR, INVALID])
    let checks = 0
    const problems = []
    for (let year = 1900; year <= 2101; year += 1) {
      const today = `${year}-06-15`
      for (let month = 1; month <= 12; month += 1) {
        for (const day of [1, 15, 29, 30]) {
          for (const isLeapMonth of [false, true]) {
            checks += 1
            const resolved = resolve({ lunarMonth: month, lunarDay: day, isLeapMonth }, today)
            const occurrences = lunarMonthDayOccurrences(year, month, day, isLeapMonth)
            if (!allowed.has(resolved.status)) problems.push(`${today} ${month}-${day}${isLeapMonth ? '闰' : ''}: 未知状态 ${resolved.status}`)
            // ok ⟺ 该公历年内真的存在这一天（历法模块说了算）
            if ((resolved.status === OK) !== (occurrences.length > 0)) {
              problems.push(`${today} ${month}-${day}${isLeapMonth ? '闰' : ''}: 状态 ${resolved.status} 与 occurrences=${occurrences.length} 不一致`)
            }
            if (resolved.status === INVALID) problems.push(`${today} ${month}-${day}${isLeapMonth ? '闰' : ''}: 合法月日被判为 invalid`)
            if (resolved.status === OK) {
              if (!resolved.dateKey.startsWith(`${year}-`)) problems.push(`${today} ${month}-${day}: 落点 ${resolved.dateKey} 不在本年`)
              if (resolved.statusText !== '') problems.push(`${today} ${month}-${day}: ok 却有状态文案`)
              if (typeof resolved.daysFromToday !== 'number') problems.push(`${today} ${month}-${day}: ok 却没有距今天数`)
            } else if (!resolved.statusText) {
              problems.push(`${today} ${month}-${day}: 不可用状态却没有文案`)
            }
          }
        }
      }
    }
    // 202 年 × 12 月 × 4 日 × 2 = 19392 个检查点（防止循环写错导致"零检查也算绿"）
    expect(checks).toBe(19392)
    expect(problems).toEqual([])
  })
})

describe('农历纪念日：与节日表资产交叉验证 + 归一化 + 写法', () => {
  it('落在已知节日上的农历纪念日，日期必须与 festive.js 权威表一致', () => {
    const festivals = [
      { key: 'spring', month: 1, day: 1 },
      { key: 'lantern', month: 1, day: 15 },
      { key: 'dragon', month: 5, day: 5 },
      { key: 'midautumn', month: 8, day: 15 },
      { key: 'chongyang', month: 9, day: 9 },
    ]
    const years = [2015, 2020, 2026, 2033, 2050]
    const mismatches = []
    let points = 0
    for (const year of years) {
      const row = LUNAR_FESTIVAL_DATES[year]
      expect(row).toBeTruthy()
      for (const festival of festivals) {
        const expected = Object.entries(row).find(([, key]) => key === festival.key)?.[0]
        expect(expected).toBeTruthy()
        const resolved = resolve({ lunarMonth: festival.month, lunarDay: festival.day }, `${year}-01-01`)
        points += 1
        if (resolved.dateKey.slice(5) !== expected) {
          mismatches.push(`${year} ${festival.key}: 权威表 ${expected}，纪念日解析 ${resolved.dateKey || resolved.status}`)
        }
      }
    }
    expect(points).toBe(25)
    expect(mismatches).toEqual([])
  })

  it('整表解析：resolveLunarAnniversaries 支持数组与 { lunarAnniversaries } 两种入参', () => {
    const list = [
      { label: '外婆生日', lunarMonth: 5, lunarDay: 5 },
      { label: '爷爷生日', lunarMonth: 8, lunarDay: 15, isLeapMonth: false },
    ]
    const fromArray = resolveLunarAnniversaries(list, '2026-06-19')
    const fromConfig = resolveLunarAnniversaries({ lunarAnniversaries: list }, '2026-06-19')
    expect(fromArray.map((item) => item.dateKey)).toEqual(['2026-06-19', '2026-09-25'])
    expect(fromConfig.map((item) => item.dateKey)).toEqual(['2026-06-19', '2026-09-25'])
    // 空标签条目在**解析**层保留（面板里能显示落点），在**持久化**层才被丢弃
    const unnamed = resolveLunarAnniversaries([{ label: '', lunarMonth: 1, lunarDay: 1 }], '2026-06-19')
    expect(unnamed).toHaveLength(1)
    expect(unnamed[0].status).toBe(OK)
    expect(unnamed[0].dateKey).toBe('2026-02-17')
    expect(normalizeLunarAnniversaries([{ label: '', lunarMonth: 1, lunarDay: 1 }])).toEqual([])
    // 但没名字的条目不会点亮首页（没有名字就没法写祝福语）
    expect(findLunarAnniversaryForDate('2026-02-17', { lunarAnniversaries: [{ label: '', lunarMonth: 1, lunarDay: 1 }] })).toBeNull()
  })

  it('归一化：空标签与越界月日丢弃，字符串数字被接受，闰月只认 true', () => {
    const normalized = normalizeLunarAnniversaries([
      { label: ' 腊八 ', lunarMonth: 12, lunarDay: 8, isLeapMonth: false },
      { label: '', lunarMonth: 1, lunarDay: 1 },
      { label: '   ', lunarMonth: 1, lunarDay: 1 },
      { label: '越界月', lunarMonth: 13, lunarDay: 1 },
      { label: '越界日', lunarMonth: 1, lunarDay: 31 },
      { label: '零月', lunarMonth: 0, lunarDay: 1 },
      { label: '字符串', lunarMonth: '5', lunarDay: '5', isLeapMonth: 'true' },
      { label: '真闰月', lunarMonth: 4, lunarDay: 1, isLeapMonth: true },
      null,
      'x',
      [],
    ])
    expect(normalized.map((item) => item.label)).toEqual(['腊八', '字符串', '真闰月'])
    expect(normalized[0]).toEqual({ id: 'lunar-12-8-S', label: '腊八', lunarMonth: 12, lunarDay: 8, isLeapMonth: false })
    // isLeapMonth 只认真布尔 true：字符串 'true' 不算（避免坏数据把平月当闰月）
    expect(normalized[1].isLeapMonth).toBe(false)
    expect(normalized[2].isLeapMonth).toBe(true)
    expect(normalizeLunarAnniversaries('nope')).toEqual([])
    expect(normalizeLunarAnniversaries(null)).toEqual([])
  })

  it('农历月日的可读写法', () => {
    expect([1, 10, 11, 15, 20, 21, 29, 30].map((day) => lunarDayName(day))).toEqual([
      '初一', '初十', '十一', '十五', '二十', '廿一', '廿九', '三十',
    ])
    expect(lunarDayName(0)).toBe('')
    expect(lunarDayName(31)).toBe('')
    expect(formatLunarDate(4, 8, true)).toBe('闰四月初八')
    expect(formatLunarDate(12, 30)).toBe('腊月三十')
    expect(formatLunarDate(11, 15)).toBe('冬月十五')
    expect(formatLunarDate(13, 1)).toBe('')
  })

  it('"一年两次"取最早一次（与 lunar.js 的既定语义一致）', () => {
    // 1901 年：十一月十五 出现在 01-05（农历 1900 年）与 12-25（农历 1901 年）
    const occurrences = lunarMonthDayOccurrences(1901, 11, 15)
    expect(occurrences).toHaveLength(2)
    const resolved = resolve({ lunarMonth: 11, lunarDay: 15 }, '1901-06-15')
    expect(resolved.dateKey).toBe('1901-01-05')
    expect(resolved.dateKey).toBe(`${occurrences[0].year}-${pad2(occurrences[0].month)}-${pad2(occurrences[0].day)}`)
  })
})

describe('农历纪念日接入 festive.js 的氛围判断（纯加法）', () => {
  it('命中时走既有装饰与配色机制，不新增动效令牌', () => {
    publishLunarAnniversaries([{ label: '外婆生日', lunarMonth: 5, lunarDay: 5 }])
    const overlay = festiveFor('2026-06-19', DEFAULT_FESTIVE_CONFIG)
    // 复用既有纪念日 key：App.vue 的 ANNIVERSARY_KEYS 才会给它金色粒子与光环，
    // 而 App.vue / style.css 都不在本次允许改动的文件里（换新 key 会静默退回彩带）。
    expect(overlay.key).toBe('anniversary')
    expect(LUNAR_ANNIVERSARY_PRESENTATION.key).toBe('anniversary')
    expect(overlay.name).toBe('外婆生日')
    expect(overlay.decor).toBe('confetti') // 既有令牌
    expect(overlay.accentColor).toBe(LUNAR_ANNIVERSARY_PRESENTATION.accentColor)
    expect(overlay.message).toBe('外婆生日快乐，一起记住今天。')
  })

  it('未配置农历纪念日时，既有行为与改动前完全一致（走内置节日）', () => {
    const overlay = festiveFor('2026-06-19', DEFAULT_FESTIVE_CONFIG)
    expect(overlay.key).toBe('dragon')
    expect(overlay.name).toBe('端午节')
  })

  it('既有优先级不变：生日与公历纪念日仍然优先于农历纪念日', () => {
    publishLunarAnniversaries([{ label: '外婆生日', lunarMonth: 5, lunarDay: 5 }])
    expect(festiveFor('2026-06-19', { ...DEFAULT_FESTIVE_CONFIG, birthday: '06-19' })?.key).toBe('birthday')
    expect(
      festiveFor('2026-06-19', { ...DEFAULT_FESTIVE_CONFIG, anniversaries: [{ date: '06-19', label: '在一起' }] })?.name,
    ).toBe('在一起')
  })

  it('农历纪念日与"使用周年"同一天时，农历纪念日优先（记录这一取舍）', () => {
    publishLunarAnniversaries([{ label: '外婆生日', lunarMonth: 5, lunarDay: 5 }])
    // 农历纪念日与公历纪念日同属"个人节点"层，排在生日/纪念日之后、使用周年之前。
    const winner = festiveFor('2026-06-19', { ...DEFAULT_FESTIVE_CONFIG, installDate: '2020-06-19' })
    expect(winner?.key).toBe('anniversary')
    expect(winner?.name).toBe('外婆生日') // 不是"使用周年"
    // 不配置农历纪念日时，"使用周年"照旧命中
    publishLunarAnniversaries([])
    expect(festiveFor('2026-06-19', { ...DEFAULT_FESTIVE_CONFIG, installDate: '2020-06-19' })?.key).toBe('anniversary-start')
  })

  it('findLunarAnniversaryForDate：显式 config.lunarAnniversaries 优先，缺省读内存镜像', () => {
    const config = { lunarAnniversaries: [{ label: '自家端午', lunarMonth: 5, lunarDay: 5 }] }
    expect(findLunarAnniversaryForDate('2026-06-19', config)?.label).toBe('自家端午')
    expect(findLunarAnniversaryForDate('2026-06-20', config)).toBeNull()

    resetLunarAnniversaryMirror()
    expect(findLunarAnniversaryForDate('2026-06-19', DEFAULT_FESTIVE_CONFIG)).toBeNull()
    publishLunarAnniversaries([{ label: '镜像里的', lunarMonth: 5, lunarDay: 5 }])
    expect(findLunarAnniversaryForDate('2026-06-19', DEFAULT_FESTIVE_CONFIG)?.label).toBe('镜像里的')
    // 入参不是合法日期 → 不命中也不抛
    expect(findLunarAnniversaryForDate('not-a-date', DEFAULT_FESTIVE_CONFIG)).toBeNull()
  })
})