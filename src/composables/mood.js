// 情绪引擎（模块 A）：纯函数处理心情记录与月度情绪概览。
// 本文件不持有存储；调用方自行读写 sl_mood_log（见 atmosphereStore.js）。
// 存储值兼容两种形态：纯 emoji 字符串，或 { mood, note } 对象，读入时统一归一化。

const WEATHER_BY_MOOD = {
  sunny: ['😊', '😄', '😁', '🙂', '😀', '☀️', '😍', '🤩', '😆', '😉', '🥳', '😌', '😺'],
  cloudy: ['😐', '😑', '😴', '😅', '🤔', '😪', '😬', '🙃', '😶', '😮‍💨', '😏'],
  rain: ['😢', '😭', '😞', '😔', '😟', '😫', '😩', '😤', '😠', '😱', '☔', '💧', '😿', '💔'],
}

export const MOOD_OPTIONS = Object.freeze(['😞', '😐', '🙂', '😄'])

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
  // 兜底必须是 sunny/cloudy/rain 之一：调用方用返回值直接做 counts[...] += 1，
  // 返回任何新键都会让计数变成 NaN，并连带 dominant 判定一起出错。
  return 'cloudy'
}

/**
 * 是不是应用内置的 4 个标准情绪之一。
 *
 * UI 只提供这 4 个选项，非标准 emoji 来自导入 / 旧数据 / 同步，
 * 会被静默归入「多云」。调用方可据此提示「已按多云统计」。
 */
export function isKnownMood(mood) {
  return MOOD_OPTIONS.includes(String(mood ?? '').trim())
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
  const key = String(day ?? '')
  if (!DAY_RE.test(key) || !log || typeof log !== 'object' || Array.isArray(log)) return null
  return normalizeEntry(log[key])
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
  // 以下三个字段是纯新增：4 个标准情绪在天气聚合里会塌缩（🙂 与 😄 都算 sunny），
  // 想区分具体情绪时看 countsByMood；非标准 emoji 在 unknownMoods 里列出。
  const countsByMood = Object.fromEntries(MOOD_OPTIONS.map((emoji) => [emoji, 0]))
  const unknownMoods = new Set()
  let days = 0
  for (const [day, entry] of Object.entries(normalized)) {
    if (!day.startsWith(prefix)) continue
    days += 1
    counts[weatherOfMood(entry.mood)] += 1
    const mood = String(entry.mood ?? '').trim()
    if (isKnownMood(mood)) countsByMood[mood] += 1
    else unknownMoods.add(mood)
  }
  const total = counts.sunny + counts.cloudy + counts.rain
  let dominant = ''
  if (total > 0) {
    if (counts.sunny >= counts.cloudy && counts.sunny >= counts.rain) dominant = 'sunny'
    else if (counts.cloudy >= counts.rain) dominant = 'cloudy'
    else dominant = 'rain'
  }
  // 记录最多的具体情绪；并列时取 MOOD_OPTIONS 里更靠前的那个，
  // 与上面 dominant 的「同级取前者」口径保持一致。
  let dominantMood = ''
  if (days > 0) {
    dominantMood = MOOD_OPTIONS.reduce(
      (best, emoji) => (countsByMood[emoji] > countsByMood[best] ? emoji : best),
      MOOD_OPTIONS[0],
    )
    if (!countsByMood[dominantMood]) dominantMood = ''
  }
  return {
    sunny: counts.sunny,
    cloudy: counts.cloudy,
    rain: counts.rain,
    dominant,
    themeColor: dominant ? WEATHER_COLORS[dominant] : '',
    days,
    countsByMood,
    dominantMood,
    unknownMoods: [...unknownMoods],
  }
}
