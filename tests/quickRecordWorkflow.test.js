// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseQuickRecord } from '../src/composables/quickRecord/parser.js'
import { quickRecordDraftText, reconcileQuickRecordDrafts, validateQuickRecord } from '../src/composables/quickRecord/workflow.js'
import { quickRecordDraftKey, readQuickRecordDraft, writeQuickRecordDraft } from '../src/composables/quickRecord/draftStorage.js'

const now = new Date('2026-10-09T10:00:00')

describe('快速记录识别边界', () => {
  it.each([
    ['明天9:30开会', 'event'],
    ['明天14:00到15:30班会', 'event'],
    ['2026-10-12提交实验报告', 'homework'],
    ['阅读第3章', 'todo'],
    ['买2本书', 'todo'],
    ['运动30分钟', 'todo'],
  ])('日期、时间、数量不会被识别为金额：%s', (text, type) => {
    expect(parseQuickRecord(text, { now })).toHaveLength(1)
    expect(parseQuickRecord(text, { now })[0]).toMatchObject({ type, amount: 0 })
  })

  it('同时出现时间、数量和真实金额时只提取真实金额', () => {
    const [draft] = parseQuickRecord('今天9:30买2本书花39元', { now })
    expect(draft).toMatchObject({ type: 'expense', amount: 39 })
  })

  it('简短会议保留实际事项标题', () => {
    expect(parseQuickRecord('明天9:30开会', { now })[0].title).toBe('开会')
    expect(parseQuickRecord('明天下午三点开会', { now })[0].title).toBe('开会')
  })

  it('多笔口语消费保留完整原文，删除或部分保存后可重新解析金额', () => {
    const drafts = parseQuickRecord('今天坐公交车用了两块钱去吃了八块钱的兰州拉面。', { now })
    const reparsed = parseQuickRecord(quickRecordDraftText(drafts), { now })
    expect(reparsed.map((draft) => draft.amount)).toEqual([2, 8])
    expect(reparsed.map((draft) => draft.type)).toEqual(['expense', 'expense'])
  })

  it('支持粘贴带序号的列表、分号及每行多笔消费', () => {
    const drafts = parseQuickRecord('1. 早餐6元，公交2元\n2、奶茶9元；明天9:30开会', { now })
    expect(drafts.map((draft) => draft.type)).toEqual(['expense', 'expense', 'expense', 'event'])
    expect(drafts.slice(0, 3).map((draft) => draft.amount)).toEqual([6, 2, 9])
  })

  it('明确选择待办时不因多处金额拆成多笔记录', () => {
    const drafts = parseQuickRecord('对比39元和59元的教材', { now, forcedType: 'todo' })
    expect(drafts).toHaveLength(1)
    expect(drafts[0].type).toBe('todo')
  })

  it('识别半点与分钟，并匹配课程标识', () => {
    const [draft] = parseQuickRecord('明天下午三点半交高数作业', { now, courses: [{ id: 'sample-math', name: '高数' }] })
    expect(draft).toMatchObject({ course: '高数', courseId: 'sample-math', time: '15:30' })
  })
})

describe('快速记录核对与暂存', () => {
  it('新加一行保留原有手动修改及勾选，重复文本仍是独立记录', () => {
    const previous = parseQuickRecord('午饭18元\n午饭18元', { now }).map((draft, i) => ({ ...draft, title: `自定义午饭${i}`, selected: i === 0 }))
    const merged = reconcileQuickRecordDrafts(parseQuickRecord('午饭18元\n午饭18元\n奶茶9元', { now }), previous)
    expect(merged.slice(0, 2)).toEqual(previous)
    expect(merged[2].selected).toBe(true)
    expect(new Set(merged.map((draft) => draft.id)).size).toBe(3)
  })

  it('在写入前要求完整日程、正确金额和有效时间范围', () => {
    expect(validateQuickRecord({ type: 'event', title: '组会', date: '', time: '15:00' }).date).toBeTruthy()
    expect(validateQuickRecord({ type: 'event', title: '组会', date: '2026-02-30', time: '15:00', endTime: '14:00' })).toMatchObject({ date: expect.any(String), endTime: expect.any(String) })
    expect(validateQuickRecord({ type: 'expense', title: '午饭', date: '2026-10-09', amount: '1.234' }).amount).toBeTruthy()
    expect(validateQuickRecord({ type: 'todo', title: '买洗衣液' })).toEqual({})
  })

  it('草稿按账号和入口隔离，往返保留修改和未选中项', () => {
    const key = quickRecordDraftKey('sample-owner', { preferredType: 'homework', courseId: 'sample-course' })
    const drafts = parseQuickRecord('午饭18元', { now }).map((draft) => ({ ...draft, title: '修改的午饭', selected: false, note: '示例备注' }))
    expect(writeQuickRecordDraft(key, { input: '午饭18元', forcedType: '', drafts })).toBe(true)
    expect(readQuickRecordDraft(key)?.drafts).toEqual(drafts)
    expect(readQuickRecordDraft(quickRecordDraftKey('another-sample-owner', { preferredType: 'homework', courseId: 'sample-course' }))).toBeNull()
    expect(readQuickRecordDraft(quickRecordDraftKey('sample-owner', { preferredType: 'expense' }))).toBeNull()
    writeQuickRecordDraft(key, { input: '', forcedType: '', drafts: [] })
    expect(readQuickRecordDraft(key)).toBeNull()
  })

  it('损坏或无法写入的暂存不会让记录面板崩溃', () => {
    expect(readQuickRecordDraft('sample', { getItem: () => '{broken' })).toBeNull()
    expect(writeQuickRecordDraft('sample', { input: '示例', drafts: [] }, { setItem: () => { throw new Error('quota') } })).toBe(false)
  })
})
