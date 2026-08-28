import { describe, expect, it } from 'vitest'
import { parseScheduleOCR } from '../src/composables/scheduleOcrParser.js'
import {
  RECOGNITION_ISSUE,
  applyImportItem,
  buildImportPlan,
  buildRecognitionDraft,
  buildReplaceDiff,
  executeImportPlan,
  mapRowToPeriodIndex,
  resolveSchemeTarget,
  restoreTimeConfig,
  snapshotTimeConfig,
  schemeDisplayName,
  schemeStatus,
  validateSchemeRows,
} from '../src/composables/scheduleRecognition.js'

function timesOf(pairs) {
  return pairs.map(([start, end]) => ({ start, end }))
}

function makeCfg({ campuses = 2, seasons = ['summer', 'winter'], withTimes = true } = {}) {
  const campusList = campuses === 1
    ? [{ id: 'south', name: '南校区' }]
    : campuses === 3
      ? [{ id: 'south', name: '南校区' }, { id: 'north', name: '北校区' }, { id: 'east', name: '东校区' }]
      : [{ id: 'south', name: '南校区' }, { id: 'north', name: '北校区' }]
  const seasonList = seasons.map((id) => ({
    id,
    name: id === 'summer' ? '夏季时间' : id === 'winter' ? '冬季时间' : id,
    startDate: '05-01',
  }))
  const periods = [
    { id: 'p0', label: '早自习' },
    ...Array.from({ length: 12 }, (_, i) => ({ id: 'p' + (i + 1), label: `第${i + 1}节课` })),
  ]
  const times = {}
  for (const season of seasonList) {
    times[season.id] = {}
    for (const campus of campusList) {
      times[season.id][campus.id] = withTimes
        ? timesOf([
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
            ['21:30', '22:15'],
          ])
        : []
    }
  }
  return { campuses: campusList, seasons: seasonList, periods, times }
}

function analysisFromText(text, cfg) {
  return parseScheduleOCR(text, { campuses: cfg.campuses, seasons: cfg.seasons })
}

const FOUR_COLUMN_TEXT = [
  '夏季时间 冬季时间',
  '南校区 北校区 南校区 北校区',
  '早自习 07:20-07:50 07:30-08:00 07:20-07:50 07:30-08:00',
  '第一节课 08:00-08:45 08:10-08:55 08:00-08:45 08:10-08:55',
  '第二节课 08:55-09:40 09:05-09:50 08:55-09:40 09:05-09:50',
  '第三节课 10:05-10:50 10:05-10:50 10:05-10:50 10:05-10:50',
  '第四节课 11:00-11:45 11:00-11:45 11:00-11:45 11:00-11:45',
  '第五节课 14:30-15:15 14:30-15:15 14:00-14:45 14:00-14:45',
  '第六节课 15:20-16:05 15:20-16:05 14:50-15:35 14:50-15:35',
  '第七节课 16:20-17:05 16:15-17:00 15:50-16:35 15:45-16:30',
  '第八节课 17:05-17:50 17:05-17:50 16:40-17:25 16:35-17:20',
  '第九节课 19:00-19:45 19:00-19:45 19:00-19:45 19:00-19:45',
  '第十节课 19:50-20:35 19:50-20:35 19:50-20:35 19:50-20:35',
  '第十一节课 20:40-21:25 20:40-21:25 20:40-21:25 20:40-21:25',
  '第十二节课 21:30-22:15 21:30-22:15 21:30-22:15 21:30-22:15',
].join('\n')

