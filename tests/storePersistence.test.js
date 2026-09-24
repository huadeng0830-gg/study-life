// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

describe('useStoredRef 延迟持久化', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    localStorage.clear()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('不会漏掉深层监听建立前发生的修改', async () => {
    const { useStoredRef } = await import('../src/composables/store')
    const state = useStoredRef('sl_delayed_persistence_test', [])

    state.value.push({ id: 'early-change' })
    await vi.advanceTimersByTimeAsync(500)

    expect(JSON.parse(localStorage.getItem('sl_delayed_persistence_test'))).toEqual([
      { id: 'early-change' },
    ])
  })

  it('序列化结果回到上次已保存值时不重复写入', async () => {
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    const state = useStoredRef('sl_noop_write_test', [])
    await vi.advanceTimersByTimeAsync(500)
    const setItem = vi.spyOn(localStorage, 'setItem')

    state.value.push({ id: 'temporary-change' })
    state.value.pop()
    await nextTick()
    flushStoredWrites()

    expect(setItem).not.toHaveBeenCalled()
  })

  it('大集合可以通过显式提交绕开深层监听', async () => {
    const key = 'sl_explicit_commit_test'
    const { flushStoredWrites, touchStoredRef, useStoredRef } = await import('../src/composables/store')
    const state = useStoredRef(key, [], { deep: false })
    await vi.advanceTimersByTimeAsync(500)

    state.value.push({ id: 'nested-change' })
    await nextTick()
    flushStoredWrites()
    expect(localStorage.getItem(key)).toBeNull()

    touchStoredRef(key)
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([{ id: 'nested-change' }])
  })

  it('任务领域命令在浅层监听模式下仍会显式提交', async () => {
    const key = 'sl_tasks'
    localStorage.setItem(key, '[]')
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    useStoredRef(key, [], { deep: false })
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    const domain = useDomainCommands()
    await vi.advanceTimersByTimeAsync(500)

    const task = domain.createTask({ title: '显式提交任务', dueDate: '2026-09-14' })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ id: task.id, title: '显式提交任务' }),
    ])

    domain.updateTask(task.id, { note: '已更新' })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ id: task.id, title: '显式提交任务', note: '已更新' }),
    ])
  })

  it('笔记领域命令在浅层监听模式下仍会显式提交', async () => {
    const key = 'sl_quick_notes'
    localStorage.setItem(key, '[]')
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    useStoredRef(key, [], { deep: false })
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    const domain = useDomainCommands()
    await vi.advanceTimersByTimeAsync(500)

    const note = domain.createNote({ content: '显式提交笔记' })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ id: note.id, content: '显式提交笔记' }),
    ])

    domain.updateNote(note.id, { tags: ['性能'] })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ id: note.id, content: '显式提交笔记', tags: ['性能'] }),
    ])
  })

  it('日程领域命令在浅层监听模式下仍会显式提交', async () => {
    const key = 'sl_events'
    localStorage.setItem(key, '[]')
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    useStoredRef(key, [], { deep: false })
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    const domain = useDomainCommands()
    await vi.advanceTimersByTimeAsync(500)

    const event = domain.createEvent({ title: '显式提交日程', date: '2026-09-15' })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ id: event.id, title: '显式提交日程' }),
    ])

    domain.archiveEvent(event.id)
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ id: event.id, title: '显式提交日程', archivedAt: expect.any(String) }),
    ])
  })

  it('重要日期领域命令在浅层监听模式下仍会显式提交', async () => {
    const key = 'sl_exams'
    localStorage.setItem(key, '[]')
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    useStoredRef(key, [], { deep: false })
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    const domain = useDomainCommands()
    await vi.advanceTimersByTimeAsync(500)

    const milestone = domain.createMilestone({ name: '显式提交重要日期', date: '2026-09-20' })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ id: milestone.id, name: '显式提交重要日期' }),
    ])

    domain.updateMilestone(milestone.id, { pinned: true })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ id: milestone.id, pinned: true }),
    ])
  })

  it('固定账单的更新、支付与撤销在浅层监听模式下仍会显式提交', async () => {
    const key = 'sl_bills'
    localStorage.setItem(key, '[]')
    localStorage.setItem('sl_expenses', '[]')
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    useStoredRef(key, [], { deep: false })
    useStoredRef('sl_expenses', [], { deep: false })
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    const domain = useDomainCommands()
    await vi.advanceTimersByTimeAsync(500)

    const bill = domain.createBill({ name: '显式提交账单', amount: 60, nextDate: '2099-09-15' })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ id: bill.id, amount: 60, nextDate: '2099-09-15' }),
    ])

    domain.updateBill(bill.id, { amount: 80 })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))[0]).toEqual(expect.objectContaining({ amount: 80 }))

    const paid = domain.payBill(bill.id)
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))[0]).toEqual(expect.objectContaining({ nextDate: '2099-10-15' }))
    expect(JSON.parse(localStorage.getItem('sl_expenses'))).toEqual([
      expect.objectContaining({ id: paid.transaction.id, billId: bill.id, billingPeriodKey: '2099-09-15' }),
    ])

    domain.undoBillPayment(paid.transaction.id)
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))[0]).toEqual(expect.objectContaining({ nextDate: '2099-09-15' }))
    expect(JSON.parse(localStorage.getItem('sl_expenses'))).toEqual([])
  })

  it('专注记录命令在浅层监听模式下仍会显式提交', async () => {
    const key = 'sl_focus_sessions'
    localStorage.setItem(key, '[]')
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    useStoredRef(key, [], { deep: false })
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    const domain = useDomainCommands()
    await vi.advanceTimersByTimeAsync(500)
    const task = domain.createTask({ id: 'focus-linked-task', title: '专注关联任务' })
    await nextTick()
    flushStoredWrites()

    domain.recordFocusSession({
      id: 'focus-explicit-commit',
      sessionId: 'focus-explicit-commit',
      focusType: 'todo-linked',
      todoId: task.id,
      actualFocusSeconds: 1500,
      endedAt: '2026-09-13T12:00:00.000Z',
      status: 'completed',
    })
    await nextTick()
    flushStoredWrites()

    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ sessionId: 'focus-explicit-commit', actualFocusSeconds: 1500 }),
    ])
    expect(JSON.parse(localStorage.getItem('sl_tasks'))[0]).toEqual(expect.objectContaining({
      id: task.id,
      focusCount: 1,
      focusTotalSeconds: 1500,
    }))
  })

  it('清单命令在浅层监听模式下逐次显式提交', async () => {
    const key = 'sl_checklists'
    localStorage.setItem(key, '[]')
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    useStoredRef(key, [], { deep: false })
    const { useChecklistCommands } = await import('../src/composables/checklists.js')
    const checklists = useChecklistCommands()
    await vi.advanceTimersByTimeAsync(500)

    const list = checklists.createList({ id: 'list-explicit-commit', name: '性能清单', type: 'general' })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ id: list.id, name: '性能清单', items: [] }),
    ])

    const item = checklists.createItem(list.id, { id: 'item-explicit-commit', name: '验证落盘' })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))[0].items).toEqual([
      expect.objectContaining({ id: item.id, done: false }),
    ])

    checklists.toggleItem(list.id, item.id)
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))[0].items[0]).toEqual(expect.objectContaining({ done: true }))
  })

  it('课程命令在浅层监听模式下逐次显式提交', async () => {
    const key = 'sl_courses'
    localStorage.setItem(key, '[]')
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    useStoredRef(key, [], { deep: false })
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    const domain = useDomainCommands()
    await vi.advanceTimersByTimeAsync(500)

    const course = domain.createCourse({ name: '高等数学', day: 0, start: 1, end: 2 })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ id: course.id, name: '高等数学' }),
    ])

    domain.archiveCourse(course.id)
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))[0]).toEqual(expect.objectContaining({ archivedAt: expect.any(String) }))

    domain.replaceCourses([{ id: 'course-replaced', name: '大学英语' }])
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([{ id: 'course-replaced', name: '大学英语' }])
  })

  it('课表模板命令在浅层监听模式下逐次显式提交', async () => {
    const key = 'sl_course_templates'
    localStorage.setItem(key, '[]')
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store')
    useStoredRef(key, [], { deep: false })
    const { useCourseTemplateCommands } = await import('../src/composables/courseTemplates.js')
    const templates = useCourseTemplateCommands()
    await vi.advanceTimersByTimeAsync(500)

    const template = templates.saveTemplate({
      id: 'template-explicit-commit',
      name: '大一上学期',
      courses: [{ id: 'course-1', name: '高等数学' }],
    })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ id: template.id, name: '大一上学期' }),
    ])

    templates.deleteTemplate(template.id)
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([])
  })

  it('特殊日期命令在浅层监听模式下逐次显式提交', async () => {
    const key = 'sl_schedule_exceptions'
    localStorage.setItem(key, '[]')
    const { flushStoredWrites, useStoredRef } = await import('../src/composables/store/core.js')
    useStoredRef(key, [], { deep: false })
    const { removeScheduleException, upsertScheduleException } = await import('../src/composables/store/schedule.js')
    await vi.advanceTimersByTimeAsync(500)

    const exception = upsertScheduleException({ date: '2026-10-01', type: 'off', note: '国庆节' })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      expect.objectContaining({ id: exception.id, date: '2026-10-01', note: '国庆节' }),
    ])

    upsertScheduleException({ date: '2026-10-01', type: 'off', note: '假期' })
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))[0]).toEqual(expect.objectContaining({ note: '假期' }))

    removeScheduleException(exception.id)
    await nextTick()
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(key))).toEqual([])
  })

  it('页面立即退出时会先安装监听并同步冲刷修改', async () => {
    const { useStoredRef } = await import('../src/composables/store')
    const state = useStoredRef('sl_pagehide_persistence_test', [])

    state.value.push({ id: 'before-pagehide' })
    window.dispatchEvent(new Event('pagehide'))

    expect(JSON.parse(localStorage.getItem('sl_pagehide_persistence_test'))).toEqual([
      { id: 'before-pagehide' },
    ])
  })

  it('批量写入回滚失败时明确标记 rollbackFailed', async () => {
    const { restoreStoredValues } = await import('../src/composables/store')
    localStorage.setItem('sl_rollback_a', JSON.stringify('old-a'))
    localStorage.setItem('sl_rollback_b', JSON.stringify('old-b'))
    const originalSetItem = localStorage.setItem.bind(localStorage)
    let calls = 0
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      calls += 1
      if (calls === 2 || calls === 3) throw new Error('模拟存储失败')
      return originalSetItem(key, value)
    })

    await expect(restoreStoredValues({ sl_rollback_a: 'new-a', sl_rollback_b: 'new-b' }, { markChanged: false }))
      .rejects.toMatchObject({ rollbackFailed: true })
  })
})
