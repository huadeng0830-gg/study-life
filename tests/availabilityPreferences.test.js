import { describe, expect, it } from 'vitest'
import { normalizeAvailabilityPreferences } from '../src/composables/availabilityPreferences.js'
import { userFreeIntervals } from '../supabase/functions/campus-social/availability.js'

const range = { start: Date.parse('2026-10-12T00:00:00+08:00'), end: Date.parse('2026-10-19T00:00:00+08:00') }
function member(preferences = {}, values = {}) {
  return { profile: { timezone: 'Asia/Shanghai', availability_preferences: { classBufferMinutes: 0, ...preferences } },
    snapshot: { revision: 1, payload: { values: { sl_courses: [], sl_events: [], sl_exams: [], ...values } } } }
}

describe('optional invitation preferences', () => {
  it('treats unscheduled time as available without coverage or semester end dates', () => {
    const free = userFreeIntervals(member(), range)
    expect(free.known).toBe(true)
    expect(free.intervals).toHaveLength(7)
  })
  it('subtracts actual schedule events while leaving other time bookable', () => {
    const free = userFreeIntervals(member({}, { sl_events: [{ date: '2026-10-12', time: '12:00', endTime: '13:00' }] }), range)
    const at = Date.parse('2026-10-12T12:30:00+08:00')
    expect(free.known).toBe(true)
    expect(free.intervals.some((slot) => slot.start <= at && slot.end > at)).toBe(false)
    expect(free.intervals).toHaveLength(8)
  })
  it('restricts invitations to selected weekdays in the member timezone', () => {
    const free = userFreeIntervals(member({ weekdays: [0, 4] }), range)
    expect(free.known).toBe(true)
    expect(free.intervals).toHaveLength(2)
    expect(free.intervals.map((slot) => new Date(slot.start + 8 * 3600000).getUTCDay())).toEqual([1, 5])
  })
  it('keeps legacy weekday-only preferences and supports explicitly pausing invitations', () => {
    expect(userFreeIntervals(member({ includeWeekends: false }), range).intervals).toHaveLength(5)
    expect(userFreeIntervals(member({ weekdays: [] }), range)).toMatchObject({ known: true, intervals: [] })
  })
  it('ignores obsolete coverage dates even when they are expired', () => {
    const value = member()
    value.profile.schedule_complete_through = '2020-01-01'
    value.profile.semester_end = '2020-01-01'
    expect(userFreeIntervals(value, range).known).toBe(true)
  })
  it('does not treat a missing snapshot as a verified empty timetable', () => {
    expect(userFreeIntervals({ profile: member().profile, snapshot: null }, range).known).toBe(false)
  })
  it('rejects malformed weekday restrictions instead of silently widening them', () => {
    for (const weekdays of [[-1], [7], [1.5], ['1'], 'weekdays', null]) expect(normalizeAvailabilityPreferences({ weekdays })).toBeNull()
    expect(normalizeAvailabilityPreferences({ weekdays: [4, 0, 4] }).weekdays).toEqual([0, 4])
  })
})
