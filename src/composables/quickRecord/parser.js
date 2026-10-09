import { classifyTransaction } from '../ledger.js'
import {
  buildExpenseTitle,
  chineseNumber,
  extractAccount,
  extractAmounts,
  extractCycle,
  extractSchedule,
  hasAmbiguousAmount,
} from './entities.js'
import { defaultAccount, policyDateKey, policyTimeKey } from '../settingsPolicy.js'

// 快速记录解析层：先做实体提取，再做意图判断。不再只用固定语序和补丁正则，
// 同一段文本无论“金额在前/在后”都会先被识别成实体，再组合成结构化草稿。

const HOMEWORK_WORDS = /作业|实验报告|论文|习题|复习|预习|测验|英语作文|报告/
const EVENT_WORDS = /开会|会议|组会|班会|答辩|面试|约|活动|讲座|值班|课题组|上课|课程/
const COUNTDOWN_WORDS = /倒计时|还有\d+天|距离.*?(考试|生日|放假|纪念日)|六级|四级|考研/
const INCOME_WORDS = /生活费|工资|奖学金|报销|退款|到账|收入|收款|红包|转入|兼职/
const BILL_WORDS = /每月|每周|每年|每季度|周期|自动续费|月租|订阅|会员/
const ALLOWED_FORCED_TYPES = new Set(['expense', 'income', 'bill', 'countdown', 'event', 'homework', 'todo'])

let uidSeq = 0
function uid() {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ? `qr-${uuid}` : `qr-${Math.random().toString(36).slice(2)}-${uidSeq++}`
}
function pad(value) { return String(value).padStart(2, '0') }
function today(now) { return policyDateKey(now) }
function currentTime(now) { return policyTimeKey(now) }

function policyReferenceDate(now) {
  return new Date(`${policyDateKey(now)}T${policyTimeKey(now)}:00`)
}

function addPolicyDays(dateKey, count) {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + count))
  return date.toISOString().slice(0, 10)
}

function countdownDate(source, now) {
  const match = String(source ?? '').match(/(?:还有|剩余)\s*(\d{1,3})\s*天/)
  if (!match) return ''
  return addPolicyDays(policyDateKey(now), Number(match[1]))
}

function timeOf(source, schedule) {
  if (schedule?.time) return schedule.time
  const original = String(source ?? '')
  // 先去掉“下周一”这类日期词，避免解析时间时把“一两”连在一起。
  const text = original.replace(/(下|本|这)?(?:周|星期)[一二三四五六日天]/g, ' ')
  const colon = text.match(/(凌晨|早上|上午|中午|下午|晚上|夜里)?\s*(\d{1,2})[:：](\d{2})/)
  const point = text.match(/(凌晨|早上|上午|中午|下午|晚上|夜里)?\s*([零〇一二两三四五六七八九十\d]{1,3})[点时](半|[零〇一二两三四五六七八九十\d]{1,3}分?)?/)
  const match = colon || point
  if (!match) return ''
  const period = match[1] || ''
  let hour = chineseNumber(match[2])
  const minute = colon ? Number(match[3]) : match[3] === '半' ? 30 : chineseNumber(String(match[3] || '0').replace('分', ''))
  if (/下午|晚上|夜里/.test(period) && hour < 12) hour += 12
  if (/凌晨/.test(period) && hour === 12) hour = 0
  if (/中午/.test(period) && hour < 11) hour += 12
  // 没有明确上下午时，“两点”通常指下午 2 点；凌晨场景应显式写“凌晨两点”。
  if (!period && hour <= 6) hour += 12
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return ''
  return `${pad(hour)}:${pad(minute)}`
}

function cleanTaskTitle(source, fallback) {
  const title = fallback && fallback !== '待处理通知' ? fallback : String(source || '')
    .replace(/^(?:今天|明天|后天|大后天|昨天|(?:本|这|下)?(?:周|星期)[一二三四五六日天])\s*/g, '')
    .replace(/(?:凌晨|早上|上午|中午|下午|晚上|夜里)?\s*(?:\d{1,2}[:：]\d{2}|[零〇一二两三四五六七八九十\d]{1,3}[点时](?:半|[零〇一二两三四五六七八九十\d]{1,3}分?)?)\s*/g, '')
  return String(title || source || '')
    .replace(/^(提醒我|记得|请|请于|请在|务必|必须|需要)+/g, '')
    .replace(/^(前|之前|以前|截止|截至)\s*/g, '')
    .replace(/(重要|紧急)$/g, '')
    .trim() || source
}

