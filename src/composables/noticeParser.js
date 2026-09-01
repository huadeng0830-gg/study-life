// 通知/自然语言解析核心：粘贴通知和语音转写共用这一条文字理解路径。
const WEEKDAY = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const PERIOD_WORDS = '凌晨|早上|上午|中午|下午|晚上|夜里|今晚|今早'
const ACTION_WORDS = '提交|上交|上传|完成|报名|填写|领取|参加|召开|开会|举行|签到|报到|集合|上课|听|交|改到|换到|处理|确认|缴费'

export const NOTICE_TYPE_OPTIONS = [
  { value: '缴费', label: '缴费', icon: '💰' },
  { value: '作业', label: '作业', icon: '📚' },
  { value: '会议', label: '会议', icon: '📅' },
  { value: '考试', label: '考试', icon: '📝' },
  { value: '课程', label: '课程', icon: '🏫' },
  { value: '截止', label: '截止事项', icon: '⏳' },
  { value: '提醒', label: '提醒', icon: '🔔' },
  { value: '通知', label: '普通通知', icon: '📣' },
]

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
  if (!text) return 0
  if (text === '十') return 10
  if (text.includes('十')) {
    const [left, right] = text.split('十')
    return (left ? CN_DIGITS[left] ?? 0 : 1) * 10 + (right ? CN_DIGITS[right] ?? 0 : 0)
  }
  if (text.includes('百')) {
    const [left, right] = text.split('百')
    return (left ? CN_DIGITS[left] ?? 0 : 1) * 100 + (right ? chineseNumber(right) : 0)
  }
  return CN_DIGITS[text] ?? 0
}

/** 只整理格式，不删除原文；“通知/辅导员/@全体成员”等语义仍保留。 */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function lineAt(text, index) {
  const start = text.lastIndexOf('\n', index) + 1
  const end = text.indexOf('\n', index)
  return text.slice(start, end < 0 ? text.length : end).trim()
}

function relativeDateValue(raw, now) {
  if (/大后天/.test(raw)) return dateString(addDays(now, 3))
  if (/后天/.test(raw)) return dateString(addDays(now, 2))
  if (/明天|明日|明早|明晚/.test(raw)) return dateString(addDays(now, 1))
  if (/今天|今日|今晚|今早/.test(raw)) return dateString(now)
  const weekday = raw.match(/(下|本|这)?(?:周|星期|礼拜)([一二三四五六日天])$/)
  if (!weekday) return ''
  const target = WEEKDAY[weekday[2]]
  const currentFromMonday = (now.getDay() + 6) % 7
  const targetFromMonday = (target + 6) % 7
  const delta = weekday[1] === '下'
    ? 7 - currentFromMonday + targetFromMonday
    : weekday[1] === '本' || weekday[1] === '这'
      ? targetFromMonday - currentFromMonday
      : (target - now.getDay() + 7) % 7 || 7
  return dateString(addDays(now, delta))
}

function isPublicationCandidate(candidate, text) {
  const context = text.slice(Math.max(0, candidate.start - 6), Math.min(text.length, candidate.end + 24))
  if (/发布|发布日期|通知日期|落款/.test(context)) return true
  if (!/^\d{4}/.test(candidate.raw)) return false
  const line = lineAt(text, candidate.start)
  return line.length <= 30 || /辅导员|发布|发布日期|通知日期|落款/.test(line)
}

function isDeadlineCandidate(candidate, text) {
  const context = text.slice(Math.max(0, candidate.start - 8), Math.min(text.length, candidate.end + 16))
    return /截止|截至|最晚|之前|以前|报名截止|前/.test(context)
}

