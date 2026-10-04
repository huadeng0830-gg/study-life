// iCalendar（RFC 5545）导出：把课程表、日程与重要日期导出成标准日历文件。
//
// 【定位要先说清】这是**导出快照文件**，不是"日历订阅"。订阅必须要一个 URL
// （webcal:// 或 https），没有服务端就没有订阅源。所以 README 与 UI 都不能写
// "日历订阅"，只能写"导出后可导入系统日历"。
//
// 【为什么全部用 UTC 而不是 TZID】带 TZID 的 DTSTART 必须同时生成完整 VTIMEZONE
// （含 RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU 这类规则），手写它是本模块最容易
// 出错的地方。一律转成 UTC（Z 结尾）就完全绕开 VTIMEZONE，而且对"整门课 18 周
// 不漂移"这个需求语义**更好**：UTC 锚定的 RRULE 在夏令时切换日不会平移一小时。
// 绝不用"浮动时间"（既不带 Z 也不带 TZID）——那会被接收方按它自己的时区解释，
// 用户换设备或换时区就错了。
//
// 【纯函数，无 Vue 依赖】所有生成逻辑都是纯字符串变换，便于 vitest 直接断言
// 字节级输出（折行、转义、UTC 标记）。
import { policyDateTime } from './settingsPolicy.js'
import { currentTimes, periodIndex } from './store/timeConfig.js'
import { scheduleExceptions, weekOf } from './store/schedule.js'

const PRODID = '-//study-life//学习生活台//ZH'
const CRLF = '\r\n'

// RFC 5545 §3.1：content line不得超过 75 octet，超出要折行。
// 中文是 UTF-8 多字节，所以必须**按字节**折，且不能折进多字节字符中间
// （折在中间会产生非法 UTF-8，整个文件在部分解析器里直接失败）。
function foldLine(line) {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(line)
  if (bytes.length <= 75) return line
  const chunks = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    // 回退到合法的 UTF-8 边界，避免把一个多字节字符切成两半
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1
    chunks.push(new TextDecoder().decode(bytes.slice(start, end)))
    start = end
    limit = 74 // 续行首字符是空格，占 1 octet
  }
  return chunks.join(CRLF + ' ')
}

/** RFC 5545 §3.3.11 TEXT 转义：反斜杠、分号、逗号、换行。 */
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/** 毫秒时间戳 -> UTC 的 iCalendar 日期时间（YYYYMMDDTHHMMSSZ）。 */
export function icsDateTime(ms) {
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

/** 毫秒时间戳 -> UTC 的全天日期（VALUE=DATE 事件用）。 */
export function icsDate(ms) {
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
}

// ISO-8601 星期几 -> iCalendar 的 BYDAY 代码。course.day 用 1..7 表示周一..周日。
const BYDAY = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

function vevent({ uid, stamp, summary, description, location, start, end, allDay, rrule, exdates, categories, alarm }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}@study-life`,
    `DTSTAMP:${icsDateTime(stamp)}`,
  ]
  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`)
    if (Number.isFinite(end)) lines.push(`DTEND;VALUE=DATE:${icsDate(end)}`)
  } else {
    lines.push(`DTSTART:${icsDateTime(start)}`)
    if (Number.isFinite(end)) lines.push(`DTEND:${icsDateTime(end)}`)
  }
  lines.push(`SUMMARY:${escapeText(summary)}`)
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`)
  if (location) lines.push(`LOCATION:${escapeText(location)}`)
  if (categories?.length) lines.push(`CATEGORIES:${categories.map(escapeText).join(',')}`)
  if (rrule) lines.push(`RRULE:${rrule}`)
  // EXDATE 对应调休 / 停课，必须是 UTC（与 DTSTART 保持同一形式）。
  if (exdates?.length) lines.push(`EXDATE:${exdates.map(icsDateTime).join(',')}`)
  // VALARM：让系统日历负责响铃。App 关闭后仍有效 —— 这正是 Web Notification
  // 做不到的那一段。
  if (Number(alarm) > 0 && !allDay) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:-PT${Math.round(alarm)}M`,
      `DESCRIPTION:${escapeText(summary)}`,
      'END:VALARM',
    )
  }
  lines.push('END:VEVENT')
  return lines
}

/**
 * 学期末日期（RRULE 的 UNTIL 上界）。学期只存了 start，用 MAX_WEEK 推一个上界。
 */
function semesterEndStamp(semesterStart, maxWeek = 20) {
  if (!semesterStart) return NaN
  const start = new Date(`${semesterStart}T00:00:00`)
  if (Number.isNaN(start.getTime())) return NaN
  start.setDate(start.getDate() + maxWeek * 7)
  return start.getTime()
}

