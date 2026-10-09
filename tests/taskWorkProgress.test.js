import { describe, expect, it } from 'vitest'
import { normalizeTaskWorkCheckpoint, parseTaskResourceLinks, safeTaskResourceLinks, taskActualMinutes, taskTimeComparison } from '../src/composables/tasks/taskWorkProgress.js'

describe('任务耗时与断点续做', () => {
  it('用现有专注计时作为实际耗时，并显示估时差异', () => {
    expect(taskActualMinutes({ focusTotalSeconds: 2700 })).toBe(45)
    expect(taskTimeComparison({ estimateMinutes: 30, focusTotalSeconds: 2700 })).toBe('预计 30 · 实际 45 分钟（多 15 分）')
    expect(taskTimeComparison({ estimateMinutes: 30, actualMinutes: 25 })).toBe('预计 30 · 实际 25 分钟（少 5 分）')
    expect(taskTimeComparison({ estimateMinutes: 20 })).toBe('预计 20 分钟')
  })

  it('只保留安全的 HTTP(S) 资料链接并去重', () => {
    expect(parseTaskResourceLinks('example.com/notes\nhttps://example.com/notes\n')).toEqual(['https://example.com/notes'])
    expect(() => parseTaskResourceLinks('javascript:alert(1)')).toThrow('只支持公开的 HTTP 或 HTTPS')
    expect(() => parseTaskResourceLinks('https://user:secret@example.com')).toThrow('只支持公开的 HTTP 或 HTTPS')
    expect(safeTaskResourceLinks(['javascript:alert(1)', 'https://example.com', 'https://user:secret@example.com']))
      .toEqual(['https://example.com/'])
  })

  it('规范化断点字段，并在没有内容时不创建空对象', () => {
    expect(normalizeTaskWorkCheckpoint({
      lastStep: '  完成草稿  ',
      blocker: '',
      nextStep: '补上数据来源',
      resources: ['https://example.com'],
    })).toMatchObject({ lastStep: '完成草稿', blocker: '', nextStep: '补上数据来源', resources: ['https://example.com/'] })
    expect(normalizeTaskWorkCheckpoint({})).toBeNull()
  })
})