/** 找出所有日期候选；选择事件日期时会排除末尾的通知发布日期。 */
export function extractDateCandidates(value, now = new Date()) {
  const text = normalizeText(value)
  const candidates = []
  const explicit = /(?:(\d{4})\s*(?:年|[\/-])\s*)?(\d{1,2})\s*(?:月|[\/-])\s*(\d{1,2})\s*(?:日|号)?/g
  for (const match of text.matchAll(explicit)) {
    const year = Number(match[1] || now.getFullYear())
    const date = new Date(year, Number(match[2]) - 1, Number(match[3]))
    if (date.getFullYear() !== year || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) continue
    let ambiguous = false
    if (!match[1] && date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      const daysPast = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - date) / 86400000)
      // 临近过去日期可能是通知中的实际日期，不武断推到下一年，交给用户确认。
      if (daysPast <= 45) ambiguous = true
      else date.setFullYear(date.getFullYear() + 1)
    }
    const candidate = { raw: match[0], start: match.index, end: match.index + match[0].length, value: dateString(date), kind: 'explicit' }
    candidate.isPublication = isPublicationCandidate(candidate, text)
    candidate.isDeadline = isDeadlineCandidate(candidate, text)
    candidate.ambiguous = ambiguous
    candidates.push(candidate)
  }
  // “最晚15号交”这类通知只写日，不写月份；按当前月份解析并保留为候选。
  for (const match of text.matchAll(/(\d{1,2})\s*(?:日|号)/g)) {
    if (candidates.some((item) => item.start <= match.index && item.end >= match.index + match[0].length)) continue
    const day = Number(match[1])
    if (day < 1 || day > 31) continue
    let date = new Date(now.getFullYear(), now.getMonth(), day)
    if (date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) date = new Date(now.getFullYear(), now.getMonth() + 1, day)
    if (date.getDate() !== day) continue
    candidates.push({ raw: match[0], start: match.index, end: match.index + match[0].length, value: dateString(date), kind: 'day', isPublication: false, isDeadline: isDeadlineCandidate({ start: match.index, end: match.index + match[0].length }, text), ambiguous: false })
  }
  const relative = /((?:下|本|这)?(?:周|星期|礼拜)[一二三四五六日天]|(?:下|本|这)?(?:周|星期|礼拜)|大后天|后天|明天|明日|明早|明晚|今天|今日|今晚|今早)/g
  for (const match of text.matchAll(relative)) {
    const raw = match[0]
    candidates.push({ raw, start: match.index, end: match.index + raw.length, value: relativeDateValue(raw, now), kind: /周|星期|礼拜/.test(raw) ? 'weekday' : 'relative', isPublication: false, isDeadline: isDeadlineCandidate({ start: match.index, end: match.index + raw.length }, text), ambiguous: false })
  }
  const byStart = new Map()
  for (const candidate of candidates) {
    const previous = byStart.get(candidate.start)
    if (!previous || candidate.end - candidate.start > previous.end - previous.start) byStart.set(candidate.start, candidate)
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start)
}

function parsePeriod(period, hour) {
  let value = hour
  if (/下午|晚上|夜里|今晚/.test(period) && value < 12) value += 12
  if (/凌晨/.test(period) && value === 12) value = 0
  if (/中午/.test(period) && value < 11) value += 12
  // 没写上下文的“两点/三点”按常见口语理解为下午，同时标记为低确定性。
  const ambiguous = !period && value >= 1 && value <= 6
  if (ambiguous) value += 12
  return { value, ambiguous }
}

function parseMinute(token) {
  if (!token) return 0
  if (token === '半') return 30
  if (token === '一刻') return 15
  if (token === '三刻') return 45
  return chineseNumber(String(token).replace(/分/g, ''))
}

