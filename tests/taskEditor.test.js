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
})
