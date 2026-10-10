// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { settings } from '../src/composables/settingsPolicy.js'
import { boundaryText, normalizeTimeStages, remainingTimeStages, stageTimeState, taskHasTime, taskOccupiedRanges, taskTimeOnDate, taskTimePlanError, taskTimeSummary } from '../src/composables/tasks/taskTimePlan.ts'
import { previewTaskTimeShift, undoTaskTimeShift } from '../src/composables/tasks/taskTimeShift.ts'
import { buildTaskMonthGrid } from '../src/composables/taskViews.js'
import { selectTaskView, selectTodayActionPanels, reminderAction } from '../src/composables/domain/selectors.js'
import { filterTaskWorkspace, taskWorkspaceSummary } from '../src/composables/planningViews.js'
import { selectHomeNextUp } from '../src/composables/home/nextUp.js'
import { detectTimePlanConflicts } from '../src/composables/conflictDetection.js'
import { createNextRepeatingTask } from '../src/composables/taskRecurrence.js'
import { selectNextWeekHighlights } from '../src/composables/domain/weeklySelectors.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
registerMirrorTeardown()

const now = new Date('2026-10-10T10:00:00Z')
function stage(id, start, end, extra = {}) {
  return { id, label: id, kind: 'scheduled', start, end, completionRequired: true, reminders: [], ...extra }
}
const offset = (days = 0, hours = 0, minutes = 0, direction = 'later') => ({ direction, days, hours, minutes })
beforeEach(() => { settings.value = { timezone: 'UTC' } })

describe('通用阶段与时间精度', () => {
  it('明确全天在摘要和日历保持全天标记，未知时刻继续显示待定', () => {
    const item = stage('全天执行', { date: '2026-10-12' }, { date: '2026-10-12' }, { allDay: true })
    const task = { id: 'all-day', timeStages: [item] }
    expect(taskTimeSummary(task, now.getTime()).text).toContain('全天')
    expect(taskTimeSummary(task, now.getTime()).text).not.toContain('时刻待定')
    expect(taskTimeOnDate(task, '2026-10-12').every((entry) => entry.allDay)).toBe(true)
    expect(taskTimeSummary({ timeStages: [{ ...item, allDay: false }] }, now.getTime()).text).toContain('时刻待定')
    expect(taskTimePlanError([null])).toMatchObject({ field: 'timeStages.0' })
  })
  it('纯日期范围包含结束日，结束后需要人工确认；等待阶段无需完成', () => {
    const item = stage('审核', { date: '2026-10-09' }, { date: '2026-10-10' }, { kind: 'window' })
    expect(stageTimeState(item, now.getTime())).toBe('active')
    expect(stageTimeState(item, Date.parse('2026-10-11T00:00Z'))).toBe('ended')
    expect(remainingTimeStages({ timeStages: [{ ...item, completionRequired: false }] }, Date.parse('2026-10-11T00:00Z'))).toEqual([])
    expect(boundaryText(item.end)).toContain('时刻待定')
    expect(taskHasTime({ timeStages: [item] })).toBe(true)
  })

  it('允许同日纯日期、跨夜、单端点和未命名阶段，拒绝反向精确区间', () => {
    const dateOnly = stage('', { date: '2026-10-10' }, { date: '2026-10-10' })
    expect(taskTimePlanError([dateOnly])).toBeNull()
    expect(normalizeTimeStages([dateOnly])[0].label).toBe('阶段 1')
    expect(taskTimePlanError([stage('跨夜', { date: '2026-10-10', time: '23:00' }, { date: '2026-10-11', time: '01:00' })])).toBeNull()
    expect(taskTimePlanError([stage('待定', { date: '' }, undefined)])).toBeNull()
    expect(taskTimePlanError([stage('错误', { date: '2026-10-10', time: '23:00' }, { date: '2026-10-10', time: '01:00' })]).field).toBe('timeStages.0.end.date')
    expect(taskTimePlanError([stage('错误', { date: '2027-02-29' }, undefined)]).field).toBe('timeStages.0.start.date')
  })

  it('日期提醒须有明确的通知时刻，零分钟有效，端点和重复标识可校验', () => {
    const item = stage('报名', { date: '2026-10-10' }, undefined, { kind: 'window', reminders: [{ id: 'r', anchor: 'start', enabled: true, minutesBefore: 0 }] })
    expect(taskTimePlanError([item]).field).toContain('reminders')
    item.reminders[0].dateOnlyTime = '09:00'
    expect(taskTimePlanError([item])).toBeNull()
    expect(taskTimePlanError([item, item]).message).toContain('标识重复')
    item.reminders[0].anchor = 'end'
    expect(taskTimePlanError([item]).field).toBe('timeStages.0.end.date')
  })
})

