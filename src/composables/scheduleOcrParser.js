import { digitize } from './courseParser.js'

const DASH_RE = /[\u2010-\u2015\u2212~～－]/g
const TIME_CHAR_RE = /[OoQqDd]/g
const ONE_CHAR_RE = /[Il|!]/g
function clean(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(DASH_RE, '-')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function confidenceLevel(score) {
  if (score >= 0.82) return 'high'
  if (score >= 0.58) return 'medium'
  return 'low'
}

function editDistance(left, right) {
  const a = [...clean(left).replace(/\s/g, '')]
  const b = [...clean(right).replace(/\s/g, '')]
  const rows = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) rows[i][0] = i
  for (let j = 0; j <= b.length; j++) rows[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return rows[a.length][b.length]
}

export function normalizeTimeToken(value) {
  let token = clean(value)
    .replace(TIME_CHAR_RE, '0')
    .replace(ONE_CHAR_RE, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/了/g, '')
    .replace(/[.：]/g, ':')
    .replace(/\s/g, '')
  if (/^\d{3}:\d{2}$/.test(token) && Number(token.slice(0, 2)) <= 23) token = token.slice(0, 2) + token.slice(3)
  if (/^\d{3,4}$/.test(token)) token = `${token.slice(0, -2)}:${token.slice(-2)}`
  const match = token.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function minutes(value) {
  const [hour, minute] = String(value).split(':').map(Number)
  return hour * 60 + minute
}

export function extractTimeRanges(value) {
  const line = clean(value)
  const token = '[0-9OoQqDdIl|!SsBb了]{1,3}\\s*(?::|：|\\.)?\\s*[0-9OoQqDdIl|!SsBb]{2}'
  const matcher = new RegExp(`(${token})\\s*(?:-|一|ー|至|到)\\s*(${token})`, 'g')
  const ranges = []
  let match
  while ((match = matcher.exec(line))) {
    const start = normalizeTimeToken(match[1])
    let end = normalizeTimeToken(match[2])
    if (!end && start) {
      const minuteOnly = clean(match[2]).replace(/[了OoQqDdIl|!]/g, '').match(/^[:：.]([0-5]\d)$/)
      if (minuteOnly) end = `${start.slice(0, 2)}:${minuteOnly[1]}`
    }
    ranges.push({
      start,
      end,
      raw: match[0],
      index: match.index,
      valid: Boolean(start && end && minutes(start) < minutes(end)),
    })
  }
  return ranges
}

export function normalizePeriod(value) {
  const raw = clean(value)
  const normalized = digitize(raw)
    .replace(/[OoQqDd]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[、,，/至到~～－—–]+/g, '-')
  let numbers = []
  const explicit = normalized.match(/第?\s*(\d{1,2})(?:\s*-\s*(?:第?\s*)?(\d{1,2}))?\s*(?:节|课)/)
  if (explicit) numbers = [Number(explicit[1]), Number(explicit[2] || explicit[1])]
  if (!numbers.length && /^\s*\d{1,2}\s*$/.test(normalized)) numbers = [Number(normalized), Number(normalized)]
  numbers = numbers.filter((number) => number >= 1 && number <= 30)
  if (!numbers.length) {
    const special = raw.match(/早自习|晨读|午自习|午休|晚自习|预备/)
    return special ? { key: special[0], label: special[0], start: null, end: null, raw } : null
  }
  const start = Math.min(...numbers)
  const end = Math.max(...numbers)
  return { key: `${start}-${end}`, label: start === end ? `第${start}节` : `第${start}-${end}节`, start, end, raw }
}

function bboxUnion(items) {
  const boxes = items.map((item) => item?.bbox).filter(Boolean)
  if (!boxes.length) return null
  return {
    x0: Math.min(...boxes.map((box) => Number(box.x0) || 0)),
    y0: Math.min(...boxes.map((box) => Number(box.y0) || 0)),
    x1: Math.max(...boxes.map((box) => Number(box.x1) || 0)),
    y1: Math.max(...boxes.map((box) => Number(box.y1) || 0)),
  }
}

function layoutRows(layout) {
  const words = (layout?.words || []).filter((word) => clean(word.text))
  if (!words.length) return (layout?.lines || []).map((line) => ({ ...line, text: clean(line.text) }))
  const heights = words
    .map((word) => Number(word.bbox?.y1) - Number(word.bbox?.y0))
    .filter((height) => height > 0)
    .sort((a, b) => a - b)
  const medianHeight = heights[Math.floor(heights.length / 2)] || 16
  const tolerance = Math.max(6, medianHeight * 0.62)
  const rows = []
  for (const word of [...words].sort((a, b) => (a.bbox.y0 - b.bbox.y0) || (a.bbox.x0 - b.bbox.x0))) {
    const center = (Number(word.bbox.y0) + Number(word.bbox.y1)) / 2
    let row = rows.find((candidate) => Math.abs(candidate.center - center) <= tolerance)
    if (!row) {
      row = { center, words: [] }
      rows.push(row)
    }
    row.words.push(word)
    row.center = row.words.reduce((sum, item) => sum + (Number(item.bbox.y0) + Number(item.bbox.y1)) / 2, 0) / row.words.length
  }
  return rows
    .sort((a, b) => a.center - b.center)
    .map((row) => {
      const ordered = row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0)
      return {
        text: ordered.map((word) => clean(word.text)).join(' '),
        confidence: ordered.reduce((sum, word) => sum + (Number(word.confidence) || 0), 0) / ordered.length,
        bbox: bboxUnion(ordered),
        words: ordered,
      }
    })
}

function lineEntries(source, sourceName) {
  if (!source) return []
  if (typeof source === 'string') {
    return source.split(/\r?\n/).map((text) => ({ text: clean(text), confidence: 70, source: sourceName }))
  }
  return layoutRows(source).map((line) => ({ ...line, source: sourceName }))
}

function mergeSplitRows(lines) {
  const merged = []
  for (let index = 0; index < lines.length; index++) {
    const current = lines[index]
    if (!current.text) continue
    if (extractTimeRanges(current.text).length) {
      continue
    }
    const period = normalizePeriod(current.text)
    const next = lines[index + 1]
    if (period && next && extractTimeRanges(next.text).length) {
      merged.push({
        text: `${current.text} ${next.text}`,
        confidence: Math.min(Number(current.confidence) || 0, Number(next.confidence) || 0),
        bbox: bboxUnion([current, next]),
        source: current.source,
      })
      index++
    }
  }
  return [...lines, ...merged]
}

function detectNamedFields(lines, knownCampuses = [], knownSeasons = []) {
  const toCandidate = (item) => typeof item === 'string'
    ? { id: null, name: item }
    : { id: item?.id ?? null, name: item?.name ?? '' }
  const campusCandidates = knownCampuses.map(toCandidate).filter((item) => item.name)
  const seasonCandidates = knownSeasons.map(toCandidate).filter((item) => item.name)
  const fields = { campuses: [], seasons: [] }
  for (const line of lines) {
    const text = clean(line.text).replace(/\s/g, '')
    if (!text) continue
    // 先识别作息季，再从校区候选中去掉同行季节前缀（如「夏季时间东校区」→「东校区」）
    const seasonNamesOnLine = []
    for (const candidate of seasonCandidates) {
      const compact = clean(candidate.name).replace(/\s/g, '')
      if (compact && text.includes(compact)) seasonNamesOnLine.push(compact)
    }
    const directCampus = text.match(/[\u4e00-\u9fffA-Za-z]{1,8}校区/g) || []
    for (let value of directCampus) {
      for (const seasonName of seasonNamesOnLine) {
        if (value.startsWith(seasonName) && value.length > seasonName.length) {
          value = value.slice(seasonName.length)
        }
      }
      // 贪婪正则会把「南校区东校区」整体当成一个值：剥掉已知校区名后重新判断
      for (const candidate of campusCandidates) {
        const compact = clean(candidate.name).replace(/\s/g, '')
        if (compact && value !== compact && value.includes(compact)) {
          value = value.replace(compact, '')
        }
      }
      if (!value.endsWith('校区') || value === '校区') continue
      const known = campusCandidates.find((candidate) => value.endsWith(clean(candidate.name).replace(/\s/g, '')))
      if (!known) fields.campuses.push({ id: null, value, score: 0.78, source: line.source, bbox: line.bbox })
    }
    const exactCampuses = campusCandidates.filter((candidate) => text.includes(clean(candidate.name).replace(/\s/g, '')))
    for (const candidate of campusCandidates) {
      const compact = clean(candidate.name).replace(/\s/g, '')
      if (text.includes(compact)) fields.campuses.push({ id: candidate.id, value: candidate.name, score: 0.96, source: line.source, bbox: line.bbox })
      else if (!exactCampuses.length && text.length <= compact.length + 6 && editDistance(text.replace(/.*?([\u4e00-\u9fff]{1,6}校.).*/, '$1'), compact) <= 1) {
        fields.campuses.push({ id: candidate.id, value: candidate.name, score: 0.62, source: line.source, bbox: line.bbox, corrected: true })
      }
    }
    for (const candidate of seasonCandidates) {
      const compact = clean(candidate.name).replace(/\s/g, '')
      if (text.includes(compact)) fields.seasons.push({ id: candidate.id, value: candidate.name, score: 0.97, source: line.source, bbox: line.bbox })
      else if (text.length <= compact.length + 6 && editDistance(text, compact) <= 1) fields.seasons.push({ id: candidate.id, value: candidate.name, score: 0.6, source: line.source, bbox: line.bbox, corrected: true })
    }
  }
  const unique = (items) => [...new Map(items.sort((a, b) => b.score - a.score).map((item) => [item.id || item.value, item])).values()]
  return { campuses: unique(fields.campuses), seasons: unique(fields.seasons) }
}

function headerOccurrences(layout, candidates) {
  const words = layout?.words || []
  const found = []
  for (const word of words) {
    const text = clean(word.text).replace(/\s/g, '')
    if (!text || !word.bbox) continue
    for (const candidate of candidates) {
      const name = clean(candidate?.name).replace(/\s/g, '')
      if (name && text.includes(name)) {
        found.push({ id: candidate.id ?? null, value: candidate.name, bbox: word.bbox, score: 0.96 })
      }
    }
  }
  return [...new Map(found.map((item) => [`${item.id || item.value}:${item.bbox.x0}:${item.bbox.y0}`, item])).values()]
}

function timeColumnCenters(layout) {
  const points = []
  for (const word of layout?.words || []) {
    if (!word?.bbox || !extractTimeRanges(word.text).length) continue
    const x = (Number(word.bbox.x0) + Number(word.bbox.x1)) / 2
    const width = Math.max(1, Number(word.bbox.x1) - Number(word.bbox.x0))
    if (Number.isFinite(x)) points.push({ x, width })
  }
  if (!points.length) return []
  const medianWidth = [...points].map((point) => point.width).sort((a, b) => a - b)[Math.floor(points.length / 2)] || 40
  const tolerance = Math.max(18, medianWidth * 1.35)
  const groups = []
  for (const point of points.sort((left, right) => left.x - right.x)) {
    let group = groups.find((candidate) => Math.abs(candidate.x - point.x) <= tolerance)
    if (!group) {
      group = { x: point.x, count: 0 }
      groups.push(group)
    }
    group.count++
    group.x += (point.x - group.x) / group.count
  }
  return groups.sort((left, right) => left.x - right.x)
}

function nearestHeader(headers, x) {
  if (!headers.length) return null
  return [...headers]
    .map((header) => ({ ...header, distance: Math.abs(((header.bbox.x0 + header.bbox.x1) / 2) - x) }))
    .sort((left, right) => left.distance - right.distance)[0]
}

// Associate time columns with visible headers. It intentionally falls back to
// text order only when OCR did not provide enough positioned time tokens.
function layoutSchemeHints(layout, options, expectedColumns) {
  const columns = timeColumnCenters(layout)
  if (columns.length !== expectedColumns || expectedColumns < 1) return []
  const campuses = headerOccurrences(layout, options.campuses || [])
  const seasons = headerOccurrences(layout, options.seasons || [])
  if (!campuses.length && !seasons.length) return []
  return columns.map((column) => {
    const campus = nearestHeader(campuses, column.x)
    const season = nearestHeader(seasons, column.x)
    return {
      campusId: campus?.id || null,
      campus: campus?.value || '',
      campusScore: campus?.score || 0,
      seasonId: season?.id || null,
      season: season?.value || '',
      seasonScore: season?.score || 0,
      x: column.x,
    }
  })
}

function candidateFromLine(line, index) {
  const ranges = extractTimeRanges(line.text)
  if (!ranges.length) return null
  const before = line.text.slice(0, ranges[0].index)
    .replace(/^(?:节次|课次|上课时间|时间)\s*[:：]?\s*/i, '')
    .replace(/[|:：,，。]+$/g, '')
    .trim()
  const after = line.text.slice(ranges[0].index + ranges[0].raw.length).trim()
  const period = normalizePeriod(before) || normalizePeriod(after)
  if (!period) return null
  const range = ranges[0]
  const issues = []
  if (!range.valid) issues.push('开始时间必须早于结束时间')
  const ocrConfidence = Math.max(0, Math.min(1, (Number(line.confidence) || 70) / 100))
  return {
    key: period.key,
    label: period.label,
    periodStart: period.start,
    periodEnd: period.end,
    start: range.start || '',
    end: range.end || '',
    alternatives: ranges.slice(1).map((item) => ({ start: item.start || '', end: item.end || '' })),
    bbox: line.bbox || null,
    source: line.source,
    sourceIndex: index,
    raw: line.text,
    issues,
    baseScore: (range.valid ? 0.55 : 0.18) + ocrConfidence * 0.28 + (period.start ? 0.1 : 0),
  }
}

function mergeCandidates(candidates) {
  const groups = new Map()
  for (const candidate of candidates) {
    if (!groups.has(candidate.key)) groups.set(candidate.key, [])
    groups.get(candidate.key).push(candidate)
  }
  const rows = []
  for (const group of groups.values()) {
    const votes = new Map()
    for (const item of group) {
      const value = `${item.start}-${item.end}`
      if (!votes.has(value)) votes.set(value, [])
      votes.get(value).push(item)
    }
    // 完整（开始+结束都识别到）的票优先于残缺票，避免残缺结果仅凭票数获胜
    const completeCount = (list) => list.filter((item) => item.start && item.end).length
    const ranked = [...votes.entries()].sort(
      (a, b) => completeCount(b[1]) - completeCount(a[1]) || b[1].length - a[1].length || b[1][0].baseScore - a[1][0].baseScore
    )
    const selected = [...ranked[0][1]].sort((a, b) => b.baseScore - a.baseScore)[0]
    const consensus = ranked[0][1].length
    const conflict = ranked.length > 1
    let score = Math.min(0.99, selected.baseScore + Math.min(0.18, (consensus - 1) * 0.09))
    const issues = [...selected.issues]
    if (conflict) {
      score -= 0.22
      issues.push(`多次识别结果冲突：${ranked.map(([value]) => value).join(' / ')}`)
    }
    // 时间列模板：取整组中证据列最多（通常=时间列数）的候选，保持来源顺序。
    // 若只看胜出候选，表格行重识别（regions）胜出时会因缺少 alternatives
    // 导致列数塌缩成 1，多组作息被错误合并并互相串时间。
    const template = [...group]
      .sort((a, b) => (1 + (b.alternatives?.length || 0)) - (1 + (a.alternatives?.length || 0)) || b.baseScore - a.baseScore)[0]
    const timeOptions = [{ start: template.start, end: template.end }, ...(template.alternatives || [])]
      .filter((option) => option.start || option.end)
    rows.push({
      ...selected,
      score: Math.max(0, score),
      confidence: confidenceLevel(Math.max(0, score)),
      needsReview: issues.length > 0 || score < 0.58,
      issues,
      evidenceCount: group.length,
      alternatives: [...new Map(group.flatMap((item) => item.alternatives).map((item) => [`${item.start}-${item.end}`, item])).values()],
      timeOptions,
    })
  }
  return rows.sort((a, b) => {
    if (a.periodStart !== null && b.periodStart !== null) return a.periodStart - b.periodStart
    return a.sourceIndex - b.sourceIndex
  })
}

// OCR 漏识别某个节次时，插入显式的"未识别"占位行（时间为空），
// 供上层标记 ⚠ 未识别，请确认；绝不静默填充默认时间。
function insertMissingPeriodRows(rows) {
  const numbered = rows
    .filter((row) => row.periodStart !== null && row.periodEnd !== null)
    .sort((a, b) => a.periodStart - b.periodStart)
  if (numbered.length < 2) return rows
  const min = numbered[0].periodStart
  const max = numbered[numbered.length - 1].periodStart
  if (max - min + 1 > numbered.length + 8) return rows
  const covers = (value) =>
    numbered.some((row) => value >= row.periodStart && value <= row.periodEnd)
  const missing = []
  for (let value = min; value <= max; value++) {
    if (covers(value)) continue
    missing.push({
      key: `${value}-${value}`,
      label: `第${value}节`,
      periodStart: value,
      periodEnd: value,
      start: '',
      end: '',
      alternatives: [],
      bbox: null,
      source: 'inferred',
      sourceIndex: Number.MAX_SAFE_INTEGER,
      raw: '',
      issues: ['未识别到该节的时间'],
      baseScore: 0,
      score: 0,
      confidence: 'low',
      needsReview: true,
      evidenceCount: 0,
      timeOptions: [],
    })
  }
  if (!missing.length) return rows
  return [...rows, ...missing].sort((a, b) => {
    if (a.periodStart !== null && b.periodStart !== null) return a.periodStart - b.periodStart
    return a.sourceIndex - b.sourceIndex
  })
}

function validateRows(rows) {
  const numbered = rows.filter((row) => row.periodStart !== null)
  const seen = new Set()
  for (const row of numbered) {
    if (seen.has(row.periodStart)) row.issues.push(`第${row.periodStart}节重复`)
    seen.add(row.periodStart)
  }
  if (numbered.length >= 2) {
    const min = Math.min(...numbered.map((row) => row.periodStart))
    const max = Math.max(...numbered.map((row) => row.periodStart))
    const missing = []
    for (let value = min; value <= max; value++) if (!seen.has(value)) missing.push(value)
    if (missing.length) numbered[0].issues.push(`可能缺少第${missing.join('、')}节`)
  }
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (row.start && row.end && minutes(row.start) >= minutes(row.end)) row.issues.push('时间倒序')
    const previous = rows[index - 1]
    if (previous?.start && row.start && minutes(row.start) <= minutes(previous.start)) row.issues.push(`时间顺序不晚于${previous.label}`)
    row.needsReview = row.issues.length > 0 || row.score < 0.58
    row.confidence = row.needsReview && row.confidence === 'high' ? 'medium' : row.confidence
  }
  return rows
}

