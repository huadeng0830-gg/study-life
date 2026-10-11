export const WEEKLY_REFLECTIONS_KEY = 'sl_weekly_reflections'
export const WEEKLY_REFLECTION_MAX_LENGTH = 1000

export const WEEKLY_REFLECTION_FIELDS = Object.freeze(['wins', 'learned', 'next'])

const textOf = (value) => (typeof value === 'string' ? value.slice(0, WEEKLY_REFLECTION_MAX_LENGTH) : '')

export function isWeeklyReflectionWeekKey(value) {
  const key = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const date = new Date(`${key}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key && date.getUTCDay() === 1
}

export function normalizeWeeklyReflection(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return Object.fromEntries(WEEKLY_REFLECTION_FIELDS.map((field) => [field, textOf(source[field])]))
}

export function normalizeWeeklyReflections(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized = {}
  for (const [week, reflection] of Object.entries(value)) {
    if (!isWeeklyReflectionWeekKey(week)) continue
    const entry = normalizeWeeklyReflection(reflection)
    if (Object.values(entry).some((text) => text.trim())) normalized[week] = entry
  }
  return normalized
}

export function isWeeklyReflectionsShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(([week, reflection]) => {
    if (!isWeeklyReflectionWeekKey(week) || !reflection || typeof reflection !== 'object' || Array.isArray(reflection)) return false
    return WEEKLY_REFLECTION_FIELDS.every((field) => typeof reflection[field] === 'string'
      && reflection[field].length <= WEEKLY_REFLECTION_MAX_LENGTH)
  })
}
