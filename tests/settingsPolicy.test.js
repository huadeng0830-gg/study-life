// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { useQuickRecordAdapters } from '../src/composables/quickRecord/adapters.js'
import { settings, policyDateKey, policyDateTime, settingsPolicy } from '../src/composables/settingsPolicy.js'
import { selectReminders } from '../src/composables/domain/selectors.js'
import { taskStatus } from '../src/composables/domain/state.js'

const domain = useDomainCommands()
const quickRecord = useQuickRecordAdapters()
let originalSettings

beforeEach(() => {
  originalSettings = { ...settings.value, defaultReminders: { ...(settings.value.defaultReminders || {}) } }
  domain.transactions.value = []
  domain.bills.value = []
})

afterEach(() => {
  settings.value = originalSettings
})

describe('SettingsPolicy', () => {
  it('keeps Today and Reminder date boundaries in the configured timezone', () => {
    const instant = new Date('2026-09-02T16:30:00Z')
    settings.value = { ...settings.value, timezone: 'Asia/Shanghai' }

    expect(policyDateKey(instant)).toBe('2026-09-03')
    expect(policyDateKey(instant, 'UTC')).toBe('2026-09-02')
    expect(policyDateTime('2026-09-03', '00:30', 'Asia/Shanghai')).toBe(instant.getTime())
    expect(settingsPolicy.value.timezone).toBe('Asia/Shanghai')
    const task = { id: 'timezone-task', title: '边界任务', dueDate: '2026-09-03', dueTime: '00:15' }
    expect(taskStatus(task, instant)).toBe('overdue')
    expect(selectReminders({ tasks: [task] }, instant)[0]).toMatchObject({ kind: 'overdue', sourceId: task.id })
  })

  it('provides the same default account and reminder policy to domain commands', () => {
    settings.value = {
      ...settings.value,
      defaultAccount: '微信',
      defaultReminders: { task: 720, event: 15, milestone: 60 },
    }
    const task = domain.createTask({ id: 'policy-task', title: '交作业' })
    const event = domain.createEvent({ id: 'policy-event', title: '组会' })
    const milestone = domain.createMilestone({ id: 'policy-milestone', name: '考试', date: '2026-12-12' })
    const transaction = domain.createTransaction({ id: 'policy-transaction', name: '午饭', amount: 18 })
    const bill = domain.createBill({ id: 'policy-bill', name: '话费', amount: 39, nextDate: '2026-09-15' })
    const quickTransaction = quickRecord.save({ id: 'policy-quick', type: 'expense', title: '咖啡', raw: '咖啡18', amount: 18 })

    expect(task.reminderMinutes).toBe(720)
    expect(event.reminderMinutes).toBe(15)
    expect(milestone.reminderMinutes).toBe(60)
    expect(transaction.account).toBe('微信')
    expect(bill.account).toBe('微信')
    expect(domain.transactions.value.find((item) => item.id === 'policy-quick').account).toBe('微信')
    quickTransaction.undo()
  })
})
