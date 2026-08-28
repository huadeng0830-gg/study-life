import { useStoredRef } from './store.js'

const MAX_TERMS_PER_FIELD = 160
const EMPTY_VOCABULARY = { courses: [], teachers: [], rooms: [], campuses: [] }

// This is deliberately a small, local correction memory rather than a model.
// It stores only terms that the user has accepted in the timetable preview.
export const ocrVocabulary = useStoredRef('sl_ocr_vocabulary', EMPTY_VOCABULARY)

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[，,。.;；:：()（）\[\]【】]/g, '')
    .toLowerCase()
}

function distance(left, right) {
  const a = normalize(left)
  const b = normalize(right)
  if (a === b) return 0
  if (!a || !b) return Math.max(a.length, b.length)
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let row = 1; row <= a.length; row++) {
    const current = [row]
    for (let column = 1; column <= b.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]
}

function mergeTerms(current, incoming) {
  const seen = new Set()
  return [...incoming, ...current]
    .map((value) => String(value || '').trim())
    .filter((value) => value.length >= 2)
    .filter((value) => {
      const key = normalize(value)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_TERMS_PER_FIELD)
}

export function rememberOcrCourses(courses) {
  const list = Array.isArray(courses) ? courses : []
  const current = ocrVocabulary.value || EMPTY_VOCABULARY
  ocrVocabulary.value = {
    courses: mergeTerms(current.courses || [], list.map((course) => course?.name)),
    teachers: mergeTerms(current.teachers || [], list.map((course) => course?.teacher)),
    rooms: mergeTerms(current.rooms || [], list.map((course) => course?.room)),
    campuses: mergeTerms(current.campuses || [], list.map((course) => course?.campus)),
  }
}

export function closestOcrTerm(value, terms) {
  const raw = String(value || '').trim()
  const key = normalize(raw)
  if (key.length < 3) return null
  const candidates = (terms || []).filter((term) => normalize(term))
  const exact = candidates.find((term) => normalize(term) === key)
  if (exact) return exact
  const ranked = candidates
    .map((term) => ({ term, distance: distance(raw, term) }))
    .sort((left, right) => left.distance - right.distance)
  const best = ranked[0]
  const runnerUp = ranked[1]
  const maxDistance = key.length >= 7 ? 2 : 1
  if (!best || best.distance > maxDistance) return null
  // Avoid silently choosing when two known terms are equally plausible.
  if (runnerUp && runnerUp.distance === best.distance) return null
  return best.term
}

export function applyOcrVocabulary(course, additionalCourses = []) {
  const current = ocrVocabulary.value || EMPTY_VOCABULARY
  const knownCourses = [...(current.courses || []), ...additionalCourses.map((item) => item?.name)]
  const fields = [
    ['name', knownCourses],
    ['teacher', current.teachers || []],
    ['room', current.rooms || []],
  ]
  const corrected = { ...course }
  const changes = []
  for (const [field, terms] of fields) {
    if (!corrected[field]) continue
    const suggestion = closestOcrTerm(corrected[field], terms)
    if (suggestion && suggestion !== corrected[field]) {
      changes.push({ field, from: corrected[field], to: suggestion })
      corrected[field] = suggestion
    }
  }
  return { course: corrected, changes }
}