describe('识别暂存层 buildRecognitionDraft', () => {
  it('场景18：构建草稿绝不修改正式作息配置', () => {
    const cfg = makeCfg()
    const before = JSON.stringify(cfg)
    const analysis = analysisFromText('夏季时间 南校区\n第一节 08:00-08:45', cfg)
    buildRecognitionDraft(analysis, cfg, '测试图片')
    expect(JSON.stringify(cfg)).toBe(before)
  })

  it('场景5：一张图片识别 1 组', () => {
    const cfg = makeCfg()
    const analysis = analysisFromText('夏季时间 南校区\n第一节 08:00-08:45\n第二节 08:55-09:40', cfg)
    const draft = buildRecognitionDraft(analysis, cfg, 'img.png')
    expect(draft.schemes).toHaveLength(1)
  })

  it('场景6+7：一张图片识别 4 组（数量与名称完全动态）', () => {
    const cfg = makeCfg()
    const analysis = analysisFromText(FOUR_COLUMN_TEXT, cfg)
    const draft = buildRecognitionDraft(analysis, cfg, 'img.png')
    expect(draft.schemes.length).toBeGreaterThanOrEqual(4)
    expect(draft.schemes[0].rows.length).toBe(13)
  })

  it('场景4：多校区+多套作息时自动匹配到已有方案（替换）', () => {
    const cfg = makeCfg()
    const analysis = analysisFromText(FOUR_COLUMN_TEXT, cfg)
    const draft = buildRecognitionDraft(analysis, cfg, 'img.png')
    for (const scheme of draft.schemes.slice(0, 4)) {
      expect(scheme.target.mode).toBe('replace')
    }
    const names = draft.schemes.slice(0, 4).map((scheme) => schemeDisplayName(scheme, cfg))
    expect(names).toEqual([
      '夏季时间 · 南校区',
      '夏季时间 · 北校区',
      '冬季时间 · 南校区',
      '冬季时间 · 北校区',
    ])
  })

  it('场景3：多校区+1套作息，标题校区名无法匹配时推荐新建校区', () => {
    const cfg = makeCfg({ campuses: 2, seasons: ['summer'] })
    const analysis = analysisFromText('夏季时间 东校区\n第一节 08:00-08:45', cfg)
    const draft = buildRecognitionDraft(analysis, cfg, 'img.png')
    expect(draft.schemes[0].target.mode).toBe('create')
    expect(draft.schemes[0].target.newCampusName).toBe('东校区')
    expect(draft.schemes[0].target.seasonId).toBe('summer')
  })

  it('场景1：1校区+1套作息，无标题时单校区兜底替换', () => {
    const cfg = makeCfg({ campuses: 1, seasons: ['summer'] })
    const analysis = analysisFromText('第一节 08:00-08:45\n第二节 08:55-09:40', cfg)
    const draft = buildRecognitionDraft(analysis, cfg, 'img.png')
    expect(draft.schemes[0].target.mode).toBe('replace')
    expect(schemeDisplayName(draft.schemes[0], cfg)).toBe('夏季时间 · 南校区')
  })

  it('场景1b：1校区但标题是别的校区名 → 不冒名顶替，推荐新建', () => {
    const cfg = makeCfg({ campuses: 1, seasons: ['summer'] })
    const analysis = analysisFromText('夏季时间 东校区\n第一节 08:00-08:45', cfg)
    const draft = buildRecognitionDraft(analysis, cfg, 'img.png')
    expect(draft.schemes[0].target.mode).toBe('create')
    expect(draft.schemes[0].target.newCampusName).toBe('东校区')
  })

  it('场景2：识别到已知方案名但不适用于该校区 → 待确认（不冒名新建）', () => {
    const cfg = makeCfg({ campuses: 1, seasons: ['winter'] })
    // 冬季时间只适用于北校区，南校区图片不应被悄悄映射或新建
    cfg.seasons[0].campuses = ['north']
    const analysis = analysisFromText('冬季时间 南校区\n第一节 08:00-08:45', cfg)
    const draft = buildRecognitionDraft(analysis, cfg, 'img.png')
    expect(draft.schemes[0].target.mode).toBe('pending')
    expect(schemeStatus(draft.schemes[0], cfg)).toBe('pending')
  })

  it('场景2b：用户命名的新方案 + 已有校区 → 计划为"新建"', () => {
    const cfg = makeCfg({ campuses: 1, seasons: ['summer'] })
    const scheme = {
      id: 'a', index: 0, detectedSeason: '', detectedCampus: '', seasonScore: 0, campusScore: 0,
      target: { mode: 'create', seasonId: '', campusId: 'south', newSeasonName: '春季时间', newCampusName: '', reason: 'manual' },
      rows: [
        { id: 'r0', key: '1-1', label: '第1节课', periodStart: 1, periodEnd: 1, start: '08:00', end: '08:45', confidence: 'high', score: 0.9, source: '', sourceIssues: [], confirmed: true },
      ],
    }
    const plan = buildImportPlan({ schemes: [scheme] }, cfg)
    expect(plan.summary.create).toBe(1)
    expect(plan.executable).toBe(true)
  })
  it('场景17：布局感知 OCR 结果（text+layout+regions）切换识别组时数据不串组', () => {
    const cfg = makeCfg()
    const analysis = parseScheduleOCR({
      text: '夏季时间 冬季时间\n南校区 北校区 南校区 北校区\n第一节课 08:00-08:45 08:10-08:55 08:00-08:45 08:10-08:55\n第二节课 08:55-09:40 09:05-09:50 08:55-09:40 09:05-09:50',
      regions: [
        { text: '第一节课 08:00-08:45', confidence: 88, source: 'table-row' },
        { text: '第二节课 08:55-09:40', confidence: 88, source: 'table-row' },
      ],
    }, { campuses: cfg.campuses, seasons: cfg.seasons })
    const draft = buildRecognitionDraft(analysis, cfg, 'img.png')
    expect(draft.schemes.length).toBe(4)
    // 各组第一节课时间互不相同 → 不允许串组
    const firstPeriodStarts = draft.schemes.map((scheme) => scheme.rows[0].start)
    expect(new Set(firstPeriodStarts).size).toBe(2)
    expect(draft.schemes.map((scheme) => scheme.rows[0].start)).toEqual([
      '08:00', '08:10', '08:00', '08:10',
    ])
    // 每组各自的替换目标正确
    expect(draft.schemes.map((scheme) => [scheme.target.seasonId, scheme.target.campusId])).toEqual([
      ['summer', 'south'], ['summer', 'north'], ['winter', 'south'], ['winter', 'north'],
    ])
    const plan = buildImportPlan(draft, cfg)
    expect(plan.executable).toBe(true)
    executeImportPlan(plan, cfg)
    expect(cfg.times.summer.north[1]).toEqual({ start: '08:10', end: '08:55' })
    expect(cfg.times.winter.south[1]).toEqual({ start: '08:00', end: '08:45' })
    expect(cfg.times.winter.north[1]).toEqual({ start: '08:10', end: '08:55' })
  })

  it('场景17b：某行某一列时间缺失时留空并标记，绝不复制其它列或默认值', () => {
    const cfg = makeCfg()
    const analysis = parseScheduleOCR({
      text: [
        '夏季时间 冬季时间',
        '南校区 北校区 南校区 北校区',
        '第一节课 08:00-08:45 08:10-08:55 08:00-08:45 08:10-08:55',
        '第二节课 08:55-09:40 09:05-09:50 08:55-09:40',
      ].join('\n'),
      regions: [],
    }, { campuses: cfg.campuses, seasons: cfg.seasons })
    const draft = buildRecognitionDraft(analysis, cfg, 'img.png')
    expect(draft.schemes).toHaveLength(4)
    // 第二节课的第4列未识别到 → 留空 + 标记，而不是复制第3列
    const missing = draft.schemes[3].rows.find((row) => row.label.includes('2'))
    expect(missing.start).toBe('')
    expect(missing.end).toBe('')
    expect(missing.sourceIssues.join(' ')).toContain('该列未识别到此节时间')
    // 该列有值的第一节课不受影响
    expect(draft.schemes[3].rows[0].start).toBe('08:10')
  })
})

