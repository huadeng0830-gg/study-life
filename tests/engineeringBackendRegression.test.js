// @vitest-environment happy-dom
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { intervalIsAvailable, userFreeIntervals } from '../supabase/functions/campus-social/availability.js'
import updaterModule from '../desktop-app/updaterController.cjs'

const account = vi.hoisted(() => ({ value: null }))
const clientAdapter = vi.hoisted(() => ({ getSupabaseClient: vi.fn() }))
vi.mock('../src/composables/accountAuth.js', () => ({ accountUser: account }))
vi.mock('../src/composables/accountSyncState.js', () => ({ accountSyncStatus: { value: 'synced' }, syncAccountNow: vi.fn() }))
vi.mock('../src/composables/accountSyncMode.js', () => ({ accountSyncViaAccount: { value: true } }))
vi.mock('../src/services/supabase.js', () => clientAdapter)
import { socialRequest } from '../src/services/social.js'
import { validateProjectForm } from '../src/services/projects.js'

describe('project date validation uses real calendar dates', () => {
  it('rejects nonexistent project start and end dates', () => {
    expect(validateProjectForm({ name: 'Fictional project', startsOn: '2026-02-31' })).toMatchObject({ ok: false, field: 'startsOn' })
    expect(validateProjectForm({ name: 'Fictional project', targetEndOn: '2026-04-31' })).toMatchObject({ ok: false, field: 'targetEndOn' })
    expect(validateProjectForm({ name: 'Fictional project', startsOn: '2028-02-29' })).toMatchObject({ ok: true })
  })
})

describe('collaboration requests keep the identity that authorized the action', () => {
  let client
  beforeEach(() => {
    vi.clearAllMocks()
    account.value = { id: 'fictional-account-a', email_confirmed_at: '2026-10-01T00:00:00Z' }
    client = {
      auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: account.value.id }, access_token: 'fictional-session-a' } }, error: null })) },
      functions: { invoke: vi.fn(async () => ({ data: { data: { ok: true } }, error: null })) },
    }
    clientAdapter.getSupabaseClient.mockResolvedValue(client)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })

  it('binds the checked JWT while the SDK lazily sends a project mutation', async () => {
    let effectiveToken
    client.functions.invoke.mockImplementation(async (_name, options) => {
      account.value = { id: 'fictional-account-b', email_confirmed_at: '2026-10-01T00:00:00Z' }
      effectiveToken = options.headers?.Authorization || 'Bearer fictional-session-b'
      return { data: { data: { ok: true } }, error: null }
    })
    await expect(socialRequest('project_create', { name: 'Fictional project A' })).rejects.toMatchObject({ code: 'account_changed' })
    expect(effectiveToken).toBe('Bearer fictional-session-a')
  })

  it('never invokes a privileged action without an access token', async () => {
    client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: account.value.id } } }, error: null })
    await expect(socialRequest('friend_remove', { friendId: 'fictional-peer' })).rejects.toMatchObject({ code: 'unauthorized' })
    expect(client.functions.invoke).not.toHaveBeenCalled()
  })
})

function memberSchedule({ courses = [], exceptions = [], events = [], preferences = {}, times } = {}) {
  return {
    profile: {
      user_id: 'fictional-user', timezone: 'Asia/Shanghai', semester_end: '2026-12-31', schedule_complete_through: '2026-12-31',
      availability_preferences: { startTime: '00:00', endTime: '23:59', minimumMinutes: 30, classBufferMinutes: 0, includeWeekends: true, ...preferences },
    },
    snapshot: { revision: 1, payload: { values: {
      sl_courses: courses, sl_events: events, sl_exams: [], sl_schedule_exceptions: exceptions, sl_semester: { start: '2026-09-01' },
      sl_timecfg: { currentCampus: 'main', seasons: [{ id: 'autumn', startDate: '09-01' }], periods: [{ id: 'p1' }, { id: 'p2' }],
        times: { autumn: { main: times || [{ start: '09:00', end: '10:00' }, { start: '13:00', end: '14:00' }] } } },
    } } },
  }
}
const at = (date, clock) => Date.parse(`${date}T${clock}:00+08:00`)
const dayRange = (date) => ({ start: at(date, '00:00'), end: at(date, '23:59') })
const mondayCourse = { id: 'fictional-course', day: 0, startWeek: 1, endWeek: 25, weekType: 'all', start: 'p1', end: 'p1' }

