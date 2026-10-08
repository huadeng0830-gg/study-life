import { describe, expect, it } from 'vitest'
import { intersectIntervals, userFreeIntervals } from '../supabase/functions/campus-social/availability.js'

function scheduleFor(userId, timezone) {
  return {
    profile: {
      user_id: userId,
      timezone,
      schedule_complete_through: '2026-10-12',
      semester_end: '2026-12-31',
      availability_preferences: { startTime: '09:00', endTime: '22:00', minimumMinutes: 60, classBufferMinutes: 0, includeWeekends: true },
    },
    snapshot: { revision: 1, payload: { values: { sl_courses: [], sl_events: [], sl_exams: [] } } },
  }
}

describe('齐行跨时区空闲时间计算', () => {
  it('按每位成员本地时区展开可约时间，再求 UTC 交集', () => {
    const range = { start: Date.UTC(2026, 9, 8), end: Date.UTC(2026, 9, 11) }
    const shanghai = userFreeIntervals(scheduleFor('user-sh', 'Asia/Shanghai'), range)
    const losAngeles = userFreeIntervals(scheduleFor('user-la', 'America/Los_Angeles'), range)

    expect(shanghai.known).toBe(true)
    expect(losAngeles.known).toBe(true)
    const overlap = intersectIntervals(shanghai.intervals, losAngeles.intervals)
    expect(overlap).toContainEqual({ start: Date.UTC(2026, 9, 9, 1), end: Date.UTC(2026, 9, 9, 5) })
    expect(shanghai.intervals).not.toEqual(losAngeles.intervals)
  })

  it('个人课表未覆盖查询范围时返回未知，供前端改用手动确认', () => {
    const member = scheduleFor('user-1', 'Asia/Shanghai')
    member.profile.schedule_complete_through = '2026-10-08'
    const result = userFreeIntervals(member, { start: Date.UTC(2026, 9, 8), end: Date.UTC(2026, 9, 11) })
    expect(result).toMatchObject({ known: false, intervals: [] })
  })
})
