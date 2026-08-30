import { parseNotice } from '../noticeParser.js'

// 实体提取层：把自然语言拆成金额、日期、时间、课程、账户、周期等可复用实体。
// 这里只做“发现和计算”，不判断最终记录类型，也不依赖 Vue / 存储层。

const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function cnDigit(ch) {
  if (typeof ch !== 'string') return 0
  if (/^[0-9]$/.test(ch)) return Number(ch)
  return CN_DIGITS[ch] ?? 0
}

// 中文数字转数值：支持 零/十/百、类似“十二”“二十一”“一百二十”。
export function chineseNumber(value) {
  const text = String(value ?? '').trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text)
  if (!/^[零〇一二两三四五六七八九十百]+$/.test(text)) return 0
  let section = 0
  let number = 0
  for (const ch of text) {
    const digit = CN_DIGITS[ch]
    if (digit !== undefined) {
      number = digit
    } else if (ch === '十') {
      section += (number || 1) * 10
      number = 0
    } else if (ch === '百') {
      section += (number || 1) * 100
      number = 0
    }
  }
  return section + number || 0
}

// 从文本中提取所有金额实体（范围 + 数值 + 原串）。
// 支持：“18”“18块”“18元”“18块钱”“12块5”“五元”“五块钱”“¥12”等。
// 不把“牛肉面五”“12月5日”这类缺乏明确货币单位/位置的数字误判为金额。
export function extractAmounts(text) {
  const source = String(text ?? '')
  const candidates = []

  function addFromMatch(match, amount, raw) {
    if (!match && match !== 0) return
    const start = typeof match.index === 'number' ? match.index : 0
    const end = start + String(raw ?? match[0]).length
    if (!(end > start) || !(amount > 0)) return
    candidates.push({ start, end, amount, raw: String(raw ?? match[0]) })
  }

  // 1) ¥/￥ 开头：¥12、￥12.5
  for (const match of source.matchAll(/(?:¥|￥)\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块钱|块|rmb|RMB)?/gi)) {
    addFromMatch(match, Number(match[1]), match[0])
  }

  // 2) 阿拉伯数字 + 块/块X：12块、12块5、12.5块
  for (const match of source.matchAll(/(\d+(?:\.\d{1,2})?)\s*块\s*([零〇一二两三四五六七八九\d])?/gi)) {
    const first = Number(match[1])
    if (!Number.isFinite(first)) continue
    const amount = match[2] ? first + cnDigit(match[2]) / 10 : first
    addFromMatch(match, amount, match[0])
  }

  // 3) 阿拉伯数字 + 元/块钱/rmb
  for (const match of source.matchAll(/(\d+(?:\.\d{1,2})?)\s*(?:元|块钱|rmb|RMB)/gi)) {
    addFromMatch(match, Number(match[1]), match[0])
  }

  // 4) 中文数字 + 块/块X：五块、五块五、十二块、十二块五
  for (const match of source.matchAll(/([零〇一二两三四五六七八九十百]+)\s*块\s*([零〇一二两三四五六七八九\d])?/gi)) {
    const first = chineseNumber(match[1])
    if (!(first > 0)) continue
    const amount = match[2] ? first + cnDigit(match[2]) / 10 : first
    addFromMatch(match, amount, match[0])
  }

  // 5) 中文数字 + 元/块钱/rmb
  for (const match of source.matchAll(/([零〇一二两三四五六七八九十百]+)\s*(?:元|块钱|rmb|RMB)/gi)) {
    const amount = chineseNumber(match[1])
    addFromMatch(match, amount, match[0])
  }

  // 6) 句子末尾的裸阿拉伯数字作为金额，例如“午饭 18”。
  const tail = source.match(/(?:^|[^\d])(\d+(?:\.\d{1,2})?)\s*$/)
  if (tail) {
    const start = source.lastIndexOf(tail[1])
    if (start >= 0) {
      const end = start + tail[1].length
      candidates.push({ start, end, amount: Number(tail[1]), raw: tail[1] })
    }
  }

  // 7) 其他位置的裸阿拉伯数字，例如“生活费到账500微信”，但跳过日期/时间上下文中的数字。
  for (const match of source.matchAll(/(?:¥|￥)?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块|rmb)?/gi)) {
    const next = source.slice(match.index + match[0].length, match.index + match[0].length + 1)
    if (/^[年月日号点时]/.test(next)) continue
    const amount = Number(match[1])
    addFromMatch(match, amount, match[0])
  }

  // 同一 start 保留原文更长/更像金额的匹配；不同 start 去掉重叠，避免“12块”和“12块钱”重复算两次。
  const byStart = new Map()
  for (const item of candidates) {
    const previous = byStart.get(item.start)
    if (!previous || item.end - item.start > previous.end - previous.start) byStart.set(item.start, item)
  }
  const result = [...byStart.values()].sort((a, b) => a.start - b.start)
  const dedup = []
  for (const item of result) {
    const last = dedup[dedup.length - 1]
    if (last && item.start < last.end) continue
    dedup.push(item)
  }
  return dedup
}

