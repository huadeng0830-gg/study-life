// @deprecated 快速录入引擎（旧版）：仅保留给旧 QuickCapturePanel 和旧测试使用。
// 新业务请使用 quickRecord/parser.js：那边的 parseQuickRecord 采用实体提取+意图判断，
// 支持“花了五元买牛肉面”等语序变化和“12块5”等口语金额。
import { parseNotice } from './noticeParser.js'
import { parseNatural, detectCategory } from './ledger.js'

const COUNTDOWN_HINTS = [
  '考试', '放假', '假期', '元旦', '春节', '元宵', '清明', '端午', '中秋', '国庆', '圣诞',
  '生日', '纪念日', '周年', '发售', '演唱会', '比赛', '演出', '开学', '毕业', '上映', '开票', '倒计时',
]

function looksLikeCountdown(text) {
  return COUNTDOWN_HINTS.some((hint) => text.includes(hint))
}

function timeNow(now) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function capture(text, { courses = [], now = new Date() } = {}) {
  const source = String(text ?? '').trim()
  if (!source) {
    return {
      kind: 'task',
      draft: { title: '', course: '', dueDate: '', dueTime: '', priority: 'normal', note: '', sourceText: '' },
    }
  }

  const natural = parseNatural(source)
  if (natural.amount) {
    const name = (natural.name || source).trim()
    return {
      kind: 'expense',
      draft: {
        name,
        amount: natural.amount,
        cat: detectCategory(name),
        sourceText: source,
      },
    }
  }

  const parsed = parseNotice(source, courses, now)
  const taskDraft = {
    title: parsed.title,
    course: parsed.course,
    dueDate: parsed.dueDate,
    dueTime: parsed.dueTime,
    priority: parsed.priority,
    note: parsed.note,
    sourceText: source,
  }

  if (parsed.dueDate && looksLikeCountdown(source)) {
    return {
      kind: 'countdown',
      draft: {
        name: parsed.title,
        date: parsed.dueDate,
        time: parsed.dueTime,
        category: '其他',
        repeat: 'none',
        pinned: false,
        sourceText: source,
      },
    }
  }

  return { kind: 'task', draft: taskDraft }
}

// 供保存层直接取默认日期/时间，避免多处重复拼装。
export function quickCaptureNow(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: timeNow(now),
  }
}
