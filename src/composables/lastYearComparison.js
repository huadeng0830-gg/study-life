import { addAppDays } from './timeContext.js'
import { createdDateKey, timestampOf } from './settingsPolicy.js'
import { normalizeMoodLog } from './mood.js'
import { normalizeWeeklyReflections } from './weeklyReflections.js'
import { gregorianToLunar, lunarToGregorian } from './lunar.js'
import { mySpendCents } from './ledgerSplit.js'
import { isValidDateKey } from './ledger.js'

const DAY_WINDOW = 3
const LUNAR_FESTIVALS = Object.freeze([
  { month: 1, day: 1, label: '春节' },
  { month: 1, day: 15, label: '元宵节' },
  { month: 5, day: 5, label: '端午节' },
  { month: 8, day: 15, label: '中秋节' },
  { month: 9, day: 9, label: '重阳节' },
])

const dateKeyOf = ({ year, month, day }) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

function previousGregorianYear(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''))
  if (!match) return ''
  const year = Number(match[1]) - 1
  const month = Number(match[2])
  const day = Number(match[3])
  // 公历 2 月 29 日在前一年不存在时按 2 月 28 日对齐。
  const priorDay = month === 2 && day === 29 ? 28 : day
  return `${year}-${match[2]}-${String(priorDay).padStart(2, '0')}`
}

function lunarMarker(dateKey, lunarAnniversaries) {
  const lunar = gregorianToLunar(dateKey)
  if (!lunar) return null
  const festival = LUNAR_FESTIVALS.find((item) => item.month === lunar.month && item.day === lunar.day && !lunar.isLeapMonth)
  if (festival) return { ...lunar, label: festival.label }

  const anniversary = (Array.isArray(lunarAnniversaries) ? lunarAnniversaries : []).find((item) => (
    Number(item?.lunarMonth) === lunar.month
    && Number(item?.lunarDay) === lunar.day
    && (item?.isLeapMonth === true) === lunar.isLeapMonth
  ))
  return anniversary ? { ...lunar, label: String(anniversary.label || '农历纪念日').trim() || '农历纪念日' } : null
}

/**
 * 为窗口里的每一天找到去年同期日期。普通日期按公历年对齐；
 * 已配置的农历纪念日与农历节日按 lunar.js 的实际历法映射，避免把节日错移到公历同一天。
 */
/** @param {{timezone?: string, lunarAnniversaries?: Array<Record<string, any>>} } options */
export function lastYearComparisonDates(todayKey, options = {}) {
  const { timezone = 'local', lunarAnniversaries = [] } = options
  const currentDates = Array.from({ length: DAY_WINDOW * 2 + 1 }, (_, index) => addAppDays(todayKey, index - DAY_WINDOW, timezone))
    .filter(Boolean)
  const previousDates = new Set()
  const lunarAlignments = []

  for (const currentDate of currentDates) {
    const lunar = lunarMarker(currentDate, lunarAnniversaries)
    if (!lunar) {
      const priorDate = previousGregorianYear(currentDate)
      if (priorDate) previousDates.add(priorDate)
      continue
    }

    const priorLunar = lunarToGregorian(lunar.year - 1, lunar.month, lunar.day, lunar.isLeapMonth)
    // 闰月可能隔多年才出现；去年没有同一个闰月时不猜一个相邻公历日。
    if (!priorLunar) continue
    const priorDate = dateKeyOf(priorLunar)
    previousDates.add(priorDate)
    lunarAlignments.push({ currentDate, previousDate: priorDate, label: lunar.label })
  }

  return {
    currentDates,
    previousDates: [...previousDates].sort(),
    lunarAlignments,
  }
}

function secondsOfFocusSession(session) {
  const actual = Number(session?.actualFocusSeconds)
  if (Number.isFinite(actual)) return Math.max(0, Math.round(actual))
  return Math.max(0, Math.round((Number(session?.minutes) || 0) * 60))
}

function recordsOf(data, timezone) {
  const focus = []
  for (const session of Array.isArray(data.focusSessions) ? data.focusSessions : []) {
    const stamp = timestampOf(session?.startedAt)
    const seconds = secondsOfFocusSession(session)
    const date = stamp ? createdDateKey(stamp, timezone) : ''
    if (date && seconds > 0) focus.push({ date, seconds })
  }

  const completedTasks = []
  for (const task of Array.isArray(data.tasks) ? data.tasks : []) {
    const stamp = timestampOf(task?.completedAt)
    const date = stamp ? createdDateKey(stamp, timezone) : ''
    if (date) completedTasks.push({ date })
  }

  const transactions = (Array.isArray(data.transactions) ? data.transactions : [])
    .filter((item) => isValidDateKey(item?.date))
    .map((item) => ({ date: String(item.date), item }))

  const moods = Object.keys(normalizeMoodLog(data.moodLog)).map((date) => ({ date }))
  const reflections = Object.entries(normalizeWeeklyReflections(data.weeklyReflections))
    .filter(([, entry]) => Object.values(entry).some((text) => text.trim()))
    .map(([date]) => ({ date }))

  return { focus, completedTasks, transactions, moods, reflections }
}