/** 找出时间点和时间范围；范围的第二个时间点继承“下午/晚上”上下文。 */
export function extractTimeCandidates(value) {
  const text = normalizeText(value)
  const candidates = []
  const colon = new RegExp(`(${PERIOD_WORDS})?\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{2})`, 'g')
  for (const match of text.matchAll(colon)) {
    const parsed = parsePeriod(match[1] || '', Number(match[2]))
    if (parsed.value > 23 || Number(match[3]) > 59) continue
    candidates.push({ raw: match[0], start: match.index, end: match.index + match[0].length, time: `${pad(parsed.value)}:${pad(match[3])}`, period: match[1] || '', ambiguous: parsed.ambiguous })
  }
  const point = new RegExp(`(${PERIOD_WORDS})?\\s*((?:\\d{1,3}|[零〇一二两三四五六七八九十百]{1,4}))\\s*[点时]\\s*(半|一刻|三刻|[零〇一二两三四五六七八九十百\\d]{1,3}分?)?`, 'g')
  for (const match of text.matchAll(point)) {
    const hour = chineseNumber(match[2])
    // “下周一两点”不能把日期末尾的“一”和时间“两点”粘成“一两点”。
    if (!hour && !/^(?:0|零|〇)$/.test(match[2])) continue
    const parsed = parsePeriod(match[1] || '', hour)
    const minute = parseMinute(match[3])
    if (parsed.value > 23 || minute > 59) continue
    candidates.push({ raw: match[0], start: match.index, end: match.index + match[0].length, time: `${pad(parsed.value)}:${pad(minute)}`, period: match[1] || '', ambiguous: parsed.ambiguous })
  }
  candidates.sort((a, b) => a.start - b.start)
  for (let index = 1; index < candidates.length; index++) {
    const previous = candidates[index - 1]
    const current = candidates[index]
    const between = text.slice(previous.end, current.start)
    if (!current.period && /^(?:到|至|[-—~～])$/.test(between.trim()) && previous.period) {
      const parsed = parsePeriod(previous.period, Number(current.time.slice(0, 2)))
      current.time = `${pad(parsed.value)}:${current.time.slice(3)}`
      current.ambiguous = parsed.ambiguous
    }
  }
  return candidates
}

export function extractLocationCandidates(value) {
  const text = normalizeText(value)
  const candidates = []
  const patterns = [
    { pattern: /(?:地点|地址|会议地点)\s*[:：]\s*([^\n，,。；;]+)/g, explicit: true },
    { pattern: /(?:在|到|于(?!\s*(?:\d{1,4}\s*(?:月|日|号|点|时)|\d{1,2}\s*[:：]|今天|明天|后天|本周|下周)))\s*([^\n，,。；;]+?)(?=\s*(?:召开|开会|开班会|举行|参加|上课|集合|签到|报到|开始|听|提交|上交|上传|完成|报名|填写|领取|携带|处理|确认|缴费|[。.!！?？]|$))/g, explicit: false },
  ]
  for (const { pattern, explicit } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const prefix = explicit ? '' : match[0].trim().slice(0, 1)
      const previous = match.index > 0 ? text[match.index - 1] : ''
      // “关于实验报告提交”里的“于”不是地点介词；只接受独立出现的“于”。
      if (!explicit && prefix === '于' && /[关于对于由于至于基于位于鉴于]$/.test(previous)) continue
      const location = match[1].replace(/^(这里|那里)\s*/, '').trim()
      if (!location || location === '场' || /^(今天|明天|后天|上午|下午|晚上|早上)/.test(location) || extractTimeCandidates(location).length) continue
      candidates.push({ raw: location, start: match.index, end: match.index + match[0].length, explicit })
    }
  }
  return candidates.sort((a, b) => {
    if (a.explicit !== b.explicit) return a.explicit ? -1 : 1
    return b.raw.length - a.raw.length || a.start - b.start
  })
}

function stripRecognizedParts(text, dates, times, locations) {
  let result = text
  const spans = [...dates, ...times, ...locations]
    .map((item) => ({ start: item.start, end: item.end }))
    .sort((a, b) => b.start - a.start)
  const merged = []
  for (const span of spans) {
    const previous = merged[merged.length - 1]
    if (previous && span.end >= previous.start) {
      previous.start = Math.min(previous.start, span.start)
      previous.end = Math.max(previous.end, span.end)
    } else merged.push(span)
  }
  for (const span of merged) result = result.slice(0, span.start) + ' ' + result.slice(span.end)
  return result
}

