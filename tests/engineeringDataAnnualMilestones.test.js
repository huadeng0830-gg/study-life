// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { selectHomeNextUp } from '../src/composables/home/nextUp.js'
import { monthReport } from '../src/composables/retrospective.js'

describe('年度重复重要日期投影', () => {
  it('首页接下来使用今年的生日 occurrence 而不是首次记录的年份', () => {
    const birthday = { id: 'fictional-birthday', name: '虚构生日', date: '2020-10-12', repeat: 'yearly' }
    const result = selectHomeNextUp({ milestones: [birthday], now: new Date('2026-10-10T12:00:00+08:00'), today: '2026-10-10' })
    expect(result.nextUp).toMatchObject({ kind: 'milestone', date: '2026-10-12' })
  })

  it('月度回顾包含往年记录、今年同月重复的重要日期', () => {
    const result = monthReport('2026-10', { exams: [{ id: 'fictional-annual', name: '虚构纪念日', date: '2020-10-12', repeat: 'yearly' }] })
    expect(result.blocks.find((block) => block.title === '月度重要节点')?.items).toEqual(['虚构纪念日'])
  })
})
