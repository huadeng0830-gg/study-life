// @vitest-environment happy-dom
//
// 校园时间格式化的回归。
//
// 【这个文件覆盖的问题】
// Postgres 的 `date` 列回来是 `YYYY-MM-DD`。原来的失物招领页
// `String(value).slice(0, 10)` 把它原样打印出来，而其它八个校园页面各自
// `new Intl.DateTimeFormat(...)`。于是同一个「发生日期」在不同页面长得不一样，
// 有一个还带着 2026-03-04T00:00:00.000Z 这种原始串。
//
// 换成 `new Date('2026-03-04')` 更糟：那是 UTC 零点，在格林尼治以西会渲染成
// **前一天**。下面第一条用例就是钉住这件事。
import { describe, expect, it } from 'vitest'

import {
  campusDateLabel,
  campusDateTimeLabel,
  campusLocalDateTimeInput,
  campusMonthDayLabel,
  campusMonthDayTimeLabel,
  campusWeekdayDateTimeLabel,
} from '../src/composables/campusFormatting.js'
import {
  CAMPUS_PAGE_SIZE,
  CAMPUS_SUBMISSION_DOMAINS,
  campusContentLabel,
  campusContentRoute,
  campusErrorMessage,
  campusStatusLabel,
  flattenCampusSubmissions,
} from '../src/composables/campusContentModel.js'

describe('校园日期格式化', () => {
  it('只有日期的字符串按原样渲染，不做时区换算', () => {
    // 换成 toLocaleString 时这里会变成 03/03 —— 用户会以为失物是前一天丢的。
    const label = campusDateLabel('2026-03-04')
    expect(label).toContain('2026')
    expect(label).toContain('03')
    expect(label).toContain('04')
  })

  it('带时间的字符串正常解析', () => {
    const label = campusDateTimeLabel('2026-03-04T08:30:00.000Z')
    expect(label).toContain('2026')
    expect(label).toContain('03')
  })

  it('各形状互不串味：月日不带年份，完整日期带年份', () => {
    expect(campusMonthDayLabel('2026-03-04')).not.toContain('2026')
    expect(campusDateLabel('2026-03-04')).toContain('2026')
    expect(campusMonthDayTimeLabel('2026-03-04T08:30:00.000Z')).toMatch(/\d/)
    expect(campusWeekdayDateTimeLabel('2026-03-04T08:30:00.000Z')).toContain('2026')
  })

  it('空值和坏值走同一个回退文案，不显示 Invalid Date', () => {
    for (const formatter of [campusDateLabel, campusDateTimeLabel, campusMonthDayLabel, campusMonthDayTimeLabel, campusWeekdayDateTimeLabel]) {
      expect(formatter('')).toBe('')
      expect(formatter(null)).toBe('')
      expect(formatter(undefined)).toBe('')
      expect(formatter('不是日期')).toBe('')
      expect(formatter('不是日期', '待核实')).toBe('待核实')
      expect(formatter(new Date('nope'))).toBe('')
    }
  })

  it('datetime-local 回填不做时区搬移', () => {
    const date = new Date(2026, 2, 4, 8, 30)
    expect(campusLocalDateTimeInput(date)).toBe('2026-03-04T08:30')
    expect(campusLocalDateTimeInput('')).toBe('')
  })
})

