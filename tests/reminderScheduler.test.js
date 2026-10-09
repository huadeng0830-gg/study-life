// @vitest-environment happy-dom
//
// 「提醒」此前是只写不读的死数据：UI 三个输入框把值写进每条 task/event/
// milestone，但全仓零消费者。这一组测试同时守住两条：
//   1. 调度器真的能把到点的条目挑出来（collectDueReminders）；
//   2. 同一条提醒不会被触发两次（去重落盘）。
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function freshModules() {
  vi.resetModules()
  localStorage.clear()
  // useStoredRef 的单例缓存 + settingsPolicy 在 import 时就读 localStorage，
  // 所以**必须先播种 localStorage，再 import 任何会触发 useStoredRef 的模块**。
  localStorage.setItem('sl_tasks', JSON.stringify(globalThis.__seedTasks || []))
  localStorage.setItem('sl_events', '[]')
  localStorage.setItem('sl_exams', '[]')
  localStorage.setItem('sl_quick_record_settings', JSON.stringify({ timezone: 'UTC' }))
  await import('../src/composables/store/core.js')
  await import('../src/composables/settingsPolicy.js')
  return import('../src/composables/reminderScheduler.js')
}

function seed(tasks) {
  globalThis.__seedTasks = tasks
}

function utc(date, time) {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return Date.UTC(y, m - 1, d, hh, mm)
}

