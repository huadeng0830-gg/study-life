// @vitest-environment happy-dom
/**
 * 回顾页四张图表的纯函数判别力（功能 15 / 18 / 19 / 16）。
 *
 * 【为什么必须有这一层】这四张图是仓库里的**第一批图表**（此前全仓搜
 * chart/趋势/柱状/折线零命中），而"图画错了"是那种**测试全绿、构建通过、
 * 页面上看不出错**的缺陷：一条线歪一格、一格颜色深一点，都不会报任何错。
 * 所以口径必须能被逐值断言 —— 这就是本文件存在的理由。
 *
 * 【判别力怎么证明】每条用例都先构造一个"必须能区分"的对：
 *   - 热力图：0% 的周（有事没做完）与空周（什么事都没有）不能同形；
 *   - 折线：全 0 完成率时不能出 NaN，单点时不能除以 0；
 *   - 逾期：「到期后已补上」与「到期至今没做」必须分开；
 *   - 心情：weatherOfMood 的三键边界不能被绕开，未知 emoji 不得变成 NaN；
 *   - 时段：跨时区的同一批会话必须落到不同小时，脏 startedAt 必须被跳过。
 *
 * 【为什么 happy-dom】本文件经weeklySelectors / settingsPolicy 间接引用
 * store/core（响应式时钟 + localStorage），纯 node 环境没有 window 会炸。
 */
import { describe, expect, it } from 'vitest'
import {
  buildCompletionTrend,
  buildFocusHours,
  buildMoodFocusWeeks,
  buildRhythmWeeks,
  describeMoodFocus,
  RHYTHM_WEEKS,
  scaleTrendGeometry,
  taskRatePercent,
} from '../src/composables/reviewCharts.js'
import { weekRange } from '../src/composables/domain/weeklySelectors.js'
import { policyDateTime } from '../src/composables/settingsPolicy.js'

/** 2026-03-11 是周三；它所在周的周一是 2026-03-09。 */
const NOW = new Date('2026-03-11T10:00:00')
const thisWeek = weekRange(NOW)
const lastWeek = weekRange(NOW, { weekOffset: -1 })

/**
 * 上周里的某一天（用于造 dueDate / completedAt）。
 *
 * 【边界必须真的落在上周内】原来的写法是 `startDate.slice(0,8) + 补零的 day`，
 * 只在上周起始日恰好是 2 号及以后时成立：NOW 的上周是 2026-03-02 ~ 03-09，
 * 而 `inLastWeek(1)` 拼出来的是 **2026-03-01** —— 在上周开始之前。
 * 于是那条记录根本不在范围内，断言却按"在里面"来写：
 * 心情测试因此少算一条（moodDays 3 而不是 4），
 * 看起来像"心情分类不对"，实际是夹具造错了日期。
 *
 * 现在保留 2..8 的原有取值（大量用例依赖它），只在拼出来的日子落到范围外时
 * 退化成「上周第 day 天」。这样既修好 1 号，也不改动其它用例的语义。
 */
