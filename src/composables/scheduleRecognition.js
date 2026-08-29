// 作息识别暂存层（recognitionDraft）：图片/文本识别结果先进入这里，
// 用户校对 → 校验 → 生成导入计划 → 确认后一次性写入正式作息。
// 本模块全部为纯函数，不直接依赖 Vue；正式数据（timeConfig）只会在
// 用户确认导入计划后被触碰，且全程可快照/撤销。

import { normalizePeriod } from './scheduleOcrParser.js'
import { seasonsForCampus, seasonAppliesTo } from './store/timeConfig.js'

export const RECOGNITION_ISSUE = {
  UNRECOGNIZED: 'unrecognized',     // 识别不确定：OCR 无法确认内容
  MISSING_TIME: 'missing-time',     // 时间缺失：某一节缺少开始/结束时间
  TIME_CONFLICT: 'time-conflict',   // 真实时间冲突：同组内不同节次确实交叉
  MAPPING_PENDING: 'mapping-pending', // 映射待确认：无法确定归属的校区/作息方案
}

const ISSUE_TEXT = {
  [RECOGNITION_ISSUE.UNRECOGNIZED]: '识别不确定',
  [RECOGNITION_ISSUE.MISSING_TIME]: '时间缺失',
  [RECOGNITION_ISSUE.TIME_CONFLICT]: '时间冲突',
  [RECOGNITION_ISSUE.MAPPING_PENDING]: '映射待确认',
}

export function issueTypeText(type) {
  return ISSUE_TEXT[type] ?? '待确认'
}

function toMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? ''))
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return Number.isFinite(minutes) ? minutes : null
}

let idSeed = 0
function nextId(prefix) {
  idSeed += 1
  return `${prefix}-${Date.now().toString(36)}-${idSeed}`
}

// ---------- 行 → 节次索引映射 ----------

// 将识别出的行对应到基础设置的节次：优先精确名称，其次归一化节次号，
// 数量与节次一致时允许按位置兜底；无法对应返回 -1（绝不猜测写入）。
export function mapRowToPeriodIndex(row, periods, fallbackIndex, rowCount) {
  const label = String(row.label ?? '').trim()
  if (label) {
    const exact = periods.findIndex((period) => period.label.trim() === label)
    if (exact >= 0) return exact
  }
  const parsed = normalizePeriod(label)
  if (parsed) {
    const normalized = periods.findIndex((period) => {
      const parsedPeriod = normalizePeriod(period.label)
      return (parsedPeriod && parsedPeriod.key === parsed.key) || period.label.trim() === parsed.label
    })
    if (normalized >= 0) return normalized
  }
  return rowCount === periods.length ? fallbackIndex : -1
}

// ---------- 目标匹配（自动映射到现有 校区 × 作息方案） ----------

function findCampus(scheme, cfg) {
  const byId = scheme.campusId ? cfg.campuses.find((c) => c.id === scheme.campusId) : null
  if (byId) {
    return { campus: byId, reliable: Number(scheme.campusScore || 0) >= 0.82 }
  }
  const name = String(scheme.campus ?? '').trim()
  if (name) {
    const byName = cfg.campuses.find((c) => c.name === name)
    if (byName) return { campus: byName, reliable: true }
  }
  return { campus: null, reliable: false }
}

function findSeason(scheme, cfg, campusId) {
  const pool = campusId ? seasonsForCampus(campusId, cfg) : cfg.seasons
  const byId = scheme.seasonId ? pool.find((s) => s.id === scheme.seasonId) : null
  if (byId) {
    return { season: byId, reliable: Number(scheme.seasonScore || 0) >= 0.82 }
  }
  const name = String(scheme.season ?? '').trim()
  if (name) {
    const byName = pool.find((s) => s.name === name)
    if (byName) return { season: byName, reliable: true }
  }
  return { season: null, reliable: false }
}

// 校区确定后查找作息方案；无法按名称/ID 匹配且 OCR 没给出季节名、
// 该校区又只有一个方案时直接采用（绝不覆盖用户明确命名的其它方案）
function findSeasonWithFallback(scheme, cfg, campusId) {
  const hit = findSeason(scheme, cfg, campusId)
  if (hit.season) return hit
  if (String(scheme.season ?? '').trim()) return hit
  const pool = campusId ? seasonsForCampus(campusId, cfg) : cfg.seasons
  if (pool.length === 1) return { season: pool[0], reliable: false }
  return hit
}

