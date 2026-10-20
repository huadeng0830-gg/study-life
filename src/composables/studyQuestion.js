import { rankCandidates } from './searchRelevance.js'
import { selectTaskView } from './domain/selectors.js'
import { taskStatus } from './domain/state.js'
import { parseQuickRecord } from './quickRecord/parser.js'
import { classifyText, DEFAULT_CATEGORIES } from './ledgerCategories.js'
import { coursesForDate } from './store/schedule.js'
import { normalizeFocusSession } from './focusTimer.js'
import { convertToBaseMinor } from './ledgerFx.js'
import { policyDateKey } from './settingsPolicy.js'
import { clock } from './store/core.js'
import { moneyCentsWithCode } from '../utils/formatters.js'

const DAY_MS = 86400000
const EXAMPLES = Object.freeze(['下周一之前要交什么', '这个月吃饭花了多少', '明天有什么课'])

function dateAfter(dateKey, days) {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function relativeDate(question, now) {
  const phrase = String(question).match(/大后天|后天|明天|今天|下周[一二三四五六日天]|本周[一二三四五六日天]|这周[一二三四五六日天]/)?.[0]
  if (!phrase) return ''
  const parsed = parseQuickRecord(`${phrase}提交作业`, { now })[0]?.date
  if (parsed) return parsed
  const today = policyDateKey(now)
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  if (phrase === '今天') return today
  if (phrase === '明天') return dateAfter(today, 1)
  if (phrase === '后天') return dateAfter(today, 2)
  if (phrase === '大后天') return dateAfter(today, 3)
  const dayIndex = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }[phrase.slice(-1)]
  const thisWeek = /^(本|这)周/.test(phrase)
  const offset = thisWeek ? (dayIndex - weekday + 7) % 7 : 7 - weekday + dayIndex
  return dateAfter(today, offset)
}

function amountCents(item, fx) {
  const converted = convertToBaseMinor(item?.amount, item?.currency, fx)
  return converted.reason ? null : converted.cents
}

function centsForAvailableAmount(item, fx) {
  const cents = amountCents(item, fx)
  if (cents === null) throw new Error('金额或汇率在汇总时发生变化。')
  return cents
}

function formatMoney(cents, fx) {
  // 基准币种（默认 CNY）用 ¥，其他币种按既有约定用代码前缀；数值口径统一走 formatters。
  return moneyCentsWithCode(cents, fx?.base)
}

function categoryName(key, categories) {
  return categories.find((item) => item.key === key)?.name || String(key || '未分类')
}

function activeTasks(snapshot, now) {
  return selectTaskView(snapshot.tasks || [], { now, filter: 'all', showHistory: false }).visible
    .filter((task) => !['completed', 'cancelled', 'archived'].includes(taskStatus(task, now)))
}

function taskRow(task) {
  return { id: task.id, title: task.title || '未命名待办', date: task.dueDate || '未安排截止时间', kind: task.kind === 'homework' ? '作业' : '待办' }
}

function result(intent, label, answer, rows, partition, criteria) {
  return {
    understood: true,
    intent,
    label,
    answer,
    rows,
    trace: { partition, hitCount: rows.length, criteria },
  }
}

function noHits(intent, label, partition, criteria) {
  return result(intent, label, '没有找到符合条件的记录。', [], partition, criteria)
}

function dueTasks(question, snapshot, now) {
  const until = relativeDate(question, now)
  if (!until) return null
  const today = policyDateKey(now)
  const rows = activeTasks(snapshot, now)
    .filter((task) => task.dueDate && task.dueDate <= until)
    .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')))
  if (!rows.length) return noHits('due-tasks', '截止日前的待办/作业', 'sl_tasks', `未完成，截止日期不晚于 ${until}`)
  const overdue = rows.filter((task) => String(task.dueDate || '') < today)
  const upcoming = rows.filter((task) => String(task.dueDate || '') >= today)
  return result('due-tasks', '截止日前的待办/作业', `找到 ${rows.length} 条，其中逾期 ${overdue.length} 条。`, [
    ...overdue.map((task) => ({ ...taskRow(task), group: '逾期' })),
    ...upcoming.map((task) => ({ ...taskRow(task), group: '未截止' })),
  ], 'sl_tasks', `未完成，截止日期不晚于 ${until}`)
}

