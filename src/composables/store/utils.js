const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export function todayIndex() {
  const d = new Date().getDay()
  return d === 0 ? 6 : d - 1
}

export function dayName(i) {
  return DAY_NAMES[i] ?? ''
}

export function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${week}`
}

export function daysUntil(dateStr) {
  const target = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((target - now) / 86400000)
}

export function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function dateString(date) {
  const p = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

export { dateString }

export const MAX_WEEK = 25

export const PALETTE = [
  '#456fe8',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
]

const DEFAULT_PERIOD_LABELS = [
  '早自习',
  '第一节课',
  '第二节课',
  '第三节课',
  '第四节课',
  '第五节课',
  '第六节课',
  '第七节课',
  '第八节课',
  '第九节课',
  '第十节课',
  '第十一节课',
  '第十二节课',
]

const T = (...pairs) => pairs.map(([start, end]) => ({ start, end }))

export const DEFAULT_TIMES = {
  summer: {
    south: T(
      ['07:20', '07:50'],
      ['08:00', '08:45'],
      ['08:55', '09:40'],
      ['10:05', '10:50'],
      ['11:00', '11:45'],
      ['14:30', '15:15'],
      ['15:20', '16:05'],
      ['16:20', '17:05'],
      ['17:10', '17:55'],
      ['19:00', '19:45'],
      ['19:50', '20:35'],
      ['20:40', '21:25'],
      ['21:30', '22:15']
    ),
    north: T(
      ['07:30', '08:00'],
      ['08:10', '08:55'],
      ['09:05', '09:50'],
      ['10:05', '10:50'],
      ['11:00', '11:45'],
      ['14:30', '15:15'],
      ['15:20', '16:05'],
      ['16:15', '17:00'],
      ['17:05', '17:50'],
      ['19:00', '19:45'],
      ['19:50', '20:35'],
      ['20:40', '21:25'],
      ['21:30', '22:15']
    ),
  },
  winter: {
    south: T(
      ['07:20', '07:50'],
      ['08:00', '08:45'],
      ['08:55', '09:40'],
      ['10:05', '10:50'],
      ['11:00', '11:45'],
      ['14:00', '14:45'],
      ['14:50', '15:35'],
      ['15:50', '16:35'],
      ['16:40', '17:25'],
      ['19:00', '19:45'],
      ['19:50', '20:35'],
      ['20:40', '21:25'],
      ['21:30', '22:15']
    ),
    north: T(
      ['07:30', '08:00'],
      ['08:10', '08:55'],
      ['09:05', '09:50'],
      ['10:05', '10:50'],
      ['11:00', '11:45'],
      ['14:00', '14:45'],
      ['14:50', '15:35'],
      ['15:45', '16:30'],
      ['16:35', '17:20'],
      ['19:00', '19:45'],
      ['19:50', '20:35'],
      ['20:40', '21:25'],
      ['21:30', '22:15']
    ),
  },
}

export const FALLBACK_TIME = { start: '08:00', end: '08:45' }
export { DEFAULT_PERIOD_LABELS }