describe('时间校验 validateSchemeRows（只在同组内部）', () => {
  function schemeFrom(rows, target = { mode: 'replace', seasonId: 'summer', campusId: 'south', newSeasonName: '', newCampusName: '', reason: 'ok' }) {
    return {
      id: 's1',
      index: 0,
      detectedSeason: '',
      detectedCampus: '',
      seasonScore: 1,
      campusScore: 1,
      target,
      rows: rows.map((row, i) => ({
        id: `r${i}`,
        key: '',
        label: row.label,
        periodStart: null,
        periodEnd: null,
        start: row.start ?? '',
        end: row.end ?? '',
        confidence: 'high',
        score: 0.9,
        source: 'test',
        sourceIssues: [],
        confirmed: false,
      })),
    }
  }

  it('场景13：相邻节次首尾相接（17:05 结束 → 17:05 开始）不算重叠', () => {
    const cfg = makeCfg()
    const scheme = schemeFrom([
      { label: '第7节课', start: '16:20', end: '17:05' },
      { label: '第8节课', start: '17:05', end: '17:50' },
      { label: '第9节课', start: '19:00', end: '19:45' },
    ])
    const validation = validateSchemeRows(scheme, cfg)
    expect(validation.rowIssues.size).toBe(0)
    expect(schemeStatus(scheme, cfg)).toBe('ready')
  })

  it('场景14：真正的时间交叉 → 同组内标记时间冲突且阻塞导入', () => {
    const cfg = makeCfg()
    const scheme = schemeFrom([
      { label: '第1节课', start: '08:00', end: '09:00' },
      { label: '第2节课', start: '08:30', end: '09:40' },
    ])
    const validation = validateSchemeRows(scheme, cfg)
    expect(validation.hardRowCount).toBe(1)
    const issues = [...validation.rowIssues.values()][0]
    expect(issues[0].type).toBe(RECOGNITION_ISSUE.TIME_CONFLICT)
    expect(schemeStatus(scheme, cfg)).toBe('blocked')
  })

  it('场景11：OCR 缺失某一节 → 显式"未识别"；替换时保留原时间（不阻塞），新建时阻塞', () => {
    const cfg = makeCfg()
    const scheme = schemeFrom([
      { label: '第1节课', start: '08:00', end: '08:45' },
      { label: '第2节课', start: '', end: '' },
      { label: '第3节课', start: '08:55', end: '09:40' },
    ])
    const validation = validateSchemeRows(scheme, cfg)
    const issues = validation.rowIssues.get('r1')
    expect(issues[0].type).toBe(RECOGNITION_ISSUE.MISSING_TIME)
    expect(issues[0].message).toContain('未识别')
    expect(issues[0].blocking).toBe(false)
    expect(issues[0].message).toContain('08:55–09:40')

    const freshCfg = makeCfg({ withTimes: false })
    const validationNew = validateSchemeRows(scheme, freshCfg)
    const issuesNew = validationNew.rowIssues.get('r1')
    expect(issuesNew[0].blocking).toBe(true)
  })

  it('场景12：低置信度/多次识别冲突是软提示，确认后不再提示', () => {
    const cfg = makeCfg()
    const scheme = schemeFrom([{ label: '第1节课', start: '08:00', end: '08:45' }])
    scheme.rows[0].sourceIssues = ['多次识别结果冲突：08:00-08:45 / 06:00-08:45']
    let validation = validateSchemeRows(scheme, cfg)
    expect(validation.rowIssues.has('r0')).toBe(true)
    scheme.rows[0].confirmed = true
    validation = validateSchemeRows(scheme, cfg)
    expect(validation.rowIssues.size).toBe(0)
  })

  it('映射待确认：无法确定归属时 pending，且不出现在时间冲突里', () => {
    const cfg = makeCfg()
    const analysis = analysisFromText('第一节 08:00-08:45\n第二节 08:55-09:40', cfg)
    const draft = buildRecognitionDraft(analysis, { ...cfg, campuses: cfg.campuses, seasons: cfg.seasons }, 'x')
    expect(schemeStatus(draft.schemes[0], cfg)).toBe('pending')
  })
})