// 返回 { mode, seasonId, campusId, newSeasonName, newCampusName, reason }
// mode: 'replace' 已存在 → 推荐替换；'create' 不存在 → 推荐新建；'pending' 待确认
export function resolveSchemeTarget(scheme, cfg) {
  const campusHit = findCampus(scheme, cfg)

  // 校区确定
  if (campusHit.campus) {
    const campusId = campusHit.campus.id
    const seasonHit = findSeasonWithFallback(scheme, cfg, campusId)
    if (seasonHit.season) {
      const season = seasonHit.season
      if (seasonAppliesTo(season, campusId)) {
        return {
          mode: 'replace',
          seasonId: season.id,
          campusId,
          newSeasonName: '',
          newCampusName: '',
          reason: 'ok',
        }
      }
      // 作息季存在但不适用于该校区 → 待确认
      return {
        mode: 'pending',
        seasonId: '',
        campusId,
        newSeasonName: String(scheme.season ?? '').trim(),
        newCampusName: '',
        reason: 'scope-mismatch',
      }
    }
    // 校区存在、作息方案不存在 → 用识别到的名称新建
    const newSeasonName = String(scheme.season ?? '').trim()
    const duplicated = newSeasonName && cfg.seasons.some((s) => s.name === newSeasonName)
    if (duplicated) {
      return { mode: 'pending', seasonId: '', campusId, newSeasonName, newCampusName: '', reason: 'season-name-taken' }
    }
    return {
      mode: newSeasonName ? 'create' : 'pending',
      seasonId: '',
      campusId,
      newSeasonName,
      newCampusName: '',
      reason: newSeasonName ? 'new-season' : 'no-season',
    }
  }

  // 校区未确定：识别到了校区名 → 推荐新建校区；否则单校区兜底
  const detectedCampus = String(scheme.campus ?? '').trim()
  if (detectedCampus) {
    const newSeasonName = String(scheme.season ?? '').trim()
    const seasonByName = newSeasonName ? cfg.seasons.find((s) => s.name === newSeasonName) : null
    if (seasonByName) {
      // 作息方案存在，只缺校区 → 新建校区后替换该方案
      return {
        mode: 'create',
        seasonId: seasonByName.id,
        campusId: '',
        newSeasonName: '',
        newCampusName: detectedCampus,
        reason: 'new-campus',
      }
    }
    return {
      mode: 'create',
      seasonId: '',
      campusId: '',
      newSeasonName,
      newCampusName: detectedCampus,
      reason: 'new-both',
    }
  }
  if (cfg.campuses.length === 1) {
    const campusId = cfg.campuses[0].id
    const seasonHit = findSeasonWithFallback(scheme, cfg, campusId)
    if (seasonHit.season && seasonAppliesTo(seasonHit.season, campusId)) {
      return {
        mode: 'replace',
        seasonId: seasonHit.season.id,
        campusId,
        newSeasonName: '',
        newCampusName: '',
        reason: 'ok',
      }
    }
    if (seasonHit.season) {
      return { mode: 'pending', seasonId: '', campusId, newSeasonName: String(scheme.season ?? '').trim(), newCampusName: '', reason: 'scope-mismatch' }
    }
    const newSeasonName = String(scheme.season ?? '').trim()
    const duplicated = newSeasonName && cfg.seasons.some((s) => s.name === newSeasonName)
    if (duplicated) {
      return { mode: 'pending', seasonId: '', campusId, newSeasonName, newCampusName: '', reason: 'season-name-taken' }
    }
    return {
      mode: newSeasonName ? 'create' : 'pending',
      seasonId: '',
      campusId,
      newSeasonName,
      newCampusName: '',
      reason: newSeasonName ? 'new-season' : 'no-season',
    }
  }
  return {
    mode: 'pending',
    seasonId: '',
    campusId: '',
    newSeasonName: String(scheme.season ?? '').trim(),
    newCampusName: detectedCampus,
    reason: 'no-campus',
  }
}

export const TARGET_REASON_TEXT = {
  ok: '',
  manual: '',
  'scope-mismatch': '识别到的作息方案不适用于该校区，请调整校区或作息季',
  'season-name-taken': '已存在同名作息方案，请确认是否为同一方案，或修改新建名称',
  'new-season': '未找到匹配的作息方案，将新建',
  'new-campus': '未找到匹配的校区，将新建校区后导入',
  'new-both': '未找到匹配的校区和作息方案，将新建后导入',
  'no-season': '请选择或命名作息方案',
  'no-campus': '无法确定所属校区，请选择或命名',
}

