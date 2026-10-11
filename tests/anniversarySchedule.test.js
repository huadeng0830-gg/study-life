// @vitest-environment node
//
// 「下一次落点」与氛围引擎的**对账测试**。
//
// 这组用例的核心不是"某个函数返回了什么"，而是：**面板上写的倒计时，必须与
// 氛围引擎实际点亮的日期逐字一致**。这两处是两套代码（anniversarySchedule.js 算
// 落点、festive.js 判断当天命中），一旦它们对「02-29 在非闰年落到 02-28」这类规则
// 各写一份，面板就会说 2027-02-28、氛围却在 2027-03-01 才点亮 —— 两处单看都"对"，
// 单元测试也各自会绿，只有用户会发现倒计时说谎。
//
// 所以这里的判据形式是**穷举对账**而不是举例：遍历全部 366 个月-日 × 2026–2028
// 每一天，检查「倒计时说的那天引擎一定点亮」且「前一天引擎一定不点亮」。

import { describe, expect, it } from 'vitest'
import { festiveFor, monthDayInYear, normalizeFestiveConfig, DEFAULT_FESTIVE_CONFIG } from '../src/composables/festive.js'
import {
  ANNIVERSARY_SOURCE,
  nextMonthDayOnOrAfter,
  resolveBirthday,
  resolveInstallAnniversary,
  resolveSolarAnniversary,
  upcomingAnniversaries,
} from '../src/composables/anniversarySchedule.js'
import { daysBetweenDateKeys } from '../src/composables/lunarAnniversaries.js'

