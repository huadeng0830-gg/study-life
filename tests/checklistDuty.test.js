// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
import { currentSemesterStartDate, dutyMemberChoices, summarizeDutyCounts } from '../src/composables/domain/checklistDuty.js'

registerMirrorTeardown()

describe('值日与班务仍使用既有清单分区', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-14T10:00:00'))
    localStorage.clear()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('按 taskRecurrence 的每周星期生成下一期，轮换成员并重置代班状态', async () => {
    const { useChecklistCommands } = await import('../src/composables/checklists.js')
    const commands = useChecklistCommands()
    const list = commands.createList({
      id: 'duty-fixture-series', name: '宿舍值日（每周三）', type: 'chores',
      dutyEnabled: true, dutyTemplateId: 'dorm-duty', dutyMembers: ['虚构同学甲', '虚构同学乙'],
      dutySeriesId: 'duty-fixture-series', occurrenceDate: '2026-10-14', semesterStartDate: '2026-09-01',
      repeat: 'weekly', repeatWeekday: 3,
      items: [{ name: '清扫地面', assignedTo: '虚构同学甲', substitutedBy: '虚构同学乙', done: true }],
    })

    const next = commands.createNextDutyOccurrence(list.id)

    expect(next).toMatchObject({
      name: list.name, dutyEnabled: true, dutySeriesId: list.dutySeriesId,
      occurrenceDate: '2026-10-21', repeat: 'weekly', repeatWeekday: 3,
    })
    expect(next.id).not.toBe(list.id)
    expect(next.items[0]).toMatchObject({ name: '清扫地面', dueDate: '2026-10-21', assignedTo: '虚构同学乙', substitutedBy: '', done: false })
    expect(commands.createNextDutyOccurrence(list.id)).toBeNull()
    expect(commands.lists.value).toHaveLength(2)
  })

  it('单条事项可记录代班人，并把新名字保存在 sl_checklists 的名单中', async () => {
    const { useChecklistCommands } = await import('../src/composables/checklists.js')
    const commands = useChecklistCommands()
    const list = commands.createList({
      name: '实验室值班', type: 'chores', dutyEnabled: true, dutyMembers: ['虚构同学甲'],
      occurrenceDate: '2026-10-07', repeat: 'none', items: [{ name: '检查公共区域', assignedTo: '虚构同学甲' }],
    })
    const item = commands.updateItem(list.id, list.items[0].id, { substitutedBy: '虚构同学乙' })
    const { flushStoredWrites } = await import('../src/composables/store/index.js')
    flushStoredWrites()

    expect(item).toMatchObject({ assignedTo: '虚构同学甲', substitutedBy: '虚构同学乙' })
    expect(list.dutyMembers).toEqual(['虚构同学甲', '虚构同学乙'])
    expect(dutyMemberChoices(commands.lists.value)).toEqual(['虚构同学甲', '虚构同学乙'])
    const stored = JSON.parse(localStorage.getItem('sl_checklists'))
    expect(stored[0].items[0].substitutedBy).toBe('虚构同学乙')
  })

  it('按学期日期汇总实际值班和代班次数，同一班次多项只计一次', () => {
    const lists = [
      {
        id: 'fixture-series-a', dutyEnabled: true, dutySeriesId: 'fixture-series-a', occurrenceDate: '2026-09-02',
        items: [
          { dueDate: '2026-09-02', assignedTo: '虚构同学甲', substitutedBy: '虚构同学乙' },
          { dueDate: '2026-09-02', assignedTo: '虚构同学甲' },
        ],
      },
      {
        id: 'fixture-series-a-next', dutyEnabled: true, dutySeriesId: 'fixture-series-a', occurrenceDate: '2026-09-09',
        items: [{ dueDate: '2026-09-09', assignedTo: '虚构同学甲' }],
      },
      {
        id: 'fixture-series-b', dutyEnabled: true, dutySeriesId: 'fixture-series-b', occurrenceDate: '2026-09-02',
        items: [{ dueDate: '2026-09-02', assignedTo: '虚构同学甲' }],
      },
      { id: 'outside-term', dutyEnabled: true, dutySeriesId: 'other', occurrenceDate: '2026-08-31', items: [{ assignedTo: '虚构同学甲' }] },
      { id: 'future', dutyEnabled: true, dutySeriesId: 'future', occurrenceDate: '2026-11-01', items: [{ assignedTo: '虚构同学甲' }] },
      { id: 'ordinary-list', items: [{ assignedTo: '虚构同学甲' }] },
    ]

    expect(currentSemesterStartDate(new Date('2026-10-14T10:00:00'))).toBe('2026-09-01')
    expect(summarizeDutyCounts(lists, { semesterStartDate: '2026-09-01', throughDate: '2026-10-14' })).toEqual({
      byMember: [{ name: '虚构同学甲', count: 3 }, { name: '虚构同学乙', count: 1 }],
      substitutedBy: [{ name: '虚构同学乙', count: 1 }],
      totalShifts: 4,
      totalSubstitutions: 1,
    })
  })
})