// ---------- 识别草稿 ----------

function detectedLabel(scheme) {
  return [scheme.season, scheme.campus].map((part) => String(part ?? '').trim()).filter(Boolean).join(' · ')
}

// 展示名：优先用户确认后的目标（实时配置），其次 OCR 识别到的原始标题
export function schemeDisplayName(scheme, cfg) {
  const target = scheme.target ?? {}
  if (target.mode === 'replace' && target.seasonId && target.campusId) {
    const season = cfg.seasons.find((s) => s.id === target.seasonId)
    const campus = cfg.campuses.find((c) => c.id === target.campusId)
    if (season && campus) return `${season.name} · ${campus.name}`
  }
  if (target.mode === 'create') {
    const seasonName = target.seasonId
      ? cfg.seasons.find((s) => s.id === target.seasonId)?.name
      : target.newSeasonName
    const campusName = target.campusId
      ? cfg.campuses.find((c) => c.id === target.campusId)?.name
      : target.newCampusName
    const label = [seasonName, campusName].map((part) => String(part ?? '').trim()).filter(Boolean).join(' · ')
    if (label) return label
  }
  return detectedLabel(scheme) || `识别结果 ${(scheme.index ?? 0) + 1}`
}

function createSchemeRow(raw, index) {
  return {
    id: nextId('row'),
    key: raw.key ?? '',
    label: String(raw.label ?? ''),
    periodStart: raw.periodStart ?? null,
    periodEnd: raw.periodEnd ?? null,
    start: String(raw.start ?? ''),
    end: String(raw.end ?? ''),
    confidence: raw.confidence ?? 'low',
    score: Number(raw.score ?? 0),
    source: raw.source ?? '',
    sourceIssues: [...(raw.issues ?? [])], // 来自 OCR 的原始疑虑（低置信度/多次识别冲突等）
    confirmed: false,
  }
}

// 从 parseScheduleOCR 的输出构建识别草稿
export function buildRecognitionDraft(analysis, cfg, sourceName = '') {
  const schemes = analysis?.schemes?.length
    ? analysis.schemes
    : (analysis?.rows?.length
        ? [{ index: 0, seasonId: null, season: '', seasonScore: 0, campusId: null, campus: '', campusScore: 0, rows: analysis.rows }]
        : [])
  return {
    id: nextId('draft'),
    createdAt: Date.now(),
    sourceName: String(sourceName ?? ''),
    schemes: schemes.map((scheme, index) => ({
      id: nextId('scheme'),
      index,
      selected: true,
      detectedSeason: String(scheme.season ?? ''),
      detectedCampus: String(scheme.campus ?? ''),
      seasonScore: Number(scheme.seasonScore ?? 0),
      campusScore: Number(scheme.campusScore ?? 0),
      rows: (scheme.rows ?? []).map((row, rowIndex) => createSchemeRow(row, rowIndex)),
      target: resolveSchemeTarget(scheme, cfg),
    })),
  }
}

// ---------- 校验（只在同一组作息内部进行） ----------

