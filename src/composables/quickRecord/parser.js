import { detectCategory } from '../ledger.js'
import {
  buildExpenseTitle,
  chineseNumber,
  extractAccount,
  extractAmounts,
  extractCycle,
  extractSchedule,
  hasAmbiguousAmount,
} from './entities.js'

// 快速记录解析层：先做实体提取，再做意图判断。不再只用固定语序和补丁正则，
// 同一段文本无论“金额在前/在后”都会先被识别成实体，再组合成结构化草稿。

const HOMEWORK_WORDS = /作业|实验报告|论文|习题|复习|预习|测验|英语作文|报告/
const EVENT_WORDS = /开会|会议|组会|答辩|面试|约|活动|讲座|值班|课题组|上课|课程/
const COUNTDOWN_WORDS = /倒计时|还有\d+天|距离.*?(考试|生日|放假|纪念日)|六级|四级|考研/
const NOTE_WORDS = /^(记一下|笔记|note[：:]?)/i
const INCOME_WORDS = /生活费|工资|奖学金|报销|退款|到账|收入|收款|红包|转入|兼职/
const BILL_WORDS = /每月|每周|每年|每季度|周期|自动续费|月租|订阅|会员/

let uidSeq = 0
function uid() { return `qr${Date.now().toString(36)}${uidSeq++}${Math.random().toString(36).slice(2, 7)}` }
function pad(value) { return String(value).padStart(2, '0') }
function today(now) { return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` }
function currentTime(now) { return `${pad(now.getHours())}:${pad(now.getMinutes())}` }

function timeOf(source, schedule) {
  if (schedule?.time) return schedule.time
  const original = String(source ?? '')
  // 先去掉“下周一”这类日期词，避免解析时间时把“一两”连在一起。
  const text = original.replace(/(下|本|这)?(?:周|星期)[一二三四五六日天]/g, ' ')
  const colon = text.match(/(凌晨|早上|上午|中午|下午|晚上|夜里)?\s*(\d{1,2})[:：](\d{2})/)
  const point = text.match(/(凌晨|早上|上午|中午|下午|晚上|夜里)?\s*([零〇一二两三四五六七八九十\d]{1,3})[点时](?:半|[零〇一二两三四五六七八九十\d]{1,3}分?)?/)
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
  return String(fallback || source || '')
    .replace(/^(提醒我|记得|请|请于|请在|务必|必须|需要)+/g, '')
    .replace(/^(前|之前|以前|截止|截至)\s*/g, '')
    .replace(/(重要|紧急)$/g, '')
    .trim() || source
}

function splitStatements(text) {
  const source = String(text ?? '').trim()
  if (!source) return []
  const lines = source.split(/\n+/).map((item) => item.trim()).filter(Boolean)
  if (lines.length > 1) return lines.map((statement) => ({ statement, amount: null, title: '' }))

  const amounts = extractAmounts(source)
  if (amounts.length >= 2 && !INCOME_WORDS.test(source) && !BILL_WORDS.test(source)) {
    return amounts.map((amount, index) => {
      const before = source.slice(index ? amounts[index - 1].end : 0, amount.start)
      const after = source.slice(amount.end, index + 1 < amounts.length ? amounts[index + 1].start : source.length)
      const afterName = /^\s*的\s*([^，,。；;]+)/.exec(after)?.[1] || ''
      const raw = (afterName || before || `支出 ${amount.amount}元`).trim()
      return { statement: raw, amount: amount.amount, title: '' }
    })
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
  if (NOTE_WORDS.test(source)) return { type: 'note', confidence: 0.9, uncertain: false }
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

function parseStatement(statement, { courses = [], now = new Date(), forcedType = '', context = {} } = {}) {
  const source = String(statement ?? '').trim()
  if (!source) return null
  // 自由笔记是明确的用户意图：不做日期、金额、课程等实体提取，
  // 既避免无意义的计算，也不会把笔记误显示成待办草稿。
  if (forcedType === 'note') {
    return {
      id: uid(), type: 'note', raw: source, title: '', course: '', courseId: '',
      date: '', time: '', priority: 'normal', note: source, amount: 0,
      category: '', account: '', cycle: 'monthly', questions: [], confidence: 0.94, uncertain: false,
    }
  }
  const knownAmount = typeof context.knownAmount === 'number' ? context.knownAmount : null
  const amounts = extractAmounts(source)
  const schedule = extractSchedule(source, courses, now)
  const account = extractAccount(source)
  const cycle = extractCycle(source)
  const amount = knownAmount ?? amounts[0]?.amount ?? 0
  const amountCount = knownAmount === null ? amounts.length : 1
  const intent = knownAmount === null
    ? inferIntent(source, schedule, amountCount, forcedType, context.preferredType)
    : { type: forcedType || 'expense', confidence: 0.9, uncertain: false }
  const type = intent.type

  const base = {
    id: uid(),
    type,
    raw: source,
    title: '',
    course: schedule.course || context.courseName || '',
    courseId: context.courseId || '',
    date: schedule.date || '',
    dateRange: schedule.dateRange || '',
    time: timeOf(source, schedule),
    endTime: schedule.endTime || '',
    location: schedule.location || '',
    reminder: schedule.reminder || '',
    priority: schedule.priority || 'normal',
    note: schedule.note || '',
    amount,
    category: detectCategory(source),
    account,
    cycle: cycle?.cycle || 'monthly',
    questions: questionsFor(type, source, schedule, amount),
    confidence: intent.confidence,
    uncertain: Boolean(intent.uncertain),
  }

  if (type === 'expense' || type === 'income' || type === 'bill') {
    base.title = buildExpenseTitle(source, amounts, account) || (type === 'income' ? '收入' : '未命名账目')
    base.date = schedule.date || today(now)
    base.time = schedule.time || currentTime(now)
    if (type === 'bill') {
      const day = cycle?.day || now.getDate()
      base.date = schedule.date || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`
    }
  } else if (type === 'countdown') {
    base.title = cleanTaskTitle(source, schedule.title)
    base.date = schedule.date || ''
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

  if (type === 'note' || type === 'unknown') {
    base.title = ''
    base.note = source
  }

  return base
}

export function parseQuickRecord(text, { courses = [], now = new Date(), forcedType = '', context = {} } = {}) {
  const statements = splitStatements(text)
  return statements
    .map(({ statement, amount: knownAmount, title: knownTitle }) => {
      const mergedContext = { ...context }
      if (knownAmount !== null) mergedContext.knownAmount = knownAmount
      const draft = parseStatement(statement, { courses, now, forcedType, context: mergedContext })
      if (!draft) return null
      if (knownTitle) draft.title = knownTitle
      if (knownAmount !== null) {
        draft.type = forcedType || 'expense'
        draft.amount = knownAmount
        draft.confidence = 0.9
      }
      return draft
    })
    .filter(Boolean)
}
