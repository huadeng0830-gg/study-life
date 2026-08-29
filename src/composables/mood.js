// 情绪引擎（模块 A）：纯函数处理心情记录与月度情绪概览。
// 本文件不持有存储；调用方自行读写 sl_mood_log（见 atmosphereStore.js）。
// 存储值兼容两种形态：纯 emoji 字符串，或 { mood, note } 对象，读入时统一归一化。

const WEATHER_BY_MOOD = {
  sunny: ['😊', '😄', '😁', '🙂', '😀', '☀️', '😍', '🤩', '😆', '😉', '🥳', '😌', '😺'],
  cloudy: ['😐', '😑', '😴', '😅', '🤔', '😪', '😬', '🙃', '😶', '😮‍💨', '😏'],
  rain: ['😢', '😭', '😞', '😔', '😟', '😫', '😩', '😤', '😠', '😱', '☔', '💧', '😿', '💔'],
}

export const WEATHER_COLORS = {
  sunny: '#f59e0b',
  cloudy: '#94a3b8',
  rain: '#64748b',
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export function weatherOfMood(mood) {
  const emoji = String(mood ?? '').trim()
  for (const [weather, list] of Object.entries(WEATHER_BY_MOOD)) {
    if (list.includes(emoji)) return weather
  }
  return 'cloudy'
}

function normalizeEntry(raw) {
  if (typeof raw === 'string') {
    const mood = raw.trim()
    return mood ? { mood, note: '' } : null
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const mood = String(raw.mood ?? '').trim()
    return mood ? { mood, note: String(raw.note ?? '') } : null
  }
  return null
}

// 坏数据修复：只保留合法日期的有效记录，其余丢弃。
export function normalizeMoodLog(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
  const out = {}
  for (const [day, raw] of Object.entries(saved)) {
    if (!DAY_RE.test(day)) continue
    const entry = normalizeEntry(raw)
    if (entry) out[day] = entry
  }
  return out
}

export function moodOf(day, log) {
  const normalized = normalizeMoodLog(log)
  return normalized[day] ?? null
}

// 返回一份“写入后”的新日志对象（纯函数，不修改入参），调用方负责落盘。
export function logMood(day, mood, note = '', log) {
  const normalized = normalizeMoodLog(log)
  if (!DAY_RE.test(String(day ?? ''))) return normalized
  const entry = normalizeEntry({ mood, note })
  if (!entry) return normalized
  normalized[day] = entry
  return normalized
}

export function monthMoodSummary(month, log) {
  const prefix = String(month ?? '').slice(0, 7)
  const normalized = normalizeMoodLog(log)
  const counts = { sunny: 0, cloudy: 0, rain: 0 }
  for (const [day, entry] of Object.entries(normalized)) {
    if (!day.startsWith(prefix)) continue
    counts[weatherOfMood(entry.mood)] += 1
  }
  const total = counts.sunny + counts.cloudy + counts.rain
  let dominant = ''
  if (total > 0) {
    if (counts.sunny >= counts.cloudy && counts.sunny >= counts.rain) dominant = 'sunny'
    else if (counts.cloudy >= counts.rain) dominant = 'cloudy'
    else dominant = 'rain'
  }
  return {
    sunny: counts.sunny,
    cloudy: counts.cloudy,
    rain: counts.rain,
    dominant,
    themeColor: dominant ? WEATHER_COLORS[dominant] : '',
  }
}