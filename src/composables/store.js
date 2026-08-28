import { effectScope, ref, watch } from 'vue'
import { markLocalChanged } from './cloudSync.js'
import { mirrorLocalValue, mirrorLocalValues } from './dataVault.js'

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

// 统一写入队列：300ms 内所有数据键的连续修改合并成一批，浏览器空闲时
// 一次性写入本地存储和镜像备份。页面隐藏或关闭前仍同步冲刷，避免丢数据。
const WRITE_DELAY = 300
const pendingWrites = new Map()
let writeTimer = null
let idleWrite = null

function writeNow(key, makeRaw) {
  try {
    const raw = makeRaw()
    localStorage.setItem(key, raw)
    void mirrorLocalValue(key, raw)
    markLocalChanged(key)
  } catch {
    // 浏览器禁用或存储空间不足时，仍保留当前会话内的数据。
  }
}

function cancelScheduledBatch() {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (idleWrite !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(idleWrite)
  }
  idleWrite = null
}

function writePendingBatch() {
  cancelScheduledBatch()
  const batch = [...pendingWrites.entries()]
  pendingWrites.clear()
  for (const [key, producer] of batch) writeNow(key, producer)
}

function scheduleWrite(key, makeRaw) {
  pendingWrites.set(key, makeRaw)
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleWrite = window.requestIdleCallback(writePendingBatch, { timeout: 700 })
    } else {
      writePendingBatch()
    }
  }, WRITE_DELAY)
}

function flushAllWrites() {
  if (pendingWrites.size) writePendingBatch()
  else cancelScheduledBatch()
}

// 其他标签页写入了新值时，取消本地排队中的旧值回写，避免旧数据覆盖新数据。
function cancelPendingWrite(key) {
  pendingWrites.delete(key)
  if (!pendingWrites.size) cancelScheduledBatch()
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeStoredValue(saved, defaultValue) {
  if (Array.isArray(defaultValue)) {
    if (Array.isArray(saved)) return { value: saved, repaired: false }
    if (isPlainObject(saved)) {
      const numericEntries = Object.entries(saved)
        .filter(([entryKey]) => /^\d+$/.test(entryKey))
        .sort(([a], [b]) => Number(a) - Number(b))
      if (numericEntries.length) return { value: numericEntries.map(([, value]) => value), repaired: true }
    }
    return { value: JSON.parse(JSON.stringify(defaultValue)), repaired: true }
  }
  if (isPlainObject(defaultValue)) {
    if (!isPlainObject(saved)) {
      return { value: JSON.parse(JSON.stringify(defaultValue)), repaired: true }
    }
    const value = { ...JSON.parse(JSON.stringify(defaultValue)), ...saved }
    return { value, repaired: JSON.stringify(value) !== JSON.stringify(saved) }
  }
  return typeof saved === typeof defaultValue
    ? { value: saved, repaired: false }
    : { value: JSON.parse(JSON.stringify(defaultValue)), repaired: true }
}

export function useStoredRef(key, defaultValue) {
  if (storedRefs.has(key)) return storedRefs.get(key)

  let saved = null
  try {
    saved = JSON.parse(localStorage.getItem(key))
  } catch {
    saved = null
  }
  const normalized = saved === null
    ? { value: JSON.parse(JSON.stringify(defaultValue)), repaired: false }
    : normalizeStoredValue(saved, defaultValue)
  const state = ref(normalized.value)
  if (normalized.repaired) {
    try {
      const raw = JSON.stringify(normalized.value)
      localStorage.setItem(key, raw)
      void mirrorLocalValue(key, raw)
    } catch {
      // 无法落盘时仍使用修复后的内存值，确保页面能够打开。
    }
  }
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

// 备份恢复统一从这里进入：先完成 localStorage 写入，再同步已创建的响应式引用，
// 最后用一个 IndexedDB 事务更新影子副本，并把本机标记为待同步。
export async function restoreStoredValues(values) {
  const entries = Object.entries(values || {}).filter(([key]) => typeof key === 'string' && key.startsWith('sl_'))
  if (!entries.length) return
  const rawValues = Object.fromEntries(entries.map(([key, value]) => [key, JSON.stringify(value)]))
  const previous = Object.fromEntries(entries.map(([key]) => [key, localStorage.getItem(key)]))
  try {
    for (const [key, raw] of Object.entries(rawValues)) localStorage.setItem(key, raw)
    for (const [key, value] of entries) {
      if (storedRefs.has(key)) storedRefs.get(key).value = value
    }
    await mirrorLocalValues(rawValues)
    markLocalChanged()
  } catch (error) {
    for (const [key, raw] of Object.entries(previous)) {
      if (raw === null) localStorage.removeItem(key)
      else localStorage.setItem(key, raw)
    }
    throw error
  }
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

// 保证每个 季×校区 的时间数组与节次数量对齐，并统一补零为 HH:MM。
// 未设置（空）的时间保持为空，绝不静默填充 08:00-08:45 之类的默认值。
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
        const source = list[i]
        if (!source || (!String(source.start ?? '').trim() && !String(source.end ?? '').trim())) {
          return { start: '', end: '' }
        }
        return { start: pad(source.start), end: pad(source.end) }
      })
      cfg.times[season.id][campus.id] = fixed
    }
  }
}

// ---------- 作息季适用范围（sparse 方案：某季可只适用部分校区） ----------
// season.campuses 缺省/为空 = 适用于全部校区（兼容旧数据，无需迁移）。
export function seasonAppliesTo(season, campusId) {
  if (!Array.isArray(season?.campuses) || season.campuses.length === 0) return true
  return season.campuses.includes(campusId)
}