function monthSpend(question, snapshot, now) {
  if (!/本月|这个月|当月/.test(question) || !/花|支出|消费/.test(question)) return null
  const thisMonth = policyDateKey(now).slice(0, 7)
  const previousMonthDate = dateAfter(`${thisMonth}-01`, -1)
  const previousMonth = previousMonthDate.slice(0, 7)
  const categoryText = question.replace(/本月|这个月|当月|花了多少(?:钱)?|花多少(?:钱)?|消费了多少(?:钱)?|消费多少(?:钱)?|支出多少(?:钱)?|支出|花|消费/g, '').trim()
  const categoryHint = /吃饭|饭钱|餐饮/.test(categoryText) ? '午饭' : categoryText
  const categoryId = categoryHint ? classifyText(categoryHint, { direction: 'expense', overrides: [] }).categoryId : ''
  const categories = snapshot.ledgerCategories || DEFAULT_CATEGORIES
  const matchesMonth = (item, month) => String(item?.date || '').slice(0, 7) === month
  const categoryMatches = (item) => !categoryId || String(item?.cat || item?.category || '') === categoryId
  const fx = snapshot.ledgerFx || { base: 'CNY', rates: {} }
  const valid = (item) => amountCents(item, fx) !== null
  const current = (snapshot.transactions || []).filter((item) => matchesMonth(item, thisMonth) && categoryMatches(item) && item.direction !== 'income' && valid(item))
  const previous = (snapshot.transactions || []).filter((item) => matchesMonth(item, previousMonth) && categoryMatches(item) && item.direction !== 'income' && valid(item))
  const rawCurrentCount = (snapshot.transactions || []).filter((item) => matchesMonth(item, thisMonth) && categoryMatches(item) && item.direction !== 'income').length
  if (!current.length) {
    const unavailable = (snapshot.transactions || []).filter((item) => matchesMonth(item, thisMonth) && categoryMatches(item) && item.direction !== 'income').length
    if (unavailable) return result('month-spend', '本月支出', `找到 ${unavailable} 笔相关记录，但金额或汇率不可用，无法安全汇总。`, [], 'sl_expenses', `${thisMonth}，${categoryId ? `分类 ${categoryName(categoryId, categories)}` : '全部分类'}；无法计入 ${unavailable} 笔`)
    return noHits('month-spend', '本月支出', 'sl_expenses', `${thisMonth}，${categoryId ? `分类 ${categoryName(categoryId, categories)}` : '全部分类'}`)
  }
  const total = current.reduce((sum, item) => sum + centsForAvailableAmount(item, fx) * (item.direction === 'refund' ? -1 : 1), 0)
  const previousTotal = previous.reduce((sum, item) => sum + centsForAvailableAmount(item, fx) * (item.direction === 'refund' ? -1 : 1), 0)
  const largest = current.filter((item) => item.direction !== 'refund')
    .reduce((best, item) => !best || centsForAvailableAmount(item, fx) > centsForAvailableAmount(best, fx) ? item : best, null)
  const name = categoryId ? `${categoryName(categoryId, categories)}：` : ''
  const compare = previous.length ? `，比上月 ${formatMoney(total - previousTotal, fx)}（上月 ${formatMoney(previousTotal, fx)}）` : '，上月没有符合条件的记录可比较'
  const largestText = largest ? `${largest.name || '未命名'} ${formatMoney(centsForAvailableAmount(largest, fx), fx)}` : '暂无支出单笔'
  const excludedText = rawCurrentCount > current.length ? `另有 ${rawCurrentCount - current.length} 笔因金额或汇率不可用未计入。` : ''
  return result('month-spend', '本月支出', `${name}${formatMoney(total, fx)}${compare}；最大单笔 ${largestText}。${excludedText}`,
    current.map((item) => ({ id: item.id, title: item.name || '未命名支出', date: item.date, amount: formatMoney(centsForAvailableAmount(item, fx), fx), category: categoryName(item.cat || item.category, categories) })),
    'sl_expenses', `${thisMonth}，${categoryId ? `分类 ${categoryName(categoryId, categories)}` : '全部分类'}`)
}

function todaySpend(question, snapshot, now) {
  if (!/今天|今日/.test(question) || !/花|支出|消费/.test(question)) return null
  const today = policyDateKey(now)
  const fx = snapshot.ledgerFx || { base: 'CNY', rates: {} }
  const items = (snapshot.transactions || []).filter((item) => item.date === today && item.direction !== 'income' && amountCents(item, fx) !== null)
  const rawTodayCount = (snapshot.transactions || []).filter((item) => item.date === today && item.direction !== 'income').length
  if (!items.length) {
    const unavailable = (snapshot.transactions || []).filter((item) => item.date === today && item.direction !== 'income').length
    if (unavailable) return result('today-spend', '今日支出', `找到 ${unavailable} 笔记录，但金额或汇率不可用，无法安全汇总。`, [], 'sl_expenses', `日期 ${today}；无法计入 ${unavailable} 笔`)
    return noHits('today-spend', '今日支出', 'sl_expenses', `日期 ${today}`)
  }
  const total = items.reduce((sum, item) => sum + centsForAvailableAmount(item, fx) * (item.direction === 'refund' ? -1 : 1), 0)
  const groups = new Map()
  for (const item of items) {
    const key = item.cat || item.category || 'other'
    groups.set(key, (groups.get(key) || 0) + centsForAvailableAmount(item, fx) * (item.direction === 'refund' ? -1 : 1))
  }
  const categories = snapshot.ledgerCategories || DEFAULT_CATEGORIES
  const top = [...groups].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([key, cents]) => `${categoryName(key, categories)} ${formatMoney(cents, fx)}`).join('、')
  const excludedText = rawTodayCount > items.length ? `另有 ${rawTodayCount - items.length} 笔因金额或汇率不可用未计入。` : ''
  return result('today-spend', '今日支出', `今天共 ${formatMoney(total, fx)}，${items.length} 笔；分类前三：${top}。${excludedText}`,
    items.map((item) => ({ id: item.id, title: item.name || '未命名支出', date: item.date, amount: formatMoney(centsForAvailableAmount(item, fx), fx), category: categoryName(item.cat || item.category, categories) })),
    'sl_expenses', `日期 ${today}，排除收入`)
}