// 首尾相接（下一节开始 == 上一节结束）不属于重叠；
// 只有下一节开始时间 < 上一节结束时间才是真正的重叠。
export function validateSchemeRows(scheme, cfg) {
  const rowIssues = new Map()
  // blocking = 必须处理后才能导入；非阻塞项会明确告知导入时如何处理
  const add = (row, type, message, blocking = true) => {
    if (!rowIssues.has(row.id)) rowIssues.set(row.id, [])
    rowIssues.get(row.id).push({ type, message, blocking })
  }
  const rowCount = scheme.rows.length
  const seenIndex = new Map()
  let mappedCount = 0
  let keepOldCount = 0
  const missingCandidates = []

  scheme.rows.forEach((row, index) => {
    const periodIndex = mapRowToPeriodIndex(row, cfg.periods, index, rowCount)
    if (periodIndex >= 0) {
      if (seenIndex.has(periodIndex)) {
        add(row, RECOGNITION_ISSUE.UNRECOGNIZED, `与「${cfg.periods[seenIndex.get(periodIndex)]?.label ?? row.label}」对应同一节次`)
      } else {
        seenIndex.set(periodIndex, index)
        mappedCount += 1
      }
    } else {
      add(row, RECOGNITION_ISSUE.UNRECOGNIZED, '无法对应到基础设置中的节次')
    }
    if (!row.start || !row.end) {
      missingCandidates.push({ row, periodIndex })
      return
    }
    const start = toMinutes(row.start)
    const end = toMinutes(row.end)
    if (start === null || end === null || start >= end) {
      add(row, RECOGNITION_ISSUE.TIME_CONFLICT, '开始时间必须早于结束时间')
      return
    }
    // 与前一节比较：只在同组内部检查，且严格小于才算重叠
    for (let prev = index - 1; prev >= 0; prev--) {
      const previous = scheme.rows[prev]
      if (!previous.start || !previous.end) continue
      const prevEnd = toMinutes(previous.end)
      if (prevEnd === null) continue
      if (start < prevEnd) {
        add(row, RECOGNITION_ISSUE.TIME_CONFLICT, `与「${previous.label || '上一节'}」时间重叠`)
      }
      break
    }
  })

  // 时间缺失：替换已有方案且原时间存在时，导入会明确保留原时间（非阻塞）；
  // 否则必须由用户补齐或确认（阻塞），绝不静默填假时间。
  const target = scheme.target ?? {}
  const existingTimes =
    target.mode === 'replace' && target.seasonId && target.campusId
      ? cfg.times?.[target.seasonId]?.[target.campusId] ?? []
      : null
  for (const { row, periodIndex } of missingCandidates) {
    const old = periodIndex >= 0 ? existingTimes?.[periodIndex] : null
    if (old?.start && old?.end) {
      keepOldCount += 1
      add(row, RECOGNITION_ISSUE.MISSING_TIME, `未识别，导入后将保留原时间 ${old.start}–${old.end}`, false)
    } else {
      add(row, RECOGNITION_ISSUE.MISSING_TIME, '未识别，请确认')
    }
  }

  // OCR 原始疑虑（多次识别冲突/低置信度）作为软提示，用户确认后不再提示
  for (const row of scheme.rows) {
    if (row.sourceIssues.length && !row.confirmed) {
      add(row, RECOGNITION_ISSUE.UNRECOGNIZED, row.sourceIssues.join('；'), false)
    }
  }

  let hardRowCount = 0
  let softRowCount = 0
  for (const issues of rowIssues.values()) {
    if (issues.some((issue) => issue.blocking)) hardRowCount += 1
    else softRowCount += 1
  }
  return {
    rowIssues,
    mappedCount,
    keepOldCount,
    hardRowCount,
    softRowCount,
    issueRowCount: rowIssues.size,
  }
}

export function targetPendingReasonText(scheme) {
  return TARGET_REASON_TEXT[scheme.target?.reason] ?? '无法确定该组作息的归属，请确认'
}

// 组级状态：'ready' 可直接导入；'review' 有待处理项；'pending' 映射待确认
export function schemeStatus(scheme, cfg) {
  if (scheme.target?.mode === 'pending') return 'pending'
  const validation = validateSchemeRows(scheme, cfg)
  if (validation.hardRowCount > 0 || validation.mappedCount === 0) return 'blocked'
  if (validation.issueRowCount > 0) return 'review'
  return 'ready'
}

export function schemeSummaryText(scheme, cfg) {
  const validation = validateSchemeRows(scheme, cfg)
  const parts = []
  if (validation.mappedCount < scheme.rows.length) {
    parts.push(`${scheme.rows.length - validation.mappedCount} 项无法对应节次`)
  }
  if (validation.rowIssues.size) parts.push(`${validation.rowIssues.size} 项待确认`)
  return parts
}

// ---------- 导入计划 ----------

export function buildReplaceDiff(scheme, cfg) {
  const target = scheme.target ?? {}
  const existing = cfg.times?.[target.seasonId]?.[target.campusId] ?? []
  const rowCount = scheme.rows.length
  const changes = []
  const added = []
  let mappedCount = 0
  scheme.rows.forEach((row, index) => {
    if (!row.start || !row.end) return
    const periodIndex = mapRowToPeriodIndex(row, cfg.periods, index, rowCount)
    if (periodIndex < 0) return
    mappedCount += 1
    const label = cfg.periods[periodIndex]?.label ?? row.label
    const old = existing[periodIndex]
    if (!old?.start || !old?.end) {
      added.push({ index: periodIndex, label, from: '', to: `${row.start}–${row.end}` })
    } else if (old.start !== row.start || old.end !== row.end) {
      changes.push({ index: periodIndex, label, from: `${old.start}–${old.end}`, to: `${row.start}–${row.end}` })
    }
  })
  return {
    changes,
    added,
    mappedCount,
    changedCount: changes.length + added.length,
    oldCount: existing.filter((item) => item?.start && item?.end).length,
  }
}

