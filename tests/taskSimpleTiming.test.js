// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { settings } from '../src/composables/settingsPolicy.js'
import { taskDeadlineError, taskHasTime, taskRepeatBase, taskTimeEntries, taskTimeSummary, taskOccupiedRanges } from '../src/composables/tasks/taskTimePlan'
import { previewTaskTimeShift, undoTaskTimeShift } from '../src/composables/tasks/taskTimeShift'
import { taskWorkspaceSummary, filterTaskWorkspace } from '../src/composables/planningViews.js'
import { selectTaskView, selectTodayActionPanels } from '../src/composables/domain/selectors.js'
import { selectHomeNextUp } from '../src/composables/home/nextUp.js'
import { buildTaskMonthGrid } from '../src/composables/taskViews.js'
import { useTaskEditor } from '../src/composables/tasks/useTaskEditor.js'
import { useTaskBulkActions } from '../src/composables/tasks/useTaskBulkActions.js'
import { flushStoredWrites } from '../src/composables/store/core.js'
import { completeBackupArchive, createBackupSnapshot, parseBackupArchive, BACKUP_STORAGE_KEYS } from '../src/composables/backupArchive.js'
import { buildBackupRestoreValues } from '../src/composables/backupRestore.js'
import { buildEntityManifest } from '../src/composables/syncMetadata.js'
import { mergeSyncPayload } from '../src/composables/syncMerge.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
registerMirrorTeardown()

const domain = useDomainCommands()
const now = new Date('2026-10-10T10:00:00Z')
const timing = { startDate: '2026-10-10', startTime: '09:00', dueDate: '2026-10-12', dueTime: '18:00' }
const later = { direction: 'later', days: 1, hours: 0, minutes: 0 }
beforeEach(() => { domain.tasks.value = []; domain.events.value = []; domain.courses.value = []; settings.value = { timezone: 'UTC' } })

