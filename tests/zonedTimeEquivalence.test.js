// @vitest-environment happy-dom
/**
 * 时区换算原语的归位守卫。
 *
 * 【背景】`zonedParts` / `dateInZone` / `wallTimeToEpoch` 原先住在
 * `supabase/functions/campus-social/availability.js`，而前端 4 个文件（ProjectsView、
 * TogetherView、SocialCalendarEvents、projectMeetingBridge）从**函数目录** import 它们。
 * 依赖方向是反的：源码目录依赖部署产物目录。已迁到 `src/composables/zonedTime.js`，
 * 函数目录那侧改为反向 import，保持单一实现。
 *
 * 【为什么必须有这条守卫】
 * 时区换算是那种"看着简单、错一位就差一小时"的东西。归位时如果两份实现有任何差异，
 * 症状会表现为**偶尔**差一小时（只在某些时区/某些日期），极难排查。所以这里不是断言
 * "两边看起来一样"，而是逐个输入跑一遍、原样比对返回值。
 *
 * 【当年的两个真实坑】
 *   1. `for (let delta = -36; …) sample = desired + delta * 60 * MINUTE_MS` —— 那个 `* 60`
 *      漏掉会让探测范围从 ±36 小时缩成 ±36 分钟，DST 边界附近直接返回 null（"本地时间
 *      不存在"），表现是正常时间被误判。
 *   2. `offsets.add(represented - Math.floor(sample / 1000) * 1000)` —— Intl 只精确到秒，
 *      不把 sample 截到整秒会算出虚假偏移，半小时/45 分钟偏移的时区（Asia/Kathmandu、
 *      Australia/Lord_Howe、Pacific/Chatham）一个候选都匹配不上。
 * 两处都真实发生过，所以 DST 边界时区与整 UTC 偏移时区都必须纳入比对集。
 */
import { describe, expect, it } from 'vitest'
import * as original from '../supabase/functions/campus-social/availability.js'
import * as moved from '../src/composables/zonedTime.js'

const ZONES = [
  'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Asia/Singapore', 'UTC',
  'Europe/London', 'America/Los_Angeles', 'America/New_York', 'Europe/Berlin',
  // DST 边界时区：北美春季前跳 / 秋季回拨。
  'America/Santiago', 'America/Sao_Paulo', 'Australia/Lord_Howe',
  // 整 UTC 偏移（非整小时）：最容易暴露"没截到整秒"的那类错误。
  'Asia/Kathmandu', 'Pacific/Chatham',
]

const INSTANTS = [
  Date.UTC(2026, 0, 1, 0, 0),
  Date.UTC(2026, 2, 8, 6, 30),   // 美国夏令时开始附近
  Date.UTC(2026, 2, 8, 9, 30),
  Date.UTC(2026, 9, 25, 5, 0),   // 欧洲夏令时结束附近
  Date.UTC(2026, 10, 1, 6, 0),   // 美国夏令时结束附近
  Date.UTC(2026, 10, 1, 9, 0),
  Date.UTC(2026, 3, 5, 7, 0),
  Date.UTC(2026, 6, 15, 12, 0),
]

const DATES = ['2026-03-08', '2026-03-09', '2026-11-01', '2026-04-05', '2026-02-28', '2026-12-31', '2026-01-01']
const CLOCKS = ['00:00', '01:30', '02:30', '09:15', '12:00', '23:59']
const EDGES = ['start', 'end']

describe('时区换算原语归位后与原实现等价', () => {
  it('zonedParts 在所有时区与时刻上逐字一致', () => {
    for (const zone of ZONES) {
      for (const instant of INSTANTS) {
        expect(moved.zonedParts(instant, zone), `${instant} @ ${zone}`).toEqual(original.zonedParts(instant, zone))
      }
    }
  })

  it('dateInZone 在跨日界的所有时区上一致', () => {
    for (const zone of ZONES) {
      for (const instant of INSTANTS) {
        expect(moved.dateInZone(instant, zone), `${instant} @ ${zone}`).toBe(original.dateInZone(instant, zone))
      }
    }
  })

  it('wallTimeToEpoch 在 DST 边界与整点偏移时区上一致', () => {
    let compared = 0
    for (const zone of ZONES) {
      for (const date of DATES) {
        for (const clock of CLOCKS) {
          for (const edge of EDGES) {
            expect(
              moved.wallTimeToEpoch(date, clock, zone, edge),
              `${date} ${clock} ${zone} ${edge}`,
            ).toBe(original.wallTimeToEpoch(date, clock, zone, edge))
            compared += 1
          }
        }
      }
    }
    // 确认这个用例真的跑了足够多的组合，避免"循环空转"式的假绿。
    expect(compared).toBe(ZONES.length * DATES.length * CLOCKS.length * EDGES.length)
    expect(compared).toBeGreaterThan(1000)
  })

  it('非法输入两边都返回 null 而不是抛错', () => {
    const invalid = [
      ['2026-13-45', '09:00', 'UTC'],
      ['2026-01-01', '99:99', 'UTC'],
      ['', '', 'UTC'],
      ['abc', '12:00', 'UTC'],
      ['2026-01-01', '25:00', 'Asia/Shanghai'],
    ]
    for (const args of invalid) {
      expect(moved.wallTimeToEpoch(...args), JSON.stringify(args)).toBe(original.wallTimeToEpoch(...args))
      expect(moved.wallTimeToEpoch(...args)).toBeNull()
    }
  })

  it('函数目录那侧仍是同一份实现（转出而非复制）', async () => {
    // availability.js 把三个函数从 zonedTime 转出，两边必须是同一引用而非各有一份。
    expect(original.zonedParts).toBe(moved.zonedParts)
    expect(original.dateInZone).toBe(moved.dateInZone)
    expect(original.wallTimeToEpoch).toBe(moved.wallTimeToEpoch)
  })

  it('前端不再从函数目录 import 时区工具', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const files = [
      '../src/views/ProjectsView.vue',
      '../src/views/TogetherView.vue',
      '../src/components/SocialCalendarEvents.vue',
      '../src/composables/projectMeetingBridge.js',
    ]
    for (const file of files) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
      // 只看 import 语句那一行，注释里提到旧路径是正常的（解释迁移原因）。
      const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line))
      for (const line of importLines) {
        expect(line, `${file} 不应再从 supabase/functions import`).not.toContain('supabase/functions')
      }
    }
  })
})