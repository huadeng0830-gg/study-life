import { describe, expect, it } from 'vitest'
import {
  currencySymbol, dateParts, dateText, dayLabel, formatRelativeTime, hmText, moneyCents,
  moneyCentsWithCode, moneyDigits, moneyHero, moneyRow, moneyWithCurrency, nowHM, pad2, timeText,
} from '../src/utils/formatters.js'

// 千分位分隔符由运行环境的默认 locale 决定（zh-CN/en-US 是 ','，部分 locale 用窄空格），
// 断言因此只钉「有分组」和「两位小数」，不钉具体分隔符字符。
const GROUP = '[,\\u00a0\\u202f]'

describe('formatters', () => {
  it('pad2 补齐两位数字', () => {
    expect(pad2(3)).toBe('03')
    expect(pad2('12')).toBe('12')
  })

  it('dateText 输出本地时区 YYYY-MM-DD', () => {
    expect(dateText(new Date(2026, 7, 29))).toBe('2026-08-29')
  })

  it('moneyRow 统一保留两位小数', () => {
    expect(moneyRow(12)).toBe('¥12.00')
    expect(moneyRow('12')).toBe('¥12.00')
    expect(moneyRow(12.5)).toBe('¥12.50')
    expect(moneyRow(0)).toBe('¥0.00')
    expect(moneyRow('abc')).toBe('¥0.00')
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

describe('formatters 新增 helper（金额按分、时间/日期拼装）', () => {
  it('moneyCents 按分转元并走 moneyRow 口径', () => {
    expect(moneyCents(6200)).toBe('¥62.00')
    expect(moneyCents(1235)).toBe('¥12.35')
    expect(moneyCents(0)).toBe('¥0.00')
    expect(moneyCents(-500)).toBe('¥-5.00')
    expect(moneyCents('1235')).toBe('¥12.35')
  })

  it('moneyCents 非法/缺失归零，超安全整数照原值不显示成 0', () => {
    expect(moneyCents(null)).toBe('¥0.00')
    expect(moneyCents(undefined)).toBe('¥0.00')
    expect(moneyCents(NaN)).toBe('¥0.00')
    expect(moneyCents('abc')).toBe('¥0.00')
    expect(moneyCents(Number.MAX_SAFE_INTEGER)).not.toBe('¥0.00')
    expect(moneyCents(1e18)).not.toBe('¥0.00')
  })

  it('金额统一带千分位（≥1000 与 <1000 同一口径）', () => {
    expect(moneyCents(123456)).toMatch(new RegExp(`^¥1${GROUP}234\\.56$`))
    expect(moneyRow(1234.5)).toMatch(new RegExp(`^¥1${GROUP}234\\.50$`))
    expect(moneyRow(999.999)).toMatch(new RegExp(`^¥1${GROUP}000\\.00$`))
  })

  it('moneyDigits 只取数字部分且口径与 moneyRow 一致', () => {
    expect(moneyDigits(12)).toBe('12.00')
    expect(moneyDigits('¥1,234.5')).toMatch(new RegExp(`^1${GROUP}234\\.50$`))
    expect(moneyDigits('abc')).toBe('0.00')
    expect(`前缀 ${moneyDigits(-5)}`).toBe('前缀 -5.00')
  })

  it('moneyCentsWithCode 基准币种用 ¥，其他币种用代码前缀', () => {
    expect(moneyCentsWithCode(6200)).toBe('¥62.00')
    expect(moneyCentsWithCode(6200, 'cny')).toBe('¥62.00')
    expect(moneyCentsWithCode(500, 'usd')).toBe('USD 5.00')
    expect(moneyCentsWithCode(500, '')).toBe('¥5.00')
    expect(moneyCentsWithCode(500, null)).toBe('¥5.00')
    expect(moneyCentsWithCode(null, 'JPY')).toBe('JPY 0.00')
    expect(moneyCentsWithCode(123456, 'USD')).toMatch(new RegExp(`^USD 1${GROUP}234\\.56$`))
  })

  it('hmText 与 pad2 同一套补齐规则（超过两位不截断）', () => {
    expect(hmText(9, 5)).toBe('09:05')
    expect(hmText(0, 0)).toBe('00:00')
    expect(hmText(23, 59)).toBe('23:59')
    expect(hmText(100, 5)).toBe('100:05')
    expect(hmText(3, 4)).toBe(`${pad2(3)}:${pad2(4)}`)
  })

  it('timeText 从 Date 取本地时区 HH:MM', () => {
    expect(timeText(new Date(2026, 7, 29, 9, 5))).toBe('09:05')
    expect(timeText(new Date(2026, 0, 1, 0, 0))).toBe('00:00')
    expect(timeText()).toMatch(/^\d{2}:\d{2}$/)
  })

  it('dateParts 数字年月日 → YYYY-MM-DD，与 dateText(Date) 一致', () => {
    expect(dateParts(2026, 8, 29)).toBe('2026-08-29')
    expect(dateParts(2026, 1, 1)).toBe('2026-01-01')
    expect(dateParts(2026, 8, 29)).toBe(dateText(new Date(2026, 7, 29)))
  })

  it('既有导出行为未变（moneyHero / moneyWithCurrency / currencySymbol / formatRelativeTime）', () => {
    expect(moneyHero(128)).toBe('¥128.00')
    expect(moneyWithCurrency(850, 'CNY')).toBe('¥850.00')
    expect(moneyWithCurrency(1234.5, 'USD')).toMatch(new RegExp(`^\\$1${GROUP}234\\.50$`))
    expect(moneyWithCurrency(12, 'XYZ')).toBe('XYZ 12.00')
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('')).toBe('¥')
    expect(formatRelativeTime(0)).toBe('即将开始')
    expect(formatRelativeTime(0, { direction: 'past' })).toBe('刚刚')
  })
})