function splitStatements(text, forcedType = '') {
  const source = String(text ?? '').trim()
  if (!source) return []
  const lines = source.split(/[\n；;]+/).map((item) => item.trim().replace(/^(?:[-*•]\s+|\d+[)、]\s*|\d+\.\s+)/, '')).filter(Boolean)
  if (lines.length > 1) return lines.flatMap((statement) => splitStatements(statement, forcedType))

  const amounts = extractAmounts(source)
  if (amounts.length >= 2 && (!forcedType || forcedType === 'expense') && !INCOME_WORDS.test(source) && !BILL_WORDS.test(source)) {
    return amounts.map((amount, index) => {
      const before = source.slice(index ? amounts[index - 1].end : 0, amount.start)
      const after = source.slice(amount.end, index + 1 < amounts.length ? amounts[index + 1].start : source.length)
      const afterName = /^\s*的\s*([^，,。；;]+)/.exec(after)?.[1] || ''
      const title = buildExpenseTitle((afterName || before).trim())
      const raw = source.slice(index ? amounts[index - 1].end : 0, amount.end) + (afterName ? after.slice(0, after.indexOf(afterName) + afterName.length) : '')
      return { statement: raw.replace(/^[\s，,。；;]+|[\s，,。；;]+$/g, ''), amount: amount.amount, title }
    })
  }

  // 一笔消费后接一个明确的计划动作时，拆成两个业务草稿。
  // 例如“买六级真题39元，周五开始做第一套”应分别落到支出和待办。
  // 仅在自动识别且存在明确分隔符/行动词时拆分，避免改变强制类型和普通消费标题。
  if (!forcedType && amounts.length === 1) {
    const amount = amounts[0]
    const head = source.slice(0, amount.end).replace(/[，,；;。]+$/g, '').trim()
    const tail = source.slice(amount.end).replace(/^[\s，,；;。]+/g, '').trim()
    const followUp = /^(?:(?:今天|明天|后天|大后天|本周|这周|下周|周[一二三四五六日天])[^，,；;。]*|开始|做|完成|提交|交|复习|提醒|安排|准备|开会|组会|上课)/.test(tail)
    if (head && tail && followUp) return [{ statement: head, amount: null, title: '' }, { statement: tail, amount: null, title: '' }]
  }

  return [{ statement: source, amount: null, title: '' }]
}

function inferIntent(source, schedule, amountCount, forcedType, preferredType = '') {
  if (forcedType) return { type: forcedType, confidence: 0.94, uncertain: false }
  const hasDate = Boolean(schedule.date)
  const hasTime = Boolean(schedule.time)

  if (amountCount > 0) {
    if (INCOME_WORDS.test(source)) return { type: 'income', confidence: 0.88, uncertain: false }
    if (BILL_WORDS.test(source)) return { type: 'bill', confidence: 0.84, uncertain: false }
    return { type: 'expense', confidence: 0.92, uncertain: false }
  }

  if (COUNTDOWN_WORDS.test(source) && hasDate) return { type: 'countdown', confidence: 0.8, uncertain: false }
  if (EVENT_WORDS.test(source) && (hasDate || hasTime)) return { type: 'event', confidence: 0.84, uncertain: false }
  if (HOMEWORK_WORDS.test(source)) return { type: 'homework', confidence: 0.72, uncertain: false }
  if (hasDate || hasTime || /提醒我|记得|截止|开始|完成|提交|交/.test(source)) return { type: preferredType === 'event' ? 'event' : 'todo', confidence: 0.66, uncertain: false }
  if (hasAmbiguousAmount(source)) return { type: 'unknown', confidence: 0.3, uncertain: true }
  if (preferredType) return { type: preferredType, confidence: 0.5, uncertain: true }
  return { type: 'todo', confidence: 0.45, uncertain: true }
}

function questionsFor(type, source, schedule, amount) {
  if ((type === 'expense' || type === 'income' || type === 'bill') && !(Number(amount) > 0)) {
    return [{ field: 'amount', label: '金额需要确认', choices: ['5', '10', '20'] }]
  }
  if ((type === 'event' || type === 'homework' || type === 'todo') && /明晚/.test(source) && !schedule.time) {
    return [{ field: 'time', label: '时间需要确认', choices: ['18:00', '20:00', '23:59'] }]
  }
  return []
}

/**
 * @param {string} statement
 * @param {{courses?: Array<{id: string, name: string}>, now?: Date, forcedType?: string, context?: import('./contracts').QuickRecordContext}} options
 * @returns {import('./contracts').QuickRecordDraft | null}
 */