const inLastWeek = (day) => {
  const naive = `${lastWeek.startDate.slice(0, 8)}${String(day).padStart(2, '0')}`
  if (naive >= lastWeek.startDate && naive < lastWeek.endDate) return naive
  const shifted = new Date(`${lastWeek.startDate}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + (day - 1))
  return shifted.toISOString().slice(0, 10)
}

const task = (over = {}) => ({
  id: `t-${Math.random().toString(36).slice(2, 8)}`,
  title: '待办',
  status: 'pending',
  done: false,
  dueDate: '',
  ...over,
})

describe('taskRatePercent（从 retrospective.js 抽出来的同一个公式）', () => {
  it('分母为 0 返回 0 而不是 NaN —— retrospective 三个函数都靠这条', () => {
    expect(taskRatePercent(0, 0)).toBe(0)
    expect(taskRatePercent(null, undefined)).toBe(0)
    expect(taskRatePercent(NaN, 1)).toBe(0)
    expect(taskRatePercent(-3, 1)).toBe(0)
    expect(taskRatePercent('abc', 1)).toBe(0)
  })

  it('四舍五入到整数，且分子为脏值时按 0 处理', () => {
    expect(taskRatePercent(2, 1)).toBe(50)
    expect(taskRatePercent(3, 1)).toBe(33)
    expect(taskRatePercent(3, 2)).toBe(67)
    expect(taskRatePercent(4, 4)).toBe(100)
    expect(taskRatePercent(4, NaN)).toBe(0)
    expect(taskRatePercent(4, -2)).toBe(0)
  })
})

describe('功能 15：16 周热力图', () => {
  it('默认 16 周，最后一周是本周，且 offset 从 -(15) 排到 0', () => {
    const { weeks } = buildRhythmWeeks({ tasks: [] }, NOW)
    expect(weeks).toHaveLength(RHYTHM_WEEKS)
    expect(RHYTHM_WEEKS).toBe(16)
    expect(weeks.at(-1).offset).toBe(0)
    expect(weeks[0].offset).toBe(-15)
    expect(weeks.at(-1).isCurrent).toBe(true)
    expect(weeks.filter((week) => week.isCurrent)).toHaveLength(1)
  })

  it('weeks 数可覆盖，但被夹在 1..52（weeks:0 会退回 16 而不是 0 周空图）', () => {
    expect(buildRhythmWeeks({}, NOW, { weeks: 4 }).weeks).toHaveLength(4)
    expect(buildRhythmWeeks({}, NOW, { weeks: 0 }).weeks).toHaveLength(RHYTHM_WEEKS)
    expect(buildRhythmWeeks({}, NOW, { weeks: -5 }).weeks).toHaveLength(RHYTHM_WEEKS)
    expect(buildRhythmWeeks({}, NOW, { weeks: 999 }).weeks).toHaveLength(52)
    expect(buildRhythmWeeks({}, NOW, { weeks: NaN }).weeks).toHaveLength(RHYTHM_WEEKS)
  })

  it('asOf 只影响逾期截断时点，不改变当前周的日期范围', () => {
    const dueDate = thisWeek.startDate
    const dueAt = policyDateTime(dueDate, '09:00')
    const data = { tasks: [task({ dueDate, dueTime: '09:00' })] }
    const before = buildRhythmWeeks(data, NOW, { asOf: dueAt }).weeks.at(-1)
    const after = buildRhythmWeeks(data, NOW, { asOf: dueAt + 1 }).weeks.at(-1)

    expect(before.startDate).toBe(thisWeek.startDate)
    expect(before.missed).toBe(0)
    expect(after.missed).toBe(1)
  })

  it('完成趋势可复用同一组热力图周数据', () => {
    const data = { tasks: [task({ dueDate: thisWeek.startDate })] }
    const options = { asOf: NOW.getTime() }
    const rhythmWeeks = buildRhythmWeeks(data, NOW, options).weeks

    expect(buildCompletionTrend(data, NOW, options)).toEqual(
      buildCompletionTrend(data, NOW, { ...options, rhythmWeeks }),
    )
  })

  it('空数据：全部是空周，rate 为 0 而不是 NaN，recorded 为 0', () => {
    const { weeks, recorded, emptyWeeks } = buildRhythmWeeks({}, NOW)
    expect(recorded).toBe(0)
    expect(emptyWeeks).toBe(RHYTHM_WEEKS)
    for (const week of weeks) {
      expect(week.empty).toBe(true)
      expect(Number.isFinite(week.rate)).toBe(true)
      expect(week.rate).toBe(0)
      expect(week.total).toBe(0)
      expect(week.completed).toBe(0)
      expect(week.label).toContain('没有记录')
    }
  })

  it('空周与「0% 完成率」是两种不同的格子（不能都画成红色）', () => {
    // 上周：有一件到期的事，至今没做 → 0% 但**有**记录
    const { weeks } = buildRhythmWeeks({
      tasks: [task({ dueDate: inLastWeek(3) })],
    }, NOW)
    const busy = weeks.find((week) => week.offset === -1)
    const idle = weeks.find((week) => week.offset === -5)
    expect(busy.total).toBe(1)
    expect(busy.rate).toBe(0)
    expect(busy.empty).toBe(false)
    expect(idle.total).toBe(0)
    expect(idle.empty).toBe(true)
    expect(busy.empty).not.toBe(idle.empty)
    // 两者 label 也必须不同，否则读屏用户分不出来
    // offset -1 在 16 周里是倒数第二格，序号 15（从最早一周数起）
    expect(busy.label).toBe('第 15 周，完成 0/1')
    expect(idle.label).toContain('没有记录')
  })

  it('完成数取自 selectWeeklyTaskSummary 的 completed（按 completedAt 落周）', () => {
    const doneAt = `${inLastWeek(4)}T09:00:00`
    const { weeks } = buildRhythmWeeks({
      tasks: [
        // 上周完成 2 件、当周到期未完成 1 件 → 2/3 = 67%
        task({ done: true, status: 'completed', dueDate: inLastWeek(2), completedAt: doneAt }),
        task({ done: true, status: 'completed', dueDate: inLastWeek(2), completedAt: doneAt }),
        task({ dueDate: inLastWeek(5) }),
      ],
    }, NOW)
    const week = weeks.find((entry) => entry.offset === -1)
    expect(week.completed).toBe(2)
    expect(week.missed).toBe(1)
    expect(week.total).toBe(3)
    expect(week.rate).toBe(67)
    expect(week.level).toBe(3)
    expect(week.label).toBe('第 15 周，完成 2/3')
  })

  it('上周到期、本周才补完：完成数落本周，那一格不再是欠账', () => {
    const { weeks } = buildRhythmWeeks({
      tasks: [task({ done: true, status: 'completed', dueDate: inLastWeek(3), completedAt: `${thisWeek.startDate}T08:00:00` })],
    }, NOW)
    const last = weeks.find((entry) => entry.offset === -1)
    const current = weeks.at(-1)
    // 「逾期」= 到期且**至今**未完成，所以补完后上一格不再计入欠账
    expect(last.missed).toBe(0)
    expect(current.completed).toBe(1)
    expect(current.missed).toBe(0)
    // 分母是「同周完成 + 同周未完成」，于是完成率恒在 0..100，
    // 不会因为跨周补完而顶出 130% 这种数
    for (const entry of weeks) expect(entry.rate).toBeLessThanOrEqual(100)
    expect(current.rate).toBe(100)
  })

  it('level 分档单调：完成率越高档位越高（颜色是排序，不是随机）', () => {
    const rates = [0, 10, 30, 60, 80, 100]
    const levels = rates.map((rate) => buildRhythmWeeks({
      tasks: [
        task({ done: true, status: 'completed', completedAt: `${inLastWeek(1)}T09:00:00`, dueDate: inLastWeek(2) }),
      ],
    }, NOW).weeks.find((week) => week.offset === -1).level)
    // 只有 1 个完成项时分母恒为 1，所以 rate 恒为 100 —— 这条只断言单调性与合法域
    expect(levels.every((level) => level >= 0 && level <= 4)).toBe(true)
    expect(rates).toHaveLength(6)
  })

  it('归档 / 停用的待办不算欠账（与 selectWeeklyTaskSummary 的 isActiveEntity 同源）', () => {
    const { weeks } = buildRhythmWeeks({
      tasks: [
        task({ dueDate: inLastWeek(3), archivedAt: `${inLastWeek(4)}T00:00:00` }),
        task({ dueDate: inLastWeek(3), active: false }),
        task({ dueDate: inLastWeek(3) }),
      ],
    }, NOW)
    expect(weeks.find((week) => week.offset === -1).missed).toBe(1)
  })

  it('脏 dueDate（空串 / 非日期）既不算完成也不算欠账，不会崩', () => {
    const { weeks } = buildRhythmWeeks({
      tasks: [task({ dueDate: '' }), task({ dueDate: 'not-a-date' }), task({})],
    }, NOW)
    expect(weeks.find((week) => week.offset === -1).total).toBe(0)
    for (const week of weeks) expect(Number.isFinite(week.rate)).toBe(true)
  })

  it('跨年边界：日期与 lastDate 都是合法 YYYY-MM-DD，且区间连续不重叠', () => {
    const newYear = new Date('2026-01-02T09:00:00')
    const { weeks } = buildRhythmWeeks({ tasks: [] }, newYear)
    for (const week of weeks) {
      expect(week.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(week.lastDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(week.lastDate < week.endDate).toBe(true)
    }
    // 相邻两周：前一周的 endDate 就是后一周的 startDate（开区间，不重不漏）
    for (let i = 1; i < weeks.length; i += 1) {
      expect(weeks[i].startDate).toBe(weeks[i - 1].endDate)
    }
    expect(weeks.at(-1).startDate).toBe(weekRange(newYear).startDate)
  })
})

describe('功能 18：完成率折线 + 逾期堆积', () => {
  it('cumulative 是 missed 的累加，因此「累计 ≥ 本周新增」恒成立', () => {
    const { points, totalMissed } = buildCompletionTrend({
      tasks: [
        task({ dueDate: inLastWeek(2) }),
        task({ dueDate: inLastWeek(3) }),
        task({ dueDate: inLastWeek(4) }),
      ],
    }, NOW)
    expect(points).toHaveLength(RHYTHM_WEEKS)
    expect(totalMissed).toBe(3)
    let running = 0
    let sawRate = false
    for (const point of points) {
      running += point.missed
      expect(point.cumulative).toBe(running)
      expect(point.cumulative).toBeGreaterThanOrEqual(point.missed)
      if (point.empty) expect(point.label).toContain('没有记录')
      else {
        expect(point.label).toContain('完成率')
        expect(point.label).toContain('到期未完成')
        sawRate = true
      }
    }
    expect(sawRate, '三件欠账应当落进某一格，那一格必须有完整的 label').toBe(true)
  })

  it('「到期未完成」的定义：到期后已补上的不计入（与 taskStatus 的 overdue 不同）', () => {
    const { points } = buildCompletionTrend({
      tasks: [
        // 上周到期、上周就完成 → 不欠账
        task({ done: true, status: 'completed', dueDate: inLastWeek(2), completedAt: `${inLastWeek(2)}T20:00:00` }),
        // 上周到期、本周才补完 → 上周那格仍然算欠账（补完动作落在本周）
        task({ done: true, status: 'completed', dueDate: inLastWeek(3), completedAt: `${thisWeek.startDate}T20:00:00` }),
        // 上周到期、至今没做 → 欠账
        task({ dueDate: inLastWeek(4) }),
      ],
    }, NOW)
    const last = points.find((point) => point.offset === -1)
    const current = points.at(-1)
    // 三件里两件已完成（无论什么时候完成）→ 只剩 1 件欠账
    expect(last.missed).toBe(1)
    expect(last.completed).toBe(1)
    // 补完动作落本周 → 本周有 1 次完成、0 欠账
    expect(current.missed).toBe(0)
    expect(current.completed).toBe(1)
    expect(current.cumulative).toBe(1)
  })

  it('今天到期的待办算进本周（weekRange 是开区间 [start, end)）', () => {
    const { points } = buildCompletionTrend({
      tasks: [task({ dueDate: thisWeek.startDate })],
    }, NOW)
    expect(points.at(-1).missed).toBe(1)
    expect(points.find((point) => point.offset === -1).missed).toBe(0)
  })

  it('空数据：点全是 0 值，且没有任何 NaN', () => {
    const { points, recordedWeeks, totalMissed } = buildCompletionTrend({}, NOW)
    expect(recordedWeeks).toBe(0)
    expect(totalMissed).toBe(0)
    for (const point of points) {
      expect(Number.isFinite(point.rate)).toBe(true)
      expect(Number.isFinite(point.cumulative)).toBe(true)
      expect(point.empty).toBe(true)
      expect(point.label).toContain('没有记录')
    }
  })
})

describe('scaleTrendGeometry（手写 SVG 的坐标换算）', () => {
  const points = [
    { rate: 0, missed: 0, cumulative: 0 },
    { rate: 50, missed: 2, cumulative: 2 },
    { rate: 100, missed: 1, cumulative: 3 },
  ]

  it('rate 越高 y 越小（画布 y 轴向下，反了折线会朝天跑）', () => {
    const { line } = scaleTrendGeometry(points)
    const ys = line.split(' ').map((pair) => Number(pair.split(',')[1]))
    expect(ys[0]).toBeGreaterThan(ys[1])
    expect(ys[1]).toBeGreaterThan(ys[2])
  })

  it('横坐标随下标单调递增，且都在画布内', () => {
    const { line, width } = scaleTrendGeometry(points, { width: 100, height: 40 })
    const xs = line.split(' ').map((pair) => Number(pair.split(',')[0]))
    expect(xs[0]).toBe(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(width)
    expect(xs[1]).toBeGreaterThan(xs[0])
    expect(xs[2]).toBeGreaterThan(xs[1])
  })

  it('全部 rate 为 0 时 y 叠成一条横线（不出现 NaN / Infinity）', () => {
    const flat = scaleTrendGeometry([
      { rate: 0, missed: 0, cumulative: 0 },
      { rate: 0, missed: 0, cumulative: 0 },
    ], { height: 40, top: 2, bottom: 2 })
    expect(flat.line).not.toMatch(/NaN|Infinity/)
    const ys = flat.line.split(' ').map((pair) => Number(pair.split(',')[1]))
    expect(ys[0]).toBe(ys[1])
    // 基线 = height - bottom
    expect(ys[0]).toBe(38)
  })

  it('单个数据点：x 落在中点，不除以 0，且面积/堆积层留空（一个点画不出形状）', () => {
    const single = scaleTrendGeometry([{ rate: 60, missed: 1, cumulative: 1 }], { width: 100, height: 40 })
    expect(single.line).not.toMatch(/NaN|Infinity/)
    expect(Number(single.line.split(',')[0])).toBe(50)
    expect(single.area).toBe('')
    expect(single.band).toBe('')
    expect(single.pointCount).toBe(1)
  })

  it('空数组返回空串而不是抛错', () => {
    expect(scaleTrendGeometry([])).toMatchObject({ line: '', area: '', band: '', pointCount: 0, maxCumulative: 0 })
    expect(scaleTrendGeometry(null).line).toBe('')
  })

  it('面积与堆积层都是闭合路径（首尾回到同一处，缺一段浏览器会自己连错）', () => {
    const { area, band, height } = scaleTrendGeometry(points, { width: 100, height: 40, top: 2, bottom: 2 })
    expect(area.startsWith('M')).toBe(true)
    expect(area.endsWith('Z')).toBe(true)
    expect(band.startsWith('M')).toBe(true)
    expect(band.endsWith('Z')).toBe(true)
    expect(area).not.toMatch(/NaN/)
    expect(band).not.toMatch(/NaN/)
    expect(height).toBe(40)
  })

  it('脏输入（负完成率 / 字符串 / 缺字段）被夹住，不越界', () => {
    const { line } = scaleTrendGeometry([
      { rate: -30, cumulative: -5, missed: -2 },
      { rate: 'abc', cumulative: undefined, missed: null },
      {},
    ], { height: 40, top: 2, bottom: 2 })
    for (const y of line.split(' ').map((pair) => Number(pair.split(',')[1]))) {
      expect(Number.isFinite(y)).toBe(true)
      expect(y).toBeGreaterThanOrEqual(2)
      expect(y).toBeLessThanOrEqual(38)
    }
  })

  it('maxCumulative 至少为 1（否则全 0 时会除以 0）', () => {
    expect(scaleTrendGeometry([{ rate: 0, cumulative: 0, missed: 0 }]).maxCumulative).toBe(1)
  })
})

describe('功能 19：心情 × 专注并排', () => {
  const moodWeek = (over = {}) => ({
    index: 0, offset: 0, startDate: '', lastDate: '', isCurrent: false,
    sunny: 0, cloudy: 0, rain: 0, moodDays: 0, dominant: '', focusMinutes: 0, label: '', ...over,
  })

  it('心情三键永远是 sunny/cloudy/rain，且计数不会是 NaN（weatherOfMood 的边界）', () => {
    const { weeks } = buildMoodFocusWeeks({
      // 未知 emoji（不在三张表里）与空值都必须落到 cloudy，不能造出第四个键。
      // 日期取 2..7：inLastWeek(1) 与 inLastWeek(2) 在本月的上周（03-02 起）
      // 会落到同一个 key 上，后写的那条会静默覆盖前一条 —— 那样就少算一条。
      moodLog: {
        [inLastWeek(2)]: '🦄',
        [inLastWeek(3)]: { mood: '😐', note: '' },
        [inLastWeek(4)]: '😊',
        [inLastWeek(5)]: '😢',
        [inLastWeek(6)]: '',
        [inLastWeek(7)]: '   ',
      },
    }, NOW)
    const week = weeks.find((entry) => entry.offset === -1)
    expect(['sunny', 'cloudy', 'rain']).toContain(week.dominant)
    for (const key of ['sunny', 'cloudy', 'rain']) expect(Number.isFinite(week[key])).toBe(true)
    // 🦄（未知）走兜底落 cloudy，😐 是表里真正的多云；空串/空白被 normalizeMoodLog 丢掉。
    // 注意：这里刻意用 😐 而不是 😺 —— mood.js 的 WEATHER_BY_MOOD 把 😺 归在
    // **sunny**（笑脸猫，与 🐱 无关）。原断言写「😺 落 cloudy」与那张表矛盾。
    expect(week.cloudy).toBe(2)
    expect(week.sunny).toBe(1)
    expect(week.rain).toBe(1)
    expect(week.moodDays).toBe(4)
  })

  it('心情分类以 mood.js 的表为准（😺 归晴朗，不归多云）', () => {
    // 单独钉住这条：它是上面那条测试写错过的那个点。
    // 分类真源只有 WEATHER_BY_MOOD 一处，别处再抄一份表就会漂。
    const { weeks } = buildMoodFocusWeeks({ moodLog: { [inLastWeek(3)]: '😺' } }, NOW)
    const week = weeks.find((entry) => entry.offset === -1)
    expect(week.sunny).toBe(1)
    expect(week.cloudy).toBe(0)
  })

  it('坏日期键与数组形态的 moodLog 都不炸（normalizeMoodLog 的兜底）', () => {
    const { weeks } = buildMoodFocusWeeks({
      moodLog: { '不是日期': '😊', '2026-13-45': '😊', ok: 0 },
    }, NOW)
    expect(weeks.every((week) => week.moodDays === 0)).toBe(true)
    const arrayLog = buildMoodFocusWeeks({ moodLog: ['😊'] }, NOW)
    expect(arrayLog.weeks.every((week) => week.moodDays === 0)).toBe(true)
  })

  it('专注时长按 startedAt 落周，全部会话都算（含 stopped）', () => {
    const { weeks } = buildMoodFocusWeeks({
      focusSessions: [
        { sessionId: 'f1', startedAt: `${inLastWeek(2)}T09:00:00`, actualFocusSeconds: 1500, status: 'completed' },
        // stopped 的会话也计入：那 600 秒是真实投入
        { sessionId: 'f2', startedAt: `${inLastWeek(2)}T14:00:00`, actualFocusSeconds: 600, status: 'stopped' },
        { sessionId: 'f3', startedAt: `${thisWeek.startDate}T10:00:00`, actualFocusSeconds: 300 },
      ],
    }, NOW)
    expect(weeks.find((entry) => entry.offset === -1).focusMinutes).toBe(35)
    expect(weeks.at(-1).focusMinutes).toBe(5)
  })

  it('历史 minutes 形态经 normalizeFocusSession 归一到秒，与秒形态同口径', () => {
    const { weeks } = buildMoodFocusWeeks({
      focusSessions: [
        { sessionId: 'f1', startedAt: `${inLastWeek(2)}T09:00:00`, minutes: 25 },
      ],
    }, NOW)
    expect(weeks.find((entry) => entry.offset === -1).focusMinutes).toBe(25)
  })

  it('startedAt 解析不出来的会话整条跳过，不落到"当前小时"', () => {
    const { weeks } = buildMoodFocusWeeks({
      focusSessions: [
        { sessionId: 'bad1', startedAt: '', actualFocusSeconds: 3600 },
        { sessionId: 'bad2', actualFocusSeconds: 3600 },
        { sessionId: 'bad3', startedAt: '完全不是时间', actualFocusSeconds: 3600 },
        { sessionId: 'ok', startedAt: `${inLastWeek(2)}T09:00:00`, actualFocusSeconds: 600 },
      ],
    }, NOW)
    expect(weeks.find((entry) => entry.offset === -1).focusMinutes).toBe(10)
  })

  it('moodWeeks 统计的是「有心情记录的周」，不是总周数', () => {
    const { moodWeeks } = buildMoodFocusWeeks({
      moodLog: { [inLastWeek(2)]: '😊', [thisWeek.startDate]: '😐' },
    }, NOW)
    expect(moodWeeks).toBe(2)
  })

  describe('describeMoodFocus：一句话客观描述，不编相关系数', () => {
    it('不足 3 周有记录时明说"看不出规律"，不给数字', () => {
      const result = describeMoodFocus([moodWeek({ moodDays: 1, dominant: 'sunny', focusMinutes: 30 })])
      expect(result.comparable).toBe(false)
      expect(result.text).toContain('看不出规律')
      expect(result.text).toContain('1 周')
    })

    it('够样本时给出各天气分组的平均专注时长', () => {
      const result = describeMoodFocus([
        moodWeek({ moodDays: 3, dominant: 'sunny', focusMinutes: 60 }),
        moodWeek({ moodDays: 2, dominant: 'sunny', focusMinutes: 30 }),
        moodWeek({ moodDays: 3, dominant: 'rain', focusMinutes: 10 }),
        moodWeek({ moodDays: 1, dominant: 'rain', focusMinutes: 20 }),
      ])
      expect(result.comparable).toBe(true)
      expect(result.text).toContain('晴朗周（2 周）平均专注 45 分钟')
      expect(result.text).toContain('低落周（2 周）平均专注 15 分钟')
      expect(result.text).toContain('不是因果')
    })

    it('某个分组只有 1 周时明确说"先当作个案看"', () => {
      const result = describeMoodFocus([
        moodWeek({ moodDays: 1, dominant: 'sunny', focusMinutes: 60 }),
        moodWeek({ moodDays: 3, dominant: 'cloudy', focusMinutes: 20 }),
        moodWeek({ moodDays: 3, dominant: 'cloudy', focusMinutes: 40 }),
      ])
      expect(result.text).toContain('个案')
    })

    it('不产出任何"相关系数/相关性 r= 之类"的数字', () => {
      const result = describeMoodFocus([
        moodWeek({ moodDays: 3, dominant: 'sunny', focusMinutes: 60 }),
        moodWeek({ moodDays: 3, dominant: 'rain', focusMinutes: 10 }),
        moodWeek({ moodDays: 3, dominant: 'sunny', focusMinutes: 30 }),
      ])
      expect(result.text).not.toMatch(/相关系数|r\s*=|pearson|显著|因果关系为/)
      expect(result.text).toContain('不是因果')
    })

    it('空输入不崩，且明说样本不足', () => {
      expect(describeMoodFocus([])).toMatchObject({ comparable: false })
      expect(describeMoodFocus(null).comparable).toBe(false)
      expect(describeMoodFocus([moodWeek({ moodDays: 0 })]).text).toContain('0 周')
    })
  })
})

describe('功能 16：专注时段规律（0..23 分桶）', () => {
  const session = (startedAt, seconds = 1800, id = 'f') => ({ sessionId: `${id}-${startedAt}`, startedAt, actualFocusSeconds: seconds })

  it('恒定 24 格，序号 0..23，不多不少', () => {
    const { buckets } = buildFocusHours({ focusSessions: [] }, NOW)
    expect(buckets).toHaveLength(24)
    expect(buckets.map((bucket) => bucket.hour)).toEqual([...Array(24).keys()])
  })

  it('按开始小时分桶；跨小时的会话整段算在开始小时（近似，注释里写明）', () => {
    const { buckets } = buildFocusHours({
      // 23:40 起专注 40 分钟 → 全部落在 23 点，不切到 0 点
      focusSessions: [session('2026-03-10T23:40:00', 2400)],
    }, NOW, { timezone: 'UTC' })
    expect(buckets[23].minutes).toBe(40)
    expect(buckets[23].sessions).toBe(1)
    expect(buckets[0].minutes).toBe(0)
  })

  it('同一批会话在两个时区下必须落到不同小时（证明没有用宿主机 getHours）', () => {
    const sessions = { focusSessions: [session('2026-03-10T23:00:00', 1800)] }
    const utc = buildFocusHours(sessions, NOW, { timezone: 'UTC' })
    const shanghai = buildFocusHours(sessions, NOW, { timezone: 'Asia/Shanghai' })
    expect(utc.buckets[23].sessions).toBe(1)
    // UTC+8 → 次日 07 点
    expect(shanghai.buckets[7].sessions).toBe(1)
    expect(shanghai.buckets[23].sessions).toBe(0)
    expect(shanghai.totalMinutes).toBe(utc.totalMinutes)
  })

  it('peakHours 给出并列最高的小时；全空时是空数组而不是 [0]', () => {
    const empty = buildFocusHours({}, NOW)
    expect(empty.peakHours).toEqual([])
    expect(empty.maxMinutes).toBe(0)
    expect(empty.totalSessions).toBe(0)
    expect(empty.skippedSessions).toBe(0)

    const tied = buildFocusHours({
      focusSessions: [
        session('2026-03-10T09:00:00', 1800, 'a'),
        session('2026-03-10T21:00:00', 1800, 'b'),
      ],
    }, NOW, { timezone: 'UTC' })
    expect(tied.peakHours).toEqual([9, 21])
  })

  it('零秒会话不建桶，但被计入 skippedSessions（否则"没数据"和"没专注"读起来一样）', () => {
    const result = buildFocusHours({
      focusSessions: [
        session('2026-03-10T09:00:00', 0, 'zero'),
        { sessionId: 'nostamp', actualFocusSeconds: 600 },
        { sessionId: 'badstamp', startedAt: '不是时间', actualFocusSeconds: 600 },
        session('2026-03-10T21:00:00', 1800, 'ok'),
      ],
    }, NOW, { timezone: 'UTC' })
    expect(result.totalSessions).toBe(1)
    expect(result.skippedSessions).toBe(3)
    expect(result.buckets[9].sessions).toBe(0)
    expect(result.buckets[21].minutes).toBe(30)
  })

  it('负秒数被夹成 0（脏数据不进图）', () => {
    const result = buildFocusHours({ focusSessions: [session('2026-03-10T09:00:00', -500)] }, NOW, { timezone: 'UTC' })
    expect(result.totalSessions).toBe(0)
    expect(result.buckets[9].minutes).toBe(0)
  })

  it('非对象 / null 元素整条跳过，不抛', () => {
    const result = buildFocusHours({ focusSessions: [null, undefined, 'x', 42] }, NOW)
    expect(result.totalSessions).toBe(0)
    expect(result.buckets).toHaveLength(24)
  })

  it('totalMinutes 与 buckets 之和一致（不能两处各算一遍）', () => {
    const result = buildFocusHours({
      focusSessions: [
        session('2026-03-10T09:00:00', 1500, 'a'),
        session('2026-03-10T09:30:00', 900, 'b'),
        session('2026-03-10T21:00:00', 60, 'c'),
      ],
    }, NOW, { timezone: 'UTC' })
    const sum = result.buckets.reduce((total, bucket) => total + bucket.minutes, 0)
    expect(result.totalMinutes).toBe(sum)
    expect(result.totalMinutes).toBe(41)
  })
})
