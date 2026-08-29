// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('待办课程关联迁移', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
  })

  it('为唯一课程名称的旧待办补充 courseId，并保留原名称', async () => {
    const { migrateTaskCourseLinks } = await import('../src/composables/store')
    const tasks = [{ id: 't1', title: '作业', course: '高等数学' }]
    const courses = [{ id: 'course-1', name: '高等数学' }]
    expect(migrateTaskCourseLinks(tasks, courses)).toBe(true)
    expect(tasks[0]).toMatchObject({ course: '高等数学', courseId: 'course-1' })
  })

  it('不猜测重名课程，也不覆盖已有关联', async () => {
    const { migrateTaskCourseLinks } = await import('../src/composables/store')
    const tasks = [
      { id: 't1', course: '英语' },
      { id: 't2', course: '英语', courseId: 'course-1' },
    ]
    const courses = [{ id: 'course-1', name: '英语' }, { id: 'course-2', name: '英语' }]
    expect(migrateTaskCourseLinks(tasks, courses)).toBe(false)
    expect(tasks[0].courseId).toBeUndefined()
    expect(tasks[1].courseId).toBe('course-1')
  })
})
