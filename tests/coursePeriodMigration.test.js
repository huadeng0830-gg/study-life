import { describe, expect, it } from 'vitest'
import { migrateCoursePeriodIds, migrateTemplatePeriodIds } from '../src/composables/coursePeriodMigration.js'

describe('课程节次 ID 迁移', () => {
  it('把历史数字节次转成稳定字符串 ID，并保留其它字段', () => {
    const course = { id: 'c1', name: '数学', start: 1, end: 2, day: 0 }
    const result = migrateCoursePeriodIds([course, { id: 'c2', start: 'p3', end: 'p4' }])
    expect(result.changed).toBe(true)
    expect(result.value).toEqual([
      { ...course, start: 'p1', end: 'p2' },
      { id: 'c2', start: 'p3', end: 'p4' },
    ])
  })

  it('迁移课表模板嵌套课程，且对新格式保持幂等', () => {
    const legacy = [{ id: 'template-1', courses: [{ id: 'c1', start: 1, end: 3 }] }]
    expect(migrateTemplatePeriodIds(legacy)).toMatchObject({
      changed: true,
      value: [{ id: 'template-1', courses: [{ id: 'c1', start: 'p1', end: 'p3' }] }],
    })
    expect(migrateTemplatePeriodIds([{ id: 'template-2', courses: [{ start: 'p1', end: 'p2' }] }]).changed).toBe(false)
  })
})