/**
 * 课表 -> VEVENT 列表。
 *
 * 每门课是**一个** VEVENT + 一条 RRULE（而不是按周展开 18 个 VEVENT）：
 * 展开的产物在学期调整后无法整体更新，而 RRULE 在多数日历软件里可编辑。
 */
export function buildCourseEvents({ courses, semesterStart, timezone, maxWeek = 20 }) {
  const times = currentTimes()
  const until = semesterEndStamp(semesterStart, maxWeek)
  const untilText = Number.isFinite(until) ? icsDateTime(until) : ''
  const exceptions = scheduleExceptions.value || []
  const events = []

  for (const course of courses || []) {
    if (!course?.name) continue
    const day = Number(course.day)
    if (!day || day < 1 || day > 7) continue
    const startIndex = periodIndex(course.start)
    const endIndex = periodIndex(course.end)
    const startTime = times[startIndex]?.start
    const endTime = times[endIndex]?.end || times[endIndex]?.start
    if (!startTime || !endTime) continue

    // 用学期第一周的那一天算出墙钟时间，再交给 policyDateTime 按配置时区换算。
    const firstMonday = weekOneDate(semesterStart)
    if (!firstMonday) continue
    const date = addDays(firstMonday, day - 1)
    const start = policyDateTime(date, startTime, timezone)
    let end = policyDateTime(date, endTime, timezone)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      // 跨午夜的节次（end < start）按次日算
      end = policyDateTime(addDays(date, 1), endTime, timezone)
    }
    if (!Number.isFinite(start)) continue

    const exdates = exceptions
      .filter((item) => item && item.date && item.weekType !== undefined ? false : true)
      .filter((item) => item?.date && !item.makeup)
      .map((item) => policyDateTime(item.date, startTime, timezone))
      .filter((ms) => Number.isFinite(ms) && ms > start)

    const parts = [`FREQ=WEEKLY`, `BYDAY=${BYDAY[day]}`]
    if (untilText) parts.push(`UNTIL=${untilText}`)
    const weekType = course.weekType || 'all'
    if (weekType === 'odd' || weekType === 'even') {
      // 单双周没有干净的 RRULE 表达（INTERVAL=2 会跨双周而不是隔周），
      // 只能展开成两个 VEVENT，各带自己的起始周。
      const wanted = weekType === 'odd' ? 1 : 2
      const startWeek = Number(course.startWeek) || 1
      events.push(...expandAlternateWeeks({ course, day, date, startTime, endTime, timezone, wanted, startWeek, maxWeek, untilText, exceptions }))
      continue
    }
    events.push(vevent({
      uid: `course-${course.id}`,
      stamp: start,
      summary: course.name,
      description: [course.teacher, course.room].filter(Boolean).join(' · '),
      location: course.room || '',
      start,
      end,
      rrule: parts.join(';'),
      exdates,
      categories: ['课程'],
    }))
  }
  return events
}

// 单双周课程：按周次奇偶展开成多个 VEVENT，各自 UNTIL 落在学期内。
function expandAlternateWeeks({ course, day, date, startTime, endTime, timezone, wanted, startWeek, maxWeek, untilText, exceptions }) {
  const out = []
  let week = startWeek
  if (week % 2 !== wanted) week += 1
  let index = 0
  for (; week <= maxWeek; week += 2, index += 1) {
    const weekDate = addDays(date, (week - 1) * 7)
    const start = policyDateTime(weekDate, startTime, timezone)
    const end = policyDateTime(weekDate, endTime, timezone)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    const exdates = (exceptions || [])
      .filter((item) => item?.date && !item.makeup && weekOf(item.date) === week)
      .map((item) => policyDateTime(item.date, startTime, timezone))
      .filter((ms) => Number.isFinite(ms) && ms > start)
    out.push(vevent({
      uid: `course-${course.id}-w${index}`,
      stamp: start,
      summary: course.name,
      description: [course.teacher, course.room].filter(Boolean).join(' · '),
      location: course.room || '',
      start,
      end,
      // 只有一个 VEVENT 就不要 RRULE 了，直接写死日期更不容易被误解。
      exdates,
      categories: ['课程'],
    }))
  }
  return out
}