describe('组合时长改期', () => {
  it.each([[0, 2, 0, '2026-11-01', '01:45'], [2, 3, 20, '2026-11-03', '03:05'], [0, 0, 30, '2026-11-01', '00:15']])('移动 %i 天 %i 小时 %i 分钟可跨月，保持区间长度', (days, hours, minutes, date, time) => {
    const task = { dueDate: '2026-11-02', dueTime: '10:00', timeStages: [stage('执行', { date: '2026-10-31', time: '23:45' }, { date: '2026-11-01', time: '01:15' })] }
    const original = JSON.stringify(task)
    const result = previewTaskTimeShift(task, offset(days, hours, minutes), { nowMs: now.getTime() })
    expect(result.error).toBe('')
    expect(result.plan.timeStages[0].start).toEqual({ date, time })
    const { start, end } = result.plan.timeStages[0]
    expect(Date.parse(`${end.date}T${end.time}Z`) - Date.parse(`${start.date}T${start.time}Z`)).toBe(90 * 60_000)
    expect(JSON.stringify(task)).toBe(original)
  })

  it('提前组合时间、显式截止选择以及已完成和已结束等待阶段的历史保留', () => {
    const completed = stage('已办理', { date: '2026-10-09', time: '09:00' }, { date: '2026-10-09', time: '10:00' }, { completedAt: '2026-10-09T09:30:00Z' })
    const waiting = stage('等待', { date: '2026-10-08' }, { date: '2026-10-09' }, { completionRequired: false, kind: 'window' })
    const pending = stage('执行', { date: '2026-10-13', time: '01:30' }, undefined)
    const result = previewTaskTimeShift({ dueDate: '2026-10-14', timeStages: [completed, waiting, pending] }, offset(1, 2, 15, 'earlier'), { nowMs: now.getTime(), includeDeadline: false })
    expect(result.plan.timeStages[0]).toEqual(completed)
    expect(result.plan.timeStages[1]).toEqual(waiting)
    expect(result.plan.timeStages[2].start).toEqual({ date: '2026-10-11', time: '23:15' })
    expect(result.plan.timeStages[2].end).toBeUndefined()
    expect(result.plan.dueDate).toBe('2026-10-14')
  })

  it('按天保留日期精度，按小时须分别明确各端点的原时刻', () => {
    const task = { dueDate: '2026-10-12', timeStages: [stage('执行', { date: '2026-10-11' }, { date: '2026-10-11' }, { allDay: true })] }
    const day = previewTaskTimeShift(task, offset(2), { nowMs: now.getTime() })
    expect(day.plan.timeStages[0].start).toEqual({ date: '2026-10-13' })
    expect(day.plan.timeStages[0].allDay).toBe(true)
    const hour = previewTaskTimeShift(task, offset(0, 2), { nowMs: now.getTime() })
    expect(hour.missingTimes.map((item) => item.key)).toEqual(['due', '执行:start', '执行:end'])
    const precise = previewTaskTimeShift(task, offset(0, 2), { nowMs: now.getTime(), dateOnlyTimes: { due: '18:00', '执行:start': '09:00', '执行:end': '17:00' } })
    expect(precise.missingTimes).toEqual([])
    expect(precise.plan.timeStages[0].start.time).toBe('11:00')
    expect(precise.plan.timeStages[0].allDay).toBe(false)
    expect(precise.dateOnlyBoundaries).toHaveLength(3)
  })

  it.each([offset(-1), offset(0, 'Infinity'), offset(0, 0, 0.5), offset(0, 0, 0)])('拒绝非法或空时长', (duration) => {
    expect(previewTaskTimeShift({ dueDate: '2026-10-11' }, duration).error).not.toBe('')
  })

  it('时区使用应用设置，分钟改期保持本地时刻跨午夜', () => {
    settings.value = { timezone: 'Asia/Shanghai' }
    const result = previewTaskTimeShift({ dueDate: '2026-10-10', dueTime: '23:45' }, offset(0, 0, 30))
    expect(result.plan).toMatchObject({ dueDate: '2026-10-11', dueTime: '00:15' })
  })

  it('撤销改期保留之后添加的阶段、改名和完成事实，不覆盖再次修改的端点', () => {
    const before = { dueDate: '2026-10-12', dueTime: '18:00', timeStages: [stage('原阶段', { date: '2026-10-11', time: '09:00' }, { date: '2026-10-11', time: '10:00' })] }
    const after = previewTaskTimeShift(before, offset(0, 2), { nowMs: now.getTime() }).plan
    const current = JSON.parse(JSON.stringify(after))
    current.timeStages[0].label = '已改名称'
    current.timeStages[0].completedAt = now.toISOString()
    current.timeStages[0].end.time = '19:00'
    current.timeStages.push(stage('后来新增', { date: '2026-10-15' }, undefined))
    const undone = undoTaskTimeShift(current, before, after)
    expect(undone.timeStages).toHaveLength(2)
    expect(undone.timeStages[0]).toMatchObject({ label: '已改名称', completedAt: now.toISOString(), start: before.timeStages[0].start, end: { date: '2026-10-11', time: '19:00' } })
    expect(undone.timeStages[1]).toEqual(current.timeStages[1])
  })

  it('月重复日号只随原重复基准一起撤销，后来改动的基准和日号保留', () => {
    const before = { repeat: 'monthly', repeatAnchorDay: 31, timeStages: [stage('执行', { date: '2027-01-31', time: '09:00' }, undefined)] }
    const after = { ...previewTaskTimeShift(before, offset(1), { nowMs: now.getTime() }).plan, repeat: 'monthly', repeatAnchorDay: 1 }
    const undone = undoTaskTimeShift(after, before, after)
    expect(undone.timeStages[0].start.date).toBe('2027-01-31')
    expect(undone.repeatAnchorDay).toBe(31)
    const current = { ...after, timeStages: [{ ...after.timeStages[0], start: { date: '2027-03-01', time: '09:00' } }] }
    expect(undoTaskTimeShift(current, before, after).timeStages[0].start.date).toBe('2027-03-01')
    expect(undoTaskTimeShift(current, before, after).repeatAnchorDay).toBe(1)
    expect(undoTaskTimeShift({ ...after, repeatAnchorDay: 17 }, before, after).repeatAnchorDay).toBe(17)
  })
})

