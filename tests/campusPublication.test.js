import { describe, expect, it } from 'vitest'
import { buildCampusPublication, campusPublicationDefaults } from '../src/composables/campusPublication.js'

describe('campus publication conversion', () => {
  it('converts currency exactly, supports negotiable prices and ignores a hidden price for giveaways', () => {
    expect(buildCampusPublication('market', { title: '虚构教材', price: 0.29 }).priceCents).toBe(29)
    expect(buildCampusPublication('market', { title: '虚构教材' }).priceCents).toBeNull()
    expect(buildCampusPublication('market', { title: '虚构教材', listingType: 'free', price: 'broken' }).priceCents).toBe(0)
    for (const price of [-1, '1.001', Infinity, 'no', 1000000.01]) expect(() => buildCampusPublication('market', { title: '虚构教材', price })).toThrow('价格')
  })
  it('rejects invalid activity time order and non-integer capacity before sending', () => {
    const event = { title: '虚构活动', startsAt: '2026-10-15T09:00', endsAt: '2026-10-15T10:00', capacity: '20' }
    expect(buildCampusPublication('event', event).capacity).toBe(20)
    expect(() => buildCampusPublication('event', { ...event, endsAt: event.startsAt })).toThrow('结束时间')
    expect(() => buildCampusPublication('event', { ...event, startsAt: 'invalid' })).toThrow('开始时间')
    expect(() => buildCampusPublication('event', { ...event, capacity: '1.5' })).toThrow('整数')
  })
  it('requires verifiable sources and rejects unsafe URL schemes and embedded credentials', () => {
    expect(() => buildCampusPublication('teacher', { name: '虚构教师' })).toThrow('公开来源')
    for (const sourceUrl of ['http://example.test', 'javascript:alert(1)', 'https://user:pass@example.test']) expect(() => buildCampusPublication('teacher', { name: '虚构教师', sourceUrl })).toThrow('HTTPS')
  })
  it('drops unsupported owner and school fields and keeps existing drafts intact', () => {
    const draft = { name: ' 虚构课程 ', school: '伪造范围', ownerId: 'fake', status: 'approved' }
    expect(buildCampusPublication('course', draft)).toEqual({ ...campusPublicationDefaults().course, name: '虚构课程' })
    expect(draft.name).toBe(' 虚构课程 ')
    expect(() => buildCampusPublication('toString', {})).toThrow('发布类型')
  })
  it('validates every shuttle row instead of silently losing extra columns', () => {
    const route = { name: '虚构线路', sourceUrl: 'https://example.test/timetable', stopsText: 'outbound|东门\ninbound|西门', departuresText: 'outbound|weekday|08:00|东门' }
    expect(buildCampusPublication('shuttle', route).departures).toEqual([{ direction: 'outbound', serviceDay: 'weekday', time: '08:00', stopName: '东门' }])
    expect(() => buildCampusPublication('shuttle', { ...route, stopsText: 'outbound|东门|多余列\ninbound|西门' })).toThrow('字段数量')
    expect(() => buildCampusPublication('shuttle', { ...route, departuresText: 'outbound|weekday|25:00' })).toThrow('发车时间')
    expect(() => buildCampusPublication('shuttle', { ...route, effectiveFrom: '2026-10-20', effectiveTo: '2026-10-10' })).toThrow('失效日期')
  })
})
