import { describe, expect, it } from 'vitest'
import { extractTimeRanges, normalizePeriod, normalizeTimeToken, parseScheduleOCR } from '../src/composables/scheduleOcrParser.js'

describe('schedule OCR structured parser', () => {
  it('only corrects ambiguous glyphs inside time fields', () => {
    expect(normalizeTimeToken('O8：OO')).toBe('08:00')
    expect(normalizeTimeToken('l4.5S')).toBe('14:55')
    expect(normalizeTimeToken('2460')).toBeNull()
  })

  it('supports colonless and full-width time ranges', () => {
    expect(extractTimeRanges('第一节 0800－0845')[0]).toMatchObject({ start: '08:00', end: '08:45', valid: true })
    expect(extractTimeRanges('第二节 8：55—9：40')[0]).toMatchObject({ start: '08:55', end: '09:40', valid: true })
    expect(extractTimeRanges('早自习 7了:20一7:50')[0]).toMatchObject({ start: '07:20', end: '07:50', valid: true })
    expect(normalizeTimeToken('173:05')).toBe('17:05')
  })

  it('normalizes Arabic, Chinese and ranged period labels', () => {
    expect(normalizePeriod('第一节课')).toMatchObject({ start: 1, end: 1, label: '第1节' })
    expect(normalizePeriod('第1、2节')).toMatchObject({ start: 1, end: 2, label: '第1-2节' })
    expect(normalizePeriod('3')).toMatchObject({ start: 3, end: 3 })
  })

  it('detects campus, season, missing periods and reversed time', () => {
    const parsed = parseScheduleOCR([
      '夏季时间 南校区',
      '第一节 O8:OO-O8:45',
      '第二节 0855-0940',
      '第四节 10:50-10:05',
    ].join('\n'), {
      campuses: [{ id: 'campus-a', name: '南校区' }],
      seasons: [{ id: 'season-a', name: '夏季时间' }],
    })
    expect(parsed.seasons[0].value).toBe('夏季时间')
    expect(parsed.seasons[0].id).toBe('season-a')
    expect(parsed.campuses[0].value).toBe('南校区')
    expect(parsed.campuses[0].id).toBe('campus-a')
    expect(parsed.rows.map((row) => [row.start, row.end])).toEqual([
      ['08:00', '08:45'],
      ['08:55', '09:40'],
      ['', ''],
      ['10:50', '10:05'],
    ])
    // OCR 漏识别的节次必须显式标记"未识别"，绝不静默填充默认时间
    const missingRow = parsed.rows.find((row) => row.periodStart === 3)
    expect(missingRow).toBeTruthy()
    expect(missingRow.start).toBe('')
    expect(missingRow.end).toBe('')
    expect(missingRow.issues.join(' ')).toContain('未识别')
    expect(parsed.issues.map((issue) => issue.message).join(' ')).toContain('倒序')
  })

  it('merges independent OCR strategies and flags conflicts', () => {
    const parsed = parseScheduleOCR({
      text: '第一节 08:00-08:45',
      variants: [
        { name: 'enhanced', text: '第一节 08:00-08:45' },
        { name: 'region', text: '第一节 06:00-08:45' },
      ],
    })
    expect(parsed.rows[0].start).toBe('08:00')
    expect(parsed.rows[0].needsReview).toBe(true)
    expect(parsed.rows[0].issues.join(' ')).toContain('冲突')
  })

  it('keeps four season-campus columns associated by position', () => {
    const parsed = parseScheduleOCR([
      '夏季时间 冬季时间',
      '南校区 北校区 南校区 北校区',
      '第一节课 08:00-08:45 08:10-08:55 08:00-08:45 08:10-08:55',
      '第二节课 08:55-09:40 09:05-09:50 08:55-09:40 09:05-09:50',
    ].join('\n'), {
      campuses: [{ id: 'south', name: '南校区' }, { id: 'north', name: '北校区' }],
      seasons: [{ id: 'summer', name: '夏季时间' }, { id: 'winter', name: '冬季时间' }],
    })
    expect(parsed.schemes).toHaveLength(4)
    expect(parsed.schemes.map((scheme) => [scheme.season, scheme.campus])).toEqual([
      ['夏季时间', '南校区'],
      ['夏季时间', '北校区'],
      ['冬季时间', '南校区'],
      ['冬季时间', '北校区'],
    ])
    expect(parsed.schemes[1].rows[0]).toMatchObject({ start: '08:10', end: '08:55' })
    expect(parsed.schemes[1]).toMatchObject({ seasonId: 'summer', campusId: 'north' })
  })

  it('never invents configured season options from generic names', () => {
    const parsed = parseScheduleOCR('夏季时间 主校区\n第一节 08:00-08:45', {
      campuses: [{ id: 'main', name: '主校区' }],
      seasons: [{ id: 'custom', name: '常规作息' }],
    })
    expect(parsed.campuses[0]).toMatchObject({ id: 'main', value: '主校区' })
    expect(parsed.seasons).toEqual([])
    expect(parsed.schemes[0].seasonId).toBeNull()
  })

  it('uses layout rows when full-page OCR order is unusable', () => {
    const parsed = parseScheduleOCR({
      text: '第一节\n第二节\n08:00\n08:45',
      layout: {
        width: 800,
        height: 600,
        words: [
          { text: '第一节', confidence: 90, bbox: { x0: 10, y0: 100, x1: 90, y1: 130 } },
          { text: '08:00-08:45', confidence: 92, bbox: { x0: 150, y0: 100, x1: 300, y1: 130 } },
          { text: '第二节', confidence: 91, bbox: { x0: 10, y0: 160, x1: 90, y1: 190 } },
          { text: '08:55-09:40', confidence: 93, bbox: { x0: 150, y0: 160, x1: 300, y1: 190 } },
        ],
      },
    })
    expect(parsed.rows.map((row) => row.label)).toEqual(['第1节', '第2节'])
    expect(parsed.summary.review).toBe(0)
  })

  it('associates multi-level season and campus headers with time columns by position', () => {
    const word = (text, x, y) => ({ text, confidence: 93, bbox: { x0: x - 30, y0: y - 9, x1: x + 30, y1: y + 9 } })
    const layout = {
      width: 1000,
      height: 700,
      words: [
        word('夏季时间', 290, 30), word('冬季时间', 730, 30),
        word('南校区', 150, 70), word('北校区', 430, 70), word('南校区', 590, 70), word('北校区', 870, 70),
        word('第一节', 45, 140), word('08:00-08:45', 150, 140), word('08:10-08:55', 430, 140), word('08:00-08:45', 590, 140), word('08:10-08:55', 870, 140),
        word('第二节', 45, 190), word('08:55-09:40', 150, 190), word('09:05-09:50', 430, 190), word('08:55-09:40', 590, 190), word('09:05-09:50', 870, 190),
      ],
    }
    const parsed = parseScheduleOCR({ text: '', layout }, {
      campuses: [{ id: 'south', name: '南校区' }, { id: 'north', name: '北校区' }],
      seasons: [{ id: 'summer', name: '夏季时间' }, { id: 'winter', name: '冬季时间' }],
    })
    expect(parsed.schemes.map((scheme) => [scheme.seasonId, scheme.campusId])).toEqual([
      ['summer', 'south'], ['summer', 'north'], ['winter', 'south'], ['winter', 'north'],
    ])
    expect(parsed.schemes[3].rows[1]).toMatchObject({ start: '09:05', end: '09:50' })
  })

  it('优先用带坐标的布局列，避免逐行 OCR 的乱序时间串到其它作息组', () => {
    const word = (text, x, y) => ({ text, confidence: 93, bbox: { x0: x - 30, y0: y - 9, x1: x + 30, y1: y + 9 } })
    const layout = {
      width: 1000,
      height: 700,
      words: [
        word('夏季时间', 290, 30), word('冬季时间', 730, 30),
        word('南校区', 150, 70), word('北校区', 430, 70), word('南校区', 590, 70), word('北校区', 870, 70),
        word('第一节', 45, 140), word('08:00-08:45', 150, 140), word('08:10-08:55', 430, 140), word('08:00-08:45', 590, 140), word('08:10-08:55', 870, 140),
        word('第二节', 45, 190), word('08:55-09:40', 150, 190), word('09:05-09:50', 430, 190), word('08:55-09:40', 590, 190), word('09:05-09:50', 870, 190),
      ],
    }
    const parsed = parseScheduleOCR({
      text: '',
      layout,
      // 表格行 OCR 把四列文字从右到左拼乱；不能覆盖布局里的正确列顺序。
      regions: [
        { source: 'table-row', confidence: 92, text: '第一节 20:40-21:25 08:10-08:55 08:00-08:45 08:10-08:55' },
        { source: 'table-row', confidence: 92, text: '第二节 21:30-22:15 09:05-09:50 08:55-09:40 09:05-09:50' },
      ],
    }, {
      campuses: [{ id: 'south', name: '南校区' }, { id: 'north', name: '北校区' }],
      seasons: [{ id: 'summer', name: '夏季时间' }, { id: 'winter', name: '冬季时间' }],
    })

    expect(parsed.schemes.map((scheme) => scheme.rows[0].start)).toEqual(['08:00', '08:10', '08:00', '08:10'])
    expect(parsed.schemes.map((scheme) => scheme.rows[1].start)).toEqual(['08:55', '09:05', '08:55', '09:05'])
  })
})