function cleanTitle(value, dates, times, locations) {
  const heading = normalizeText(value).split('\n')
    .map((line) => line.replace(/^\s*(?:【通知】|\[通知\]|通知)\s*[:：]?\s*/, '').trim())
    .map((line) => line.match(/^关于\s*(.+?)\s*(?:的)?通知[：:。.!！]?$/))
    .find(Boolean)
  if (heading?.[1]) return heading[1].trim()

  let text = stripRecognizedParts(value, dates, times, locations)
    .replace(/(^|\n)\s*(?:【通知】|\[通知\]|通知)\s*[:：]?/gi, '$1 ')
    .replace(/(^|\n)\s*@?(?:全体成员|所有人|各位同学|同学们|大家)\s*[:：]?/g, '$1 ')
    .replace(/(^|\n)\s*(?:辅导员|班主任|老师)\s*$/gm, '')
    .replace(/(?:请大家|请各位|请|务必|必须|需要|记得|注意)\s*/g, ' ')
    .replace(/(?:发布通知|通知公告)\s*/g, ' ')
    .replace(/(?:提前\s*[零〇一二两三四五六七八九十百\d]+\s*分钟?[^\n，,。；;]*)/g, ' ')
    .replace(/(?:截止|截至|最晚)\s*/g, ' ')
    .replace(/(?:前|之前|以前)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const action = text.match(new RegExp(`(?:^|\\s)((?:${ACTION_WORDS})[^，,。；;\\n]*)`, 'i'))
  if (action) {
    const phrase = action[1].trim()
    const startsTitle = text.indexOf(phrase) === 0
    if (startsTitle && /^(召开|开会|开班会|举行|签到|上课|听)/.test(phrase)) text = phrase.replace(/^(召开|开会|开班会|举行|签到|上课|听)\s*/, '')
    else if (startsTitle && !/^(交|提交|完成|报名|填写|领取|参加|处理|确认|缴费)$/.test(phrase)) text = phrase
  }
  text = text.replace(/截止|截至|最晚/g, ' ').replace(/\s+交$/g, '').replace(/[\n，,。；;]+/g, ' ').replace(/\s+/g, ' ').replace(/(?<=[\p{L}\p{N}])(?:至|到|在|于)(?=\s)/gu, ' ').replace(/(^|\s)(?:至|到|在|于)(?=\s|$)/g, '$1').replace(/^(?:至|到|在|于)\s*/g, '').replace(/^[:：、\s]+|[:：、\s]+$/g, '').replace(/^交(?=[^班级代])/g, '提交')
  return text.slice(0, 80) || '待处理通知'
}

function extractReminder(text) {
  const match = text.match(/提前\s*([零〇一二两三四五六七八九十百\d]+)\s*分钟?[^\n，,。；;]*/)
  return match ? match[0].trim() : ''
}

function noteFrom(text, title, reminder) {
  const lines = normalizeText(text).split('\n')
  const useful = []
  for (const line of lines) {
    if (!line || /^【?通知】?$/.test(line) || /^(辅导员|班主任|老师)$/.test(line)) continue
    if (/^\d{4}\s*[年\/-]\s*\d{1,2}\s*[月\/-]\s*\d{1,2}\s*(?:日|号)?$/.test(line)) continue
    const rest = title && line.includes(title) ? line.replace(title, '') : line
    const cleaned = rest.trim().replace(/^关于\s*的通知[：:。.!！]?$/, '')
    if (cleaned && (!title || cleaned !== line.trim() || reminder)) useful.push(cleaned)
  }
  return useful.join('；').replace(/^；+|；+$/g, '').slice(0, 500)
}

function classifyNotice(text, title) {
  if (/缴费|交费|学费|收费|付款|支付/.test(text)) return '缴费'
  if (/考试|测验|期中|期末|模拟考|模拟考试|四六级|六级|四级/.test(text)) return '考试'
  if (/班会|会议|开会|组会|答辩|面试|讲座|活动|签到|召开|举行/.test(text)) return '会议'
  if (/调课|改到|换到|上课|课程/.test(text)) return '课程'
  if (/作业|实验报告|论文|习题|上交|提交|上传/.test(text)) return '作业'
  if (/截止|截至|最晚|逾期|之前|以前/.test(text)) return '截止'
  if (/(报名|报到|集合|提交|完成|缴费)/.test(text) && /前|日期|时间|今天|明天|后天|本周|下周|\d{1,2}月|\d{1,2}日/.test(text)) return '截止'
  if (/公告|公示|须知|开放时间|安排如下|说明如下|通知如下|信息通知/.test(text)) return '通知'
  return title && title !== '待处理通知' ? '提醒' : '通知'
}

function extractAmount(text) {
  const match = text.match(/(?:金额|费用|收费标准|缴费金额)\s*[:：]?\s*(?:人民币|RMB|¥|￥)?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)?/i) || text.match(/(?:人民币|RMB|¥|￥)\s*(\d+(?:\.\d{1,2})?)/i)
  return match ? `¥${match[1]}` : ''
}

