import { parseNotice } from '../noticeParser.js'
import { detectCategory } from '../ledger.js'

const HOMEWORK_WORDS = /作业|实验报告|论文|习题|复习|预习|测验|英语作文|报告/
const EVENT_WORDS = /开会|会议|组会|答辩|面试|约|活动|讲座|值班|课题组/
const COUNTDOWN_WORDS = /倒计时|还有\d+天|距离.*?(考试|生日|放假|纪念日)|六级|四级|考研/
const NOTE_WORDS = /^(记一下|笔记|note[：:]?)/i
const INCOME_WORDS = /生活费|工资|奖学金|报销|退款|到账|收入|收款|红包|转入/
const BILL_WORDS = /每月|每周|每年|每季度|周期|自动续费/

function uid() { return `qr${Date.now()}${Math.random().toString(36).slice(2, 7)}` }
function pad(value) { return String(value).padStart(2, '0') }
function today(now) { return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` }
function currentTime(now) { return `${pad(now.getHours())}:${pad(now.getMinutes())}` }
function timeFrom(source, parsed) {
  if (parsed?.dueTime) return parsed.dueTime
  const hit = String(source).match(/(?:下午|晚上)?\s*(\d{1,2})点/)
  if (!hit) return ''
  let hour = Number(hit[1])
  if (/下午|晚上/.test(source) && hour < 12) hour += 12
  return hour <= 23 ? `${pad(hour)}:00` : ''
}
function cleanTitle(source, parsed) {
  return String(parsed?.title || source || '')
    .replace(/^(记一下|笔记|note[：:]?|提醒我|记得)/i, '')
    .replace(/(重要|紧急)$/g, '')
    .replace(/[，,。；;]+$/g, '')
    .trim() || '未命名记录'
}
const CN_NUMBERS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
function chineseAmount(value) {
  const text = String(value || '')
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text)
  if (!/^[零〇一二两三四五六七八九十百]+$/.test(text)) return 0
  let total = 0; let current = 0
  for (const char of text) {
    if (char === '十') { total += (current || 1) * 10; current = 0 }
    else if (char === '百') { total += (current || 1) * 100; current = 0 }
    else current = CN_NUMBERS[char]
  }
  return total + current
}
function moneyMatches(text) {
  const source = String(text || '')
  const expression = /(?:¥|￥)?\s*(\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百]+)\s*(?:块钱|元|块|rmb)/gi
  return [...source.matchAll(expression)].map((match) => ({
    amount: chineseAmount(match[1]), start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, raw: match[0],
  })).filter((match) => match.amount > 0)
}
function amountOf(text) {
  const explicit = moneyMatches(text)[0]
  if (explicit) return explicit.amount
  const matches = [...String(text).matchAll(/(?:¥|￥)?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块|rmb)?/gi)]
  const hit = matches.find((item) => !/[年月日号点时]/.test(String(text).slice(item.index + item[0].length, item.index + item[0].length + 1)))
  return hit ? Number(hit[1]) : 0
}
function cycleOf(text) {
  const source = String(text)
  const match = source.match(/每(周|星期|月|季度|年)\s*(\d{1,2})?\s*(?:号|日)?/)
  if (!match) return null
  const cycle = match[1].includes('周') || match[1].includes('星期') ? 'weekly'
    : match[1].includes('季度') ? 'quarterly'
      : match[1] === '年' ? 'yearly' : 'monthly'
  return { cycle, day: match[2] ? Number(match[2]) : null }
}
function paymentAccount(text) {
  const match = String(text).match(/微信|支付宝|现金|银行卡|校园卡|信用卡/)
  return match?.[0] ?? ''
}
function titleWithoutMoney(text, amount) {
  return String(text)
    .replace(/每(周|星期|月|季度|年)\s*\d{0,2}\s*(?:号|日)?/g, '')
    .replace(new RegExp(`(?:¥|￥)?\\s*${String(amount).replace('.', '\\.')}\\s*(?:元|块|rmb)?`, 'i'), '')
    .replace(/微信|支付宝|现金|银行卡|校园卡|信用卡/g, '')
    .replace(/(到账|收入|支出|花了|花费)/g, '')
    .replace(/[，,。；;]+/g, ' ')
    .trim()
}
function compactExpenseTitle(text) {
  return String(text || '')
    .replace(/(?:¥|￥)?\s*(?:\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百]+)\s*(?:块钱|元|块|rmb)/gi, '')
    .replace(/^(今天|今日|刚刚|我|去|坐|乘坐|乘|搭乘)+/g, '')
    .replace(/(用了|花了|花费|支付了|买了|去吃了|吃了|消费了)+$/g, '')
    .replace(/^[的、，,\s]+|[的、，,。；;\s]+$/g, '')
    .trim()
}
function moneyBatchStatements(source) {
  const matches = moneyMatches(source)
  if (matches.length < 2 || BILL_WORDS.test(source) || INCOME_WORDS.test(source)) return null
  return matches.map((match, index) => {
    const before = source.slice(index ? matches[index - 1].end : 0, match.start)
    const after = source.slice(match.end, index + 1 < matches.length ? matches[index + 1].start : source.length)
    const afterName = /^\s*的\s*([^，,。；;]+)/.exec(after)?.[1] || ''
    const title = compactExpenseTitle(afterName || before)
    return { statement: title || `支出 ${match.amount}元`, amount: match.amount, title: title || '未命名账目' }
  })
}
function splitStatements(text) {
  const lines = String(text).split(/\n+/).map((item) => item.trim()).filter(Boolean)
  if (lines.length > 1) return lines
  const pieces = String(text).split(/[，,；;](?=(?:周|星期|明天|后天|今天|下周|记得|开始|完成))/).map((item) => item.trim()).filter(Boolean)
  return pieces.length > 1 ? pieces : lines
}
function inferType(source, forcedType, preferredType = '') {
  if (forcedType) return forcedType
  if (NOTE_WORDS.test(source)) return 'note'
  if (BILL_WORDS.test(source) && amountOf(source)) return 'bill'
  if (COUNTDOWN_WORDS.test(source)) return 'countdown'
  if (amountOf(source)) return INCOME_WORDS.test(source) ? 'income' : 'expense'
  if (EVENT_WORDS.test(source)) return 'event'
  if (HOMEWORK_WORDS.test(source)) return 'homework'
  return preferredType || 'todo'
}
function questionsFor(type, parsed, source, amount = 0) {
  if ((type === 'expense' || type === 'income' || type === 'bill') && !(Number(amount) > 0)) {
    return [{ field: 'amount', label: '金额需要确认', choices: ['5', '10', '20'] }]
  }
  if ((type === 'event' || type === 'homework') && /明晚/.test(source) && !parsed.dueTime) {
    return [{ field: 'time', label: '时间需要确认', choices: ['18:00', '20:00', '23:59'] }]
  }
  return []
}

export function parseQuickRecord(text, { courses = [], now = new Date(), forcedType = '', context = {} } = {}) {
  const source = String(text ?? '').trim()
  if (!source) return []
  const batch = moneyBatchStatements(source)
  const statements = batch ?? splitStatements(source).map((statement) => ({ statement, amount: null, title: '' }))
  return statements.map(({ statement, amount: knownAmount, title: knownTitle }) => {
    const parsed = parseNotice(statement, courses, now)
    // 同一句中拆出的金额片段已经明确是独立消费，不能再因为片段标题里没有金额而退回待办。
    const type = knownAmount ? (forcedType || 'expense') : inferType(statement, forcedType, context.preferredType)
    const amount = knownAmount ?? amountOf(statement)
    const cycle = cycleOf(statement)
    const base = {
      id: uid(), type, raw: statement, title: knownTitle || cleanTitle(statement, parsed),
      course: parsed.course || context.courseName || '', courseId: context.courseId || '',
      date: parsed.dueDate || '', time: timeFrom(statement, parsed), priority: parsed.priority || 'normal',
      note: type === 'note' ? cleanTitle(statement, parsed) : parsed.note || '',
      amount, category: detectCategory(statement), account: paymentAccount(statement), cycle: cycle?.cycle || 'monthly',
      questions: questionsFor(type, parsed, statement, amount), confidence: knownAmount ? 0.9 : 0.78,
    }
    if (type === 'expense' || type === 'income' || type === 'bill') {
      base.title = knownTitle || compactExpenseTitle(titleWithoutMoney(statement, amount)) || (type === 'income' ? '收入' : '未命名账目')
      base.date = parsed.dueDate || today(now)
      base.time = parsed.dueTime || currentTime(now)
      if (type === 'bill') {
        const day = cycle?.day || now.getDate()
        base.date = parsed.dueDate || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`
      }
    }
    if (type === 'countdown') base.date = parsed.dueDate || ''
    return base
  })
}
