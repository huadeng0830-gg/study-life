import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useTaskEditor } from '../src/composables/tasks/useTaskEditor.js'

function createEditor() {
  const domain = { createTask: vi.fn(), updateTask: vi.fn() }
  const editor = useTaskEditor({
    domain,
    tasks: ref([]),
    courses: ref([{ id: 'course-1', name: '高等数学' }]),
    events: ref([]),
  })
  return { domain, editor }
}

describe('useTaskEditor', () => {
  it('clears an orphaned time when no due date is set', () => {
    const { domain, editor } = createEditor()
    editor.openAdd()
    editor.form.value.title = '整理资料'
    editor.form.value.dueTime = '18:00'
    editor.save()
    expect(domain.createTask.mock.calls[0][0].dueTime).toBe('')
  })

  it.each(['-10', 'Infinity', 'not-a-number'])('rejects invalid estimates (%s)', (value) => {
    const { domain, editor } = createEditor()
    editor.openAdd()
    editor.form.value.title = '整理资料'
    editor.form.value.estimateMinutes = value
    editor.save()
    expect(domain.createTask).not.toHaveBeenCalled()
    expect(editor.errorField.value).toBe('estimateMinutes')
  })

  it('saves an explicit zero-minute reminder and rejects negative reminders', () => {
    const { domain, editor } = createEditor()
    editor.openAdd()
    editor.form.value.title = '整理资料'
    editor.form.value.reminderMinutes = '-1'
    editor.save()
    expect(domain.createTask).not.toHaveBeenCalled()
    expect(editor.errorField.value).toBe('reminderMinutes')
    editor.form.value.reminderMinutes = '0'
    editor.save()
    expect(domain.createTask.mock.calls[0][0].reminderMinutes).toBe(0)
  })

  it('rejects an impossible due date without storing a normalized overflow date', () => {
    const { domain, editor } = createEditor()
    editor.openAdd()
    editor.form.value.title = '整理资料'
    editor.form.value.dueDate = '2027-02-29'
    editor.save()
    expect(domain.createTask).not.toHaveBeenCalled()
    expect(editor.errorField.value).toBe('dueDate')
  })

  it('validates and saves a normalized new task through the domain interface', () => {
    const { domain, editor } = createEditor()
    editor.openAdd()
    editor.form.value.title = '  完成练习  '
    editor.form.value.courseId = 'course-1'
    editor.form.value.estimateMinutes = '35'
    editor.form.value.note = '  复习第二章  '

    editor.save()

    expect(domain.createTask).toHaveBeenCalledWith({
      title: '完成练习',
      course: '高等数学',
      courseId: 'course-1',
      dueDate: '',
      dueTime: '',
      priority: 'normal',
      note: '复习第二章',
      estimateMinutes: 35,
      repeat: 'none',
      repeatEndDate: '',
      createdFrom: 'manual',
    })
    expect(editor.showForm.value).toBe(false)
    expect(editor.error.value).toBe('')
  })

  it('keeps an invalid repeated task open and focuses its missing due-date field', async () => {
    const { domain, editor } = createEditor()
    const dueDateInput = { focus: vi.fn() }
    editor.dueDateInput.value = dueDateInput
    editor.openAdd()
    editor.form.value.title = '每周复习'
    editor.form.value.repeat = 'weekly'

    editor.save()
    await Promise.resolve()

    expect(domain.createTask).not.toHaveBeenCalled()
    expect(editor.showForm.value).toBe(true)
    expect(editor.error.value).toContain('需要设置截止日期')
    expect(dueDateInput.focus).toHaveBeenCalledOnce()
  })

  it('saves actual time and a structured continuation checkpoint on the existing task', () => {
    const task = { id: 'task-1', title: '整理访谈资料' }
    const domain = { createTask: vi.fn(), updateTask: vi.fn() }
    const editor = useTaskEditor({
      domain,
      tasks: ref([task]),
      courses: ref([]),
      events: ref([]),
    })
    editor.openEdit(task)
    editor.form.value.actualMinutes = '42'
    editor.form.value.checkpointLastStep = '完成录音转写'
    editor.form.value.checkpointBlocker = '缺少一份访谈同意书'
    editor.form.value.checkpointNextStep = '联系受访者补签'
    editor.form.value.checkpointResources = 'example.com/interview'

    editor.save()

    expect(domain.updateTask).toHaveBeenCalledOnce()
    expect(domain.updateTask.mock.calls[0][0]).toBe('task-1')
    expect(domain.updateTask.mock.calls[0][1]).toMatchObject({
      actualMinutes: 42,
      workCheckpoint: {
        lastStep: '完成录音转写',
        blocker: '缺少一份访谈同意书',
        nextStep: '联系受访者补签',
        resources: ['https://example.com/interview'],
      },
    })
  })

  it('rejects unsafe checkpoint links without saving the task', () => {
    const { domain, editor } = createEditor()
    editor.openAdd()
    editor.form.value.title = '完成报告'
    editor.form.value.checkpointResources = 'javascript:alert(1)'

    editor.save()

    expect(domain.createTask).not.toHaveBeenCalled()
    expect(editor.showForm.value).toBe(true)
    expect(editor.error.value).toContain('只支持公开的 HTTP 或 HTTPS')
  })
})