function extractPaymentPlatform(text) {
  const match = text.match(/(?:通过|登录|进入|在)\s*([^，,。；;\n]{1,24}?)(?:缴费|支付|付款)/)
  if (!match) return ''
  const value = match[1].replace(/^(?:手机|线上|网上|统一)\s*/, '').trim()
  return value && !/^(?:本学期|相关|平台已开放)$/.test(value) ? value : ''
}

function extractDateRangeText(text) {
  const range = text.match(/((?:\d{1,2}\s*月)?\s*(?:上旬|中旬|下旬)(?:\s*(?:至|到|[-—~～])\s*(?:\d{1,2}\s*月)?\s*(?:上旬|中旬|下旬)))/)
  if (range) return range[1].replace(/\s+/g, '')
  const relative = text.match(/(?:本周|下周|这周|近期|近日)(?:内|左右)?/)
  return relative ? relative[0] : ''
}

function actionTextFor(type, title, text) {
  const subject = String(title || '').replace(/^(?:参加|完成|提交|上交|上传|缴费|报名|处理)\s*/, '').trim() || '这项通知'
  if (type === '缴费') {
    if (/学费/.test(text)) return '完成本学期学费缴纳'
    if (/住宿费/.test(text)) return '完成住宿费缴纳'
    return '完成本次缴费'
  }
  if (type === '作业') return `提交${subject}`
  if (type === '考试') return `参加${subject}`
  if (type === '会议') return `参加${subject}`
  if (type === '截止' && /报到/.test(text)) {
    const location = text.match(/(?:到|在)\s*([^，,。；;\n]+?)\s*报到/)?.[1]?.trim()
    return location ? `前往${location}报到` : '按通知要求报到'
  }
  if (type === '课程') return '查看课程调整并按新安排上课'
  if (type === '截止') return `完成${subject}`
  if (type === '通知') return '无需操作'
  if (type === '提醒') return /带|携带/.test(text) ? `准备${subject}` : `处理${subject}`
  return subject
}

function summaryFor(text, title) {
  const firstSentence = normalizeText(text).split(/[。！？!?\n]/).map((item) => item.trim()).find(Boolean) || ''
  const summary = firstSentence.replace(title, '').replace(/^[:：、，,\s]+|[:：、，,\s]+$/g, '').trim()
  return (summary || title || '待处理通知').slice(0, 120)
}

