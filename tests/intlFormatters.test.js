import { describe, expect, it } from 'vitest'
import { formatDateTime, formatNumber, getDateTimeFormatter, getNumberFormatter } from '../src/composables/intlFormatters.js'

describe('Intl 格式化器缓存', () => {
  it('按 locale 和选项复用日期与数字格式化器', () => {
    const dateOptions = { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }
    const numberOptions = { maximumFractionDigits: 1 }

    expect(getDateTimeFormatter('zh-CN', dateOptions)).toBe(getDateTimeFormatter('zh-CN', { ...dateOptions }))
    expect(getNumberFormatter('zh-CN', numberOptions)).toBe(getNumberFormatter('zh-CN', { ...numberOptions }))
  })

  it('保留显式时区并格式化数字', () => {
    expect(formatDateTime('2026-10-08T00:00:00.000Z', {
      timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    })).toContain('2026')
    expect(formatNumber(12.34, { maximumFractionDigits: 1 })).toContain('12.3')
  })
})