/** 全部合法的 'MM-DD'（含 02-29）。 */
const ALL_MONTH_DAYS = (() => {
  const out = []
  for (let month = 1; month <= 12; month += 1) {
    const lastDay = new Date(Date.UTC(2000, month, 0)).getUTCDate()
    for (let day = 1; day <= lastDay; day += 1) {
      out.push(`${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    }
  }
  return out
})()

/** 2026-01-01 ~ 2028-12-31 的每一天（含 2028 闰日 02-29 与 2027 非闰年 02-28）。 */
const SWEEP_DAYS = (() => {
  const out = []
  for (let t = Date.UTC(2026, 0, 1); t <= Date.UTC(2028, 11, 31); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
})()

function previousDay(dateKey) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
}

describe('与引擎对账：公历纪念日的倒计时不能说谎', () => {
  it('穷举 366 个月-日 × 1096 天：倒计时说的那天引擎必点亮，前一天必不点亮', () => {
    const mismatches = []
    for (const monthDay of ALL_MONTH_DAYS) {
      for (const today of SWEEP_DAYS) {
        const next = nextMonthDayOnOrAfter(today, monthDay)
        if (!next) { mismatches.push(`${monthDay} @${today} → 找不到落点`); break }
        const config = { enabled: true, anniversaries: [{ date: monthDay, label: '在一起' }] }
        if (festiveFor(next, config)?.key !== 'anniversary') {
          mismatches.push(`${monthDay} @${today} → 倒计时说 ${next}，引擎没点亮`)
          break
        }
        if (next > today) {
          const dayBefore = previousDay(next)
          if (festiveFor(dayBefore, config)?.key === 'anniversary') {
            mismatches.push(`${monthDay} @${today} → ${dayBefore} 就提前点亮了`)
            break
          }
        }
      }
    }
    expect(mismatches, `倒计时与引擎不一致：\n  ${mismatches.join('\n  ')}`).toEqual([])
    // 自证：这批夹具真的跑满了量级，而不是因为循环体提前退出而"什么都没检查"。
    expect(ALL_MONTH_DAYS.length).toBe(366)
    expect(SWEEP_DAYS.length).toBe(1096)
  })

  it('判别力自证：把共享规则改回"02-29 永不命中"，上面那条判据会红', () => {
    // 复刻一份"各写各的"实现：只按字符串相等判命中（也就是修复前 sameMonthDay 之外的
    // 那种直觉写法）。它在自己的年份里能点亮，却在 02-28 那天失约 —— 正是要防的分歧。
    const naive = (monthDay, today) => monthDay === today.slice(5)
    const leaked = []
    for (const today of SWEEP_DAYS) {
      const monthDay = '02-29'
      const next = nextMonthDayOnOrAfter(today, monthDay)
      if (!naive(monthDay, next)) leaked.push(next)
    }
    // 真实规则下 2028-02-29 那天的引擎会点亮；朴素实现按定义也"能点亮"，
    // 但它在 2027-02-28 / 2026-02-28 这些非闰年落点上与共享规则给出的日期不同。
    expect(nextMonthDayOnOrAfter('2027-01-01', '02-29')).toBe('2027-02-28')
    expect(naive('02-29', '2027-02-28')).toBe(false)
    expect(leaked.length).toBeGreaterThan(0)
  })

  it('02-29 的落点：非闰年落到 02-28，闰年用 02-29', () => {
    expect(monthDayInYear('02-29', 2027)).toBe('2027-02-28')
    expect(monthDayInYear('02-29', 2028)).toBe('2028-02-29')
    expect(nextMonthDayOnOrAfter('2027-03-01', '02-29')).toBe('2028-02-29')
    // 月日不合法时返回空串，而不是编一个日期出来。
    expect(monthDayInYear('02-31', 2027)).toBe('')
    expect(nextMonthDayOnOrAfter('2027-01-01', '13-01')).toBe('')
    expect(nextMonthDayOnOrAfter('不是日期', '02-29')).toBe('')
  })
})

describe('与引擎对账：使用周年要满一年才算', () => {
  it('穷举若干安装日期 × 每天：倒计时与 anniversary-start 的点亮日一致', () => {
    const installDates = ['2020-01-01', '2023-05-06', '2024-02-29', '2025-12-31', '2027-06-01']
    const mismatches = []
    for (const installDate of installDates) {
      for (const today of SWEEP_DAYS) {
        const row = resolveInstallAnniversary(installDate, today)
        const config = { enabled: true, anniversaries: [], installDate }
        if (!row) {
          if (festiveFor(today, config)?.key === 'anniversary-start') mismatches.push(`${installDate} @${today} → 返回 null 但引擎点亮`)
          continue
        }
        if (festiveFor(row.nextDateKey, config)?.key !== 'anniversary-start') {
          mismatches.push(`${installDate} @${today} → 倒计时说 ${row.nextDateKey}，引擎没点亮`)
          break
        }
        if (row.nextDateKey > today && festiveFor(previousDay(row.nextDateKey), config)?.key === 'anniversary-start') {
          mismatches.push(`${installDate} @${today} → ${previousDay(row.nextDateKey)} 提前点亮`)
          break
        }
      }
    }
    expect(mismatches, `使用周年倒计时与引擎不一致：\n  ${mismatches.join('\n  ')}`).toEqual([])
  })

  it('满一年之前没有周年：给的是"下一个周年日"，而不是安装当天', () => {
    // 安装当天（elapsed = 0）引擎不点亮周年，所以倒计时必须指向**下一年**。
    expect(resolveInstallAnniversary('2026-06-01', '2026-06-01')?.nextDateKey).toBe('2027-06-01')
    expect(resolveInstallAnniversary('2026-06-01', '2027-05-31')?.nextDateKey).toBe('2027-06-01')
    // 满一年当天：就是今天。
    expect(resolveInstallAnniversary('2026-06-01', '2027-06-01')).toMatchObject({
      nextDateKey: '2027-06-01',
      isToday: true,
      relativeText: '就是今天',
    })
    // 安装日期在未来：同样从"满一年"算起，而不是报到安装当天。
    expect(resolveInstallAnniversary('2029-06-01', '2027-01-10')?.nextDateKey).toBe('2030-06-01')
  })

  it('安装日期形状不对时不给落点，而不是编一个', () => {
    // 2023 不是闰年，'2023-02-29' 这个日期不存在。
    expect(resolveInstallAnniversary('2023-02-29', '2027-01-01')).toBeNull()
    expect(resolveInstallAnniversary('', '2027-01-01')).toBeNull()
    expect(resolveInstallAnniversary('2027-01-01', '不是日期')).toBeNull()
  })
})

describe('单条解析', () => {
  it('公历纪念日：带标签、带重复规则、今天命中时 relativeText 是「就是今天」', () => {
    const row = resolveSolarAnniversary({ date: '12-25', label: '在一起' }, '2027-12-25')
    expect(row).toMatchObject({
      source: ANNIVERSARY_SOURCE.ANNIVERSARY,
      label: '在一起',
      recurrence: '每年 12-25',
      nextDateKey: '2027-12-25',
      daysFromToday: 0,
      isToday: true,
      relativeText: '就是今天',
    })
  })

  it('生日：沿用既有「我的生日」名号，不要求标签', () => {
    expect(resolveBirthday('06-01', '2027-01-10')).toMatchObject({
      source: ANNIVERSARY_SOURCE.BIRTHDAY,
      label: '我的生日',
      recurrence: '每年 06-01',
      nextDateKey: '2027-06-01',
      daysFromToday: 142,
      isToday: false,
    })
  })

  it('没有标签的行也给兜底名，不在清单里凭空消失', () => {
    expect(resolveSolarAnniversary({ date: '03-08', label: '   ' }, '2027-01-01')?.label).toBe('未命名纪念日')
  })

  it('日期不合法返回 null（而不是一条"没有下一次"的行）', () => {
    expect(resolveSolarAnniversary({ date: '02-31', label: 'x' }, '2027-01-01')).toBeNull()
    expect(resolveSolarAnniversary({ date: '', label: 'x' }, '2027-01-01')).toBeNull()
    expect(resolveSolarAnniversary(null, '2027-01-01')).toBeNull()
    expect(resolveBirthday('', '2027-01-01')).toBeNull()
  })
})

describe('即将到来清单', () => {
  const lunar = [{ id: 'l1', label: '外婆生日', lunarMonth: 8, lunarDay: 15, isLeapMonth: false }]

  it('四类节点合并、按日期升序', () => {
    const rows = upcomingAnniversaries(
      {
        enabled: true,
        birthday: '06-01',
        installDate: '2020-03-08',
        anniversaries: [{ date: '01-20', label: '在一起' }],
      },
      lunar,
      '2027-01-10',
    )
    // 农历八月十五在 2027 年是 09-15（中秋），排在最后 —— 顺序由日期决定，不是按添加顺序。
    expect(rows.map((row) => row.label)).toEqual(['在一起', '使用周年', '我的生日', '外婆生日'])
    expect(rows.map((row) => row.nextDateKey)).toEqual([
      '2027-01-20',
      '2027-03-08',
      '2027-06-01',
      '2027-09-15',
    ])
    expect(rows.map((row) => row.source)).toEqual([
      ANNIVERSARY_SOURCE.ANNIVERSARY,
      ANNIVERSARY_SOURCE.INSTALL,
      ANNIVERSARY_SOURCE.BIRTHDAY,
      ANNIVERSARY_SOURCE.LUNAR,
    ])
  })

  it('limit 只保留最近 N 条，且必须是正整数才生效', () => {
    const config = { enabled: true, birthday: '06-01', anniversaries: [{ date: '01-20', label: '在一起' }] }
    expect(upcomingAnniversaries(config, lunar, '2027-01-10', { limit: 2 })).toHaveLength(2)
    // limit: 0 / 负数 / 小数都当成"不限制"，而不是返回空数组。
    expect(upcomingAnniversaries(config, lunar, '2027-01-10', { limit: 0 })).toHaveLength(3)
    expect(upcomingAnniversaries(config, lunar, '2027-01-10', { limit: -1 })).toHaveLength(3)
    expect(upcomingAnniversaries(config, lunar, '2027-01-10', { limit: 2.5 })).toHaveLength(3)
  })

  it('关掉"启用节日氛围"时清单照样列出 —— 那是装饰开关，不是数据开关', () => {
    const on = upcomingAnniversaries({ enabled: true, birthday: '06-01' }, [], '2027-01-10')
    const off = upcomingAnniversaries({ enabled: false, birthday: '06-01' }, [], '2027-01-10')
    expect(off).toEqual(on)
  })

  it('什么都不登记时返回空数组，不报错', () => {
    expect(upcomingAnniversaries(undefined, undefined, '2027-01-10')).toEqual([])
    expect(upcomingAnniversaries({}, null, '2027-01-10')).toEqual([])
    expect(upcomingAnniversaries({}, [], '不是日期')).toEqual([])
  })

  it('农历条目今年算不出来时仍列出，并带上明确的不可用文案', () => {
    // 闰四月：2027 年没有这个闰月。清单要给出"今年没有"，同时仍找到下一次真存在的
    // 那天（2058 年 —— 表内最长间隔 38 年，原先 20 年窗口找不到，会让提示永远空着）。
    // 不能因为"反正倒计时找得到"就把状态吞掉，也不能只显示状态不给日期。
    const rows = upcomingAnniversaries({}, [{ id: 'l2', label: '外婆生日', lunarMonth: 4, lunarDay: 8, isLeapMonth: true }], '2027-01-10')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('no-such-leap-month')
    expect(rows[0].statusText).toBe('该年没有这个闰月')
    expect(rows[0].nextDateKey).toBe('2058-05-29')
  })

  it('农历纪念日的下一次能跨过 20 年窗口（闰四月从 2027 年等到 2058 年）', () => {
    // 这条钉住"窗口按表尾而不是按固定年数"：写死 20 年的话 nextDateKey 会是空串，
    // 面板上就只剩"该年没有这个闰月"、永远不给"下一次"。
    const row = upcomingAnniversaries({}, [{ id: 'l2', label: 'x', lunarMonth: 4, lunarDay: 8, isLeapMonth: true }], '2027-01-10')[0]
    expect(row.nextDateKey.slice(0, 4)).toBe('2058')
  })

  it('农历条目农历月日非法时不进清单（各行自己的状态提示负责说明）', () => {
    expect(upcomingAnniversaries({}, [{ id: 'l3', label: '坏条目', lunarMonth: 13, lunarDay: 1 }], '2027-01-10')).toEqual([])
  })
})

describe('daysBetweenDateKeys', () => {
  it('跨闰日、跨年都对；非法输入返回 null', () => {
    expect(daysBetweenDateKeys('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetweenDateKeys('2027-02-28', '2027-03-01')).toBe(1)
    expect(daysBetweenDateKeys('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetweenDateKeys('2027-01-01', '2027-01-01')).toBe(0)
    expect(daysBetweenDateKeys('2027-01-02', '2027-01-01')).toBe(-1)
    expect(daysBetweenDateKeys('2027-01-01', 'x')).toBeNull()
  })
})

describe('normalizeFestiveConfig 去掉深拷贝后行为不变', () => {
  it('空/坏输入仍得到默认值，且返回的 anniversaries 不与冻结常量共享引用', () => {
    for (const input of [undefined, null, 'x', 42, []]) {
      const out = normalizeFestiveConfig(input)
      expect(out.enabled).toBe(true)
      expect(out.birthday).toBe('')
      expect(out.installDate).toBe('')
      expect(out.anniversaries).toEqual([])
      // 共享引用的话，调用方 push 一次就会污染 DEFAULT_FESTIVE_CONFIG，
      // 下一个 normalize 出来的东西就带着别人的数据 —— 原来的 JSON 深拷贝正是防这个。
      expect(out.anniversaries).not.toBe(DEFAULT_FESTIVE_CONFIG.anniversaries)
    }
    expect(DEFAULT_FESTIVE_CONFIG.anniversaries).toEqual([])
  })

  it('既有坏数据修复口径不变：不合法月日与空标签仍被丢弃', () => {
    const out = normalizeFestiveConfig({
      enabled: false,
      birthday: '02-31',
      installDate: '2023-02-29',
      anniversaries: [
        { date: '06-01', label: '  在一起  ' },
        { date: '02-31', label: '不存在的日期' },
        { date: '06-02', label: '   ' },
      ],
    })
    expect(out).toEqual({
      enabled: false,
      birthday: '',
      installDate: '',
      anniversaries: [{ date: '06-01', label: '在一起' }],
    })
  })
})