function tomorrowClasses(question, snapshot, now) {
  if (!/课|课程/.test(question) || !/明天|今天|下周|本周|这周/.test(question)) return null
  const date = relativeDate(question, now)
  if (!date) return null
  const courses = coursesForDate(snapshot.courses || [], date, snapshot.scheduleExceptions || [])
    .sort((a, b) => String(a.start).localeCompare(String(b.start), undefined, { numeric: true }))
  if (!courses.length) return noHits('classes', '当天课程', 'sl_courses', `日期 ${date}，应用调课与停课例外`)
  const rows = courses.map((course) => ({ id: course.id, title: course.name || '未命名课程', date, detail: `${course.start}–${course.end}${course.room ? ` · ${course.room}` : ''}` }))
  return result('classes', '当天课程', `${date} 有 ${courses.length} 节课。`, rows, 'sl_courses + sl_schedule_exceptions', `日期 ${date}，应用调课与停课例外`)
}

function courseTasks(question, snapshot, now) {
  if (!/没做|未做|没完成|还有哪些|哪些.*(?:待办|作业)/.test(question)) return null
  const courses = snapshot.courses || []
  let matches = courses.filter((course) => course?.name && question.includes(course.name))
  if (!matches.length) {
    const term = question.replace(/还有哪些|还有什么|哪些|没做|未做|没完成|未完成|待办|作业|任务|高数还有/g, '').trim()
    matches = rankCandidates(courses.map((course) => ({ ...course, title: course.name, contents: [course.teacher] })), term).map((course) => course)
  }
  if (!matches.length) return noHits('course-tasks', '课程待办', 'sl_tasks', `课程名称模糊匹配「${question}」`)
  const course = matches[0]
  const tasks = activeTasks(snapshot, now).filter((task) => task.courseId === course.id || String(task.course || '').includes(course.name) || String(task.title || '').includes(course.name))
  if (!tasks.length) return noHits('course-tasks', '课程待办', 'sl_tasks', `课程 ${course.name}，未完成`)
  const rows = tasks.map(taskRow)
  return result('course-tasks', '课程待办', `${course.name}还有 ${rows.length} 项未完成。`, rows, 'sl_tasks', `课程 ${course.name}，未完成`)
}

function recentFocus(question, snapshot, now) {
  if (!/专注/.test(question) || !/最近|多少|小时/.test(question)) return null
  const cutoff = now.getTime() - 7 * DAY_MS
  const sessions = (snapshot.focusSessions || []).map((item, index) => normalizeFocusSession(item, index))
    .filter((item) => item && Number.isFinite(Date.parse(item.startedAt)) && Date.parse(item.startedAt) >= cutoff && Date.parse(item.startedAt) <= now.getTime())
  if (!sessions.length) return noHits('recent-focus', '最近 7 天专注', 'sl_focus_sessions', '开始时间在最近 7 天')
  const seconds = sessions.reduce((sum, item) => sum + Math.max(0, Number(item.actualFocusSeconds) || 0), 0)
  const hours = (seconds / 3600).toFixed(1)
  return result('recent-focus', '最近 7 天专注', `最近 7 天专注 ${hours} 小时，共 ${sessions.length} 次，日均 ${(Number(hours) / 7).toFixed(1)} 小时。`,
    sessions.map((item) => ({ id: item.id, title: item.title || '自由專注', date: item.startedAt.slice(0, 10), detail: `${Math.round(item.actualFocusSeconds / 60)} 分钟` })),
    'sl_focus_sessions', '开始时间在最近 7 天，按实际专注秒数汇总')
}

/** 只从传入快照生成答案；不读取或修改任何分区。 */
export function buildStudyAnswer(question, snapshot = {}, now = clock.value) {
  const text = String(question || '').trim()
  if (!text) return { understood: false, intent: '', label: '', answer: '写一句问题，我会只查找已有记录。', rows: [], trace: null, examples: EXAMPLES }
  const plans = [
    () => /要交|截止|之前/.test(text) ? dueTasks(text, snapshot, now) : null,
    () => monthSpend(text, snapshot, now),
    () => todaySpend(text, snapshot, now),
    () => tomorrowClasses(text, snapshot, now),
    () => courseTasks(text, snapshot, now),
    () => recentFocus(text, snapshot, now),
  ]
  for (const plan of plans) {
    const answer = plan()
    if (answer) return answer
  }
  return { understood: false, intent: '', label: '暂时没听懂', answer: '我没听懂这个问题。可以试试下面的问法。', rows: [], trace: null, examples: EXAMPLES }
}

export function appendQuestionHistory(history, item) {
  return [{ ...item }, ...(Array.isArray(history) ? history : [])].slice(0, 20)
}