describe('提醒调度器', () => {
  beforeEach(() => {
    localStorage.clear()
    globalThis.__seedTasks = []
  })

  it('到点窗口内的待办会被挑出来（截止 - reminderMinutes）', async () => {
    seed([{
      id: 't1', title: '交高数作业', done: false, status: 'pending',
      dueDate: '2026-10-04', dueTime: '12:00', reminderMinutes: 30,
    }])
    const scheduler = await freshModules()
    // 12:00 截止、提前 30 分钟 => 11:30 应响。现在 11:35，在窗口内。
    const now = utc('2026-10-04', '11:35')
    expect(scheduler.collectDueReminders(now).map((item) => item.key)).toContain('task:t1')
  })

  it('reminderMinutes 为 0 是"到点才提醒"，不是"不提醒"', async () => {
    seed([{
      id: 't2', title: '立刻事项', done: false, status: 'pending',
      dueDate: '2026-10-04', dueTime: '11:35', reminderMinutes: 0,
    }])
    const scheduler = await freshModules()
    expect(scheduler.collectDueReminders(utc('2026-10-04', '11:35')).map((item) => item.key)).toContain('task:t2')
  })

  it('过去太久的（超出补响窗口）不再响，已完成的也不响', async () => {
    seed([
      { id: 'old', title: '上周', done: false, status: 'pending', dueDate: '2026-09-01', dueTime: '09:00', reminderMinutes: 0 },
      { id: 'done', title: '已完成', done: true, status: 'done', dueDate: '2026-10-04', dueTime: '11:35', reminderMinutes: 0 },
    ])
    const scheduler = await freshModules()
    const now = utc('2026-10-04', '11:35')
    const keys = scheduler.collectDueReminders(now).map((item) => item.key)
    expect(keys).not.toContain('task:old')
    expect(keys).not.toContain('task:done')
  })

  it('fire 之后同一条不会被再次挑出（去重落盘）', async () => {
    seed([{
      id: 't3', title: '只响一次', done: false, status: 'pending',
      dueDate: '2026-10-04', dueTime: '11:35', reminderMinutes: 0,
    }])
    const scheduler = await freshModules()
    const now = utc('2026-10-04', '11:35')
    expect(scheduler.collectDueReminders(now).map((item) => item.key)).toContain('task:t3')
    // 模拟 fire 之后：startReminderScheduler 会从 localStorage 重读去重集合。
    localStorage.setItem('sl_reminder_log', JSON.stringify([{ key: 'task:t3', firedAt: now }]))
    const { clock } = await import('../src/composables/store/core.js')
    clock.value = new Date(now)
    scheduler.startReminderScheduler()
    try {
      expect(scheduler.collectDueReminders(now).map((item) => item.key)).not.toContain('task:t3')
    } finally {
      scheduler.stopReminderScheduler()
    }
  })

  it('未到点的也会先进清单（由 tick 的时间过滤把关）', async () => {
    seed([{
      id: 't4', title: '还没到', done: false, status: 'pending',
      dueDate: '2026-10-04', dueTime: '12:30', reminderMinutes: 30,
    }])
    const scheduler = await freshModules()
    const early = utc('2026-10-04', '10:30')
    // 12:30 截止、提前 30 分钟 => 12:00 触发。10:30 时距触发 1.5h，在 6h 窗口内。
    expect(scheduler.collectDueReminders(early).map((item) => item.key)).toContain('task:t4')
    const late = utc('2026-10-04', '12:15')
    expect(scheduler.collectDueReminders(late).map((item) => item.key)).toContain('task:t4')
  })

  it('不排程未来 6 小时以外的提醒', async () => {
    seed([{
      id: 't5', title: '明天才响', done: false, status: 'pending',
      dueDate: '2026-10-05', dueTime: '09:00', reminderMinutes: 30,
    }])
    const scheduler = await freshModules()
    const now = utc('2026-10-04', '08:00')
    expect(scheduler.collectDueReminders(now).map((item) => item.key)).not.toContain('task:t5')
  })

  it('年度日期按本次发生日期提醒，刚过时仍在补响窗口内', async () => {
    const scheduler = await freshModules()
    const { useStoredRef } = await import('../src/composables/store/core.js')
    useStoredRef('sl_exams', []).value = [{ id: 'annual', name: '生日', date: '2020-10-04', time: '11:30', repeat: 'yearly', reminderMinutes: 0 }]
    const reminders = scheduler.collectDueReminders(utc('2026-10-04', '11:35'))
    expect(reminders).toContainEqual(expect.objectContaining({ key: 'milestone:annual', at: '2026-10-04 11:30', fireAt: utc('2026-10-04', '11:30') }))
  })

  it('年度闰日生日在平年最后一天提醒，跨年提前提醒落在上一年', async () => {
    const scheduler = await freshModules()
    const { useStoredRef } = await import('../src/composables/store/core.js')
    const milestones = useStoredRef('sl_exams', [])
    milestones.value = [{ id: 'leap', name: '闰日生日', date: '2024-02-29', time: '12:00', repeat: 'yearly', reminderMinutes: 0 }]
    expect(scheduler.collectDueReminders(utc('2027-02-28', '12:00'))).toContainEqual(expect.objectContaining({ key: 'milestone:leap', at: '2027-02-28 12:00' }))
    milestones.value = [{ id: 'new-year', name: '新年纪念日', date: '2020-01-01', time: '12:00', repeat: 'yearly', reminderMinutes: 1440 }]
    expect(scheduler.collectDueReminders(utc('2026-12-31', '12:00'))).toContainEqual(expect.objectContaining({ key: 'milestone:new-year', fireAt: utc('2026-12-31', '12:00') }))
  })

  it('取消或用 status 归档的任务和重要日期不再提醒', async () => {
    seed([
      { id: 'cancelled', title: '已取消', status: 'cancelled', dueDate: '2026-10-04', dueTime: '11:35', reminderMinutes: 0 },
      { id: 'archived', title: '已归档', status: 'archived', dueDate: '2026-10-04', dueTime: '11:35', reminderMinutes: 0 },
    ])
    const scheduler = await freshModules()
    const { useStoredRef } = await import('../src/composables/store/core.js')
    useStoredRef('sl_exams', []).value = [{ id: 'archived-date', name: '已归档日期', status: 'archived', date: '2026-10-04', time: '11:35', reminderMinutes: 0 }]
    expect(scheduler.collectDueReminders(utc('2026-10-04', '11:35'))).toEqual([])
  })
})
