import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXTERNAL_EXAM_ITEMS,
  externalExamReminderSpecs,
  externalExamTimelineTarget,
  normalizeExternalExam,
} from '../src/composables/externalExam.js'
import { migrateDomainData } from '../src/composables/domain/migrations.js'
import { migrateAccountSyncPayload } from '../src/composables/accountSyncSchema.js'

describe('校外考试数据与提醒', () => {
  it('为新的校外考试准备默认用品，并把旧日期字段映射为考试日期', () => {
    const item = normalizeExternalExam({ kind: 'externalExam', date: '2027-01-15', time: '09:00', location: '市一中' })
    expect(item).toMatchObject({
      category: '校外考试', date: '2027-01-15', examDate: '2027-01-15', examTime: '09:00',
      venue: '市一中', location: '市一中', requiredItems: DEFAULT_EXTERNAL_EXAM_ITEMS.map((entry) => ({ ...entry, checked: false })),
    })
  })

  it('保留用户删除全部默认用品的选择，并规范化自定义物品数量', () => {
    expect(normalizeExternalExam({ kind: 'externalExam', date: '2027-01-15', requiredItems: [] }).requiredItems).toEqual([])
    expect(normalizeExternalExam({ kind: 'externalExam', date: '2027-01-15', requiredItems: [{ name: '水', quantity: 2.8, unit: '瓶', checked: true }] }).requiredItems)
      .toEqual([{ name: '水', quantity: 2, unit: '瓶', checked: true }])
  })

  it('生成包含边界日期和跨年的报名、考试与考前物品提醒', () => {
    const specs = externalExamReminderSpecs({
      id: 'exam', name: '四级', registerDeadline: '2027-01-01', examDate: '2027-01-15',
    })
    expect(specs).toHaveLength(7)
    expect(specs.map(({ key, date, time }) => [key, date, time])).toEqual([
      ['externalExam:registration:14', '2026-12-18', '09:00'],
      ['externalExam:registration:7', '2026-12-25', '09:00'],
      ['externalExam:registration:3', '2026-12-29', '09:00'],
      ['externalExam:exam:30', '2026-12-16', '09:00'],
      ['externalExam:exam:7', '2027-01-08', '09:00'],
      ['externalExam:exam:1', '2027-01-14', '09:00'],
      ['externalExam:carry-items:1', '2027-01-14', '20:00'],
    ])
  })

  it('报名截止记录不会误生成考试日提醒', () => {
    const specs = externalExamReminderSpecs({ name: '教资报名', registerDeadline: '2027-03-10', examDate: '' })
    expect(specs).toHaveLength(3)
    expect(specs.every((item) => item.key.includes('registration'))).toBe(true)
  })

  it('时间轴先显示报名截止，过期后切换到考试日', () => {
    const item = { date: '2027-01-15', examDate: '2027-01-15', registerDeadline: '2027-01-01', examTime: '09:00' }
    expect(externalExamTimelineTarget(item, '2026-12-20')).toEqual({ date: '2027-01-01', stage: 'registration', time: '' })
    expect(externalExamTimelineTarget(item, '2027-01-02')).toEqual({ date: '2027-01-15', stage: 'exam', time: '09:00' })
  })

  it('迁移本地和账号快照中的外部考试字段，旧数据仍留在原里程碑集合', () => {
    const local = [{ id: 'local', kind: 'externalExam', date: '2027-01-15', time: '09:00' }]
    expect(migrateDomainData({ milestones: local })).toBeGreaterThan(0)
    expect(local[0]).toMatchObject({ examDate: '2027-01-15', examTime: '09:00', requiredItems: expect.any(Array) })

    const remote = migrateAccountSyncPayload({ sl_exams: [{ id: 'remote', kind: 'externalExam', date: '2027-01-15' }] })
    expect(remote.sl_exams[0]).toMatchObject({ examDate: '2027-01-15', category: '校外考试', requiredItems: expect.any(Array) })
  })
})
