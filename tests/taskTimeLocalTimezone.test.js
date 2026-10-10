// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
registerMirrorTeardown()

it('本地夏令时不存在的时刻无法手动写入、按天改期或生成下一期', async () => {
  const previousTimezone = process.env.TZ
  process.env.TZ = 'America/New_York'
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('sl_quick_record_settings', JSON.stringify({ timezone: 'local' }))
  try {
    const { taskTimePlanError } = await import('../src/composables/tasks/taskTimePlan.ts')
    const { previewTaskTimeShift } = await import('../src/composables/tasks/taskTimeShift.ts')
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    const stage = { id: 'dst', label: '示例执行', kind: 'scheduled', start: { date: '2027-03-13', time: '02:30' }, end: { date: '2027-03-13', time: '05:30' }, reminders: [] }
    const nextStage = { ...stage, start: { date: '2027-03-14', time: '02:30' }, end: { date: '2027-03-14', time: '05:30' } }
    expect(taskTimePlanError([nextStage]).message).toContain('当前时区不存在')
    expect(previewTaskTimeShift({ timeStages: [stage] }, { direction: 'later', days: 1, hours: 0, minutes: 0 }, { nowMs: Date.parse('2027-03-13T00:00Z') }).error).toContain('当前时区不存在')
    expect(previewTaskTimeShift({ dueDate: '2027-03-13', dueTime: '02:30' }, { direction: 'later', days: 1, hours: 0, minutes: 0 }).error).toContain('当前时区不存在')
    expect(taskTimePlanError([{ ...stage, start: { date: '2027-03-14' }, end: undefined, reminders: [{ id: 'clock', enabled: true, anchor: 'start', minutesBefore: 0, dateOnlyTime: '02:30' }] }]).message).toContain('提醒时刻在当前时区不存在')
    const { ref } = await import('vue')
    const { useTaskStageActions } = await import('../src/composables/tasks/useTaskStageActions.ts')
    let undo
    const domain = useDomainCommands()
    const task = domain.createTask({ title: '每日执行', repeat: 'daily', timeStages: [stage] })
    const actions = useTaskStageActions({ domain, now: ref(new Date('2027-03-13T00:00Z')), notify: (_message, options) => { undo = options.undoFn } })
    actions.toggle(task)
    actions.confirmWhole()
    expect(domain.tasks.value).toHaveLength(1)
    expect(task.repeatGenerationError).toContain('下一期未生成')
    expect(task.done).toBe(true)
    undo()
    expect(task.done).toBe(false)
    expect(task.repeatGenerationError).toBeUndefined()
    domain.toggleTask(task.id)
    domain.updateTask(task.id, { repeatEndDate: '2027-03-13' })
    expect(task.repeatGenerationError).toBeUndefined()
    expect(domain.tasks.value).toHaveLength(1)
    domain.updateTask(task.id, { repeatEndDate: '', timeStages: [{ ...stage, start: { date: '2027-03-13', time: '03:30' } }] })
    expect(domain.tasks.value).toHaveLength(2)
    expect(task.repeatGenerationError).toBeUndefined()
    expect(domain.tasks.value[1].repeatGenerationError).toBeUndefined()
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  }
})

it('编辑和单独改期的手动截止时刻也拒绝夏令时空缺，修正后才保存', async () => {
  const previousTimezone = process.env.TZ
  process.env.TZ = 'America/New_York'
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('sl_quick_record_settings', JSON.stringify({ timezone: 'local' }))
  let app, host
  try {
    const { createApp, h, nextTick } = await import('vue')
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    const { useTaskEditor } = await import('../src/composables/tasks/useTaskEditor.js')
    const domain = useDomainCommands()
    const task = domain.createTask({ title: '示例截止事项', dueDate: '2027-03-13', dueTime: '02:30' })
    const editor = useTaskEditor({ domain, tasks: domain.tasks, courses: domain.courses, events: domain.events })
    editor.openEdit(task)
    editor.form.value.dueDate = '2027-03-14'
    editor.save()
    expect(editor.error.value).toContain('当前时区不存在')
    expect(editor.errorField.value).toBe('dueTime')
    expect(editor.showForm.value).toBe(true)
    expect(task.dueDate).toBe('2027-03-13')
    editor.form.value.dueTime = '03:30'
    editor.save()
    expect(task).toMatchObject({ dueDate: '2027-03-14', dueTime: '03:30' })

    const TaskRescheduleDialog = (await import('../src/components/tasks/TaskRescheduleDialog.vue')).default
    const saved = []
    host = document.createElement('div')
    document.body.append(host)
    app = createApp({ render: () => h(TaskRescheduleDialog, { task, today: '2027-03-13', nowMs: Date.parse('2027-03-13T12:00Z'), onSave: (plan) => saved.push(plan) }) })
    app.mount(host)
    await nextTick()
    const timeInput = document.querySelector('.reschedule-form input[type="time"]')
    timeInput.value = '02:30'
    timeInput.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    const form = document.querySelector('.reschedule-form')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()
    expect(form.querySelector('[role="alert"]').textContent).toContain('当前时区不存在')
    expect(saved).toHaveLength(0)
    timeInput.value = '03:30'
    timeInput.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ dueDate: '2027-03-14', dueTime: '03:30' })
  } finally {
    app?.unmount()
    host?.remove()
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  }
})

it('进入夏令时重复小时的提前和顺延不会丢失经过的时长', async () => {
  const previousTimezone = process.env.TZ
  process.env.TZ = 'America/New_York'
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('sl_quick_record_settings', JSON.stringify({ timezone: 'local' }))
  try {
    const { previewTaskTimeShift } = await import('../src/composables/tasks/taskTimeShift.ts')
    const duration = { days: 0, hours: 1, minutes: 0 }
    expect(previewTaskTimeShift({ dueDate: '2026-11-01', dueTime: '01:30' }, { ...duration, direction: 'later' }).error).toContain('出现两次')
    expect(previewTaskTimeShift({ dueDate: '2026-11-01', dueTime: '02:30' }, { ...duration, direction: 'earlier' }).error).toContain('出现两次')
    const stage = { id: 'fold', label: '示例执行', kind: 'scheduled', start: { date: '2026-11-01', time: '01:30' }, end: { date: '2026-11-01', time: '02:30' }, reminders: [] }
    expect(previewTaskTimeShift({ timeStages: [stage] }, { ...duration, direction: 'later' }, { nowMs: Date.parse('2026-10-31T12:00Z') }).error).toContain('出现两次')
    const result = previewTaskTimeShift({ dueDate: '2026-11-01', dueTime: '00:30' }, { ...duration, direction: 'later' })
    expect(result.error).toBe('')
    expect(result.plan.dueTime).toBe('01:30')
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  }
})