describe('server availability follows the persisted schedule and overnight blocks', () => {
  it('removes only the selected cancelled class', () => {
    const schedule = memberSchedule({ courses: [mondayCourse], exceptions: [{ type: 'session_off', date: '2026-10-12', courseIds: [mondayCourse.id] }] })
    const result = userFreeIntervals(schedule, dayRange('2026-10-12'))
    expect(result.known).toBe(true)
    expect(intervalIsAvailable(result.intervals, at('2026-10-12', '09:00'), at('2026-10-12', '10:00'))).toBe(true)
  })

  it('blocks a selected makeup class at its chosen periods on a holiday', () => {
    const schedule = memberSchedule({ courses: [mondayCourse], exceptions: [
      { type: 'off', date: '2026-10-10' },
      { type: 'session_makeup', date: '2026-10-10', courseIds: [mondayCourse.id], courseSlots: [{ courseId: mondayCourse.id, start: 'p2', end: 'p2' }] },
    ] })
    const result = userFreeIntervals(schedule, dayRange('2026-10-10'))
    expect(result.known).toBe(true)
    expect(intervalIsAvailable(result.intervals, at('2026-10-10', '13:00'), at('2026-10-10', '14:00'))).toBe(false)
    expect(intervalIsAvailable(result.intervals, at('2026-10-10', '09:00'), at('2026-10-10', '10:00'))).toBe(true)
  })

  it('keeps the legacy makeup class periods and gives cancellation precedence', () => {
    const schedule = memberSchedule({ courses: [mondayCourse], exceptions: [{ type: 'session_makeup', date: '2026-10-10', courseIds: [mondayCourse.id] }] })
    expect(intervalIsAvailable(userFreeIntervals(schedule, dayRange('2026-10-10')).intervals, at('2026-10-10', '09:00'), at('2026-10-10', '10:00'))).toBe(false)
    schedule.snapshot.payload.values.sl_schedule_exceptions.push({ type: 'session_off', date: '2026-10-10', courseIds: [mondayCourse.id] })
    expect(intervalIsAvailable(userFreeIntervals(schedule, dayRange('2026-10-10')).intervals, at('2026-10-10', '09:00'), at('2026-10-10', '10:00'))).toBe(true)
  })

  it('returns unknown when a makeup time refers to a missing period', () => {
    const schedule = memberSchedule({ courses: [mondayCourse], exceptions: [{ type: 'session_makeup', date: '2026-10-10', courseIds: [mondayCourse.id], courseSlots: [{ courseId: mondayCourse.id, start: 'missing', end: 'missing' }] }] })
    expect(userFreeIntervals(schedule, dayRange('2026-10-10'))).toMatchObject({ known: false, intervals: [] })
  })

  it('does not drop an early class when its travel buffer begins the previous day', () => {
    const schedule = memberSchedule({ courses: [mondayCourse], preferences: { classBufferMinutes: 30 }, times: [{ start: '00:15', end: '01:00' }, { start: '13:00', end: '14:00' }] })
    const result = userFreeIntervals(schedule, dayRange('2026-10-12'))
    expect(result.known).toBe(true)
    expect(intervalIsAvailable(result.intervals, at('2026-10-12', '00:00'), at('2026-10-12', '00:30'))).toBe(false)
  })

  it('carries Sunday overnight events into Monday even when weekends cannot be booked', () => {
    const schedule = memberSchedule({ events: [{ id: 'fictional-event', date: '2026-10-11', time: '23:00', endTime: '01:00' }], preferences: { includeWeekends: false } })
    const result = userFreeIntervals(schedule, dayRange('2026-10-12'))
    expect(result.known).toBe(true)
    expect(intervalIsAvailable(result.intervals, at('2026-10-12', '00:00'), at('2026-10-12', '00:30'))).toBe(false)
  })

  it('reserves the previous evening for a next-day early class buffer', () => {
    const schedule = memberSchedule({ courses: [mondayCourse], preferences: { classBufferMinutes: 30 }, times: [{ start: '00:15', end: '01:00' }, { start: '13:00', end: '14:00' }] })
    const result = userFreeIntervals(schedule, dayRange('2026-10-11'))
    expect(result.known).toBe(true)
    expect(intervalIsAvailable(result.intervals, at('2026-10-11', '23:45'), at('2026-10-11', '23:59'))).toBe(false)
  })
})

describe('desktop update commands reserve their in-flight state', () => {
  it('coalesces simultaneous checks before the updater emits checking-for-update', async () => {
    const updater = new EventEmitter()
    let finish
    updater.checkForUpdates = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const controller = updaterModule.createUpdaterController({ autoUpdater: updater, currentVersion: '1.0.13' })
    const first = controller.check()
    const second = controller.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    updater.emit('update-not-available')
    finish()
    await Promise.all([first, second])
    controller.dispose()
  })

  it('keeps the reservation until the checking promise settles after an update event', async () => {
    const updater = new EventEmitter()
    let finish
    updater.checkForUpdates = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const controller = updaterModule.createUpdaterController({ autoUpdater: updater, currentVersion: '1.0.13' })
    const first = controller.check()
    updater.emit('update-available', { version: '1.0.14' })
    const second = controller.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    finish()
    await Promise.all([first, second])
    controller.dispose()
  })
})
