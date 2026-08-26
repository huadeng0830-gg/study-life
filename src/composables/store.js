import { effectScope, ref, watch } from 'vue'
import { mirrorLocalValue } from './dataVault.js'

// 同一个存储键在整个应用中只创建一个响应式引用。
// 之前每个页面都会创建自己的 ref，导致课程、待办等修改后，
// 已挂载的其他组件仍持有旧数据。
const storedRefs = new Map()

// 全局共享的时钟引用，每 30 秒更新一次，
// 让"正在上课 / 下一节课 / 倒计时"等状态在页面挂机时也能自动刷新。
// 页面转入后台时暂停，回到前台立即校准一次。
export const clock = ref(new Date())

const CLOCK_INTERVAL = 30000
let clockTimer = null

function startClock() {
  clearInterval(clockTimer)
  clockTimer = setInterval(() => {
    clock.value = new Date()
  }, CLOCK_INTERVAL)
}

startClock()

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearInterval(clockTimer)
      clockTimer = null
    } else {
      clock.value = new Date()
      startClock()
    }
  })
}

// 写入合并：300ms 内的连续修改只落盘一次（输入时不再逐字符写存储），
// 页面隐藏或关闭前强制冲刷，避免丢数据。
const WRITE_DELAY = 300
const pendingWrites = new Map()
const writeTimers = new Map()

function writeNow(key, makeRaw) {
  try {
    const raw = makeRaw()
    localStorage.setItem(key, raw)
    void mirrorLocalValue(key, raw)
  } catch {
    // 浏览器禁用或存储空间不足时，仍保留当前会话内的数据。
  }
}

function scheduleWrite(key, makeRaw) {
  pendingWrites.set(key, makeRaw)
  const previous = writeTimers.get(key)
  if (previous) clearTimeout(previous)
  writeTimers.set(
    key,
    setTimeout(() => {
      writeTimers.delete(key)
      const producer = pendingWrites.get(key)
      if (!producer) return
      pendingWrites.delete(key)
      writeNow(key, producer)
    }, WRITE_DELAY)
  )
}

function flushAllWrites() {
  for (const timer of writeTimers.values()) clearTimeout(timer)
  writeTimers.clear()
  for (const [key, producer] of pendingWrites) writeNow(key, producer)
  pendingWrites.clear()
}

// 其他标签页写入了新值时，取消本地排队中的旧值回写，避免旧数据覆盖新数据。
function cancelPendingWrite(key) {
  const timer = writeTimers.get(key)
  if (timer) {
    clearTimeout(timer)
    writeTimers.delete(key)
  }
  pendingWrites.delete(key)
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAllWrites()
  })
  window.addEventListener('pagehide', flushAllWrites)
}

// useStoredRef 可能在任意组件的 setup 中首次调用；若直接 watch，
// 监听器会绑定到那个组件的作用域，组件卸载后监听器随之销毁，
// 导致后续所有修改都不再落盘。统一挂到永不停止的模块级作用域上。
const persistenceScope = effectScope()

export function useStoredRef(key, defaultValue) {
  if (storedRefs.has(key)) return storedRefs.get(key)

  let saved = null
  try {
    saved = JSON.parse(localStorage.getItem(key))
  } catch {
    saved = null
  }
  const state = ref(saved ?? JSON.parse(JSON.stringify(defaultValue)))
  storedRefs.set(key, state)
  persistenceScope.run(() => {
    watch(
      state,
      () => {
        scheduleWrite(key, () => JSON.stringify(state.value))
      },
      { deep: true }
    )
  })
  return state
}

// 同一站点的其他标签页修改数据时，立即更新当前标签页。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!event.key || !storedRefs.has(event.key) || event.newValue === null) return
    cancelPendingWrite(event.key)
    try {
      storedRefs.get(event.key).value = JSON.parse(event.newValue)
    } catch {
      // 忽略无效的外部存储内容，保留当前可用数据。
    }
  })
}

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

function localDate(year, month, day, time = '') {
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, lastDay), hour, minute, 0, 0)
}

