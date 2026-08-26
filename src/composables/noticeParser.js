const WEEKDAY = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function pad(value) {
  return String(value).padStart(2, '0')
}

function dateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addDays(date, count) {
  const result = new Date(date)
  result.setDate(result.getDate() + count)
  return result
}

function chineseNumber(value) {
  const text = String(value ?? '')
  if (/^\d+$/.test(text)) return Number(text)
  if (text === '十') return 10
  if (text.includes('十')) {
    const [left, right] = text.split('十')
    return (left ? CN_DIGITS[left] ?? 0 : 1) * 10 + (right ? CN_DIGITS[right] ?? 0 : 0)
  }
  return CN_DIGITS[text] ?? Number(text)
}

function parseDate(text, now) {
  const explicit = text.match(/(?:(\d{4})[年\-/])?(\d{1,2})[月\-/](\d{1,2})日?/)
  if (explicit) {
    const year = Number(explicit[1] || now.getFullYear())
    const date = new Date(year, Number(explicit[2]) - 1, Number(explicit[3]))
    if (!explicit[1] && date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      date.setFullYear(date.getFullYear() + 1)
    }
    return dateString(date)
  }
  if (/大后天/.test(text)) return dateString(addDays(now, 3))
  if (/后天/.test(text)) return dateString(addDays(now, 2))
  if (/明天|明日/.test(text)) return dateString(addDays(now, 1))
  if (/今天|今日/.test(text)) return dateString(now)

  const weekday = text.match(/(下|本|这)?(?:周|星期)([一二三四五六日天])/) 
  if (weekday) {
    const target = WEEKDAY[weekday[2]]
    const current = now.getDay()
    const targetFromMonday = (target + 6) % 7
    const currentFromMonday = (current + 6) % 7
    let delta
    if (/下/.test(weekday[1] || '')) {
      delta = 7 - currentFromMonday + targetFromMonday
    } else if (/本|这/.test(weekday[1] || '')) {
      delta = targetFromMonday - currentFromMonday
    } else {
      delta = (target - current + 7) % 7
      if (delta === 0) delta = 7
    }
    return dateString(addDays(now, delta))
  }
  return ''
}

function parseTime(text) {
  const colon = text.match(/(上午|早上|中午|下午|晚上|夜里|凌晨)?\s*(\d{1,2})[:：](\d{2})/)
  const point = text.match(/(上午|早上|中午|下午|晚上|夜里|凌晨)?\s*([零〇一二两三四五六七八九十\d]{1,3})[点时](半|[零〇一二两三四五六七八九十\d]{1,3}分?)?/) 
  const match = colon || point
  if (!match) return ''
  const period = match[1] || ''
  let hour = chineseNumber(match[2])
  let minute = colon ? Number(match[3]) : match[3] === '半' ? 30 : chineseNumber(String(match[3] || '0').replace('分', ''))
  if (/下午|晚上|夜里/.test(period) && hour < 12) hour += 12
  if (/凌晨/.test(period) && hour === 12) hour = 0
  if (/中午/.test(period) && hour < 11) hour += 12
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return ''
  return `${pad(hour)}:${pad(minute)}`
}

function cleanTitle(text) {
  let first = text.split(/[，,。；;\n]/)[0] || text
  first = first
    .replace(/(?:(?:\d{4})[年\-/])?\d{1,2}[月\-/]\d{1,2}日?/g, '')
    .replace(/(?:下|本|这)?(?:周|星期)[一二三四五六日天]/g, '')
    .replace(/今天|今日|明天|明日|后天|大后天/g, '')
    .replace(/(?:上午|早上|中午|下午|晚上|夜里|凌晨)?\s*\d{1,2}[:：]\d{2}/g, '')
    .replace(/(?:上午|早上|中午|下午|晚上|夜里|凌晨)?\s*[零〇一二两三四五六七八九十\d]{1,3}[点时](?:半|[零〇一二两三四五六七八九十\d]{1,3}分?)?/g, '')
    .replace(/^(各位)?(同学们?|大家)?[：:]?/g, '')
    .replace(/^(请|请于|请在|务必|必须|需要|记得)+/g, '')
    .replace(/^(截止|截至)|之前|以前|前(?=提交|完成|上交|报名|参加)/g, '')
    .trim()
  const action = first.search(/提交|上交|完成|报名|参加|准备|领取|填写|考试|汇报|答辩|开会|签到|缴费|确认/)
  if (action > 0 && action < 12) first = first.slice(action)
  return first.replace(/^[：:、，,\s]+|[：:、，,\s]+$/g, '').slice(0, 60) || '待处理通知'
}

function noteFrom(text) {
  const parts = text.split(/[，,。；;\n]/).map((item) => item.trim()).filter(Boolean)
  return parts.slice(1).join('；').slice(0, 500)
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/提交|上交|完成|作业|通知|请|务必|必须|关于|的/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

function bigrams(value) {
  const text = normalize(value)
  if (text.length < 2) return new Set(text ? [text] : [])
  return new Set(Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2)))
}

function similarity(left, right) {
  const a = bigrams(left)
  const b = bigrams(right)
  if (!a.size || !b.size) return 0
  let same = 0
  for (const value of a) if (b.has(value)) same++
  return (2 * same) / (a.size + b.size)
}

export function parseNotice(source, courses = [], now = new Date()) {
  const text = String(source ?? '').trim()
  const course = courses.find((item) => item?.name && text.includes(item.name))?.name ?? ''
  return {
    title: cleanTitle(text),
    dueDate: parseDate(text, now),
    dueTime: parseTime(text),
    course,
    priority: /紧急|务必|必须|逾期|最后/.test(text) ? 'high' : 'normal',
    note: noteFrom(text),
    sourceText: text,
  }
}

export function findNoticeChanges(parsed, tasks) {
  return tasks
    .map((task) => {
      const titleScore = similarity(parsed.title, task.title)
      const sourceScore = task.sourceText ? similarity(parsed.sourceText, task.sourceText) : 0
      const courseBoost = parsed.course && task.course === parsed.course ? 0.12 : 0
      return { task, score: Math.min(1, Math.max(titleScore, sourceScore) + courseBoost) }
    })
    .filter((item) => item.score >= 0.42)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}
