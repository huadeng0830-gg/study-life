// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
registerMirrorTeardown()

let domain, scheduler, core
const now = Date.parse('2026-10-10T10:00:30Z')
const phase = (id, kind = 'scheduled') => ({ id, label: id, kind, start: { date: '2026-10-10', time: '09:00' }, end: { date: '2026-10-10', time: '10:00' }, reminders: [{ id: `${id}-end`, anchor: 'end', enabled: true, minutesBefore: 0 }] })
beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('sl_quick_record_settings', JSON.stringify({ timezone: 'UTC' }))
  core = await import('../src/composables/store/core.js')
  domain = (await import('../src/composables/domain/commands.js')).useDomainCommands()
  scheduler = await import('../src/composables/reminderScheduler.js')
})

describe('阶段提醒调度', () => {
  it('结束后 30 秒的零分钟提醒可被分钟轮询捕获，关闭已久的窗口不补响', () => {
    domain.createTask({ id: 'end', title: '阶段结束', timeStages: [phase('正式')] })
    expect(scheduler.collectDueReminders(now).map((item) => item.key)).toContain('task:end:stage:正式:reminder:正式-end')
    expect(scheduler.collectDueReminders(now + 120_000)).toEqual([])
  })

  it('完成阶段只停止该阶段提醒，整体完成停止所有提醒，撤销恢复未来阶段', () => {
    const first = phase('准备', 'window')
    first.start.time = '10:10'
    first.end.time = '11:00'
    const second = phase('执行')
    second.start.time = '10:30'
    second.end.time = '12:00'
    const task = domain.createTask({ id: 'multi', title: '完成展示', timeStages: [first, second] })
    expect(scheduler.collectDueReminders(now)).toHaveLength(2)
    domain.setTaskStageCompleted(task.id, '准备', true)
    expect(scheduler.collectDueReminders(now).map((item) => item.key)).toEqual(['task:multi:stage:执行:reminder:执行-end'])
    expect(task.done).toBe(false)
    domain.toggleTask(task.id)
    expect(scheduler.collectDueReminders(now)).toEqual([])
    domain.toggleTask(task.id)
    expect(scheduler.collectDueReminders(now)).toHaveLength(1)
  })

  it('同一事项同一触发时刻合并通知，改名不重响，改时刻按新签名触发', () => {
    const notifications = []
    const MockNotification = class {
      static permission = 'granted'
      constructor(title, options) { notifications.push({ title, ...options }) }
      close() {}
    }
    vi.stubGlobal('Notification', MockNotification)
    vi.spyOn(Date, 'now').mockReturnValue(now)
    core.clock.value = new Date(now)
    const task = domain.createTask({ id: 'merged', title: '完成展示', timeStages: [phase('准备', 'window'), phase('现场')] })
    try {
      scheduler.startReminderScheduler()
      expect(notifications).toHaveLength(1)
      expect(notifications[0].body).toContain('准备')
      expect(notifications[0].body).toContain('现场')
      domain.updateTask(task.id, { timeStages: task.timeStages.map((stage) => ({ ...stage, label: `${stage.label}改名` })) })
      scheduler.notifyReminderDataChanged()
      expect(notifications).toHaveLength(1)
      domain.updateTask(task.id, { timeStages: task.timeStages.map((stage) => ({ ...stage, end: { date: '2026-10-10', time: '10:01' } })) })
      core.clock.value = new Date('2026-10-10T10:01:30Z')
      Date.now.mockReturnValue(core.clock.value.getTime())
      scheduler.notifyReminderDataChanged()
      expect(notifications).toHaveLength(2)
    } finally {
      scheduler.stopReminderScheduler()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })

  it('纯日期通知使用明确的提醒时刻，关闭窗口不补发开始提醒', () => {
    const item = phase('报名', 'window')
    item.start = { date: '2026-10-10' }
    item.end = { date: '2026-10-10' }
    item.reminders = [{ id: 'open', anchor: 'start', enabled: true, minutesBefore: 0, dateOnlyTime: '09:00' }]
    domain.createTask({ title: '提交申请', timeStages: [item] })
    expect(scheduler.collectDueReminders(now)[0].at).toBe('2026-10-10 09:00')
    expect(scheduler.collectDueReminders(Date.parse('2026-10-11T00:00:00Z'))).toEqual([])
  })
})