function refineTitle(title, type, text) {
  let result = String(title || '').replace(/[.。…]+$/g, '').replace(/\s+/g, ' ').trim()
  if (type === '考试' || type === '会议') result = result.replace(/\s*(?:举行|召开|开会|参加|签到|报到)\s*$/, '').trim()
  if (type === '会议') result = result.replace(/^开(?=班会|会)/, '')
  if (type === '缴费') {
    const firstRelevant = normalizeText(text).split(/[。！？!?\n，,]/).map((item) => item.trim()).find((item) => /学费|缴费|收费/.test(item))
    if (firstRelevant && firstRelevant.length <= 48) result = firstRelevant.replace(/^(?:转发|关于|请大家|请各位)\s*/, '').replace(/(?:通知|请查收)$/, '').trim()
  }
  return result.slice(0, 80) || '待处理通知'
}

function recommendationFor(type) {
  if (type === '会议' || type === '考试') return { key: 'event', label: '加入日程', reason: '这是一个有明确发生时间的事项。' }
  if (type === '作业') return { key: 'homework', label: '添加作业', reason: '保留课程作业语义，并按截止时间管理。' }
  if (type === '课程') return { key: 'note', label: '保存课程通知', reason: '当前先保存调课信息，不直接改动课表。' }
  if (type === '通知') return { key: 'note', label: '仅保存通知', reason: '这条内容没有明确需要你完成的动作。' }
  return { key: 'task', label: '创建待办', reason: '这条内容包含需要完成或处理的动作。' }
}

function extractNoticeItems(text, courses, now) {
  const clauses = normalizeText(text).split(/[\n。！？!?；;]/).flatMap((line) => line.split(/[，,]/)).map((item) => item.trim()).filter(Boolean)
  const actionClauses = clauses.filter((clause) => new RegExp(`(?:${ACTION_WORDS}|报到|带)`).test(clause) && !/缴费平台|缴费工作安排|缴费通知|缴费时间/.test(clause))
  if (actionClauses.length < 2 || actionClauses.length > 5) return []
  const items = actionClauses.map((clause, index) => {
    const item = parseNotice(clause, courses, now, { skipItems: true })
    return {
      id: `notice-item-${index + 1}`,
      title: item.actionText === '无需操作' ? item.title : item.actionText,
      type: item.type,
      dueDate: item.dueDate,
      dueTime: item.dueTime,
      endTime: item.endTime,
      dateRange: item.dateRange,
      dateText: item.dateText,
      location: item.location,
      course: item.course,
      deadline: item.deadline,
      confidence: item.confidence,
      sourceText: clause,
    }
  }).filter((item) => item.title && item.title !== '待处理通知')
  return items.length >= 2 ? items : []
}

export function buildNoticeUnderstanding(parsed) {
  if (!parsed) return null
  const type = parsed.type || '通知'
  const recommendation = recommendationFor(type)
  const facts = []
  const addFact = (key, label, value, kind = 'text') => { if (value) facts.push({ key, label, value, kind }) }
  const dateValue = parsed.dueDate || parsed.dateRange
  if (dateValue) {
    const label = type === '缴费' ? '缴费时间' : type === '截止' || type === '作业' ? '截止' : type === '课程' ? '生效' : '日期'
    addFact('dueDate', label, dateValue, parsed.dueDate ? 'date' : 'text')
  }
  if (parsed.dueTime) addFact('dueTime', type === '缴费' ? '时间' : '时间', parsed.dueTime, 'time')
  if (parsed.endTime) addFact('endTime', '结束', parsed.endTime, 'time')
  if (parsed.location) addFact('location', '地点', parsed.location)
  if (parsed.course && type !== '课程') addFact('course', '课程', parsed.course)
  if (type === '缴费') {
    addFact('amount', '金额', parsed.amount)
    addFact('paymentPlatform', '缴费平台', parsed.paymentPlatform)
  }
  return {
    type,
    actionText: parsed.actionText || actionTextFor(type, parsed.title, parsed.content || parsed.rawText),
    summary: parsed.summary || summaryFor(parsed.content || parsed.rawText, parsed.title),
    facts,
    recommendation,
    hasAction: type !== '通知',
    warnings: [
      ...((parsed.uncertain || parsed.dateCandidates?.some((item) => item.ambiguous)) ? ['部分信息需要确认'] : []),
      ...(!parsed.dueDate && !parsed.dateRange && type !== '通知' && type !== '提醒' ? ['时间未识别'] : []),
      ...((parsed.dateCandidates?.filter((item) => !item.isPublication).length || 0) > 1 ? ['原文包含多个日期'] : []),
    ],
  }
}

