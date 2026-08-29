// 回顾叙事引擎（模块 B）：只读 sl_* 数据，生成“那天 / 月度 / 年度”的可渲染叙事，
// 绝不写入或修改任何历史数据。统计与 blocks 统一结构，供页面与长图生成复用。
import { coursesForDate } from './store/schedule.js'
import { fmtDate } from './store/utils.js'
import { monthMoodSummary } from './mood.js'

const number = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
const round2 = (value) => Math.round(value * 100) / 100

function collect(data) {
  return {
    courses: Array.isArray(data?.courses) ? data.courses : [],
    tasks: Array.isArray(data?.tasks) ? data.tasks : [],
    exams: Array.isArray(data?.exams) ? data.exams : [],
    bills: Array.isArray(data?.bills) ? data.bills : [],
    expenses: Array.isArray(data?.expenses) ? data.expenses : [],
    events: Array.isArray(data?.events) ? data.events : [],
    notes: Array.isArray(data?.notes) ? data.notes : [],
    moodLog: data?.moodLog ?? {},
  }
}

function examOnDate(item, dateStr) {
  if (!item?.date) return false
  if (item.repeat === 'yearly') return item.date.slice(5) === dateStr.slice(5)
  return item.date === dateStr
}

function spend(list) {
  return round2(list.filter((item) => item.direction !== 'income').reduce((sum, item) => sum + number(item.amount), 0))
}
function income(list) { return round2(list.filter((item) => item.direction === 'income').reduce((sum, item) => sum + number(item.amount), 0)) }

function courseLine(course) {
  return course?.room ? `${course.name} · ${course.room}` : course?.name || ''
}

function statBlock(items) {
  return { type: 'stat', items }
}

export function daySnapshot(dateStr, data) {
  const d = collect(data)
  const courses = coursesForDate(d.courses, dateStr)
  const tasks = d.tasks.filter((task) => task.dueDate === dateStr)
  const doneTasks = tasks.filter((task) => task.done)
  const exams = d.exams.filter((item) => examOnDate(item, dateStr))
  const bills = d.bills.filter((bill) => bill.nextDate === dateStr)
  const expenses = d.expenses.filter((expense) => expense.date === dateStr)
  const events = d.events.filter((item) => item.date === dateStr)
  const notes = d.notes.filter((item) => String(item.createdAt ?? '').slice(0, 10) === dateStr)
  const total = tasks.length
  return {
    courses,
    tasks,
    exams,
    bills,
    expenses,
    events,
    notes,
    stats: {
      courses: courses.length,
      tasks: total,
      tasksDone: doneTasks.length,
      taskRate: total ? Math.round((doneTasks.length / total) * 100) : 0,
      exams: exams.length,
      bills: bills.length,
      expensesCount: expenses.length,
      expensesTotal: spend(expenses),
      incomeTotal: income(expenses),
      events: events.length,
      notes: notes.length,
      focusMinutes: tasks.reduce((sum, task) => sum + number(task.estimateMinutes), 0),
    },
  }
}

