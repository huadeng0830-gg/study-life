import { describe, expect, it } from 'vitest'
import { activeWeeks, buildImportPlan, classifyImportItems } from '../src/composables/courseImport.js'

const options = { maxWeek: 16, periodIndex: (id) => Number(String(id).replace('p', '')) }
const course = (id, patch = {}) => ({ id, name: id, day: 0, start: 'p1', end: 'p2', startWeek: 1, endWeek: 16, weekType: 'all', ...patch })

describe('课程导入冲突判断', () => {
  it('准确处理周次、单双周和部分节次的交集', () => {
    expect(activeWeeks(course('a', { weekType: 'odd' }), 6)).toEqual([1, 3, 5])
    expect(classifyImportItems([course('b', { startWeek: 9 })], [course('a', { endWeek: 8 })], options)[0].type).toBe('direct')
    expect(classifyImportItems([course('b', { weekType: 'even' })], [course('a', { weekType: 'odd' })], options)[0].type).toBe('direct')
    const item = classifyImportItems([course('b', { start: 'p2', end: 'p3', startWeek: 8 })], [course('a', { endWeek: 10 })], options)[0]
    expect(item.type).toBe('conflict')
    expect(item.matches[0].detail).toMatchObject({ weeks: [8, 9, 10], periodStart: 2, periodEnd: 2 })
    expect(activeWeeks(course('custom', { customWeeks: [1, 4, 4, 7] }), 16)).toEqual([1, 4, 7])
  })

  it('一键替换仅移除完全被覆盖的冲突块', () => {
    const old = [course('A'), course('B', { day: 1 }), course('C', { day: 2 })]
    const items = classifyImportItems([course('X'), course('Y', { day: 2 }), course('Z', { day: 3 })], old, options)
    const plan = buildImportPlan({ existingCourses: old, items, decisions: { 0: 'replace', 1: 'replace', 2: 'add' }, options })
    expect(plan.courses.map((c) => c.id)).toEqual(['B', 'X', 'Y', 'Z'])
  })

  it('支持跳过、保留，以及整张课表替换', () => {
    const old = [course('A')]
    const items = classifyImportItems([course('X')], old, options)
    expect(buildImportPlan({ existingCourses: old, items, decisions: { 0: 'skip' }, options }).courses.map((c) => c.id)).toEqual(['A'])
    expect(buildImportPlan({ existingCourses: old, items, decisions: { 0: 'keep' }, options }).courses.map((c) => c.id)).toEqual(['A', 'X'])
    expect(buildImportPlan({ existingCourses: old, items, mode: 'replace-all', options }).courses.map((c) => c.id)).toEqual(['X'])
  })

  it('拒绝用整体删除处理局部冲突', () => {
    const old = [course('A')]
    const items = classifyImportItems([course('X', { startWeek: 9 })], old, options)
    const plan = buildImportPlan({ existingCourses: old, items, decisions: { 0: 'replace' }, options })
    expect(plan.unsafe).toHaveLength(1)
    expect(plan.courses.map((c) => c.id)).toEqual(['A'])
  })
})