function buildPlanItem(scheme, action, cfg) {
  const target = scheme.target ?? {}
  const item = {
    schemeId: scheme.id,
    index: scheme.index,
    label: schemeDisplayName(scheme, cfg),
    targetMode: target.mode ?? 'pending',
    action, // 'replace' | 'create' | 'skip'
    seasonId: target.seasonId ?? '',
    campusId: target.campusId ?? '',
    newSeasonName: target.newSeasonName ?? '',
    newCampusName: target.newCampusName ?? '',
    rows: scheme.rows.map((row, index) => ({
      periodIndex: mapRowToPeriodIndex(row, cfg.periods, index, scheme.rows.length),
      start: row.start,
      end: row.end,
    })),
    diff: null,
    blockers: [],
    warnings: [],
  }
  if (action === 'skip') return item

  const validation = validateSchemeRows(scheme, cfg)
  if (validation.mappedCount === 0 && scheme.rows.length) {
    item.blockers.push('没有一条识别结果能对应到基础节次')
  }
  if (validation.hardRowCount > 0) {
    item.blockers.push(`${validation.hardRowCount} 项待处理（时间缺失、冲突或无法对应节次）`)
  }
  if (validation.keepOldCount > 0) {
    item.warnings.push(`${validation.keepOldCount} 项未识别，导入后将保留原时间`)
  }

  if (action === 'replace') {
    if (!item.seasonId || !item.campusId) {
      item.blockers.push('导入目标不完整，请先在编辑中确认校区与作息方案')
    } else {
      item.diff = buildReplaceDiff(scheme, cfg)
    }
    return item
  }

  // create：校验新建名称；对"替换已有"目标选择新建时，自动派生副本名
  let seasonName = String(item.newSeasonName ?? '').trim()
  const campusName = String(item.newCampusName ?? '').trim()
  if (action === 'create' && target.mode === 'replace') {
    const season = cfg.seasons.find((candidate) => candidate.id === target.seasonId)
    const stem = String(season?.name || scheme.detectedSeason || '新方案').replace(/（?副本\d*）?$/, '') || '新方案'
    let name = `${stem}（副本）`
    let count = 2
    while (cfg.seasons.some((candidate) => candidate.name === name)) name = `${stem}（副本${count++}）`
    item.seasonId = ''
    item.newSeasonName = name
    seasonName = name
  }
  if (item.seasonId) {
    // 复用已有作息方案（只新建校区）
  } else if (!seasonName) {
    item.blockers.push('请为新建的作息方案命名')
  } else if (cfg.seasons.some((season) => season.name === seasonName)) {
    item.blockers.push(`已存在同名作息方案「${seasonName}」`)
  }
  if (item.campusId) {
    // 复用已有校区
  } else if (!campusName) {
    item.blockers.push('请为新建的校区命名')
  } else if (cfg.campuses.some((campus) => campus.name === campusName)) {
    item.blockers.push(`已存在同名校区「${campusName}」`)
  }
  if (!item.seasonId) {
    item.warnings.push('新建的作息方案未设置生效日期，配置后才会参与自动切换')
  }
  return item
}

// overrides: { [schemeId]: 'replace'|'create'|'skip' }，未指定的组按推荐方案执行
export function buildImportPlan(draft, cfg, overrides = {}, scope = null) {
  const schemes = draft.schemes.filter((scheme) =>
    scope ? scheme.id === scope : scheme.selected !== false
  )
  const items = schemes.map((scheme) => {
    const override = overrides[scheme.id]
    const action = override ?? (scheme.target?.mode === 'pending' ? 'skip' : scheme.target?.mode ?? 'skip')
    return buildPlanItem(scheme, action, cfg)
  })

  // 同一目标不能被两组同时替换
  const claimed = new Map()
  for (const item of items) {
    if (item.action === 'skip' || item.blockers.length) continue
    const key = item.action === 'create'
      ? `create:${item.seasonId || `new:${item.newSeasonName}`}:${item.campusId || `new:${item.newCampusName}`}`
      : `${item.seasonId}:${item.campusId}`
    if (claimed.has(key)) {
      item.blockers.push(`与「${claimed.get(key)}」的导入目标重复`)
    } else {
      claimed.set(key, item.label)
    }
  }

  const summary = {
    total: items.length,
    replace: items.filter((item) => item.action === 'replace' && !item.blockers.length).length,
    create: items.filter((item) => item.action === 'create' && !item.blockers.length).length,
    skip: items.filter((item) => item.action === 'skip').length,
    blocked: items.filter((item) => item.action !== 'skip' && item.blockers.length).length,
    issues: items.reduce(
      (sum, item) => sum + (item.blockers.length ? 1 : 0),
      0,
    ),
  }
  return {
    createdAt: Date.now(),
    items,
    summary,
    executable: items.every((item) => item.action === 'skip' || !item.blockers.length)
      && items.some((item) => item.action !== 'skip'),
  }
}

