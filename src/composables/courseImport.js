// Unified schedule conflict and import planning helpers.
// These are deliberately pure so every import source reaches the same decision.

export function activeWeeks(course, maxWeek = 25) {
  const explicitWeeks = Array.isArray(course?.activeWeeks) ? course.activeWeeks : course?.customWeeks
  if (Array.isArray(explicitWeeks)) {
    return [...new Set(explicitWeeks.map(Number))]
      .filter((week) => Number.isInteger(week) && week >= 1 && week <= maxWeek)
      .sort((a, b) => a - b)
  }
  const start = Math.max(1, Number(course?.startWeek) || 1)
  const end = Math.min(maxWeek, Number(course?.endWeek) || maxWeek)
  const type = course?.weekType || 'all'
  const weeks = []
  for (let week = start; week <= end; week += 1) {
    if (type === 'all' || (type === 'odd' && week % 2 === 1) || (type === 'even' && week % 2 === 0)) weeks.push(week)
  }
  return weeks
}

function periodBounds(course, periodIndex) {
  const start = periodIndex(course?.start)
  const end = periodIndex(course?.end)
  return start < 0 || end < 0 ? null : [Math.min(start, end), Math.max(start, end)]
}

export function courseConflictDetail(incoming, existing, { periodIndex, maxWeek = 25 } = {}) {
  if (!periodIndex || Number(incoming?.day) !== Number(existing?.day)) return null
  const a = periodBounds(incoming, periodIndex)
  const b = periodBounds(existing, periodIndex)
  if (!a || !b) return null
  const periodStart = Math.max(a[0], b[0])
  const periodEnd = Math.min(a[1], b[1])
  if (periodStart > periodEnd) return null
  const existingWeeks = new Set(activeWeeks(existing, maxWeek))
  const weeks = activeWeeks(incoming, maxWeek).filter((week) => existingWeeks.has(week))
  return weeks.length ? { weeks, periodStart, periodEnd } : null
}

export function isLikelyDuplicate(incoming, existing, options) {
  const detail = courseConflictDetail(incoming, existing, options)
  if (!detail) return false
  const name = String(incoming?.name || '').trim()
  return name !== ''
    && name === String(existing?.name || '').trim()
    && String(incoming?.teacher || '').trim() === String(existing?.teacher || '').trim()
    && String(incoming?.room || '').trim() === String(existing?.room || '').trim()
    && detail.weeks.length === activeWeeks(incoming, options?.maxWeek).length
    && detail.weeks.length === activeWeeks(existing, options?.maxWeek).length
}

export function classifyImportItems(incomingCourses, existingCourses, options) {
  return incomingCourses.map((course, index) => {
    const matches = existingCourses
      .map((existing, existingIndex) => ({ existing, existingIndex, detail: courseConflictDetail(course, existing, options) }))
      .filter((match) => match.detail)
    const duplicates = matches.filter(({ existing }) => isLikelyDuplicate(course, existing, options))
    return {
      index,
      course,
      type: duplicates.length ? 'duplicate' : matches.length ? 'conflict' : 'direct',
      matches,
    }
  })
}

// Replacement only removes courses whose complete block is covered by the new one.
// Partial intersections retain the old block, preventing accidental loss of non-conflicting data.
function fullyCovered(oldCourse, incoming, options) {
  const overlap = courseConflictDetail(incoming, oldCourse, options)
  if (!overlap) return false
  const oldWeeks = activeWeeks(oldCourse, options?.maxWeek)
  const oldBounds = periodBounds(oldCourse, options?.periodIndex)
  const newBounds = periodBounds(incoming, options?.periodIndex)
  return overlap.weeks.length === oldWeeks.length
    && newBounds[0] <= oldBounds[0]
    && newBounds[1] >= oldBounds[1]
}

export function buildImportPlan({ existingCourses, items, decisions = {}, mode = 'smart', options }) {
  if (mode === 'replace-all') {
    return { courses: items.map(({ course }) => course), added: items.length, replaced: existingCourses.length, skipped: 0, kept: 0, unsafe: [] }
  }
  const keep = [...existingCourses]
  const additions = []
  const unsafe = []
  let replaced = 0
  let skipped = 0
  let kept = 0
  for (const item of items) {
    const decision = decisions[item.index] || (item.type === 'direct' ? 'add' : 'pending')
    if (decision === 'pending') return null
    if (decision === 'skip') { skipped += 1; continue }
    if (decision === 'keep' || decision === 'add') { additions.push(item.course); if (decision === 'keep') kept += 1; continue }
    if (decision === 'replace') {
      const targetIds = new Set()
      for (const match of item.matches) {
        if (fullyCovered(match.existing, item.course, options)) targetIds.add(match.existing.id)
        else unsafe.push({ item, match })
      }
      if (unsafe.some(({ item: unsafeItem }) => unsafeItem.index === item.index)) continue
      const before = keep.length
      for (let i = keep.length - 1; i >= 0; i -= 1) if (targetIds.has(keep[i].id)) keep.splice(i, 1)
      replaced += before - keep.length
      additions.push(item.course)
    }
  }
  return { courses: [...keep, ...additions], added: additions.length, replaced, skipped, kept, unsafe }
}
