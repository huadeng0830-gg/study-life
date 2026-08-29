import { describe, expect, it } from 'vitest'
import { dateText, dayLabel, moneyHero, moneyRow, nowHM, pad2 } from '../src/utils/formatters.js'

describe('formatters', () => {
  it('pad2 补齐两位数字', () => {
    expect(pad2(3)).toBe('03')
    expect(pad2('12')).toBe('12')
  })

  it('dateText 输出本地时区 YYYY-MM-DD', () => {
    expect(dateText(new Date(2026, 7, 29))).toBe('2026-08-29')
  })

  it('moneyRow 整数不带小数、非整数保留两位', () => {
    expect(moneyRow(12)).toBe('¥12')
    expect(moneyRow('12')).toBe('¥12')
    expect(moneyRow(12.5)).toBe('¥12.50')
    expect(moneyRow(0)).toBe('¥0')
    expect(moneyRow('abc')).toBe('¥0')
  })

  it('moneyHero 统一两位小数', () => {
    expect(moneyHero(128)).toBe('¥128.00')
    expect(moneyHero(null)).toBe('¥0.00')
  })

  it('dayLabel 标注今天/昨天/M月D日', () => {
    const today = dateText()
    expect(dayLabel(today)).toBe('今天')
    expect(dayLabel(dateText(new Date(Date.now() - 86400000)))).toBe('昨天')
    expect(dayLabel('2026-01-09')).toBe('1月9日')
  })

  it('nowHM 输出 HH:MM', () => {
    expect(nowHM()).toMatch(/^\d{2}:\d{2}$/)
  })
})
