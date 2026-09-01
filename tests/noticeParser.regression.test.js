import { describe, expect, it } from 'vitest'
import { parseNotice } from '../src/composables/noticeParser.js'

const now = new Date('2026-09-01T10:00:00')

describe('通知解析真实输入回归', () => {
  const cases = [
    ['明天下午三点在教学楼302开班会。', { date: '2026-09-02', time: '15:00', location: '教学楼302', type: '会议' }],
    ['班会明天下午三点，在教学楼302。', { date: '2026-09-02', time: '15:00', location: '教学楼302', type: '会议' }],
    ['请大家明日15:00到302教室参加班会。', { date: '2026-09-02', time: '15:00', location: '302教室', type: '会议' }],
    ['9月15日前交实验报告。', { date: '2026-09-15', type: '作业' }],
    ['实验报告最晚15号交。', { date: '2026-09-15', type: '作业' }],
    ['请于9月15日晚22点前上传实验报告。', { date: '2026-09-15', time: '22:00', type: '作业' }],
    ['今晚十点之前完成青年大学习。', { date: '2026-09-01', time: '22:00', type: '截止' }],
    ['青年大学习今晚十点截止。', { date: '2026-09-01', time: '22:00', type: '截止' }],
    ['明天高数课改到B203。', { date: '2026-09-02', location: 'B203', type: '课程' }],
    ['高数明天换到B203上课。', { date: '2026-09-02', location: 'B203', type: '课程' }],
  ]

  it.each(cases)('解析常见通知：%s', (source, expected) => {
    const result = parseNotice(source, [], now)
    expect(result.dueDate).toBe(expected.date)
    if (expected.time) expect(result.dueTime).toBe(expected.time)
    if (expected.location) expect(result.location).toBe(expected.location)
    expect(result.type).toBe(expected.type)
    expect(result.title).not.toBe('待处理通知')
  })

  it('多行通知优先使用事件日期，不把落款发布日期当成截止日期', () => {
    const rawText = '【通知】\n\n各位同学：\n\n本周五下午3:00\n在南区教学楼302\n召开本学期第一次班会。\n\n请提前10分钟到场。\n\n辅导员\n2026年9月1日'
    const result = parseNotice(rawText, [], now)
    expect(result.dueDate).toBe('2026-09-04')
    expect(result.dueTime).toBe('15:00')
    expect(result.location).toBe('南区教学楼302')
    expect(result.title).toBe('本学期第一次班会')
    expect(result.reminder).toContain('提前10分钟')
    expect(result.dateCandidates.find((item) => item.isPublication)?.value).toBe('2026-09-01')
  })

  it('缺少精确日期时返回日期范围和可继续编辑的部分结果', () => {
    const result = parseNotice('下周交实验报告。', [], now)
    expect(result.dueDate).toBe('')
    expect(result.dateRange).toBe('下周')
    expect(result.title).toContain('实验报告')
    expect(result.confidenceLevel).toBe('medium')
    expect(result.rawText).toBe('下周交实验报告。')
  })

  it('支持下午/晚上、半刻和时间范围，不把下午解析成凌晨', () => {
    expect(parseNotice('下午三点一刻开会', [], now).dueTime).toBe('15:15')
    expect(parseNotice('晚上八点开会', [], now).dueTime).toBe('20:00')
    const range = parseNotice('下午两点到四点开会', [], now)
    expect(range.dueTime).toBe('14:00')
    expect(range.endTime).toBe('16:00')
  })

  it('保留原文，只把标准化文本用于解析', () => {
    const rawText = '【通知】\r\n各位同学：\r\n本周五\t下午3:00'
    const result = parseNotice(rawText, [], now)
    expect(result.rawText).toBe(rawText)
    expect(result.sourceText).toBe(rawText)
    expect(result.normalizedText).toContain('本周五 下午3:00')
  })

  it('信息不完整时不作废，只有日期和无日期输入也能得到结构化结果', () => {
    const missing = parseNotice('请完成实验报告。', [], now)
    expect(missing.title).toContain('实验报告')
    expect(missing.dueDate).toBe('')
    expect(missing.rawText).toBe('请完成实验报告。')

    const dateOnly = parseNotice('9月15日。', [], now)
    expect(dateOnly.dueDate).toBe('2026-09-15')
    expect(dateOnly.title).toBe('待处理通知')
  })

  it('覆盖活动、普通提醒、@成员和表情等复制格式', () => {
    expect(parseNotice('本周六晚上8点参加社团活动', [], now).type).toBe('会议')
    expect(parseNotice('记得带学生证', [], now).title).toContain('带学生证')
    const copied = parseNotice('【通知】 @全体成员 😊\n明天早上七点到南区实验楼集合', [], now)
    expect(copied.dueDate).toBe('2026-09-02')
    expect(copied.dueTime).toBe('07:00')
    expect(copied.location).toBe('南区实验楼')
    expect(copied.rawText).toContain('😊')
  })

  it('多个日期和多个时间都会保留候选，优先选择事件正文信息', () => {
    const result = parseNotice('报名截止9月10日，活动安排在9月15日下午14:00-16:00。', [], now)
    expect(result.dateCandidates.length).toBeGreaterThanOrEqual(2)
    expect(result.dueDate).toBe('2026-09-10')
    expect(result.dueTime).toBe('14:00')
    expect(result.endTime).toBe('16:00')
  })

  it('字段顺序打乱时仍按各自语义提取，而不是依赖固定句式', () => {
    const result = parseNotice(
      '关于实验报告提交的通知\n2026年9月1日发布\n截止时间为本周五晚上8点\n请在南区教学楼302提交实验报告。',
      [],
      now,
    )
    expect(result.title).toBe('实验报告提交')
    expect(result.dueDate).toBe('2026-09-04')
    expect(result.dueTime).toBe('20:00')
    expect(result.location).toBe('南区教学楼302')
    expect(result.dateCandidates.find((item) => item.isPublication)?.value).toBe('2026-09-01')
  })

  it('同句的发布日期和事件日期按语义区分', () => {
    const result = parseNotice('9月1日发布通知，请于9月10日下午3点到教学楼302参加会议。', [], now)
    expect(result.dueDate).toBe('2026-09-10')
    expect(result.dateCandidates.find((item) => item.raw === '9月1日')?.isPublication).toBe(true)
    expect(result.dateCandidates.find((item) => item.raw === '9月10日')?.isPublication).toBe(false)
    expect(result.location).toBe('教学楼302')
  })

  it('多个时间优先选择正式开始时间，非范围时间不填结束时间', () => {
    const result = parseNotice('请于14:00到场签到，会议15:00正式开始。', [], now)
    expect(result.dueTime).toBe('15:00')
    expect(result.endTime).toBe('')
  })

  it('截止日期和活动日期分开保留，任务日期选择截止日期', () => {
    const result = parseNotice('报名截止9月5日，活动于9月8日下午3点举行。', [], now)
    expect(result.dueDate).toBe('2026-09-05')
    expect(result.deadline).toBe(true)
    expect(result.title).not.toMatch(/通知|关于|至|于|截止/)
    expect(result.dateCandidates.find((item) => item.raw === '9月5日')?.isDeadline).toBe(true)
    expect(result.dateCandidates.find((item) => item.raw === '9月8日')?.isDeadline).toBe(false)
  })

  it('介词干扰词不产生地点，缺少地点或时间仍保留可用结果', () => {
    expect(parseNotice('关于、对于、由于、至于、基于、位于、于、从、到的说明。', [], now).location).toBe('')
    expect(parseNotice('明天下午三点开班会。', [], now).location).toBe('')
    expect(parseNotice('周五之前交实验报告。', [], now).dueTime).toBe('')
  })

  it('跨年和临近过去日期不武断处理', () => {
    const yearEnd = parseNotice('1月3日交报告。', [], new Date('2026-12-29T10:00:00'))
    const nearPast = parseNotice('8月30日交报告。', [], new Date('2026-09-01T10:00:00'))
    expect(yearEnd.dueDate).toBe('2027-01-03')
    expect(nearPast.dueDate).toBe('2026-08-30')
    expect(nearPast.dateCandidates[0].ambiguous).toBe(true)
    expect(nearPast.confidenceLevel).toBe('medium')
  })

  it('不确定语气降低置信度，并保留原文和两次解析的隔离性', () => {
    const uncertain = parseNotice('明天可能会调整上课地点，另行通知。', [], now)
    const second = parseNotice('后天确定交实验报告。', [], now)
    expect(uncertain.uncertain).toBe(true)
    expect(uncertain.confidenceLevel).toBe('low')
    expect(uncertain.rawText).toBe('明天可能会调整上课地点，另行通知。')
    expect(second.rawText).toBe('后天确定交实验报告。')
    expect(uncertain.rawText).not.toBe(second.rawText)
  })
})
