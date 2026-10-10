// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { selectActionCenter, selectReminders, selectTodayActionPanels } from '../src/composables/domain/selectors.js'

describe('行动面板有容量限制时的提醒保留', () => {
  it('超出紧急面板容量的提醒仍出现在后续行动中', () => {
    const now = new Date('2026-10-10T12:00:00+08:00')
    const tasks = Array.from({ length: 4 }, (_, index) => ({
      id: `fictional-overdue-${index}`, title: `虚构逾期待办 ${index}`,
      dueDate: '2026-10-09', dueTime: '12:00', status: 'pending', priority: 'normal',
    }))
    const center = selectActionCenter({ tasks }, now)
    expect(center.urgent).toHaveLength(3)
    expect([...center.urgent, ...center.today, ...center.soon]).toHaveLength(4)
    expect(selectTodayActionPanels({ tasks }, now).actions).toHaveLength(1)
  })

  it('同级逾期提醒按实际时间排序，输入顺序不会改变最早到期项', () => {
    const tasks = ['2026-10-07', '2026-10-09', '2026-10-08'].map((dueDate, index) => ({
      id: `fictional-sort-${index}`, title: dueDate, dueDate, dueTime: '12:00', status: 'pending', priority: 'high',
    }))
    const now = new Date('2026-10-10T12:00:00+08:00')
    expect(selectReminders({ tasks }, now).map((item) => item.entity.dueDate)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09'])
  })
})