describe('导入计划 buildImportPlan', () => {
  it('场景8：已存在作息 → 推荐替换；差异预览只列变化项', () => {
    const cfg = makeCfg()
    const analysis = analysisFromText(FOUR_COLUMN_TEXT, cfg)
    const draft = buildRecognitionDraft(analysis, cfg, 'img.png')
    const plan = buildImportPlan(draft, cfg)
    expect(plan.summary.replace).toBe(4)
    expect(plan.executable).toBe(true)
    const item = plan.items[0]
    expect(item.diff).toBeTruthy()
    expect(item.diff.changedCount).toBeGreaterThan(0)
    for (const change of item.diff.changes) {
      expect(change.from).not.toBe(change.to)
    }
  })

  it('场景9：不存在作息 → 推荐新建；执行后创建方案并写入', () => {
    const cfg = makeCfg({ campuses: 1, seasons: ['summer'] })
    // 方案名无法被 OCR 保守识别时，由用户在详情编辑中命名后进入计划
    const scheme = {
      id: 'a', index: 0, detectedSeason: '', detectedCampus: '', seasonScore: 0, campusScore: 0,
      target: { mode: 'create', seasonId: '', campusId: 'south', newSeasonName: '春季时间', newCampusName: '', reason: 'manual' },
      rows: [
        { id: 'r0', key: '1-1', label: '第1节课', periodStart: 1, periodEnd: 1, start: '08:00', end: '08:45', confidence: 'high', score: 0.9, source: '', sourceIssues: [], confirmed: true },
        { id: 'r1', key: '2-2', label: '第2节课', periodStart: 2, periodEnd: 2, start: '08:55', end: '09:40', confidence: 'high', score: 0.9, source: '', sourceIssues: [], confirmed: true },
      ],
    }
    const plan = buildImportPlan({ schemes: [scheme] }, cfg)
    expect(plan.summary.create).toBe(1)
    expect(plan.executable).toBe(true)
    executeImportPlan(plan, cfg)
    expect(cfg.seasons.some((season) => season.name === '春季时间')).toBe(true)
    const newSeason = cfg.seasons.find((season) => season.name === '春季时间')
    expect(cfg.times[newSeason.id].south[1]).toEqual({ start: '08:00', end: '08:45' })
    expect(cfg.times[newSeason.id].south[2]).toEqual({ start: '08:55', end: '09:40' })
  })

  it('场景10：部分已存在、部分不存在 → 混合计划（替换+新建）', () => {
    const cfg = makeCfg({ campuses: 1, seasons: ['summer'] })
    const replaceScheme = {
      id: 'a', index: 0, detectedSeason: '夏季时间', detectedCampus: '南校区', seasonScore: 1, campusScore: 1,
      target: { mode: 'replace', seasonId: 'summer', campusId: 'south', newSeasonName: '', newCampusName: '', reason: 'ok' },
      rows: [
        { id: 'r0', key: '1-1', label: '第1节课', periodStart: 1, periodEnd: 1, start: '08:05', end: '08:50', confidence: 'high', score: 0.9, source: '', sourceIssues: [], confirmed: true },
      ],
    }
    const createScheme = {
      id: 'b', index: 1, detectedSeason: '', detectedCampus: '', seasonScore: 0, campusScore: 0,
      target: { mode: 'create', seasonId: '', campusId: 'south', newSeasonName: '春季时间', newCampusName: '', reason: 'manual' },
      rows: [
        { id: 'r0', key: '1-1', label: '第1节课', periodStart: 1, periodEnd: 1, start: '07:40', end: '08:25', confidence: 'high', score: 0.9, source: '', sourceIssues: [], confirmed: true },
      ],
    }
    const plan = buildImportPlan({ schemes: [replaceScheme, createScheme] }, cfg)
    expect(plan.summary.replace).toBe(1)
    expect(plan.summary.create).toBe(1)
    expect(plan.executable).toBe(true)
  })

  it('两组指向同一目标时第二组被阻塞，不能同时替换', () => {
    const cfg = makeCfg({ campuses: 1, seasons: ['summer'] })
    const schemeA = {
      id: 'a', index: 0, detectedSeason: '夏季时间', detectedCampus: '南校区', seasonScore: 1, campusScore: 1,
      target: resolveSchemeTarget({ seasonId: 'summer', campusId: 'south', season: '夏季时间', campus: '南校区', seasonScore: 1, campusScore: 1, rows: [] }, cfg),
      rows: [
        { id: 'r0', key: '1-1', label: '第1节课', periodStart: 1, periodEnd: 1, start: '08:00', end: '08:45', confidence: 'high', score: 0.9, source: '', sourceIssues: [], confirmed: true },
      ],
    }
    const schemeB = JSON.parse(JSON.stringify(schemeA))
    schemeB.id = 'b'
    schemeB.index = 1
    const plan = buildImportPlan({ schemes: [schemeA, schemeB] }, cfg)
    expect(plan.items[0].blockers).toHaveLength(0)
    expect(plan.items[1].blockers.length).toBeGreaterThan(0)
    expect(plan.items[1].blockers[0]).toContain('重复')
  })

  it('未识别且原时间为空的项会阻塞，绝不静默写入', () => {
    const cfg = makeCfg()
    const scheme = {
      id: 'a', index: 0, detectedSeason: '夏季时间', detectedCampus: '南校区', seasonScore: 1, campusScore: 1,
      target: resolveSchemeTarget({ seasonId: 'summer', campusId: 'south', season: '夏季时间', campus: '南校区', seasonScore: 1, campusScore: 1, rows: [] }, cfg),
      rows: [
        { id: 'r0', key: '1-1', label: '第1节课', periodStart: 1, periodEnd: 1, start: '08:00', end: '08:45', confidence: 'high', score: 0.9, source: '', sourceIssues: [], confirmed: true },
        { id: 'r1', key: '', label: '第2节课', periodStart: 2, periodEnd: 2, start: '', end: '', confidence: 'low', score: 0, source: '', sourceIssues: [], confirmed: false },
      ],
    }
    const cfgNoTimes = makeCfg({ withTimes: false })
    const plan = buildImportPlan({ schemes: [scheme] }, cfgNoTimes)
    expect(plan.executable).toBe(false)
    expect(plan.items[0].blockers.join(' ')).toContain('待处理')
  })

  it('替换目标选择"新建副本"时自动派生不重复的副本名', () => {
    const cfg = makeCfg({ campuses: 1, seasons: ['summer'] })
    const scheme = {
      id: 'a', index: 0, detectedSeason: '夏季时间', detectedCampus: '南校区', seasonScore: 1, campusScore: 1,
      target: resolveSchemeTarget({ seasonId: 'summer', campusId: 'south', season: '夏季时间', campus: '南校区', seasonScore: 1, campusScore: 1, rows: [] }, cfg),
      rows: [
        { id: 'r0', key: '1-1', label: '第1节课', periodStart: 1, periodEnd: 1, start: '08:00', end: '08:45', confidence: 'high', score: 0.9, source: '', sourceIssues: [], confirmed: true },
      ],
    }
    const plan = buildImportPlan({ schemes: [scheme] }, cfg, { a: 'create' })
    expect(plan.items[0].action).toBe('create')
    expect(plan.items[0].newSeasonName).toBe('夏季时间（副本）')
    expect(plan.executable).toBe(true)
  })
})