// ---------- 事务执行（全部成功或全部保持原状） ----------

export function snapshotTimeConfig(cfg) {
  return JSON.parse(JSON.stringify({
    campuses: cfg.campuses,
    seasons: cfg.seasons,
    times: cfg.times,
  }))
}

export function restoreTimeConfig(cfg, snapshot) {
  cfg.campuses = JSON.parse(JSON.stringify(snapshot.campuses))
  cfg.seasons = JSON.parse(JSON.stringify(snapshot.seasons))
  cfg.times = JSON.parse(JSON.stringify(snapshot.times))
}

function cloneTemplate(list, periods) {
  if (Array.isArray(list) && list.length) return JSON.parse(JSON.stringify(list))
  return periods.map(() => ({ start: '', end: '' }))
}

// 执行单条导入项：缺校区建校区、缺方案建方案，再按节次写入时间。
// 未识别的节次：替换时保留原时间；全新方案保持为空（编辑器中显示"时间尚未设置"）。
export function applyImportItem(item, cfg) {
  let campusId = item.campusId
  const campusCreated = !campusId
  if (!campusId) {
    campusId = 'campus' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    cfg.campuses.push({ id: campusId, name: item.newCampusName.trim() })
    // 新校区：为其它已有作息季克隆首个校区的模板，避免出现残缺配置
    const templateCampus = cfg.campuses.find((campus) => campus.id !== campusId)
    for (const season of cfg.seasons) {
      if (cfg.times[season.id]?.[campusId]) continue
      cfg.times[season.id] = cfg.times[season.id] ?? {}
      cfg.times[season.id][campusId] = cloneTemplate(
        cfg.times[season.id]?.[templateCampus?.id],
        cfg.periods,
      )
    }
  }
  let seasonId = item.seasonId
  if (!seasonId) {
    seasonId = 'season' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    cfg.seasons.push({ id: seasonId, name: item.newSeasonName.trim(), startDate: '' })
    cfg.times[seasonId] = {}
    const templateSeason = cfg.seasons.find((season) => season.id !== seasonId)
    for (const campus of cfg.campuses) {
      cfg.times[seasonId][campus.id] = cloneTemplate(
        cfg.times[templateSeason?.id]?.[campus.id],
        cfg.periods,
      )
    }
  }
  // 新建校区导入到已有作息方案时，把新校区加入该方案的适用范围
  if (campusCreated) {
    const seasonObject = cfg.seasons.find((season) => season.id === seasonId)
    if (
      seasonObject
      && Array.isArray(seasonObject.campuses)
      && seasonObject.campuses.length
      && !seasonObject.campuses.includes(campusId)
    ) {
      seasonObject.campuses.push(campusId)
    }
  }
  cfg.times[seasonId] = cfg.times[seasonId] ?? {}
  const existing = Array.isArray(cfg.times[seasonId][campusId]) ? cfg.times[seasonId][campusId] : []
  cfg.times[seasonId][campusId] = cfg.periods.map((_, index) => {
    const row = item.rows.find((candidate) => candidate.periodIndex === index)
    if (row && row.start && row.end) return { start: row.start, end: row.end }
    const previous = existing[index]
    if (previous?.start && previous?.end) return { start: previous.start, end: previous.end }
    return { start: '', end: '' }
  })
  return { seasonId, campusId }
}

// 一次性执行整份计划；任一项失败则整体回滚并抛出异常。
export function executeImportPlan(plan, cfg) {
  const snapshot = snapshotTimeConfig(cfg)
  try {
    const applied = []
    for (const item of plan.items) {
      if (item.action === 'skip') continue
      if (item.blockers?.length) throw new Error(`「${item.label}」${item.blockers[0]}`)
      applied.push({ item, ...applyImportItem(item, cfg) })
    }
    cfg.updatedAt = new Date().toISOString()
    return { snapshot, applied }
  } catch (error) {
    restoreTimeConfig(cfg, snapshot)
    throw error
  }
}
