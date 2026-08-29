import { useStoredRef } from './core.js'
import {
  DEFAULT_PERIOD_LABELS,
  DEFAULT_TIMES,
  FALLBACK_TIME,
  todayIndex,
} from './utils.js'

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
  if (Array.isArray(raw.campuses) && Array.isArray(raw.periods)) {
    const base = defaultTimeConfig()
    return { ...base, ...raw }
  }
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
  }
  return defaultTimeConfig()
}

export function normalizeTimes(cfg) {
  let changed = false
  const pad = (value) => {
    const [h = '0', m = '00'] = String(value ?? '').split(':')
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  if (!cfg.times || typeof cfg.times !== 'object' || Array.isArray(cfg.times)) {
    cfg.times = {}
    changed = true
  }
  for (const season of cfg.seasons) {
    if (!cfg.times[season.id] || typeof cfg.times[season.id] !== 'object' || Array.isArray(cfg.times[season.id])) {
      cfg.times[season.id] = {}
      changed = true
    }
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
      const same = list.length === fixed.length && fixed.every((row, index) =>
        list[index]?.start === row.start && list[index]?.end === row.end
      )
      if (!same) {
        cfg.times[season.id][campus.id] = fixed
        changed = true
      }
    }
  }
  return changed
}

export function seasonAppliesTo(season, campusId) {
  if (!Array.isArray(season?.campuses) || season.campuses.length === 0) return true
  return season.campuses.includes(campusId)
}

export function seasonsForCampus(campusId, cfg = timeConfig.value) {
  return cfg.seasons.filter((season) => seasonAppliesTo(season, campusId))
}

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

import { clock } from './core.js'

export const timeConfig = useStoredRef('sl_timecfg', loadTimeConfig())
normalizeTimes(timeConfig.value)

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
      if (!season.campuses.length && cfg.campuses[0]) season.campuses = [cfg.campuses[0].id]
    }
  }
  if (cfg.currentCampus === id) cfg.currentCampus = cfg.campuses[0].id
  return true
}

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