describe('事务执行 executeImportPlan（全部成功或全部原状）', () => {
  it('场景8：一键替换 —— 整体覆盖旧作息，未识别的节次保留原时间而不是 08:00', () => {
    const cfg = makeCfg()
    // 只识别出 12 节（缺最后两节中的第一节）
    const rows = [
      '夏季时间 南校区',
      '早自习 07:20-07:50',
      '第一节课 08:00-08:45',
      '第二节课 08:55-09:40',
      '第三节课 10:05-10:50',
      '第四节课 11:00-11:45',
      '第五节课 14:30-15:15',
      '第六节课 15:20-16:05',
      '第七节课 16:20-17:05',
      '第八节课 17:05-17:50',
      '第九节课 19:00-19:45',
      '第十节课 19:50-20:35',
      '第十二节课 21:30-22:15',
    ].join('\n')
    const analysis = analysisFromText(rows, cfg)
    const draft = buildRecognitionDraft(analysis, cfg, 'img.png')
    const plan = buildImportPlan(draft, cfg)
    expect(plan.executable).toBe(true)
    executeImportPlan(plan, cfg)
    const times = cfg.times.summer.south
    expect(times[1]).toEqual({ start: '08:00', end: '08:45' })
    expect(times[5]).toEqual({ start: '14:30', end: '15:15' })
    // 缺失的第十一节：保留原时间 20:40-21:25，而不是伪造默认值
    expect(times[11]).toEqual({ start: '20:40', end: '21:25' })
    expect(times.some((item) => item.start === '' && item.end === '')).toBe(false)
  })

  it('场景15：批量导入中途异常 → 整体回滚，数据保持原状', () => {
    const cfg = makeCfg()
    const before = JSON.stringify(cfg)
    const goodItem = {
      schemeId: 'a', label: '好数据', action: 'replace',
      seasonId: 'summer', campusId: 'south', newSeasonName: '', newCampusName: '',
      rows: [{ periodIndex: 1, start: '08:10', end: '08:50' }],
      diff: null, warnings: [],
    }
    const badItem = {
      schemeId: 'b', label: '坏数据', action: 'replace',
      seasonId: '', campusId: '', newSeasonName: '', newCampusName: '',
      rows: [], diff: null, warnings: [], blockers: ['导入目标不完整'],
    }
    expect(() => executeImportPlan({ items: [goodItem, badItem] }, cfg)).toThrow(/坏数据/)
    expect(JSON.stringify(cfg)).toBe(before)
  })

  it('场景16：快照 + 撤销 —— 恢复到导入前状态', () => {
    const cfg = makeCfg()
    const snapshot = snapshotTimeConfig(cfg)
    const analysis = analysisFromText('夏季时间 南校区\n第一节 09:00-09:45', cfg)
    const draft = buildRecognitionDraft(analysis, cfg, 'img.png')
    const plan = buildImportPlan(draft, cfg)
    executeImportPlan(plan, cfg)
    expect(cfg.times.summer.south[1]).toEqual({ start: '09:00', end: '09:45' })
    restoreTimeConfig(cfg, snapshot)
    expect(cfg.times.summer.south[1]).toEqual({ start: '08:00', end: '08:45' })
  })
})

