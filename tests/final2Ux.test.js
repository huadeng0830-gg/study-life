import { describe, expect, it } from 'vitest'
import { selectTodayActionPanels } from '../src/composables/domain/selectors.js'
import { HOME_MODULES } from '../src/composables/appearance.js'

describe('FINAL-2 首页行动中心', () => {
  it('风险和普通行动合计不超过三条，且同一实体只出现一次', () => {
    const panels = selectTodayActionPanels({
      tasks: [
        { id: 'late', title: '补交实验报告', dueDate: '2026-08-31', dueTime: '18:00' },
        { id: 'today', title: '完成高数作业', dueDate: '2026-09-02', dueTime: '20:00' },
        { id: 'soon', title: '整理课堂笔记', dueDate: '2026-09-03' },
        { id: 'later', title: '预习下一章', dueDate: '2026-09-04' },
      ],
      bills: [{ id: 'bill', name: '手机话费', amount: 39, nextDate: '2026-09-03', remindDays: 3, active: true }],
    }, new Date('2026-09-02T10:00:00'))

    const all = [...panels.risk, ...panels.actions]
    expect(panels.risk.length).toBeLessThanOrEqual(3)
    expect(panels.actions.length).toBeLessThanOrEqual(3)
    expect(new Set(all.map((item) => item.key)).size).toBe(all.length)
    expect(all.some((item) => item.key === 'task:late')).toBe(true)
  })

  it('首页可配置模块已经收敛为少数主层级', () => {
    expect(HOME_MODULES.map((item) => item.label)).toEqual(['接下来', '现在该做', '需要注意', '专注', '本周进展'])
  })
})
