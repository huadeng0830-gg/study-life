// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { courseUsesPeriod, normalizeTimes } from '../src/composables/store/timeConfig.js'

describe('作息节次与课程联动', () => {
  const periods = [
    { id: 'early', label: '早自习' },
    { id: 'p1', label: '第一节课' },
    { id: 'p2', label: '第二节课' },
    { id: 'p3', label: '第三节课' },
  ]

  it('课程跨越的中间节次也视为正在使用', () => {
    const course = { start: 'p1', end: 'p3' }
    expect(courseUsesPeriod(course, 'p1', periods)).toBe(true)
    expect(courseUsesPeriod(course, 'p2', periods)).toBe(true)
    expect(courseUsesPeriod(course, 'p3', periods)).toBe(true)
    expect(courseUsesPeriod(course, 'early', periods)).toBe(false)
  })

  it('兼容起止节次倒置，并拒绝失效节次引用', () => {
    expect(courseUsesPeriod({ start: 'p3', end: 'p1' }, 'p2', periods)).toBe(true)
    expect(courseUsesPeriod({ start: 'missing', end: 'p2' }, 'p2', periods)).toBe(false)
  })

  it('新增节次后为每套作息补齐独立空时间', () => {
    const cfg = {
      campuses: [{ id: 'south' }],
      seasons: [{ id: 'summer' }],
      periods: periods.slice(0, 3),
      times: { summer: { south: [{ start: '8:00', end: '8:45' }] } },
    }
    expect(normalizeTimes(cfg)).toBe(true)
    expect(cfg.times.summer.south).toEqual([
      { start: '08:00', end: '08:45' },
      { start: '', end: '' },
      { start: '', end: '' },
    ])
  })
})