export function seasonsForCampus(campusId, cfg = timeConfig.value) {
  return cfg.seasons.filter((season) => seasonAppliesTo(season, campusId))
}

// 当前配置下的有效「季×校区」方案组合（不产生无意义组合）
export function validCombos(cfg = timeConfig.value) {
  const out = []
  for (const season of cfg.seasons) {
    for (const campus of cfg.campuses) {
      if (seasonAppliesTo(season, campus.id)) {
        out.push({ season: season.id, campus: campus.id, seasonName: season.name, campusName: campus.name })
      }
    }
  }
  return out
}

const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export function isValidSeasonDate(value) {
  const text = String(value ?? '')
  if (!MONTH_DAY_RE.test(text)) return false
  const [month, day] = text.split('-').map(Number)
  return day <= new Date(2000, month, 0).getDate()
}

function monthDayOf(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const pad = (number) => String(number).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// 起始日期冲突按校区检查：只有同时适用于同一校区的作息季才会互相冲突。
export function seasonConflicts(cfg = timeConfig.value) {
  const out = []
  for (const campus of cfg.campuses) {
    const byDate = new Map()
    for (const season of seasonsForCampus(campus.id, cfg)) {
      if (!isValidSeasonDate(season.startDate)) continue
      if (!byDate.has(season.startDate)) byDate.set(season.startDate, [])
      byDate.get(season.startDate).push(season)
    }
    for (const [date, list] of byDate.entries()) {
      if (list.length > 1) {
        out.push({
          campusId: campus.id,
          campusName: campus.name,
          date,
          seasonIds: list.map((season) => season.id),
          names: list.map((season) => season.name),
        })
      }
    }
  }
  return out
}

// 自动模式统一解析入口。多作息季时，日期必须完整且在当前校区内不冲突。
// 当前日期早于本年度全部生效日时，取年度周期最后一个作息季，自然覆盖跨年场景。
export function autoSeasonStatusFor(campusId, cfg = timeConfig.value, at = clock.value) {
  const seasons = seasonsForCampus(campusId, cfg)
  if (!seasons.length) return { available: false, seasonId: null, reason: 'no-season', seasons }
  if (seasons.length === 1) return { available: true, seasonId: seasons[0].id, reason: 'single', seasons }

  const missing = seasons.filter((season) => !isValidSeasonDate(season.startDate))
  if (missing.length) {
    return { available: false, seasonId: null, reason: 'missing-date', seasons, missing }
  }

  const conflicts = seasonConflicts(cfg).filter((item) => item.campusId === campusId)
  if (conflicts.length) {
    return { available: false, seasonId: null, reason: 'date-conflict', seasons, conflicts }
  }

  const today = monthDayOf(at)
  if (!today) return { available: false, seasonId: null, reason: 'invalid-date', seasons }
  const ordered = [...seasons].sort((a, b) => a.startDate.localeCompare(b.startDate))
  let current = ordered[ordered.length - 1]
  for (const season of ordered) {
    if (season.startDate <= today) current = season
  }
  return { available: true, seasonId: current.id, reason: 'resolved', seasons: ordered }
}

export function autoSeasonIdFor(campusId, cfg = timeConfig.value, at = clock.value) {
  return autoSeasonStatusFor(campusId, cfg, at).seasonId
}

export const timeConfig = useStoredRef('sl_timecfg', loadTimeConfig())
normalizeTimes(timeConfig.value)

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
    if (Array.isArray(season.campuses) && season.campuses.length) {
      season.campuses = season.campuses.filter((campusId) => campusId !== id)
      // 空数组在旧数据语义中代表“全部适用”，因此删除唯一适用校区后明确绑定到一个剩余校区。
      if (!season.campuses.length && cfg.campuses[0]) season.campuses = [cfg.campuses[0].id]
    }
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
  const date = isValidSeasonDate(startDate) ? startDate : ''
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
  if (typeof name === 'string' && name.trim()) season.name = name.trim()
  if (startDate === '' || isValidSeasonDate(startDate)) season.startDate = startDate
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
  return autoSeasonIdFor(currentCampusId())
}

export function currentSeasonId() {
  const cfg = timeConfig.value
  const campusId = currentCampusId()
  const available = seasonsForCampus(campusId, cfg)
  if (!cfg.autoSeason) {
    const manual = cfg.seasons.find((s) => s.id === cfg.currentSeason)
    if (manual && seasonAppliesTo(manual, campusId)) return manual.id
  }
  return autoSeasonIdFor(campusId) ?? available[0]?.id ?? null
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

// ---------- 特殊日期课表：停课 / 按某个星期补课 ----------
export const scheduleExceptions = useStoredRef('sl_schedule_exceptions', [])

function dateString(date) {
  const p = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

export function dateForWeekDay(week, day) {
  const date = new Date(semester.value.start + 'T00:00:00')
  date.setDate(date.getDate() + (Number(week) - 1) * 7 + Number(day))
  return dateString(date)
}

export function scheduleExceptionForDate(date) {
  return scheduleExceptions.value.find((item) => item.date === date) ?? null
}

export function coursesForDate(courseList, date) {
  const target = new Date(date + 'T00:00:00')
  const actualDay = target.getDay() === 0 ? 6 : target.getDay() - 1
  const week = weekOf(date)
  const exception = scheduleExceptionForDate(date)
  if (exception?.type === 'off') return []
  const sourceDay = exception?.type === 'makeup'
    ? Math.min(6, Math.max(0, Number(exception.sourceDay) || 0))
    : actualDay
  return courseList
    .filter((course) => course.day === sourceDay && courseInWeek(course, week))
    .map((course) => ({
      ...course,
      displayDay: actualDay,
      sourceDay,
      exceptionDate: exception ? date : '',
    }))
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