// 金额“像但不完整”时返回 true，例如“牛肉面五”、“今天花了”且末尾有数字。
export function hasAmbiguousAmount(text) {
  const source = String(text ?? '').trim()
  if (!source) return false
  if (extractAmounts(source).length) return false
  return /[0-9]+$/.test(source) || /[零〇一二两三四五六七八九十百]+$/.test(source)
}

// 日期/时间/课程/优先级等，复用 noticeParser 已比较成熟的时间解析能力。
export function extractSchedule(text, courses = [], now = new Date()) {
  const parsed = parseNotice(text, courses, now)
  return {
    title: parsed.title,
    date: parsed.dueDate,
    time: parsed.dueTime,
    course: parsed.course,
    priority: parsed.priority,
    note: parsed.note,
  }
}

export function extractAccount(text) {
  const source = String(text ?? '')
  const match = source.match(/微信|支付宝|现金|银行卡|校园卡|信用卡|Apple Pay|PayPal/gi)
  return match?.[0] ?? ''
}

// 周期实体：每周 / 每月 / 每季度 / 每年 / 每隔N天。
export function extractCycle(text) {
  const source = String(text ?? '')
  const every = source.match(/每\s*(周|星期|礼拜|月|季度|季|年)|每隔?\s*(\d{1,3})\s*天/)
  if (!every) return null
  if (every[2]) return { cycle: 'days', day: Number(every[2]) }
  const token = every[1]
  const cycle = /周|星期|礼拜/.test(token) ? 'weekly'
    : token === '月' ? 'monthly'
      : /季度|季/.test(token) ? 'quarterly'
        : 'yearly'
  let day = null
  if (cycle === 'monthly') {
    const hit = source.match(/每月\s*(\d{1,2})/)
    if (hit) day = Number(hit[1])
  }
  return { cycle, day }
}

// 支出标题：先按实体位置移除金额/账户/日期时间前缀，再清理行为动词和活用词。
// 目标：“买了牛肉面/花了五元买牛肉面/五块钱买了牛肉面 -> 牛肉面”。
export function buildExpenseTitle(source, amounts = [], account = '') {
  let text = String(source ?? '')
  const sorted = [...amounts].sort((a, b) => b.start - a.start)
  for (const item of sorted) {
    text = text.slice(0, item.start) + text.slice(item.end)
  }
  if (account) text = text.split(account).join(' ')
  text = text
    .replace(/^[\s，,。；;：:]+|[\s，,。；;：:]+$/g, '')
    // 时间/出行前缀
    .replace(/^(今天|今日|昨天|昨晚|前天|大前天|刚才|刚刚|早上|上午|中午|下午|晚上|夜里|凌晨|坐|乘坐|乘|搭乘)+/g, '')
    // 尾部消费动作词（含单字“花”，例：吃饭花18元 → 吃饭）
    .replace(/(花了|花费|支付了|付了|用了|消费了|购买了?|买了?|去吃了?|吃了?|花)\s*$/g, '')
    .replace(/^[\s，,。；;：:]+|[\s，,。；;：:]+$/g, '')
  // 开头动作词（我/我们 + 花/买/吃/付/用/支付），长词优先，避免“花”先截断“花了”
  // 单字动词留给下面“剥一层”判断，避免“吃饭”被误剥成“饭”。
  text = text
    .replace(/^(我|我们|我这边)*\s*(花了|花费|支付了|付了|用了|消费了|去吃了|购买|购入|买了|吃了|支付|消费|付|用|去)/g, '')
    .replace(/^[\s，,。；;：:]+|[\s，,。；;：:]+$/g, '')
  // 若清理后仍以单字动作词开头，且剥掉后是≥2字的有效对象，再剥一层。
  // 保留“买东西”“吃饭”这类由动作词和二字对象构成的整体表述。
  if (/^(去|吃|买|花|付|用)/.test(text) && text.length > 1) {
    const stripped = text.replace(/^(去吃了|吃了|买了|购买|购入|支付|用了|买|吃|去|付|花|用)/, '').replace(/^[\s，,。；;：:]+|[\s，,。；;：:]+$/g, '')
    if (stripped.length >= 2 && !/^(东西|什么|啥|这里|这个|那个)$/.test(stripped)) text = stripped
  }
  // 边界词
  text = text
    .replace(/^[的了]+|[的了]+$/g, '')
    .replace(/^[\s，,。；;：:]+|[\s，,。；;：:]+$/g, '')
  return text.slice(0, 40) || '未命名账目'
}