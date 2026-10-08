// @vitest-environment node
/**
 * 待办重复规则（每天 / 工作日 / 每周 / 每两周 / 每月 + 可选的重复截止日期）。
 *
 * 【为什么这一层必须是纯函数】这些全是「给定截止日期就能算出来的算术」：
 *   - 1 月 31 日的每月重复落到 2 月 28 日还是 3 月 3 日？
 *   - 周五的「工作日」下一条是下周一（跳过周末）还是直接不生成？
 *   - 重复截止日期过了还会不会生成？
 * 它们不依赖时钟、存储与组件，所以这一整个文件都是纯函数断言——不挂载、不点界面。
 * 真要靠点界面验这些，用户得多建几条待办再翻到下个月，而且闰年那一条根本点不出来。
 *
 * 【判别力怎么保证】每条规则都配了**反向**用例：非法规则值、非法截止日期、缺字段、
 * 结束日期恰好等于下一期（应当仍生成，含当天）。只看正例的话，把实现改成"永远返回 null"
 * 也能全绿。
 */
import { describe, expect, it } from 'vitest'
import {
  TASK_REPEATS,
  createNextRepeatingTask,
  createNextWeeklyTask,
  nextRepeatDueDate,
  normalizeTaskRepeat,
  repeatsTask,
  taskRepeatLabel,
} from '../src/composables/taskRecurrence.js'

const NOW = new Date('2026-03-10T09:00:00')

function taskOf(dueDate, extra = {}) {
  return { id: 't1', title: '写作业', done: false, status: 'completed', dueDate, repeat: 'daily', ...extra }
}

describe('规则的读侧：合法化与「会不会生成下一期」', () => {
  it('认识得的规则原样返回，不认识的一律收敛成 none', () => {
    for (const rule of TASK_REPEATS) expect(normalizeTaskRepeat(rule.value)).toBe(rule.value)
    // 判别力：这六个真的会被拒绝，而不是悄悄猜一个
    for (const bad of ['yearly', 'WEEKLY', 'Daily', '', null, undefined, 0, '每天']) {
      expect(normalizeTaskRepeat(bad), `${String(bad)} 不该被当成合法规则`).toBe('none')
    }
    expect(normalizeTaskRepeat(' weekly '), '两端空白是手输/拼接的常态，不该因此丢掉规则').toBe('weekly')
  })

  it('只有 none 之外的五种规则会生成下一期', () => {
    expect(repeatsTask(taskOf('2026-03-10', { repeat: 'none' }))).toBe(false)
    expect(repeatsTask(taskOf('2026-03-10'))).toBe(true)
    for (const rule of ['daily', 'weekdays', 'weekly', 'biweekly', 'monthly']) {
      expect(repeatsTask(taskOf('2026-03-10', { repeat: rule })), rule).toBe(true)
    }
    // 判别力：脏数据不生成，宁可少一条也不要凭空塞新待办给用户
    expect(repeatsTask(taskOf('2026-03-10', { repeat: 'yearly' }))).toBe(false)
    expect(repeatsTask(taskOf('2026-03-10', { repeat: 'weekly ' })), '空白容忍与 normalizeTaskRepeat 同口径').toBe(true)
    expect(repeatsTask(taskOf('2026-03-10', { repeat: 'Weekly' }))).toBe(false)
    expect(repeatsTask(null)).toBe(false)
    expect(repeatsTask({})).toBe(false)
    expect(repeatsTask('weekly'), '只有对象形态的待办才算').toBe(false)
  })

  it('下拉文案：认识得的给标签，不认识的退回「不重复」', () => {
    expect(taskRepeatLabel('weekdays')).toBe('工作日（跳过周末）')
    expect(taskRepeatLabel('monthly')).toBe('每月')
    expect(taskRepeatLabel('yearly')).toBe('不重复')
  })
})

describe('每天 / 每周 / 每两周', () => {
  it('每天 +1 天，每周日都照常生成（不跳过周末）', () => {
    expect(nextRepeatDueDate('2026-03-10', 'daily')).toBe('2026-03-11')
    // 3 月 14 日是周六、15 日是周日：每天重复不认「工作日」
    expect(nextRepeatDueDate('2026-03-14', 'daily')).toBe('2026-03-15')
    expect(nextRepeatDueDate('2026-03-15', 'daily')).toBe('2026-03-16')
  })

  it('每周 +7 天、每两周 +14 天（跨月跨年都交给原生 Date）', () => {
    expect(nextRepeatDueDate('2026-03-10', 'weekly')).toBe('2026-03-17')
    expect(nextRepeatDueDate('2026-03-28', 'weekly')).toBe('2026-04-04')
    expect(nextRepeatDueDate('2026-12-28', 'weekly')).toBe('2027-01-04')
    expect(nextRepeatDueDate('2026-03-10', 'biweekly')).toBe('2026-03-24')
    expect(nextRepeatDueDate('2026-12-18', 'biweekly')).toBe('2027-01-01')
  })
})