function confidenceOf({ title, dates, times, location, type, reminder, uncertain }) {
  let score = title && title !== '待处理通知' ? 0.32 : 0.12
  if (dates.length) score += dates.some((item) => item.value) ? 0.25 : 0.12
  if (times.length) score += 0.16
  if (location) score += 0.1
  if (type !== '通知') score += 0.1
  if (reminder) score += 0.04
  if (dates.some((item) => item.ambiguous)) score -= 0.08
  if (uncertain) score -= 0.2
  const value = Math.min(0.98, Number(score.toFixed(2)))
  return { value, level: value >= 0.78 ? 'high' : value >= 0.5 ? 'medium' : 'low' }
}

function selectTimeCandidate(candidates, text, type) {
  if (!candidates.length) return null
  const scored = candidates.map((candidate, index) => {
    const before = text.slice(Math.max(0, candidate.start - 10), candidate.start)
    const after = text.slice(candidate.end, Math.min(text.length, candidate.end + 12))
    const context = `${before}${after}`
    let score = -index * 0.01
    if (/签到|报到|检录|到场|集合|进场|入场/.test(context)) score -= 2
    if (/开始|正式|举行|召开|开会|上课|活动/.test(after) || /开始时间|正式开始|时间为/.test(before)) score += 2
    if (type === '截止' || type === '作业') {
      if (/截止|截至|最晚|之前|以前|前/.test(context)) score += 2
    }
    if (candidate.ambiguous) score -= 0.2
    return { candidate, score }
  })
  return scored.sort((a, b) => b.score - a.score)[0].candidate
}

function findTimeRange(start, candidates, text) {
  if (!start) return null
  const index = candidates.indexOf(start)
  const end = index >= 0 ? candidates[index + 1] : null
  if (!end) return null
  const between = text.slice(start.end, end.start).trim()
  return /^(?:到|至|[-—~～])$/.test(between) ? end : null
}

function semanticContext(text, candidate) {
  const separators = /[\n，,。；;：:!?！？]/g
  let left = 0
  let right = text.length
  for (const match of text.slice(0, candidate.start).matchAll(separators)) left = match.index + 1
  const rightMatch = text.slice(candidate.end).search(/[\n，,。；;：:!?！？]/)
  if (rightMatch >= 0) right = candidate.end + rightMatch
  const segment = text.slice(left, right).trim()
  return segment.length <= 80 ? segment : text.slice(Math.max(0, candidate.start - 10), Math.min(text.length, candidate.end + 12))
}

