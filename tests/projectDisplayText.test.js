/**
 * 齐行纯文案映射的冻结守卫（从 ProjectsView 抽出的 projectDisplayText.js）。
 *
 * 这些文本直接出现在界面上，改动没有任何行为签名，所以逐条冻结：
 * 状态词、角色词、日期格式、动态记录用词。
 */
import { describe, expect, it } from 'vitest'
import { activityLabel, adjustmentStatus, deliverableStatus, formatDate, nextDay, roleLabel } from '../src/composables/projects/projectDisplayText.js'

describe('齐行日期文案', () => {
  it('日期按「X 月 X 日」显示，空值返回空串', () => {
    expect(formatDate('2026-10-18')).toBe('10 月 18 日')
    expect(formatDate('2026-01-05T09:30:00Z')).toBe('1 月 5 日')
    expect(formatDate('')).toBe('')
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
  })

  it('下一天跨月跨年都对', () => {
    expect(nextDay('2026-10-18')).toBe('2026-10-19')
    expect(nextDay('2026-10-31')).toBe('2026-11-01')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
    expect(nextDay('')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('齐行状态与角色文案', () => {
  it('成员角色', () => {
    expect(roleLabel('owner')).toBe('负责人')
    expect(roleLabel('admin')).toBe('管理员')
    expect(roleLabel('member')).toBe('成员')
    expect(roleLabel('fictional-role')).toBe('成员')
  })

  it('成果版本状态带版本号，未知状态退回 V+版本号', () => {
    expect(deliverableStatus({ required: true })).toBe('等待提交')
    expect(deliverableStatus({ required: false })).toBe('选填')
    expect(deliverableStatus({ versions: [{ number: 3, reviewStatus: 'pending' }] })).toBe('V3 等待验收')
    expect(deliverableStatus({ versions: [{ number: 3, reviewStatus: 'approved' }] })).toBe('V3 已通过')
    expect(deliverableStatus({ versions: [{ number: 3, reviewStatus: 'returned' }] })).toBe('V3 需修改')
    expect(deliverableStatus({ versions: [{ number: 3, reviewStatus: 'not_required' }] })).toBe('V3 已提交')
    expect(deliverableStatus({ versions: [{ number: 4, reviewStatus: 'fictional' }] })).toBe('V4')
  })

  it('调整申请状态，未知状态退回「已更新」', () => {
    expect(adjustmentStatus('pending')).toBe('处理中')
    expect(adjustmentStatus('approved')).toBe('已通过')
    expect(adjustmentStatus('rejected')).toBe('已拒绝')
    expect(adjustmentStatus('cancelled')).toBe('已撤回')
    expect(adjustmentStatus('stale')).toBe('任务已变化')
    expect(adjustmentStatus('fictional')).toBe('已更新')
  })

  it('项目动态记录用词，未知类型退回「更新了项目」', () => {
    expect(activityLabel({ type: 'project_created' })).toBe('创建了项目')
    expect(activityLabel({ type: 'member_role_changed' })).toBe('调整了成员权限')
    expect(activityLabel({ type: 'review_completed' })).toBe('完成了成果验收')
    expect(activityLabel({ type: 'meeting_status_changed' })).toBe('更新了小组讨论安排')
    expect(activityLabel({ type: 'fictional-event' })).toBe('更新了项目')
  })
})