function dayStart(date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function countdownTarget(item, now = new Date()) {
  const [year, month, day] = String(item.date ?? '').split('-').map(Number)
  if (!year || !month || !day) return null
  const hasTime = Boolean(item.time)
  let target = localDate(year, month - 1, day, item.time)

  if (item.repeat === 'yearly') {
    target = localDate(now.getFullYear(), month - 1, day, item.time)
    const passed = hasTime
      ? target.getTime() < now.getTime()
      : dayStart(target).getTime() < dayStart(now).getTime()
    if (passed) target = localDate(now.getFullYear() + 1, month - 1, day, item.time)
  }
  return target
}

export function countdownState(item, now = new Date()) {
  const target = countdownTarget(item, now)
  if (!target) {
    return { text: '无日期', label: '', cls: 'past', isPast: true, target: null, sortValue: Infinity }
  }

  const hasTime = Boolean(item.time)
  if (!hasTime) {
    const days = Math.round((dayStart(target) - dayStart(now)) / 86400000)
    if (days > 0) {
      return { text: String(days), label: '天', cls: '', isPast: false, target, sortValue: target.getTime(), days }
    }
    if (days === 0) {
      return { text: '今天', label: '就是今天', cls: 'hot', isPast: false, target, sortValue: target.getTime(), days: 0 }
    }
    return { text: '已结束', label: `${-days} 天前`, cls: 'past', isPast: true, target, sortValue: target.getTime(), days }
  }

  const diff = target.getTime() - now.getTime()
  if (diff < 0) {
    const hoursAgo = Math.max(1, Math.ceil(-diff / 3600000))
    const label = hoursAgo < 24 ? `${hoursAgo} 小时前` : `${Math.ceil(hoursAgo / 24)} 天前`
    return { text: '已结束', label, cls: 'past', isPast: true, target, sortValue: target.getTime(), days: -1 }
  }

  const minutes = Math.max(1, Math.ceil(diff / 60000))
  if (minutes < 60) {
    return { text: String(minutes), label: '分钟', cls: 'hot', isPast: false, target, sortValue: target.getTime(), days: 0 }
  }
  const hours = Math.ceil(diff / 3600000)
  if (hours < 24) {
    return { text: String(hours), label: '小时', cls: 'hot', isPast: false, target, sortValue: target.getTime(), days: 0 }
  }
  const days = Math.ceil(diff / 86400000)
  return { text: String(days), label: '天', cls: '', isPast: false, target, sortValue: target.getTime(), days }
}

export function fmtCountdownDate(item, target = countdownTarget(item)) {
  if (!target) return ''
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][target.getDay()]
  const date = `${target.getFullYear()}年${target.getMonth() + 1}月${target.getDate()}日 ${week}`
  return item.time ? `${date} ${item.time}` : date
}

// 置顶优先，其次未结束在前，最后按目标时间升序。首页与倒计时页共用。
export function sortCountdowns(items, now = new Date()) {
  return items
    .map((item) => ({ ...item, countdown: countdownState(item, now) }))
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
      if (a.countdown.isPast !== b.countdown.isPast) return a.countdown.isPast ? 1 : -1
      return a.countdown.sortValue - b.countdown.sortValue
    })
}

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

// ---------- 作息配置：校区 / 作息季 / 节次 全部可自定义 ----------

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

// 默认作息（仅作为"恢复默认"的模板，键名与默认校区/季节 id 对应）
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

const FALLBACK_TIME = { start: '08:00', end: '08:45' }

function defaultTimeConfig() {
  return {
    campuses: [
      { id: 'south', name: '南校区' },
      { id: 'north', name: '北校区' },
    ],
    seasons: [
      { id: 'summer', name: '夏季时间', startDate: '05-01' },
      { id: 'winter', name: '冬季时间', startDate: '10-01' },
    ],
    currentCampus: 'south',
    currentSeason: 'summer',
    autoSeason: true,
    periods: DEFAULT_PERIOD_LABELS.map((label, index) => ({ id: 'p' + index, label })),
    times: JSON.parse(JSON.stringify(DEFAULT_TIMES)),
  }
}

function migrateTimeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  // 已是新结构
  if (Array.isArray(raw.campuses) && Array.isArray(raw.periods)) {
    const base = defaultTimeConfig()
    return { ...base, ...raw }
  }
  // 旧结构 { campus, season, times } → 新结构
  const base = defaultTimeConfig()
  return {
    ...base,
    currentCampus: raw.campus ?? base.currentCampus,
    currentSeason: raw.season ?? base.currentSeason,
    autoSeason: true,
    times: raw.times ?? base.times,
  }
}

function loadTimeConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('sl_timecfg'))
    const migrated = migrateTimeConfig(saved)
    if (migrated) return migrated
  } catch {
    // 解析失败则使用默认配置
  }
  return defaultTimeConfig()
}