export function parseScheduleOCR(input, options = {}) {
  const sources = []
  const regionLines = []
  if (typeof input === 'string') sources.push(...lineEntries(input, 'text'))
  else {
    sources.push(...lineEntries(input?.text, 'original'))
    sources.push(...lineEntries(input?.layout, 'layout'))
    for (const region of input?.regions || []) {
      const entry = {
        text: clean(region.text),
        confidence: Number(region.confidence) || 0,
        bbox: region.bbox || null,
        source: region.source || 'table-row',
      }
      sources.push(entry)
      regionLines.push(entry)
    }
    for (const [index, variant] of (input?.variants || []).entries()) {
      sources.push(...lineEntries(variant?.text, variant?.name || `variant-${index + 1}`))
      if (variant?.layout) sources.push(...lineEntries(variant.layout, `${variant?.name || `variant-${index + 1}`}-layout`))
    }
  }
  const lines = mergeSplitRows(sources)
  const named = detectNamedFields(lines, options.campuses, options.seasons)
  const preciseCandidates = regionLines.map(candidateFromLine).filter(Boolean)
  const candidates = preciseCandidates.length >= 3 ? preciseCandidates : lines.map(candidateFromLine).filter(Boolean)
  const rows = validateRows(insertMissingPeriodRows(mergeCandidates(candidates)))
  const columnCount = Math.max(0, ...rows.map((row) => row.timeOptions?.length || 0))
  const combinations = named.seasons.length && named.campuses.length
    ? named.seasons.flatMap((season) => named.campuses.map((campus) => ({ season, campus })))
    : []
  const spatialHints = layoutSchemeHints(input?.layout, options, columnCount)
  if (columnCount > 1 && combinations.length !== columnCount) {
    for (const row of rows) {
      row.issues.push('时间列与作息季/校区表头无法完全对应')
      row.needsReview = true
      row.confidence = row.confidence === 'high' ? 'medium' : row.confidence
    }
  }
  const reviewCount = rows.filter((row) => row.needsReview).length
  const singleSeason = named.seasons.length === 1 ? named.seasons[0] : null
  const singleCampus = named.campuses.length === 1 ? named.campuses[0] : null
  const schemes = Array.from({ length: columnCount }, (_, index) => {
    // 每列优先用空间提示/组合矩阵中属于该列的名称；
    // 仅当该列没有自己的识别结果且全局只识别到一个名称时才允许兜底，
    // 绝不把第一列的校区/季节强行套到其它列上。
    const combo = combinations[index] || null
    const hint = spatialHints[index] || null
    const hintSeason = hint ? { id: hint.seasonId, value: hint.season, score: hint.seasonScore } : null
    const hintCampus = hint ? { id: hint.campusId, value: hint.campus, score: hint.campusScore } : null
    const detectedSeason = hintSeason || combo?.season || named.seasons[index] || singleSeason || { id: null, value: '', score: 0 }
    const detectedCampus = hintCampus || combo?.campus || named.campuses[index] || singleCampus || { id: null, value: '', score: 0 }
    return {
      index,
      seasonId: detectedSeason.id || null,
      season: detectedSeason.value || '',
      seasonScore: detectedSeason.score || 0,
      campusId: detectedCampus.id || null,
      campus: detectedCampus.value || '',
      campusScore: detectedCampus.score || 0,
      rows: rows.map((row) => {
        const options = Array.isArray(row.timeOptions) ? row.timeOptions : []
        // 每列取自己的时间：只有该行仅有一组证据时才允许跨列复用，
        // 多组证据但缺当前列时必须留空并标记，避免把别的列/别的组数据串进来。
        const value = index < options.length
          ? options[index]
          : options.length === 1
            ? options[0]
            : { start: '', end: '' }
        const issues = [...row.issues]
        if (index >= options.length && options.length > 1) issues.push('该列未识别到此节时间')
        return { ...row, issues, start: value.start || '', end: value.end || '' }
      }),
    }
  })
  return {
    rows,
    schemes,
    campuses: named.campuses,
    seasons: named.seasons,
    issues: rows.flatMap((row) => row.issues.map((message) => ({ row: row.label, message }))),
    summary: { total: rows.length, normal: rows.length - reviewCount, review: reviewCount },
  }
}