describe('工作日（跳过周末）', () => {
  it('周五的下一条是下周一——跳过的是周末两天，不是跳过这一周', () => {
    // 2026-03-13 是周五
    expect(nextRepeatDueDate('2026-03-13', 'weekdays')).toBe('2026-03-16')
  })

  it('周一到周四各自 +1 天，周六与周日都落到下周一', () => {
    expect(nextRepeatDueDate('2026-03-09', 'weekdays')).toBe('2026-03-10') // 周一
    expect(nextRepeatDueDate('2026-03-12', 'weekdays')).toBe('2026-03-13') // 周四
    expect(nextRepeatDueDate('2026-03-14', 'weekdays')).toBe('2026-03-16') // 周六
    expect(nextRepeatDueDate('2026-03-15', 'weekdays')).toBe('2026-03-16') // 周日
  })

  it('跨月的那一周同样成立（周一不会被推到下个月）', () => {
    // 2026-03-30 是周一，2026-03-31 周二
    expect(nextRepeatDueDate('2026-03-31', 'weekdays')).toBe('2026-04-01')
  })
})

describe('每月：跨月夹到月末', () => {
  it('1 月 31 日 → 2 月 28 日（平年），且下一期回到 31 号的语义不会被永久拖走', () => {
    expect(nextRepeatDueDate('2026-01-31', 'monthly')).toBe('2026-02-28')
    // 闰年 2 月是 29 天
    expect(nextRepeatDueDate('2028-01-31', 'monthly')).toBe('2028-02-29')
    expect(nextRepeatDueDate('2024-01-31', 'monthly')).toBe('2024-02-29')
  })

  it('30 号的月份夹到 2 月最后一天，不会溢出到 3 月', () => {
    expect(nextRepeatDueDate('2026-01-30', 'monthly')).toBe('2026-02-28')
    // 判别力：朴素 setMonth(+1) 会得到 3 月 1/2 日
    expect(nextRepeatDueDate('2026-01-30', 'monthly')).not.toBe('2026-03-02')
  })

  it('29/30/31 号各自夹到自己的月末；跨年 12 月照常推进', () => {
    expect(nextRepeatDueDate('2026-03-31', 'monthly')).toBe('2026-04-30')
    expect(nextRepeatDueDate('2026-04-30', 'monthly')).toBe('2026-05-30')
    expect(nextRepeatDueDate('2026-12-31', 'monthly')).toBe('2027-01-31')
    expect(nextRepeatDueDate('2026-02-28', 'monthly')).toBe('2026-03-28')
  })

  it('逐月推下去时不会漂移：31 号 → 28 号 → 31 号（而不是 28 号一路拖下去）', () => {
    let date = '2026-01-31'
    const chain = []
    for (let i = 0; i < 3; i += 1) {
      date = nextRepeatDueDate(date, 'monthly')
      chain.push(date)
    }
    // 每次生成的都是**上一期的下一期**，所以缩短只影响当月，不会像朴素实现那样
    // 把「被夹短的 28 号」当成新基准一路滚下去（那是 bills 的 addMonthsKeyAnchored 修过的坑）
    expect(chain).toEqual(['2026-02-28', '2026-03-28', '2026-04-28'])
  })
})

describe('重复截止日期', () => {
  it('下一期早于或等于截止日期时照常生成（含当天）', () => {
    expect(nextRepeatDueDate('2026-03-10', 'weekly', { until: '2026-03-17' })).toBe('2026-03-17')
    expect(nextRepeatDueDate('2026-03-10', 'weekly', { until: '2026-03-24' })).toBe('2026-03-17')
  })

  it('下一期越过截止日期时返回空串（调用方据此不生成）', () => {
    expect(nextRepeatDueDate('2026-03-10', 'weekly', { until: '2026-03-16' })).toBe('')
    expect(nextRepeatDueDate('2026-03-10', 'daily', { until: '2026-03-10' })).toBe('')
  })

  it('截止日期格式非法时按「没填」处理，不因此停掉重复', () => {
    for (const bad of ['', '   ', '2026-13-01', '不是日期', '2026-3-17', null, undefined]) {
      expect(nextRepeatDueDate('2026-03-10', 'weekly', { until: bad }), String(bad)).toBe('2026-03-17')
    }
  })
})