// 保证每个 季×校区 的时间数组与节次数量对齐，并统一补零为 HH:MM
export function normalizeTimes(cfg) {
  const pad = (value) => {
    const [h = '0', m = '00'] = String(value ?? '').split(':')
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  cfg.times = cfg.times ?? {}
  for (const season of cfg.seasons) {
    cfg.times[season.id] = cfg.times[season.id] ?? {}
    for (const campus of cfg.campuses) {
      const list = Array.isArray(cfg.times[season.id][campus.id])
        ? cfg.times[season.id][campus.id]
        : []
      const fixed = cfg.periods.map((_, i) => {
        const source = list[i] ?? { ...FALLBACK_TIME }
        return { start: pad(source.start), end: pad(source.end) }
      })
      cfg.times[season.id][campus.id] = fixed
    }
  }
}

export const timeConfig = ref(loadTimeConfig())
normalizeTimes(timeConfig.value)
watch(
  timeConfig,
  () => {
    scheduleWrite('sl_timecfg', () => JSON.stringify(timeConfig.value))
  },
  { deep: true }
)

// ---------- 一次性迁移：课程节次从数字索引改为节次 ID ----------
;(function migrateCoursePeriodIds() {
  const migrateList = (list) =>
    list.map((c) =>
      c && typeof c.start === 'number'
        ? { ...c, start: 'p' + c.start, end: 'p' + c.end }
        : c
    )
  try {
    const raw = localStorage.getItem('sl_courses')
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list) && list.some((c) => c && typeof c.start === 'number')) {
        localStorage.setItem('sl_courses', JSON.stringify(migrateList(list)))
      }
    }
  } catch {}
  try {
    const raw = localStorage.getItem('sl_course_templates')
    if (raw) {
      const templates = JSON.parse(raw)
      if (Array.isArray(templates) && templates.some((t) => t?.courses?.some((c) => typeof c.start === 'number'))) {
        localStorage.setItem(
          'sl_course_templates',
          JSON.stringify(templates.map((t) => ({ ...t, courses: migrateList(t.courses ?? []) })))
        )
      }
    }
  } catch {}
})()

// ---------- 校区 ----------
export function campusName(id) {
  const campus = timeConfig.value.campuses.find((c) => c.id === id)
  return campus?.name ?? ''
}

export function addCampus(name) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return false
  const id = 'campus' + Date.now()
  const template = timeConfig.value.campuses[0]?.id
  timeConfig.value.campuses.push({ id, name: trimmed })
  for (const season of timeConfig.value.seasons) {
    const source = timeConfig.value.times[season.id]?.[template]
    timeConfig.value.times[season.id][id] = source
      ? JSON.parse(JSON.stringify(source))
      : timeConfig.value.periods.map(() => ({ ...FALLBACK_TIME }))
  }
  return true
}

export function renameCampus(id, name) {
  const campus = timeConfig.value.campuses.find((c) => c.id === id)
  if (campus && name.trim()) campus.name = name.trim()
}

export function removeCampus(id) {
  const cfg = timeConfig.value
  if (cfg.campuses.length <= 1) return false
  cfg.campuses = cfg.campuses.filter((c) => c.id !== id)
  for (const season of cfg.seasons) {
    delete cfg.times[season.id]?.[id]
  }
  if (cfg.currentCampus === id) cfg.currentCampus = cfg.campuses[0].id
  return true
}

// ---------- 作息季 ----------
export function seasonName(id) {
  const season = timeConfig.value.seasons.find((s) => s.id === id)
  return season?.name ?? ''
}

export function addSeason(name, startDate) {
  const trimmed = (name ?? '').trim()
  const date = /^\d{2}-\d{2}$/.test(startDate ?? '') ? startDate : '03-01'
  if (!trimmed) return false
  const id = 'season' + Date.now()
  const template = timeConfig.value.seasons[0]?.id
  timeConfig.value.seasons.push({ id, name: trimmed, startDate: date })
  timeConfig.value.times[id] = {}
  for (const campus of timeConfig.value.campuses) {
    const source = timeConfig.value.times[template]?.[campus.id]
    timeConfig.value.times[id][campus.id] = source
      ? JSON.parse(JSON.stringify(source))
      : timeConfig.value.periods.map(() => ({ ...FALLBACK_TIME }))
  }
  return true
}

export function renameSeason(id, name, startDate) {
  const season = timeConfig.value.seasons.find((s) => s.id === id)
  if (!season) return
  if (name.trim()) season.name = name.trim()
  if (/^\d{2}-\d{2}$/.test(startDate ?? '')) season.startDate = startDate
}

export function removeSeason(id) {
  const cfg = timeConfig.value
  if (cfg.seasons.length <= 1) return false
  cfg.seasons = cfg.seasons.filter((s) => s.id !== id)
  delete cfg.times[id]
  if (cfg.currentSeason === id) cfg.currentSeason = cfg.seasons[0].id
  return true
}

// ---------- 节次 ----------
export function addPeriod(label) {
  const trimmed = (label ?? '').trim()
  if (!trimmed) return false
  const id = 'p' + Date.now()
  timeConfig.value.periods.push({ id, label: trimmed })
  normalizeTimes(timeConfig.value)
  return true
}