describe('applyImportItem 细节', () => {
  it('新建校区 + 已有方案：把新校区加入方案适用范围', () => {
    const cfg = makeCfg()
    cfg.seasons[0].campuses = ['south']
    applyImportItem({
      action: 'create', seasonId: 'summer', campusId: '', newSeasonName: '', newCampusName: '东校区',
      rows: [{ periodIndex: 0, start: '07:00', end: '07:30' }],
      warnings: [], blockers: [],
    }, cfg)
    const campus = cfg.campuses.find((item) => item.name === '东校区')
    expect(cfg.seasons[0].campuses).toContain(campus.id)
    expect(cfg.times.summer[campus.id][0]).toEqual({ start: '07:00', end: '07:30' })
  })

  it('行 → 节次映射：精确名/归一化节次号优先，数量一致时才按位置兜底', () => {
    const cfg = makeCfg()
    const periods = cfg.periods
    expect(mapRowToPeriodIndex({ label: '第2节课' }, periods, 5, 13)).toBe(2)
    expect(mapRowToPeriodIndex({ label: '第二节' }, periods, 5, 13)).toBe(2)
    expect(mapRowToPeriodIndex({ label: '早自习' }, periods, 5, 13)).toBe(0)
    // 名称对不上且数量不一致 → 拒绝猜测
    expect(mapRowToPeriodIndex({ label: '第99节课' }, periods, 5, 12)).toBe(-1)
    expect(mapRowToPeriodIndex({ label: '早读' }, periods, 5, 12)).toBe(-1)
    // 名称对不上但数量与节次一致 → 按位置兜底
    expect(mapRowToPeriodIndex({ label: '早读' }, periods, 7, 13)).toBe(7)
  })

  it('buildReplaceDiff：相同时间不列为变化', () => {
    const cfg = makeCfg()
    const scheme = {
      id: 'a', index: 0, detectedSeason: '夏季时间', detectedCampus: '南校区', seasonScore: 1, campusScore: 1,
      target: { mode: 'replace', seasonId: 'summer', campusId: 'south', newSeasonName: '', newCampusName: '', reason: 'ok' },
      rows: [
        { id: 'r0', key: '', label: '第1节课', periodStart: 1, periodEnd: 1, start: '08:00', end: '08:45', confidence: 'high', score: 0.9, source: '', sourceIssues: [], confirmed: true },
        { id: 'r1', key: '', label: '第5节课', periodStart: 5, periodEnd: 5, start: '14:30', end: '15:15', confidence: 'high', score: 0.9, source: '', sourceIssues: [], confirmed: true },
      ],
    }
    const diff = buildReplaceDiff(scheme, cfg)
    expect(diff.changes).toHaveLength(1)
    expect(diff.changes[0]).toMatchObject({ label: '第5节课', from: '14:00–14:45', to: '14:30–15:15' })
    expect(diff.changedCount).toBe(1)
  })
})
