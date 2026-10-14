// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildNoticeUnderstanding, parseNotice, parseScheduleProposal } from '../src/composables/noticeParser.js'
import {
  applyScheduleProposal,
  buildScheduleExceptionInputs,
  findScheduleProposalConflicts,
} from '../src/composables/scheduleNoticeOperations.js'
import {
  coursesForDate,
  removeScheduleException,
  saveScheduleException,
  scheduleExceptions,
  scheduleExceptionsForDate,
  semester,
} from '../src/composables/store/schedule.js'
import { defaultTimeConfig, timeConfig } from '../src/composables/store/timeConfig.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()

const NOW = new Date('2026-10-12T09:00:00')
const COURSES = [
  { id: 'demo-math', name: '高等数学', day: 2, start: 'p2', end: 'p3', startWeek: 1, endWeek: 16 },
  { id: 'demo-english', name: '大学英语', day: 4, start: 'p1', end: 'p2', startWeek: 1, endWeek: 16 },
  { id: 'demo-physics', name: '大学物理', day: 4, start: 'p4', end: 'p5', startWeek: 1, endWeek: 16 },
]
const previous = { semester: semester.value, exceptions: scheduleExceptions.value, timeConfig: timeConfig.value }

beforeEach(() => {
  semester.value = { start: '2026-10-12' }
  scheduleExceptions.value = []
  timeConfig.value = defaultTimeConfig()
})

afterEach(() => {
  semester.value = previous.semester
  scheduleExceptions.value = previous.exceptions
  timeConfig.value = previous.timeConfig
})

describe('通知中的课表变更候选', () => {
  it.each([
    ['高等数学本周三第3-4节调到本周五第5-6节', 'move', '2026-10-16', 5, 6, ''],
    ['大学英语这周三第 3 节停课一次', 'cancel', '2026-10-14', 3, 3, ''],
    ['高数本周三补课第3节', 'makeup', '2026-10-14', 3, 3, ''],
    ['高等数学周三第3-4节换教室到B204', 'move', '2026-10-14', 3, 4, 'B204'],
    ['大学英语下周五第7-8节改到 B204', 'move', '2026-10-23', 7, 8, 'B204'],
    ['大学物理本周三第3节串讲', 'move', '2026-10-14', 3, 3, ''],
    ['高等数学本周三第3节改为B204', 'move', '2026-10-14', 3, 3, 'B204'],
    ['大学英语本周三第3节本次不上课', 'cancel', '2026-10-14', 3, 3, ''],
    ['大学英语本周三第3节补课', 'makeup', '2026-10-14', 3, 3, ''],
  ])('识别「%s」', (text, kind, date, periodStart, periodEnd, location) => {
    const proposal = parseScheduleProposal(text, COURSES, NOW)
    expect(proposal).toMatchObject({ kind, date, periodStart, periodEnd, location })
    expect(proposal.raw).toBe(text)
    const jsDay = new Date(`${date}T00:00:00`).getDay()
    expect(proposal.weekDay).toBe(jsDay === 0 ? 6 : jsDay - 1)
  })

  it('只对唯一课程名自动预选；自然语言入口将其推荐为课表操作', () => {
    const parsed = parseNotice('高等数学本周三第3节调到B204', COURSES, NOW)
    expect(parsed.scheduleProposal.courseName).toBe('高等数学')
    expect(buildNoticeUnderstanding(parsed).recommendation.key).toBe('schedule')
    expect(parseScheduleProposal('本周三第3节调到B204', COURSES, NOW).courseName).toBe('')
  })

  it('识别英文星期与教室表达', () => {
    expect(parseScheduleProposal('The class is moved to B204 next Friday', COURSES, NOW)).toMatchObject({
      kind: 'move',
      date: '2026-10-23',
      location: 'B204',
    })
  })
})