describe('共享视图和真实占用', () => {
  it('下周摘要跳过已经完成的阶段，并保留全天和跨周持续的时间含义', () => {
    const task = { id: 'next-week', timeStages: [stage('已办', { date: '2026-10-12' }, { date: '2026-10-12' }, { completedAt: now.toISOString() }), stage('全天', { date: '2026-10-14' }, { date: '2026-10-14' }, { allDay: true })] }
    const item = selectNextWeekHighlights({ tasks: [task] }, now)[0]
    expect(item.stageId).toBe('全天')
    expect(item.timeLabel).toContain('全天')
    const ongoing = selectNextWeekHighlights({ tasks: [{ id: 'ongoing', timeStages: [stage('跨周', { date: '2026-10-11', time: '09:00' }, { date: '2026-10-14', time: '18:00' })] }] }, now)[0]
    expect(ongoing.date).toBe('2026-10-12')
    expect(ongoing.time).toBe('')
    expect(ongoing.timeLabel).toContain('2026-10-14 18:00')
  })
  it('仅知未来结束时间时，不把几个月后的事项计为今天或未来七天', () => {
    const task = { id: 'later', timeStages: [stage('待定开始', undefined, { date: '2027-04-12', time: '18:00' })] }
    expect(stageTimeState(task.timeStages[0], now.getTime())).toBe('upcoming')
    expect(taskWorkspaceSummary([task], now)).toEqual({ today: 0, week: 0, overdue: 0, unplanned: 0 })
    expect(taskTimeSummary(task, now.getTime()).next.date).toBe('2027-04-12')
    expect(selectTodayActionPanels({ tasks: [task] }, now).actions).toEqual([])
  })
  it('只有阶段的事项进入已安排、今天和搜索，首页一件事只出现一次', () => {
    const task = { id: 'generic', title: '完成展示', timeStages: [stage('准备材料', { date: '2026-10-10', time: '09:00' }, { date: '2026-10-11', time: '18:00' }, { kind: 'window' }), stage('现场展示', { date: '2026-10-12', time: '14:00' }, { date: '2026-10-12', time: '16:00' })] }
    expect(selectTaskView([task], { now }).counts.scheduled).toBe(1)
    expect(taskWorkspaceSummary([task], now)).toEqual({ today: 1, week: 1, overdue: 0, unplanned: 0 })
    expect(filterTaskWorkspace([task], { now, query: '现场展示' })).toEqual([task])
    const panels = selectTodayActionPanels({ tasks: [task] }, now)
    expect([...panels.risk, ...panels.actions]).toHaveLength(1)
    expect(reminderAction(panels.actions[0]).action).toBe('view')
    expect(selectHomeNextUp({ tasks: [task], now, today: '2026-10-10' }).nextUp.entity.id).toBe('generic')
  })

  it('窗口关闭保留风险与后续阶段，阶段完成移除关闭风险', () => {
    const task = { id: 'generic', timeStages: [stage('提交', { date: '2026-10-09', time: '09:00' }, { date: '2026-10-10', time: '09:00' }, { kind: 'window' }), stage('执行', { date: '2026-10-12', time: '14:00' }, { date: '2026-10-12', time: '16:00' })] }
    expect(taskTimeSummary(task, now.getTime()).risk).toBe(true)
    expect(taskTimeSummary(task, now.getTime()).following.stage.id).toBe('执行')
    task.timeStages[0].completedAt = now.toISOString()
    expect(taskTimeSummary(task, now.getTime()).risk).toBe(false)
    expect(taskTimeSummary(task, now.getTime()).next.stage.id).toBe('执行')
  })

  it('跨月占用每天可找到，窗口只标记端点，同日多标记只计一个事项', () => {
    const task = { id: 'cross', timeStages: [stage('跨日', { date: '2026-10-31', time: '23:00' }, { date: '2026-11-03', time: '01:00' }), stage('窗口', { date: '2026-11-01' }, { date: '2026-11-05' }, { kind: 'window' })] }
    const grid = buildTaskMonthGrid('2026-11', [task])
    expect(grid.byDate.get('2026-11-01')).toHaveLength(1)
    expect(grid.byDate.get('2026-11-02')).toHaveLength(1)
    expect(grid.byDate.get('2026-11-04')).toBeUndefined()
    expect(grid.byDate.get('2026-11-05')).toHaveLength(1)
  })

  it('窗口、截止与未知结束不占用，相邻区间不冲突，跨日重叠可检测', () => {
    const task = { id: 'new', dueDate: '2026-10-10', dueTime: '23:00', timeStages: [stage('现场', { date: '2026-10-10', time: '23:00' }, { date: '2026-10-11', time: '01:00' })] }
    const existing = { id: 'old', timeStages: [stage('另一场', { date: '2026-10-11', time: '00:30' }, { date: '2026-10-11', time: '02:00' })] }
    expect(detectTimePlanConflicts(task, [existing])).toHaveLength(1)
    existing.timeStages[0].start.time = '01:00'
    expect(detectTimePlanConflicts(task, [existing])).toEqual([])
    task.timeStages[0].kind = 'window'
    expect(taskOccupiedRanges(task)).toEqual([])
    task.timeStages[0].kind = 'scheduled'
    delete task.timeStages[0].end
    expect(taskOccupiedRanges(task)).toEqual([])
  })

  it('阶段事项按正式开始重复，月末锚点保留，所有阶段重置且不修改原事项', () => {
    const task = { id: 'repeat', title: '展示', repeat: 'monthly', done: true, status: 'completed', dueDate: '2026-02-02', timeStages: [stage('准备', { date: '2026-01-29' }, { date: '2026-01-30' }, { kind: 'window', completedAt: '2026-01-30T10:00Z' }), stage('现场', { date: '2026-01-31', time: '14:00' }, { date: '2026-01-31', time: '16:00' }, { reminders: [{ id: 'original', anchor: 'start', minutesBefore: 30, enabled: true }] })] }
    const next = createNextRepeatingTask(task, now)
    expect(next.timeStages[1].start).toEqual({ date: '2026-02-28', time: '14:00' })
    expect(next.timeStages[0].start.date).toBe('2026-02-26')
    expect(next.dueDate).toBe('2026-03-02')
    expect(next.timeStages[0].completedAt).toBeNull()
    expect(next.timeStages[1].id).not.toBe('现场')
    expect(next.timeStages[1].reminders[0].id).not.toBe('original')
    expect(next.repeatAnchorDay).toBe(31)
    expect(createNextRepeatingTask(next, now).timeStages[1].start.date).toBe('2026-03-31')
    expect(task.timeStages[0].completedAt).toBeTruthy()
    expect(createNextRepeatingTask({ ...task, dueDate: '' }, now).dueDate).toBe('')
  })
})