function weekOneDate(semesterStart) {
  if (!semesterStart) return ''
  const date = new Date(`${semesterStart}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return toDateKey(date)
}

function toDateKey(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

function addDays(dateKey, count) {
  const date = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  date.setDate(date.getDate() + count)
  return toDateKey(date)
}

/** 日程 -> VEVENT。有结束时间用 timed，没有则按全天。 */
export function buildEventEvents({ events, timezone }) {
  const out = []
  for (const item of events || []) {
    if (!item?.title || !item?.date) continue
    // 有时刻才走时区换算；没有时刻的走 dateOnlyMs。
    const start = item.time ? policyDateTime(item.date, item.time, timezone) : dateOnlyMs(item.date)
    if (!Number.isFinite(start)) continue
    const allDay = !item.time
    let end = item.endTime ? policyDateTime(item.date, item.endTime, timezone) : NaN
    if (!allDay && !Number.isFinite(end)) end = start + 3600_000
    // 全天事件同样不走时区换算（见 dateOnlyMs 的注释）。
    if (allDay) end = dateOnlyMs(addDays(item.date, 1))
    const minutes = Number(item.reminderMinutes) || 0
    out.push(vevent({
      uid: `event-${item.id}`,
      stamp: start,
      summary: item.title,
      description: item.note || '',
      location: item.location || '',
      start,
      end,
      allDay,
      categories: ['日程'],
      // reminderMinutes 此前是只写不读的死数据（reminderScheduler 落地前没有任何
      // 消费者）。既然读到了，就顺势导出 VALARM —— 这样导进系统日历后提醒由
      // 操作系统负责，而系统提醒在 App 关闭时也有效，正好补上 Web Notification
      // 「只在 App 打开时可靠」这个边界。
      alarm: minutes,
    }))
  }
  return out
}

/**
 * 纯日期 -> UTC 零点时间戳。
 *
 * 【为什么不走 policyDateTime】全天事件是 VALUE=DATE，语义上是"哪一天"，
 * 不涉及时刻与时区。若走 policyDateTime(..., '00:00', 'local')，东八区的
 * 午夜换算成 UTC 会退到前一天，导出后 1 月 15 日的考试会显示成 1 月 14 日。
 */
function dateOnlyMs(dateKey) {
  const [y, m, d] = String(dateKey || '').split('-').map(Number)
  if (!y || !m || !d) return NaN
  return Date.UTC(y, m - 1, d)
}

/** 重要日期 / 考试 -> 全天 VEVENT。 */
export function buildMilestoneEvents({ milestones }) {
  const out = []
  for (const item of milestones || []) {
    if (!item?.name || !item?.date) continue
    const start = dateOnlyMs(item.date)
    if (!Number.isFinite(start)) continue
    const end = dateOnlyMs(addDays(item.date, 1))
    out.push(vevent({
      uid: `milestone-${item.id}`,
      stamp: start,
      summary: item.name,
      description: item.note || '',
      location: item.location || '',
      start,
      end,
      allDay: true,
      categories: ['重要日期'],
    }))
  }
  return out
}

/**
 * 组装完整 .ics 文本。
 *
 * @param {{courses?: object[], events?: object[], milestones?: object[], semesterStart?: string, timezone?: string, variants?: Set<string>|string[]}} input
 *   variants 决定导出哪些：'schedule' 课表 / 'events' 日程 / 'milestones' 重要日期。
 *   让用户能分开导入到不同日历 —— 全部混在一个文件里，系统日历会被污染到没法看。
 */
export function buildVCalendar({ courses = [], events = [], milestones = [], semesterStart = '', timezone = 'local', variants, maxWeek = 20 } = {}) {
  const wanted = variants instanceof Set ? variants : new Set(variants || ['schedule', 'events', 'milestones'])
  const chunks = []
  // maxWeek 必须透传：单双周课程是按周次展开的，不传就会用默认值，
  // 于是"9 周里 5 个奇数周"会变成 20 周里的 10 个。
  if (wanted.has('schedule')) chunks.push(...buildCourseEvents({ courses, semesterStart, timezone, maxWeek }))
  if (wanted.has('events')) chunks.push(...buildEventEvents({ events, timezone }))
  if (wanted.has('milestones')) chunks.push(...buildMilestoneEvents({ milestones }))

  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    // METHOD:PUBLISH 让多数客户端把它当静态快照，而不是反复来问服务器要更新
    //（没有服务器，也就没有可问的地方）。
    'METHOD:PUBLISH',
  ]
  // vevent() 返回的是"行数组"，这里直接摊平即可（不要再对每块split，
  // 那是把数组当字符串用的写法）。
  const body = chunks.flat().filter(Boolean)
  const lines = [...header, ...body, 'END:VCALENDAR']
  return lines.map(foldLine).join(CRLF) + CRLF
}

/** 触发浏览器下载。 */
export function downloadIcs(text, filename) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}