function parseStatement(statement, { courses = [], now = new Date(), forcedType = '', context = {} } = {}) {
  const source = String(statement ?? '').trim()
  if (!source) return null
  const knownAmount = typeof context.knownAmount === 'number' ? context.knownAmount : null
  const amounts = extractAmounts(source)
  const schedule = extractSchedule(source, courses, policyReferenceDate(now))
  const relativeCountdownDate = countdownDate(source, now)
  const account = extractAccount(source)
  const cycle = extractCycle(source)
  const amount = knownAmount ?? amounts[0]?.amount ?? 0
  const amountCount = knownAmount === null ? amounts.length : 1
  const intent = knownAmount === null
    ? inferIntent(source, { ...schedule, date: schedule.date || relativeCountdownDate }, amountCount, forcedType, context.preferredType)
    : { type: forcedType || 'expense', confidence: 0.9, uncertain: false }
  const type = intent.type
  const classification = ['expense', 'income', 'bill'].includes(type)
    ? classifyTransaction(source, { direction: type === 'income' ? 'income' : 'expense' })
    : null

  const base = {
    id: uid(),
    type,
    raw: source,
    title: '',
    course: schedule.course || context.courseName || '',
    courseId: courses.find((course) => course.name === schedule.course)?.id || context.courseId || '',
    date: schedule.date || relativeCountdownDate || '',
    dateRange: schedule.dateRange || '',
    time: timeOf(source, schedule),
    endTime: schedule.endTime || '',
    location: schedule.location || '',
    reminder: schedule.reminder || '',
    priority: schedule.priority || 'normal',
    note: schedule.note || '',
    amount,
    category: classification?.categoryId || '',
    categoryConfidence: classification?.confidence ?? 0,
    categoryUncertain: Boolean(classification?.uncertain),
    categorySuggested: classification?.categoryId || '',
    categoryMatchedBy: classification?.matchedBy || '',
    categoryMatchedTerms: classification?.matchedTerms || [],
    categoryCandidates: classification?.candidates || [],
    categoryAmbiguous: Boolean(classification?.ambiguous),
    account: ['expense', 'income', 'bill'].includes(type) ? (account || defaultAccount()) : account,
    cycle: cycle?.cycle || 'monthly',
    questions: questionsFor(type, source, schedule, amount),
    confidence: intent.confidence,
    uncertain: Boolean(intent.uncertain),
  }

  if (type === 'expense' || type === 'income' || type === 'bill') {
    base.title = buildExpenseTitle(source, amounts, account) || (type === 'income' ? '收入' : '日常支出')
    base.date = schedule.date || today(now)
    base.time = schedule.time || currentTime(now)
    if (type === 'bill') {
      const [year, month] = policyDateKey(now).split('-').map(Number)
      const day = cycle?.day || Number(policyDateKey(now).slice(8, 10))
      base.date = schedule.date || `${year}-${pad(month)}-${pad(day)}`
    }
  } else if (type === 'countdown') {
    base.title = cleanTaskTitle(source, schedule.title)
    base.date = schedule.date || relativeCountdownDate || ''
    base.time = schedule.time || ''
  } else if (type === 'event') {
    base.title = cleanTaskTitle(source, schedule.title)
    base.date = schedule.date || ''
    base.time = timeOf(source, schedule)
  } else {
    base.title = cleanTaskTitle(source, schedule.title)
    base.date = schedule.date || ''
    base.time = timeOf(source, schedule)
  }

  if (type === 'unknown') {
    base.title = ''
    base.note = source
  }

  return base
}

/**
 * @param {string} text
 * @param {{courses?: Array<{id: string, name: string}>, now?: Date, forcedType?: string, context?: import('./contracts').QuickRecordContext}} options
 * @returns {import('./contracts').QuickRecordDraft[]}
 */
export function parseQuickRecord(text, { courses = [], now = new Date(), forcedType = '', context = {} } = {}) {
  // Ignore legacy/unknown modes (including the removed free-note mode) and
  // classify the text through the same structured-record path as auto mode.
  const safeForcedType = ALLOWED_FORCED_TYPES.has(forcedType) ? forcedType : ''
  const statements = splitStatements(text, safeForcedType)
  return statements
    .map(({ statement, amount: knownAmount, title: knownTitle }) => {
      const mergedContext = { ...context }
      if (knownAmount !== null) mergedContext.knownAmount = knownAmount
      const draft = parseStatement(statement, { courses, now, forcedType: safeForcedType, context: mergedContext })
      if (!draft) return null
      if (knownTitle) draft.title = knownTitle
      if (knownAmount !== null) {
        draft.type = safeForcedType || 'expense'
        draft.amount = knownAmount
        draft.confidence = 0.9
      }
      return draft
    })
    .filter((draft) => draft !== null)
}
