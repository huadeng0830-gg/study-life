// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { normalizePerformanceMode } from '../src/composables/performanceMode.js'

describe('流畅优先设置兼容', () => {
  it('保留当前三个模式', () => {
    expect(normalizePerformanceMode('auto')).toBe('auto')
    expect(normalizePerformanceMode('on')).toBe('on')
    expect(normalizePerformanceMode('off')).toBe('off')
  })

  it('迁移旧版 low/high 并修复未知值', () => {
    expect(normalizePerformanceMode('low')).toBe('on')
    expect(normalizePerformanceMode('high')).toBe('off')
    expect(normalizePerformanceMode('unexpected')).toBe('auto')
  })
})