export function renamePeriod(id, label) {
  const period = timeConfig.value.periods.find((p) => p.id === id)
  if (period && label.trim()) period.label = label.trim()
}

export function removePeriod(id, isUsedChecker) {
  const cfg = timeConfig.value
  if (cfg.periods.length <= 1) return '至少保留一个节次'
  if (isUsedChecker?.(id)) return '有课程正在使用这个节次，无法删除'
  const index = cfg.periods.findIndex((p) => p.id === id)
  if (index < 0) return '未找到该节次'
  cfg.periods.splice(index, 1)
  for (const season of cfg.seasons) {
    for (const campus of cfg.campuses) {
      cfg.times[season.id]?.[campus.id]?.splice(index, 1)
    }
  }
  return true
}

export function resetTimesToDefault() {
  const cfg = timeConfig.value
  const times = {}
  for (const season of cfg.seasons) {
    times[season.id] = {}
    for (const campus of cfg.campuses) {
      times[season.id][campus.id] = cfg.periods.map((_, i) => {
        const preset =
          DEFAULT_TIMES[season.id]?.[campus.id]?.[i] ??
          (cfg.seasons.length === 1 && cfg.campuses.length === 1
            ? DEFAULT_TIMES.summer.south[i]
            : null)
        return preset ? { ...preset } : { ...FALLBACK_TIME }
      })
    }
  }
  cfg.times = times
}

// ---------- 当前生效的校区 / 季节 ----------
export function currentCampusId() {
  const cfg = timeConfig.value
  const found = cfg.campuses.find((c) => c.id === cfg.currentCampus)
  return found?.id ?? cfg.campuses[0]?.id ?? null
}

export function autoSeasonId() {
  const seasons = [...timeConfig.value.seasons].sort((a, b) =>
    String(a.startDate).localeCompare(String(b.startDate))
  )
  if (!seasons.length) return null
  const today = todayStr().slice(5) // MM-DD
  let current = seasons[seasons.length - 1].id // 早于最早起始日时，取最后一个（跨年）
  for (const season of seasons) {
    if (season.startDate <= today) current = season.id
  }
  return current
}

export function currentSeasonId() {
  const cfg = timeConfig.value
  if (!cfg.autoSeason) {
    const found = cfg.seasons.find((s) => s.id === cfg.currentSeason)
    if (found) return found.id
  }
  return autoSeasonId()
}

export function currentTimes() {
  const cfg = timeConfig.value
  return cfg.times?.[currentSeasonId()]?.[currentCampusId()] ?? []
}

// ---------- 节次工具（基于动态 periods） ----------
export function periodIndex(id) {
  return timeConfig.value.periods.findIndex((p) => p.id === id)
}

export function periodLabelById(id) {
  return timeConfig.value.periods.find((p) => p.id === id)?.label ?? '未知节次'
}

export function periodRangeById(id) {
  const t = currentTimes()[periodIndex(id)]
  return t ? `${t.start}-${t.end}` : ''
}

export function courseTimeRange(c) {
  const ts = currentTimes()
  const si = periodIndex(c.start)
  const ei = periodIndex(c.end)
  if (si < 0 || ei < 0 || !ts[si] || !ts[ei]) return ''
  return `${ts[si].start} - ${ts[ei].end}`
}

// ---------- 学期 / 周次 ----------
export const MAX_WEEK = 25

export function todayStr() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function mondayOfThisWeek() {
  const d = new Date()
  d.setDate(d.getDate() - todayIndex())
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const semester = useStoredRef('sl_semester', {
  start: mondayOfThisWeek(),
})

export function weekOf(dateStr) {
  const start = new Date(semester.value.start + 'T00:00:00')
  const d = new Date(dateStr + 'T00:00:00')
  return Math.floor((d - start) / (7 * 86400000)) + 1
}

export function currentWeek() {
  return weekOf(todayStr())
}

export function courseInWeek(c, week) {
  const sw = c.startWeek ?? 1
  const ew = c.endWeek ?? MAX_WEEK
  if (week < sw || week > ew) return false
  const t = c.weekType ?? 'all'
  if (t === 'odd') return week % 2 === 1
  if (t === 'even') return week % 2 === 0
  return true
}

export function weekLabel(c) {
  const sw = c.startWeek ?? 1
  const ew = c.endWeek ?? MAX_WEEK
  let base = sw === ew ? `${sw}周` : sw === 1 && ew === MAX_WEEK ? '全学期' : `${sw}-${ew}周`
  const t = c.weekType ?? 'all'
  if (t === 'odd') base += ' 单'
  if (t === 'even') base += ' 双'
  return base
}
