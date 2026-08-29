import { describe, expect, it } from 'vitest'
import { categoryFromTitle, classifyTask, classifyTasks, resolvePriority } from '../src/composables/smartClassify.js'

const courses = [
  { id: 'c1', name: '高等数学' },
  { id: 'c2', name: '大学英语' },
]

describe('smartClassify.js', () => {
  it('标题匹配唯一课程名时补 courseId 与课程名', () => {
    const out = classifyTask({ title: '完成高等数学第三章作业' }, courses)
    expect(out.courseId).toBe('c1')
    expect(out.course).toBe('高等数学')
  })

  it('标题关键词在无课程时补分类', () => {
    const out = classifyTask({ title: '去跑步三公里' }, courses)
    expect(out.course).toBe('健康')
  })

  it('紧急/今天字样提升为 high', () => {
    expect(resolvePriority({ title: '紧急处理报名', priority: 'normal' })).toBe('high')
    expect(resolvePriority({ title: '今天交材料' })).toBe('high')
  })

  it('3 天内到期提升为 high，且不降级已有 high', () => {
    const now = new Date('2026-08-28T00:00:00')
    expect(resolvePriority({ title: '写作业', dueDate: '2026-08-30' }, now)).toBe('high')
    expect(resolvePriority({ title: '写作业', priority: 'high', dueDate: '2026-09-20' }, now)).toBe('high')
    expect(resolvePriority({ title: '写作业', dueDate: '2026-09-20' }, now)).toBe('normal')
  })

  it('批量整理只改字段、不删数据，并计数变化', () => {
    const tasks = [
      { id: 't1', title: '复习大学英语', done: false, priority: 'normal' },
      { id: 't2', title: '写点东西', done: false, priority: 'normal', note: '保留' },
    ]
    const { list, changed } = classifyTasks(tasks, courses)
    expect(list[0].courseId).toBe('c2')
    expect(list[0].done).toBe(false)
    expect(list[1].note).toBe('保留')
    expect(list[1].course).toBeFalsy()
    expect(changed).toBe(1)
  })

  it('categoryFromTitle 返回空串表示未知分类', () => {
    expect(categoryFromTitle('')).toBe('')
    expect(categoryFromTitle('随便一句话')).toBe('')
  })
})