describe('不生成的一切情况', () => {
  it('none 与任何非法规则都不生成', () => {
    expect(nextRepeatDueDate('2026-03-10', 'none')).toBe('')
    expect(nextRepeatDueDate('2026-03-10', 'yearly')).toBe('')
    expect(nextRepeatDueDate('2026-03-10', 'WEEKLY')).toBe('')
    expect(nextRepeatDueDate('2026-03-10', undefined)).toBe('')
  })

  it('截止日期缺失或非法时不生成', () => {
    expect(nextRepeatDueDate('', 'daily')).toBe('')
    expect(nextRepeatDueDate(null, 'monthly')).toBe('')
    expect(nextRepeatDueDate('不是日期', 'weekly')).toBe('')
    // 2 月 30 日这种不存在的日期：原生 `Date` 会滚成 3 月 2 日，旧实现也是这个行为
    // （加校验等于悄悄改掉既有语义），所以这里断言"它照样推进"，而不是断言被拒绝。
    expect(nextRepeatDueDate('2026-02-30', 'monthly')).toBe('2026-04-02')
    expect(nextRepeatDueDate('2026-02-30', 'weekly')).toBe('2026-03-09')
  })
})

describe('生成下一条待办', () => {
  it('清掉完成态与生成标记，并沿用标题、课程、重复规则与重复截止日期', () => {
    const next = createNextRepeatingTask(taskOf('2026-03-10', {
      repeat: 'monthly',
      repeatEndDate: '2026-06-30',
      courseId: 'c1',
      course: '高数',
      completedAt: '2026-03-10T09:00:00.000Z',
      repeatGeneratedAt: '2026-03-10T09:00:00.000Z',
      priority: 'high',
      note: '第三章',
    }), NOW)
    expect(next).toMatchObject({
      title: '写作业',
      courseId: 'c1',
      course: '高数',
      priority: 'high',
      note: '第三章',
      repeat: 'monthly',
      repeatEndDate: '2026-06-30',
      done: false,
      status: 'completed',
      completedAt: null,
      repeatGeneratedAt: null,
      dueDate: '2026-04-10',
      createdAt: NOW.toISOString(),
    })
    expect(next.id, '必须换 id，否则与上一条撞在同步合并里').not.toBe('t1')
  })

  it('同一毫秒内生成两次也要拿到不同 id（同步合并与 tombstone 会互相覆盖）', () => {
    const task = taskOf('2026-03-10', { repeat: 'weekly' })
    expect(createNextRepeatingTask(task, NOW).id).not.toBe(createNextRepeatingTask(task, NOW).id)
  })

  it('超过重复截止日期、缺截止日期、非法规则时返回 null', () => {
    expect(createNextRepeatingTask(taskOf('2026-03-10', { repeat: 'weekly', repeatEndDate: '2026-03-01' }))).toBeNull()
    expect(createNextRepeatingTask(taskOf('', { repeat: 'daily' }))).toBeNull()
    expect(createNextRepeatingTask(taskOf('2026-03-10', { repeat: 'yearly' }))).toBeNull()
    expect(createNextRepeatingTask(null)).toBeNull()
  })
})

describe('旧导出名 createNextWeeklyTask：行为一字不变', () => {
  it('weekly 仍然只是 +7 天，且沿用同一套 id 与清场字段', () => {
    const next = createNextWeeklyTask({ ...taskOf('2026-03-10', { repeat: 'weekly' }), courseId: 'c1' }, NOW)
    expect(next).toMatchObject({
      dueDate: '2026-03-17',
      done: false,
      completedAt: null,
      repeatGeneratedAt: null,
      createdAt: NOW.toISOString(),
      courseId: 'c1',
    })
    expect(next.id).toMatch(/^t\d{13}-[a-z0-9]+$/)
  })

  it('别的规则传进来仍然返回 null（不因为函数被泛化就顺手扩大语义）', () => {
    // 判别力：这里如果写成 createNextRepeatingTask 直通，下面这三条都会红
    expect(createNextWeeklyTask(taskOf('2026-03-10', { repeat: 'daily' }))).toBeNull()
    expect(createNextWeeklyTask(taskOf('2026-03-10', { repeat: 'monthly' }))).toBeNull()
    expect(createNextWeeklyTask(taskOf('2026-03-10', { repeat: 'yearly' }))).toBeNull()
  })

  it('非法截止日期与缺日期仍然返回 null（与旧实现的守卫一致）', () => {
    expect(createNextWeeklyTask({ ...taskOf('不是日期', { repeat: 'weekly' }) })).toBeNull()
    expect(createNextWeeklyTask({ ...taskOf('', { repeat: 'weekly' }) })).toBeNull()
    expect(createNextWeeklyTask(null)).toBeNull()
  })
})
