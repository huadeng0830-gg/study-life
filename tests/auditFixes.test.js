// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { amountToCents, normalizeAmount, parseNatural } from '../src/composables/ledger.js'
import { defaultReminderMinutes, settingsPolicy } from '../src/composables/settingsPolicy.js'
import { createNextWeeklyTask } from '../src/composables/taskRecurrence.js'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { useStoredRef } from '../src/composables/store/core.js'

/* 本文件集中覆盖本轮审计里修掉的、用户可感知的计算类缺陷。 */

beforeEach(() => {
  localStorage.clear()
  // store 的 ref 是模块级共享的：只清 localStorage 不会清掉内存里的旧数据，
  // 用例之间会互相污染，所以显式把待办列表复位。
  useStoredRef('sl_tasks', []).value = []
})

describe('自然输入里的千分位金额', () => {
  it('「午饭 1,234.56」拆成名称「午饭」和金额「1234.56」', () => {
    const parsed = parseNatural('午饭 1,234.56')
    expect(parsed.name).toBe('午饭')
    expect(parsed.amount).toBe('1234.56')
    expect(amountToCents(parsed.amount)).toBe(123456)
  })

  it('不带千分位的写法保持不变', () => {
    expect(parseNatural('午饭 18')).toMatchObject({ name: '午饭', amount: '18' })
    expect(parseNatural('房租 1,200')).toMatchObject({ name: '房租', amount: '1200' })
  })

  it('金额 0 合法，空值不合法', () => {
    expect(amountToCents(0)).toBe(0)
    expect(normalizeAmount('0.00')).toBe(0)
    expect(normalizeAmount('')).toBeNull()
    expect(normalizeAmount('   ')).toBeNull()
  })
})

describe('默认提醒时间的空值处理', () => {
  it('null / 空串回退到设置里的默认值，而不是「提前 0 分钟」', () => {
    const defaults = settingsPolicy.value.defaultReminders
    expect(defaultReminderMinutes('task', null)).toBe(defaults.task)
    expect(defaultReminderMinutes('task', '')).toBe(defaults.task)
    expect(defaultReminderMinutes('event', null)).toBe(defaults.event)
    expect(defaultReminderMinutes('milestone', undefined)).toBe(defaults.milestone)
  })

  it('显式数值（含 0）优先于默认值', () => {
    expect(defaultReminderMinutes('task', 0)).toBe(0)
    expect(defaultReminderMinutes('task', 15)).toBe(15)
    expect(defaultReminderMinutes('task', '30')).toBe(30)
  })

  it('非数值回退到默认值', () => {
    expect(defaultReminderMinutes('task', 'abc')).toBe(settingsPolicy.value.defaultReminders.task)
    expect(defaultReminderMinutes('task', -5)).toBe(settingsPolicy.value.defaultReminders.task)
  })
})

describe('周重复待办的生成', () => {
  const baseTask = {
    id: 't-base',
    title: '周报',
    done: false,
    repeat: 'weekly',
    dueDate: '2026-03-02',
  }

  it('同一毫秒生成两条也不会撞 id', () => {
    const now = new Date('2026-03-02T10:00:00.000Z')
    const first = createNextWeeklyTask(baseTask, now)
    const second = createNextWeeklyTask(baseTask, now)
    expect(first.id).not.toBe(second.id)
    expect(first.dueDate).toBe('2026-03-09')
    expect(first.done).toBe(false)
  })

  it('日期非法时返回 null，不会留下「已生成」标记', () => {
    expect(createNextWeeklyTask({ ...baseTask, dueDate: '不是日期' })).toBeNull()
    expect(createNextWeeklyTask({ ...baseTask, repeat: 'none' })).toBeNull()
    expect(createNextWeeklyTask({ ...baseTask, dueDate: '' })).toBeNull()
  })

  it('toggleTask 完成一次只生成一期，反复切换不会重复生成', () => {
    const tasks = useStoredRef('sl_tasks', [])
    const domain = useDomainCommands()
    const task = domain.createTask({ title: '周报', repeat: 'weekly', dueDate: '2026-03-02' })
    const repeats = () => tasks.value.filter((item) => item.sourceType === 'task-repeat')

    domain.toggleTask(task.id)
    expect(repeats()).toHaveLength(1)
    const countAfterFirst = tasks.value.length

    domain.toggleTask(task.id) // 取消完成
    domain.toggleTask(task.id) // 再次完成
    expect(repeats()).toHaveLength(1)
    expect(tasks.value.length).toBe(countAfterFirst)
  })

  it('通过 updateTask 标记完成也会生成下一期（不再绕过周重复）', () => {
    const tasks = useStoredRef('sl_tasks', [])
    const domain = useDomainCommands()
    const task = domain.createTask({ title: '周报', repeat: 'weekly', dueDate: '2026-03-02' })
    domain.updateTask(task.id, { done: true })
    expect(tasks.value.filter((item) => item.sourceType === 'task-repeat')).toHaveLength(1)
  })
})