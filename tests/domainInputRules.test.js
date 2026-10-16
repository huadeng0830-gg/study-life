// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { flushStoredWrites } from '../src/composables/store/core.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
const domain = useDomainCommands()
beforeEach(() => { domain.tasks.value = []; domain.milestones.value = [] })
afterEach(() => { domain.tasks.value = []; domain.milestones.value = [] })

describe('all entry points preserve input rules before mutating stored entities', () => {
  it('rejects an explicitly empty task title without changing its old content', () => {
    const task = domain.createTask({ title: '示例待办', note: '原备注' })
    const before = JSON.parse(JSON.stringify(task))
    expect(() => domain.updateTask(task.id, { title: '  ', note: '不应保存' })).toThrow('待办内容')
    expect(task).toEqual(before)
  })

  it('rejects impossible dates through direct create and update commands', () => {
    expect(() => domain.createTask({ title: '示例待办', dueDate: '2027-02-29' })).toThrow('截止日期')
    expect(domain.tasks.value).toHaveLength(0)
    const task = domain.createTask({ title: '示例待办' })
    expect(() => domain.updateTask(task.id, { dueDate: '2026-02-30' })).toThrow('截止日期')
    expect(task.dueDate).toBe('')
  })

  it('allows optional clearing and valid zero values while leaving unrelated legacy data editable', () => {
    const task = domain.createTask({ title: '示例待办', dueDate: '2026-10-20', dueTime: '09:00', note: '示例备注' })
    domain.updateTask(task.id, { dueDate: '', dueTime: '', note: '', estimateMinutes: 0, actualMinutes: 0, reminderMinutes: 0 })
    expect(task).toMatchObject({ dueDate: '', dueTime: '', note: '', estimateMinutes: 0, actualMinutes: 0, reminderMinutes: 0 })
    // Repairing a note must not demand that an unrelated legacy date be filled in again.
    task.dueDate = 'legacy-invalid-date'
    expect(() => domain.updateTask(task.id, { note: '修订备注' })).not.toThrow()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem('sl_tasks'))[0].note).toBe('修订备注')
  })

  it('rejects invalid milestone targets and preserves the old record on a rejected edit', () => {
    expect(() => domain.createMilestone({ name: '示例节点', date: '2027-02-29' })).toThrow('日期')
    expect(domain.milestones.value).toHaveLength(0)
    const milestone = domain.createMilestone({ name: '示例节点', date: '2026-10-20', pinned: false })
    const before = JSON.parse(JSON.stringify(milestone))
    expect(() => domain.updateMilestone(milestone.id, { name: '', date: '' })).toThrow()
    expect(milestone).toEqual(before)
    domain.updateMilestone(milestone.id, { note: '', time: '', reminderMinutes: 0, reviewProgress: 0, pinned: false })
    expect(milestone).toMatchObject({ time: '', note: '', reminderMinutes: 0, reviewProgress: 0, pinned: false })
  })

  it.each([-1, NaN, Infinity])('does not replace an invalid explicit milestone reminder with a default: %s', (reminderMinutes) => {
    expect(() => domain.createMilestone({ name: '示例日期', date: '2026-12-10', reminderMinutes })).toThrow('提醒')
    expect(domain.milestones.value).toHaveLength(0)
  })

  it('clears external-exam aliases when the user clears its date or venue', () => {
    const milestone = domain.createMilestone({ name: '示例考试', kind: 'externalExam', examDate: '2026-12-10', venue: '虚构考点' })
    domain.updateMilestone(milestone.id, { examDate: '', registerDeadline: '2026-12-01', venue: '' })
    expect(milestone).toMatchObject({ examDate: '', date: '2026-12-01', venue: '', location: '' })
  })
})