function summarizeSpending(transactions, { convertAmount, currencyBase }) {
  let expenseCents = 0
  let excludedCount = 0
  const missingCurrencies = new Set()
  for (const { item } of transactions) {
    const cents = mySpendCents(item)
    if (cents === null) {
      excludedCount += 1
      continue
    }
    const converted = typeof convertAmount === 'function'
      ? convertAmount(cents / 100, item.currency)
      : { cents }
    if (converted?.cents === null) {
      excludedCount += 1
      if (converted.reason === 'rate' && converted.currency) missingCurrencies.add(converted.currency)
      continue
    }
    if (item.direction === 'income') continue
    const amountCents = Number(converted?.cents)
    if (!Number.isFinite(amountCents)) {
      excludedCount += 1
      continue
    }
    expenseCents += item.direction === 'refund' ? -amountCents : amountCents
  }
  return {
    expense: Math.round(expenseCents) / 100,
    excludedCount,
    missingCurrencies: [...missingCurrencies].sort(),
    currencyBase: String(currencyBase || 'CNY'),
  }
}

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`
  }
}

function formatSupportingSentence({ focus, completedTasks, transactions, moods, reflections, lunarAlignments, spending }) {
  const activity = []
  const supporting = []
  if (focus) activity.push('专注')
  if (completedTasks) activity.push('完成待办')
  if (transactions) supporting.push('账本')
  if (moods) supporting.push('心情')
  if (reflections) supporting.push('周复盘')
  let sentence = activity.length ? `那几天留下了${activity.join('与')}记录` : `那几天还留下了${supporting.join('、')}记录`
  if (activity.length && supporting.length) sentence += `，也记下了${supporting.join('、')}内容`
  const lunarLabels = [...new Set(lunarAlignments.map((item) => item.label))]
  const alignment = lunarLabels.length
    ? `${lunarLabels.join('、')}按农历日期对齐`
    : '公历按公历对照，农历节日与纪念日按农历对照'
  if (transactions) sentence += `，支出 ${formatMoney(spending.expense, spending.currencyBase)}`
  if (spending.excludedCount) {
    sentence += spending.missingCurrencies.length
      ? `，${spending.excludedCount} 笔因缺少 ${spending.missingCurrencies.join('、')} 汇率未计入`
      : `，${spending.excludedCount} 笔账目金额无法统计`
  }
  return `${sentence}；${alignment}。`
}

/** 纯查询：汇总去年同期记录，并在无样本时统计之后新增的有效记录条数。
 * @param {Record<string, any>} data
 * @param {string} todayKey
 * @param {{timezone?: string, lunarAnniversaries?: Array<Record<string, any>>, currencyBase?: string, convertAmount?: Function|null}} options
 */
export function buildLastYearComparison(data = {}, todayKey, options = {}) {
  const { timezone = 'local', lunarAnniversaries = [], currencyBase = 'CNY', convertAmount = null } = options
  const window = lastYearComparisonDates(todayKey, { timezone, lunarAnniversaries })
  const targetDates = new Set(window.previousDates)
  const records = recordsOf(data, timezone)
  const grouped = Object.fromEntries(Object.entries(records).map(([key, list]) => [key, list.filter((item) => targetDates.has(item.date))]))
  const totalRecords = Object.values(grouped).reduce((sum, list) => sum + list.length, 0)
  const earliestDate = window.previousDates[0] || ''
  const subsequentRecordCount = Object.values(records).flat().filter(({ date }) => date > earliestDate && date <= todayKey).length
  const focusSeconds = grouped.focus.reduce((sum, item) => sum + item.seconds, 0)
  const spending = summarizeSpending(grouped.transactions, { convertAmount, currencyBase })

  return {
    hasRecords: totalRecords > 0,
    totalRecords,
    focusHours: Math.round((focusSeconds / 3600) * 10) / 10,
    completedTasks: grouped.completedTasks.length,
    transactionCount: grouped.transactions.length,
    expense: spending.expense,
    expenseCurrency: spending.currencyBase,
    excludedTransactions: spending.excludedCount,
    missingCurrencies: spending.missingCurrencies,
    moodDays: grouped.moods.length,
    reflectionWeeks: grouped.reflections.length,
    subsequentRecordCount,
    previousDates: window.previousDates,
    lunarAlignments: window.lunarAlignments,
    sentence: totalRecords ? formatSupportingSentence({
      focus: grouped.focus.length,
      completedTasks: grouped.completedTasks.length,
      transactions: grouped.transactions.length,
      moods: grouped.moods.length,
      reflections: grouped.reflections.length,
      lunarAlignments: window.lunarAlignments,
      spending,
    }) : '',
  }
}