describe('普通待办独立起止时间', () => {
  it.each([
    [{ startDate: '2027-02-29' }, 'startDate'],
    [{ startTime: '09:00' }, 'startTime'],
    [{ startDate: '2026-10-10', startTime: '25:00' }, 'startTime'],
    [{ ...timing, dueDate: '2026-10-09' }, 'dueDate'],
    [{ ...timing, dueDate: timing.startDate, dueTime: '08:00' }, 'dueTime'],
    [{ ...timing, dueDate: timing.startDate, dueTime: timing.startTime }, 'dueTime'],
  ])('校验错误端点并拒绝领域写入 %j', (input, field) => {
    expect(taskDeadlineError(input)?.field).toBe(field)
    expect(() => domain.createTask({ title: '示例任务', ...input })).toThrow()
    expect(domain.tasks.value).toEqual([])
  })

  it('允许同日纯日期、跨夜以及单独开始或截止，不强制时间精度', () => {
    for (const input of [
      { startDate: '2026-10-10', dueDate: '2026-10-10' },
      { startDate: '2026-10-10', startTime: '23:00', dueDate: '2026-10-11', dueTime: '01:00' },
      { startDate: '2026-10-10' }, { dueDate: '2026-10-10' }, {},
    ]) expect(taskDeadlineError(input)).toBeNull()
  })

  it('部分更新时间也必须与另一端校验，错误不会半保存', () => {
    const task = domain.createTask({ title: '示例任务', ...timing })
    const before = JSON.stringify(task)
    expect(() => domain.updateTask(task.id, { title: '错误修改', startDate: '2026-10-13' })).toThrow('截止须晚于开始')
    expect(JSON.stringify(task)).toBe(before)
    expect(() => domain.updateTask(task.id, { dueDate: '2026-10-09' })).toThrow('截止须晚于开始')
  })

  it('开始时间独立进入已安排、今日行动、首页、搜索和日历，不产生阶段或占用', () => {
    const task = domain.createTask({ title: '示例任务', startDate: '2026-10-10', startTime: '11:00' })
    expect(task.timeStages || []).toEqual([])
    expect(taskHasTime(task)).toBe(true)
    expect(selectTaskView([task], { now }).counts.scheduled).toBe(1)
    expect(taskWorkspaceSummary([task], now)).toEqual({ today: 1, week: 1, overdue: 0, unplanned: 0 })
    expect(selectTodayActionPanels({ tasks: [task] }, now).actions).toHaveLength(1)
    expect(selectHomeNextUp({ tasks: [task], now }).nextUp.timeSummary).toContain('开始')
    expect(filterTaskWorkspace([task], { now, query: '2026-10-10' })).toEqual([task])
    expect(buildTaskMonthGrid('2026-10', [task]).byDate.get('2026-10-10')).toHaveLength(1)
    expect(taskOccupiedRanges({ ...task, dueDate: '2026-10-12', dueTime: '18:00' })).toEqual([])
  })

  it('区间内每天可行动，未来开始优先展示，到期后只按截止判逾期', () => {
    const task = domain.createTask({ title: '示例任务', ...timing })
    expect(taskTimeSummary(task, Date.parse('2026-10-09T10:00Z')).next.date).toBe(timing.startDate)
    expect(taskTimeSummary(task, now.getTime()).next.date).toBe(timing.dueDate)
    expect(taskTimeSummary(task, now.getTime()).text).toContain('开始 2026-10-10 09:00')
    expect(taskWorkspaceSummary([task], new Date('2026-10-11T10:00Z')).today).toBe(1)
    expect(taskWorkspaceSummary([task], new Date('2026-10-13T10:00Z')).overdue).toBe(1)
    expect(taskTimeEntries(task).map((entry) => entry.label)).toEqual(['事项开始', '事项截止'])
  })

  it('事项开始后优先展示仍待处理的阶段；阶段完成后提示确认事项完成', () => {
    const task = { id: 'example-staged', title: '示例任务', startDate: '2026-10-01', timeStages: [{ id: 'example-submit', label: '提交材料', kind: 'window', end: { date: '2026-10-15' } }] }
    expect(taskTimeSummary(task, now.getTime()).next.stage?.id).toBe('example-submit')
    expect(selectHomeNextUp({ tasks: [task], now }).nextUp.stageId).toBe('example-submit')
    task.timeStages[0].completedAt = now.toISOString()
    expect(taskTimeSummary(task, now.getTime()).text).toContain('待确认事项完成')
  })

  it('整体改期移动两个端点，撤销保留后续修改并避免产生反向区间', () => {
    const after = previewTaskTimeShift(timing, later).plan
    expect(after).toMatchObject({ startDate: '2026-10-11', startTime: '09:00', dueDate: '2026-10-13', dueTime: '18:00' })
    expect(undoTaskTimeShift(after, timing, after)).toMatchObject(timing)
    const current = { ...after, startDate: '2026-10-13' }
    expect(undoTaskTimeShift(current, timing, after)).toMatchObject(current)
    expect(previewTaskTimeShift(timing, { ...later, days: 4 }, { includeDeadline: false }).error).toContain('截止须晚于开始')
  })

  it('只有日期按小时改期要求明确两个原时刻，按天移动保留日期精度', () => {
    const input = { startDate: '2026-10-10', dueDate: '2026-10-12' }
    const duration = { ...later, days: 0, hours: 2 }
    expect(previewTaskTimeShift(input, duration).missingTimes.map((item) => item.key)).toEqual(['start', 'due'])
    expect(previewTaskTimeShift(input, duration, { dateOnlyTimes: { start: '09:00', due: '18:00' } }).plan).toMatchObject({ startTime: '11:00', dueTime: '20:00' })
    expect(previewTaskTimeShift(input, later).plan).toMatchObject({ startDate: '2026-10-11', startTime: '', dueDate: '2026-10-13', dueTime: '' })
  })

  it('只有开始日期也可批量改期和撤销', () => {
    const task = domain.createTask({ title: '示例任务', startDate: '2026-10-10' })
    let notification
    const bulk = useTaskBulkActions({ domain, tasks: domain.tasks, selection: { clear() {} }, notify: (_message, options) => { notification = options }, nowMs: () => now.getTime() })
    bulk.startShift([task])
    const preview = bulk.previewShift()
    expect(preview.skipped).toBe(0)
    bulk.applyShift(preview)
    expect(task.startDate).toBe('2026-10-11')
    notification.undoFn()
    expect(task.startDate).toBe('2026-10-10')
  })

  it('编辑保留独立时间；清空日期同时清空时刻，取消不改动原任务', () => {
    const task = domain.createTask({ title: '示例任务', ...timing })
    const editor = useTaskEditor({ domain, tasks: domain.tasks, courses: domain.courses, events: domain.events })
    editor.openEdit(task)
    editor.form.value.startDate = '2026-10-11'
    editor.showForm.value = false
    expect(task.startDate).toBe(timing.startDate)
    editor.openEdit(task)
    editor.form.value.startDate = ''
    editor.save()
    expect(task).toMatchObject({ startDate: '', startTime: '', dueDate: timing.dueDate })
    expect(editor.showForm.value).toBe(false)
  })

  it('仅编辑标题不出现撤销改期，实际修改开始时间后可撤销', () => {
    const task = domain.createTask({ title: '示例任务', ...timing })
    const saved = []
    const editor = useTaskEditor({ domain, tasks: domain.tasks, courses: domain.courses, events: domain.events, onSaved: (...args) => saved.push(args) })
    editor.openEdit(task)
    editor.form.value.title = '示例新标题'
    editor.save()
    expect(saved[0]).toEqual(['待办已更新'])
    editor.openEdit(task)
    editor.form.value.startTime = '10:00'
    editor.save()
    expect(saved[1][1].actionLabel).toBe('撤销改期')
    saved[1][1].undoFn()
    expect(task.startTime).toBe(timing.startTime)
    expect(task.title).toBe('示例新标题')
  })

  it.each([false, true])('重复时同时移动起止日期，支持只有开始日期（%s）', (startOnly) => {
    const task = domain.createTask({ title: '示例每周任务', repeat: 'weekly', ...(startOnly ? { startDate: timing.startDate, startTime: timing.startTime } : timing) })
    expect(taskRepeatBase(task).date).toBe(startOnly ? timing.startDate : timing.dueDate)
    domain.toggleTask(task.id)
    expect(domain.tasks.value[1]).toMatchObject({ startDate: '2026-10-17', startTime: '09:00', dueDate: startOnly ? '' : '2026-10-19', status: 'pending' })
    expect(domain.tasks.value[1].timeStages || []).toEqual([])
  })

  it('刷新、完整备份恢复和同步载荷均保留普通任务的起止字段', async () => {
    domain.createTask({ id: 'example-range', title: '示例任务', ...timing })
    flushStoredWrites()
    const stored = JSON.parse(localStorage.getItem('sl_tasks'))
    expect(stored[0]).toMatchObject(timing)
    const parsed = await parseBackupArchive(await completeBackupArchive(createBackupSnapshot()))
    const restored = buildBackupRestoreValues(parsed.data, parsed.providedFields, BACKUP_STORAGE_KEYS)
    expect(restored.sl_tasks[0]).toMatchObject(timing)
    const merged = mergeSyncPayload({ baseManifest: buildEntityManifest({ sl_tasks: [] }), localValues: { sl_tasks: [] }, remoteValues: { sl_tasks: stored }, keys: ['sl_tasks'] })
    expect(merged.conflicts).toEqual([])
    expect(merged.values.sl_tasks[0]).toMatchObject(timing)
  })
})