describe('校园领域表', () => {
  it('未知类型回落到有上下文的模块页，而不是空白', () => {
    expect(campusContentRoute('market_listing')).toBe('/campus/market')
    expect(campusContentRoute('完全不存在的类型')).toBe('/campus/mine')
    expect(campusContentLabel('完全不存在的类型')).toBe('校园内容')
    expect(campusStatusLabel('完全不存在的状态')).toBe('完全不存在的状态')
  })

  it('摊平我的投稿：最新的在前，标出可撤回与可重提', () => {
    const items = flattenCampusSubmissions({
      listings: [
        { id: 'l2', title: '较新的商品', status: 'active', updated_at: '2026-03-05T00:00:00.000Z' },
        { id: 'l1', title: '较旧的商品', status: 'withdrawn', review_status: 'rejected', revision: 4, updated_at: '2026-03-01T00:00:00.000Z' },
      ],
      helpTasks: [{ id: 't1', title: '待办甲', status: 'pending_review', updated_at: '2026-03-03T00:00:00.000Z' }],
    })
    expect(items.map((item) => item.id)).toEqual(['l2', 't1', 'l1'])
    expect(items[0].canWithdraw).toBe(true)
    expect(items[1].targetType).toBe('help_task')
    // 退回的才给「修改并重新提交」，且要能推出发布页认识的类型。
    const rejected = items.find((item) => item.id === 'l1')
    expect(rejected.canWithdraw).toBe(false)
    expect(rejected.resubmitType).toBe('market')
    expect(rejected.revision).toBe(4)
  })

  it('课程评价没有重提入口，但不因此从列表里消失', () => {
    const [review] = flattenCampusSubmissions({ courseReviews: [{ id: 'r1', note: '还行', review_status: 'rejected' }] })
    expect(review.label).toBe('课程评价')
    expect(review.title).toBe('还行')
    expect(review.resubmitType).toBe('')
  })

  it('作者主动撤回的状态单独归类', () => {
    const [item] = flattenCampusSubmissions({ guides: [{ id: 'g1', title: '指南', review_reason: '作者主动撤回' }] })
    expect(item.status).toBe('withdrawn')
    expect(item.canWithdraw).toBe(false)
  })

  it('响应缺字段或结构不对时返回空列表而不是抛错', () => {
    expect(flattenCampusSubmissions(null)).toEqual([])
    expect(flattenCampusSubmissions({})).toEqual([])
    expect(flattenCampusSubmissions({ listings: '不是数组' })).toEqual([])
    // 服务端混进一条 null 曾经让整页白屏：一条坏数据不该毁掉整个投稿列表。
    expect(flattenCampusSubmissions({ listings: [null] })).toEqual([])
    expect(flattenCampusSubmissions({ listings: ['字符串', { id: 'ok', title: '好的' }] }).map((item) => item.id)).toEqual(['ok'])
  })

  it('每个领域都指向一个真实存在的分区', () => {
    const ids = new Set(CAMPUS_SUBMISSION_DOMAINS.map((domain) => domain.key))
    expect(ids.size).toBe(CAMPUS_SUBMISSION_DOMAINS.length)
    for (const domain of CAMPUS_SUBMISSION_DOMAINS) {
      expect(domain.label, domain.key).toBeTruthy()
      expect(domain.route, domain.key).toMatch(/^\//)
      expect(domain.targetType, domain.key).toBeTruthy()
    }
  })

  it('分页大小只有一个来源', () => {
    expect(CAMPUS_PAGE_SIZE).toBeGreaterThan(0)
    expect(Number.isInteger(CAMPUS_PAGE_SIZE)).toBe(true)
  })

  it('错误文案回退：技术错误没有可读 message 时才用兜底', () => {
    expect(campusErrorMessage(new Error('请稍后再试'), '兜底')).toBe('请稍后再试')
    expect(campusErrorMessage(new Error(''), '兜底')).toBe('兜底')
    expect(campusErrorMessage(new Error('   '), '兜底')).toBe('兜底')
    expect(campusErrorMessage(new TypeError('x is not a function'), '兜底')).toBe('x is not a function')
    for (const message of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
      expect(campusErrorMessage(new TypeError(message), '列表暂时无法读取。')).toBe('列表暂时无法读取。请检查网络后重试。')
    }
    for (const message of ['Upload failed: file exceeds the size limit', 'Download failed: permission denied']) {
      expect(campusErrorMessage(new Error(message), '保存没有完成。')).toBe(message)
    }
    // 没有 message 的异常（fetch 失败、字符串 throw）以前会渲染出 "undefined"。
    expect(campusErrorMessage(new Error(), '兜底')).toBe('兜底')
    expect(campusErrorMessage('字符串异常', '兜底')).toBe('兜底')
    expect(campusErrorMessage(undefined, '兜底')).toBe('兜底')
    expect(campusErrorMessage(null, '兜底')).toBe('兜底')
  })
})