describe('通知课表应用与撤销', () => {
  const proposal = {
    kind: 'move',
    sourceDate: '2026-10-14',
    date: '2026-10-16',
    weekDay: 4,
    periodStart: 5,
    periodEnd: 6,
    courseName: '高等数学',
    location: 'B204',
    raw: '高等数学周三第3节调到周五第5-6节，教室B204',
  }

  it('写入已有课表例外，按日期查询可见；撤销会移除整次调课', () => {
    const result = applyScheduleProposal(proposal, 'demo-math', { courses: COURSES })
    expect(result.ok).toBe(true)
    expect(result.saved).toHaveLength(2)
    expect(scheduleExceptionsForDate('2026-10-14').map((item) => item.type)).toContain('session_off')
    expect(coursesForDate(COURSES, '2026-10-14').some((course) => course.id === 'demo-math')).toBe(false)
    expect(coursesForDate(COURSES, '2026-10-16').find((course) => course.id === 'demo-math')).toMatchObject({ start: 'p4', end: 'p5', room: 'B204' })
    expect(result.undo()).toBe(true)
    expect(result.undo()).toBe(false)
    expect(scheduleExceptions.value).toEqual([])
    expect(coursesForDate(COURSES, '2026-10-14').find((course) => course.id === 'demo-math')).toMatchObject({ start: 'p2', end: 'p3' })
  })

  it('对重叠的日期和节次要求先选替换或并存，并且替换可撤销', () => {
    const prior = saveScheduleException({
      date: proposal.date,
      type: 'session_makeup',
      courseIds: ['demo-physics'],
      courseSlots: [{ courseId: 'demo-physics', start: 'p4', end: 'p5' }],
      note: '虚构的既有安排',
    })
    const inputs = buildScheduleExceptionInputs(proposal, 'demo-math', COURSES)
    expect(findScheduleProposalConflicts(inputs, scheduleExceptions.value)).toEqual([prior])
    expect(applyScheduleProposal(proposal, 'demo-math', { courses: COURSES }).ok).toBe(false)

    const result = applyScheduleProposal(proposal, 'demo-math', { courses: COURSES, conflictChoice: 'replace' })
    expect(result.ok).toBe(true)
    expect(scheduleExceptions.value.some((item) => item.id === prior.id)).toBe(false)
    result.undo()
    expect(scheduleExceptions.value).toContainEqual(prior)
  })

  it('只有教室的调整也会提示同一课程已有安排', () => {
    const prior = saveScheduleException({
      date: '2026-10-14',
      type: 'session_makeup',
      courseIds: ['demo-math'],
      courseSlots: [{ courseId: 'demo-math', start: 'p2', end: 'p3' }],
      note: '虚构的既有安排',
    })
    const roomChange = { kind: 'move', date: '2026-10-14', location: 'B204', raw: '高等数学换教室到B204' }
    expect(findScheduleProposalConflicts(buildScheduleExceptionInputs(roomChange, 'demo-math', COURSES), scheduleExceptions.value))
      .toContainEqual(prior)
  })

  it('替换假期范围中的单日安排时保留范围其余日期，撤销后恢复原范围', () => {
    const holiday = saveScheduleException({ date: '2026-10-14', endDate: '2026-10-18', type: 'off', note: '虚构的假期范围' })
    const singleDay = { ...proposal, sourceDate: '', date: '2026-10-16' }
    const result = applyScheduleProposal(singleDay, 'demo-math', { courses: COURSES, conflictChoice: 'replace' })
    expect(result.ok).toBe(true)
    expect(scheduleExceptionsForDate('2026-10-15').some((item) => item.type === 'off')).toBe(true)
    expect(scheduleExceptionsForDate('2026-10-16').some((item) => item.type === 'off')).toBe(false)
    expect(scheduleExceptionsForDate('2026-10-17').some((item) => item.type === 'off')).toBe(true)
    result.undo()
    expect(scheduleExceptions.value).toEqual([holiday])
  })

  it('换教室只覆盖当天显示，不修改课程原始地点', () => {
    const result = applyScheduleProposal({
      kind: 'move', date: '2026-10-14', periodStart: null, periodEnd: null, location: 'B204', raw: '高等数学换教室B204',
    }, 'demo-math', { courses: COURSES })
    expect(result.ok).toBe(true)
    expect(coursesForDate(COURSES, '2026-10-14').find((course) => course.id === 'demo-math')).toMatchObject({ room: 'B204', start: 'p2', end: 'p3' })
    expect(COURSES[0].room).toBeUndefined()
    result.undo()
    expect(coursesForDate(COURSES, '2026-10-14').find((course) => course.id === 'demo-math').room).toBeUndefined()
  })

  it('没有课程、日期或节次信息时不会改写存储', () => {
    const before = scheduleExceptions.value.slice()
    expect(applyScheduleProposal({ ...proposal, date: '' }, 'demo-math', { courses: COURSES }).ok).toBe(false)
    expect(scheduleExceptions.value).toEqual(before)
    removeScheduleException('missing')
  })
})