function selectDateCandidate(candidates, text, type) {
  if (!candidates.length) return null
  const scored = candidates.map((candidate, index) => {
    const context = semanticContext(text, candidate)
    let score = -index * 0.01
    if (candidate.isPublication) score -= 6
    const afterCandidate = text.slice(candidate.end, candidate.end + 40)
    const signal = afterCandidate.search(/活动|安排|会议|班会|召开|开会|举行|上课|调整|提交|上交|上传|完成|报名|截止|最晚/)
    if (signal >= 0) score += Math.max(0, 0.8 - signal / 40)
    if (type === '会议' || type === '课程') {
      if (/活动|安排|会议|班会|召开|开会|举行|上课/.test(context)) score += 3
      if (candidate.isDeadline) score += 4
      else if (/截止|最晚|之前|以前/.test(context)) score -= 2
    } else if (/截止|最晚|之前|以前|提交|上交|上传|完成|报名/.test(context)) score += 3
    if (candidate.isDeadline && type !== '会议' && type !== '课程') score += 1
    return { candidate, score }
  })
  return scored.sort((a, b) => b.score - a.score)[0].candidate
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

export function parseNotice(source, courses = [], now = new Date(), options = {}) {
  const rawText = String(source ?? '')
  const normalizedText = normalizeText(rawText)
  const dateCandidates = extractDateCandidates(normalizedText, now)
  const eventDates = dateCandidates.filter((item) => !item.isPublication)
  const timeCandidates = extractTimeCandidates(normalizedText)
  const locations = extractLocationCandidates(normalizedText)
  const location = locations[0]?.raw ?? ''
  const reminder = extractReminder(normalizedText)
  // 清理标题时使用全部日期，避免通知落款日期泄漏到标题。
  const rawTitle = cleanTitle(normalizedText, dateCandidates, timeCandidates, locations)
  const type = classifyNotice(normalizedText, rawTitle)
  const title = refineTitle(rawTitle, type, normalizedText)
  const uncertain = /可能|暂定|预计|待定|或许|另行通知/.test(normalizedText)
  const selectedTime = selectTimeCandidate(timeCandidates, normalizedText, type)
  const rangeEnd = findTimeRange(selectedTime, timeCandidates, normalizedText)
  const endTime = rangeEnd?.time ?? ''
  const selectedDate = selectDateCandidate(eventDates.length ? eventDates : dateCandidates, normalizedText, type)
  const confidence = confidenceOf({ title, dates: eventDates.length ? eventDates : dateCandidates, times: timeCandidates, location, type, reminder, uncertain })
  const isDeadline = selectedDate ? /截止|截至|最晚|之前|以前|前/.test(normalizedText.slice(Math.max(0, selectedDate.start - 8), selectedDate.end + 12)) : false
  const dateRange = selectedDate && !selectedDate.value ? selectedDate.raw : selectedDate ? '' : extractDateRangeText(normalizedText)
  const course = (Array.isArray(courses) ? courses : [])
    .map((item) => String(item?.name ?? '').trim())
    .filter(Boolean)
    .filter((name) => normalizedText.includes(name))
    .sort((a, b) => b.length - a.length)[0] ?? ''
  const result = {
    title,
    content: normalizedText,
    type,
    course,
    dueDate: selectedDate?.value ?? '',
    dueTime: selectedTime?.time ?? '',
    startTime: selectedTime?.time ?? '',
    endTime,
    deadline: isDeadline,
    deadlineText: isDeadline ? selectedDate?.raw ?? '' : '',
    dateText: selectedDate?.raw ?? '',
    dateRange,
     dateCandidates: dateCandidates.map((item) => ({ raw: item.raw, value: item.value, kind: item.kind, isPublication: Boolean(item.isPublication), isDeadline: Boolean(item.isDeadline), ambiguous: Boolean(item.ambiguous) })),
    location,
    reminder,
    amount: extractAmount(normalizedText),
    paymentPlatform: extractPaymentPlatform(normalizedText),
    priority: /紧急|务必|必须|逾期|最后|尽快|立即/.test(normalizedText) ? 'high' : 'normal',
    note: noteFrom(normalizedText, title, reminder),
    actionText: actionTextFor(type, title, normalizedText),
    summary: summaryFor(normalizedText, title),
     confidence: confidence.value,
     confidenceLevel: confidence.level,
     uncertain,
    // rawText 永远保存用户输入；sourceText 保留给旧任务和旧匹配逻辑。
    rawText,
    normalizedText,
    sourceText: rawText,
  }
  if (!options.skipItems) result.items = extractNoticeItems(normalizedText, courses, now)
  return result
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