export function dayStory(dateStr, data) {
  const snap = daySnapshot(dateStr, data)
  const s = snap.stats
  const blocks = []

  const active = s.courses + s.tasks + s.exams + s.bills + s.expensesCount + s.events + s.notes
  blocks.push({
    type: 'p',
    text: active
      ? `这一天，你上了 ${s.courses} 节课，处理了 ${s.tasks} 件待办（完成 ${s.tasksDone} 件），记下 ${s.expensesCount} 笔收支，还关注了 ${s.exams} 个重要节点。`
      : '这一天比较安静，没有留下太多记录；有时放空也是一种进度。',
  })

  blocks.push(statBlock([
    { label: '课程', value: String(s.courses) },
    { label: '待办完成', value: `${s.tasksDone}/${s.tasks}` },
    { label: '支出', value: s.expensesCount ? `¥${s.expensesTotal.toFixed(2)}` : '—' },
    { label: '专注', value: s.focusMinutes ? `${s.focusMinutes} 分钟` : '—' },
  ]))

  if (snap.courses.length) blocks.push({ type: 'list', title: '当天课程', items: snap.courses.map(courseLine) })
  if (snap.tasks.length) blocks.push({ type: 'list', title: '当天待办', items: snap.tasks.map((task) => `${task.title}${task.done ? '（已完成）' : ''}`) })
  if (snap.exams.length) blocks.push({ type: 'list', title: '重要节点', items: snap.exams.map((item) => item.name) })
  if (snap.bills.length) blocks.push({ type: 'list', title: '到期账单', items: snap.bills.map((bill) => `${bill.name} · ¥${number(bill.amount).toFixed(2)}`) })
  if (snap.expenses.length) blocks.push({ type: 'list', title: '当日消费', items: snap.expenses.map((expense) => `${expense.name} ¥${number(expense.amount).toFixed(2)}`) })
  if (snap.events.length) blocks.push({ type: 'list', title: '当日日程', items: snap.events.map((item) => `${item.title}${item.time ? ` · ${item.time}` : ''}`) })
  if (snap.notes.length) blocks.push({ type: 'list', title: '当天笔记', items: snap.notes.map((item) => item.title) })

  blocks.push({
    type: 'p',
    text: s.tasks
      ? s.taskRate === 100
        ? '待办全部完成，稳稳的一天。'
        : `待办完成率 ${s.taskRate}%${s.tasksDone < s.tasks ? '，未完的再接再厉。' : '。'}`
      : '没有任何待办到期，可以按自己的节奏来。',
  })

  return { title: `${fmtDate(dateStr)} · 那天`, blocks }
}

export function monthReport(month, data) {
  const d = collect(data)
  const prefix = String(month ?? '').slice(0, 7)
  const tasks = d.tasks.filter((task) => String(task.dueDate ?? '').startsWith(prefix))
  const doneTasks = tasks.filter((task) => task.done)
  const expenses = d.expenses.filter((expense) => String(expense.date ?? '').startsWith(prefix))
  const exams = d.exams.filter((item) => (
    item.repeat === 'yearly' ? String(item.date ?? '').slice(5) === prefix.slice(5) : String(item.date ?? '').startsWith(prefix)
  ))
  const bills = d.bills.filter((bill) => String(bill.nextDate ?? '').startsWith(prefix))
  const events = d.events.filter((item) => String(item.date ?? '').startsWith(prefix))
  const notes = d.notes.filter((item) => String(item.createdAt ?? '').startsWith(prefix))
  const mood = monthMoodSummary(prefix, d.moodLog)
  const total = tasks.length

  const stats = {
    tasks: total,
    tasksDone: doneTasks.length,
    taskRate: total ? Math.round((doneTasks.length / total) * 100) : 0,
    expensesCount: expenses.length,
    expensesTotal: spend(expenses),
    incomeTotal: income(expenses),
    exams: exams.length,
    bills: bills.length,
    focusMinutes: tasks.reduce((sum, task) => sum + number(task.estimateMinutes), 0),
    moodDays: mood.sunny + mood.cloudy + mood.rain,
    moodDominant: mood.dominant,
    events: events.length,
    notes: notes.length,
  }

  const blocks = []
  blocks.push({
    type: 'p',
    text: stats.tasks || stats.expensesCount
      ? `${prefix} 里，你处理了 ${stats.tasks} 件待办，记下 ${stats.expensesCount} 笔收支，支出 ¥${stats.expensesTotal.toFixed(2)}${stats.incomeTotal ? `，收入 ¥${stats.incomeTotal.toFixed(2)}` : ''}。`
      : `${prefix} 还没有留下待办或消费记录，也许是一段轻松的日子。`,
  })

  blocks.push(statBlock([
    { label: '待办完成', value: `${stats.tasksDone}/${stats.tasks}` },
    { label: '支出', value: stats.expensesCount ? `¥${stats.expensesTotal.toFixed(2)}` : '—' },
    { label: '专注', value: stats.focusMinutes ? `${stats.focusMinutes} 分钟` : '—' },
    { label: '心情', value: stats.moodDays ? `${stats.moodDays} 天` : '未记录' },
  ]))

  if (mood.dominant) {
    blocks.push({ type: 'p', text: `这个月你记录的心情以「${mood.dominant === 'sunny' ? '晴朗' : mood.dominant === 'cloudy' ? '多云' : '低落'}」为主（晴 ${mood.sunny} / 多云 ${mood.cloudy} / 低落 ${mood.rain}）。` })
  }
  if (exams.length) blocks.push({ type: 'list', title: '月度重要节点', items: exams.slice(0, 12).map((item) => item.name) })
  if (stats.bills) blocks.push({ type: 'list', title: '月度账单', items: bills.slice(0, 12).map((bill) => `${bill.name} · ¥${number(bill.amount).toFixed(2)}`) })
  if (stats.events) blocks.push({ type: 'list', title: '本月日程', items: events.slice(0, 12).map((item) => item.title) })
  if (stats.notes) blocks.push({ type: 'list', title: '本月笔记', items: notes.slice(0, 12).map((item) => item.title) })

  return { title: `${prefix.slice(0, 4)}年${Number(prefix.slice(5, 7))}月 · 月度回顾`, blocks }
}

