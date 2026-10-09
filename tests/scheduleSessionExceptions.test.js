// @vitest-environment happy-dom
/**
 * 单节课停上 / 补课（课程表特殊安排的第四种粒度）。
 *
 * 【为什么需要这层】
 * 原来的 `scheduleExceptionForDate` 用 find，一天最多一条例外，而 `off` 是整天级
 * （`coursesForDateFromIndex` 里直接 `return []`）。于是「周三第 3-4 节停课，其余照上」
 * 这类最常见的调课**无法表达**——用户只能整天停课，把当天所有课一起砍掉。
 * 补课同理：只能「整天按周一课表显示」，不能「周六只补高等数」。
 *
 * 【本次补的能力】
 * 新增两个类型，都按**课程 id** 精确到节次，并允许同一天并存多条：
 *   session_off     当天停掉被点名的这几门课，其余课程照常
 *   session_makeup  当天补上被点名的这几门课（按它原本的星期取出），其余照常
 * 与原有的整天 off / makeup 并存，语义互不干扰。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  coursesForDate,
  isSessionException,
  removeScheduleException,
  scheduleExceptionForDate,
  scheduleExceptions,
  scheduleExceptionsForDate,
  sessionExceptionCourseIds,
  upsertScheduleException,
} from '../src/composables/store/schedule.js'

const MON = '2026-10-12'
const TUE = '2026-10-13'
const WED = '2026-10-14'

/** 高等数：周三第 1-2 节。英语：周三第 3-4 节。物理：周一第 3-4 节。 */
const COURSES = [
  { id: 'c-math', name: '高等数', day: 2, start: 'p1', end: 'p2', startWeek: 1, endWeek: 20, weekType: 'all' },
  { id: 'c-eng', name: '英语', day: 2, start: 'p3', end: 'p4', startWeek: 1, endWeek: 20, weekType: 'all' },
  { id: 'c-physics', name: '物理', day: 0, start: 'p3', end: 'p4', startWeek: 1, endWeek: 20, weekType: 'all' },
]

const idsOn = (date) => coursesForDate(COURSES, date).map((course) => course.id).sort()

beforeEach(() => {
  scheduleExceptions.value = []
})

describe('单节课停上', () => {
  it('只停掉被点名的那门课，当天其余课程照常显示', () => {
    expect(idsOn(WED)).toEqual(['c-eng', 'c-math'])

    upsertScheduleException({ date: WED, type: 'session_off', courseIds: ['c-math'], note: '教师出差' })

    // 英语仍在，只有高等数消失——这正是整天 off 表达不了的情况。
    expect(idsOn(WED)).toEqual(['c-eng'])
    expect(sessionExceptionCourseIds(WED).hidden.has('c-math')).toBe(true)
  })

  it('同一天可以并存多条单节课停课，不会互相顶掉', () => {
    upsertScheduleException({ date: WED, type: 'session_off', courseIds: ['c-math'] })
    upsertScheduleException({ date: WED, type: 'session_off', courseIds: ['c-eng'] })

    expect(idsOn(WED)).toEqual([])
    expect(scheduleExceptions.value).toHaveLength(2)
  })

  it('单节课停课不影响其他日期', () => {
    upsertScheduleException({ date: WED, type: 'session_off', courseIds: ['c-math'] })
    expect(idsOn(MON)).toEqual(['c-physics'])
    expect(idsOn(TUE)).toEqual([])
  })
})

describe('单节课补课', () => {
  it('在原本没有课的日期补进指定课程，并按它原来的星期取出', () => {
    // 周二本来没课（只有周三和周一有课）。
    expect(idsOn(TUE)).toEqual([])

    upsertScheduleException({ date: TUE, type: 'session_makeup', courseIds: ['c-math'], sourceDay: 2 })

    const added = coursesForDate(COURSES, TUE)
    expect(added.map((course) => course.id)).toEqual(['c-math'])
    // 补进来的课落在当天的显示列上，但记着自己原本的星期。
    expect(added[0]).toMatchObject({ displayDay: 1, sourceDay: 2, sessionMakeup: true })
  })

  it('当天已有同一门课时不重复补一次', () => {
    // 周三本来就有高等数。
    expect(idsOn(WED)).toEqual(['c-eng', 'c-math'])
    upsertScheduleException({ date: WED, type: 'session_makeup', courseIds: ['c-math'], sourceDay: 2 })
    expect(idsOn(WED)).toEqual(['c-eng', 'c-math'])
  })

  it('课程已删除时忽略悬空的 courseId，不报错', () => {
    upsertScheduleException({ date: TUE, type: 'session_makeup', courseIds: ['c-gone'], sourceDay: 2 })
    expect(idsOn(TUE)).toEqual([])
  })

  it('可以只补一节、其余课程当天照常', () => {
    // 周一本来有物理；补一门周三的英语进来。
    expect(idsOn(MON)).toEqual(['c-physics'])
    upsertScheduleException({ date: MON, type: 'session_makeup', courseIds: ['c-eng'], sourceDay: 2 })
    expect(idsOn(MON)).toEqual(['c-eng', 'c-physics'])
  })
})

describe('单节课例外与整天例外的边界', () => {
  it('整天停课仍然清空当天全部课程，单节课停课不会', () => {
    upsertScheduleException({ date: WED, type: 'session_off', courseIds: ['c-math'] })
    upsertScheduleException({ date: TUE, type: 'off' })

    expect(idsOn(WED)).toEqual(['c-eng'])
    expect(idsOn(TUE)).toEqual([])
  })

  it('单条例外视图只认整天例外，保持旧调用方的语义', () => {
    upsertScheduleException({ date: WED, type: 'session_off', courseIds: ['c-math'] })
    expect(scheduleExceptionForDate(WED)).toBeNull()

    upsertScheduleException({ date: TUE, type: 'makeup', sourceDay: 0 })
    expect(scheduleExceptionForDate(TUE)).toMatchObject({ type: 'makeup', sourceDay: 0 })
  })

  it('同一天的整天例外仍然覆盖更新，不会堆叠成多条', () => {
    upsertScheduleException({ date: WED, type: 'off', endDate: WED })
    upsertScheduleException({ date: WED, type: 'makeup', sourceDay: 3 })
    const dayLevel = scheduleExceptions.value.filter((item) => !isSessionException(item))
    expect(dayLevel).toHaveLength(1)
    expect(dayLevel[0].type).toBe('makeup')
  })

  it('当天例外列表按"整天优先"排序', () => {
    upsertScheduleException({ date: WED, type: 'session_off', courseIds: ['c-math'] })
    upsertScheduleException({ date: WED, type: 'off' })
    const list = scheduleExceptionsForDate(WED)
    expect(list.map((item) => item.type)).toEqual(['off', 'session_off'])
  })

  it('删除单节课例外后课程恢复显示', () => {
    const saved = upsertScheduleException({ date: WED, type: 'session_off', courseIds: ['c-math'] })
    expect(idsOn(WED)).toEqual(['c-eng'])
    removeScheduleException(saved.id)
    expect(idsOn(WED)).toEqual(['c-eng', 'c-math'])
  })

  it('脏 courseId 被清理，不会进存储', () => {
    const item = upsertScheduleException({ date: WED, type: 'session_off', courseIds: ['c-math', '', null, 'c-math', '  '] })
    expect(item.courseIds).toEqual(['c-math'])
  })

  it('整天例外不写 courseIds 字段', () => {
    expect(upsertScheduleException({ date: WED, type: 'off' }).courseIds).toBeNull()
    expect(upsertScheduleException({ date: WED, type: 'makeup', sourceDay: 1 }).courseIds).toBeNull()
  })
})