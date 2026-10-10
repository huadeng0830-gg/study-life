import { describe, expect, it } from 'vitest'
import { validDate } from '../src/composables/zonedTime.js'
import { userFreeIntervals } from '../supabase/functions/campus-social/availability.js'

describe('共享日历日期校验', () => {
  it.each(['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-01'])('拒绝不存在的日期 %s', (value) => {
    expect(validDate(value)).toBe(false)
  })
  it.each(['2024-02-29', '2026-02-28', '2026-04-30', '0099-12-31'])('保留合法日期 %s', (value) => {
    expect(validDate(value)).toBe(true)
  })
  it('无效的课表覆盖日期不会给出已知空闲时间', () => {
    const result = userFreeIntervals({
      profile: {
        user_id: 'fictional-calendar-member',
        timezone: 'UTC',
        semester_end: '2026-12-31',
        schedule_complete_through: '2026-04-31',
        availability_preferences: { startTime: '09:00', endTime: '22:00', includeWeekends: true },
      },
      snapshot: { revision: 1, payload: { values: { sl_courses: [], sl_events: [], sl_exams: [] } } },
    }, { start: Date.UTC(2026, 3, 10), end: Date.UTC(2026, 3, 11) })
    expect(result).toMatchObject({ known: false, intervals: [] })
  })
})