export function yearReport(year, data) {
  const d = collect(data)
  const prefix = String(year ?? '').slice(0, 4)
  const tasks = d.tasks.filter((task) => String(task.dueDate ?? '').startsWith(prefix))
  const doneTasks = tasks.filter((task) => task.done)
  const expenses = d.expenses.filter((expense) => String(expense.date ?? '').startsWith(prefix))
  const exams = d.exams.filter((item) => (
    item.repeat === 'yearly' ? Boolean(item.date) : String(item.date ?? '').startsWith(prefix)
  ))
  const bills = d.bills.filter((bill) => String(bill.nextDate ?? '').startsWith(prefix))
  const events = d.events.filter((item) => String(item.date ?? '').startsWith(prefix))
  const notes = d.notes.filter((item) => String(item.createdAt ?? '').startsWith(prefix))
  const total = tasks.length

  const stats = {
    tasks: total,
    tasksDone: doneTasks.length,
    taskRate: total ? Math.round((doneTasks.length / total) * 100) : 0,
    expensesCount: expenses.length,
    expensesTotal: spend(expenses),
    incomeTotal: income(expenses),
    exams: exams.length,
    bills: bills.length,
    focusMinutes: tasks.reduce((sum, task) => sum + number(task.estimateMinutes), 0),
    activeDays: new Set([
      ...tasks.map((task) => task.dueDate),
      ...expenses.map((expense) => expense.date),
      ...events.map((item) => item.date),
      ...notes.map((item) => String(item.createdAt ?? '').slice(0, 10)),
    ].filter(Boolean)).size,
  }

  const blocks = []
  blocks.push({
    type: 'p',
    text: `${prefix} 全年，你累计处理了 ${stats.tasks} 件待办、记下 ${stats.expensesCount} 笔收支，共支出 ¥${stats.expensesTotal.toFixed(2)}${stats.incomeTotal ? `，收入 ¥${stats.incomeTotal.toFixed(2)}` : ''}。`,
  })

  blocks.push(statBlock([
    { label: '待办完成', value: `${stats.tasksDone}/${stats.tasks}` },
    { label: '全年支出', value: stats.expensesCount ? `¥${stats.expensesTotal.toFixed(2)}` : '—' },
    { label: '专注', value: stats.focusMinutes ? `${stats.focusMinutes} 分钟` : '—' },
    { label: '活跃天数', value: `${stats.activeDays} 天` },
  ]))

  if (stats.taskRate) blocks.push({ type: 'p', text: `待办完成率 ${stats.taskRate}%，坚持记录本身就是一种了不起。` })
  if (stats.exams) blocks.push({ type: 'list', title: '年度重要节点', items: exams.slice(0, 12).map((item) => item.name) })
  if (events.length) blocks.push({ type: 'list', title: '年度日程', items: events.slice(0, 12).map((item) => item.title) })
  if (notes.length) blocks.push({ type: 'list', title: '年度笔记', items: notes.slice(0, 12).map((item) => item.title) })

  blocks.push({
    type: 'p',
    text: stats.tasks || stats.expensesCount
      ? '每一笔记录都是你这一年的脚步。新的一年，继续把日子过清楚。'
      : '这一年尚未留下太多记录，也许真正的故事才刚刚开始。',
  })

  return { title: `${prefix} · 年度回顾`, blocks }
}
