import { describe, expect, it } from 'vitest'
import { buildReleaseEntry, formatDateKey, nextVersion } from '../scripts/version-utils.mjs'

describe('version-utils', () => {
  it('formatDateKey 输出 YYYY年MM月DD日', () => {
    expect(formatDateKey(new Date(2026, 7, 29))).toBe('2026年08月29日')
  })

  it('同一天发布时序号递增', () => {
    const entries = [{ version: '2026年08月29日-版本4' }]
    expect(nextVersion(entries, new Date(2026, 7, 29))).toBe('2026年08月29日-版本5')
  })

  it('跨天发布时从版本1 重新开始', () => {
    const entries = [{ version: '2026年08月29日-版本4' }]
    expect(nextVersion(entries, new Date(2026, 8, 1))).toBe('2026年09月01日-版本1')
  })

  it('没有历史条目时从版本1 开始', () => {
    expect(nextVersion([], new Date(2026, 7, 29))).toBe('2026年08月29日-版本1')
  })

  it('buildReleaseEntry 生成可用的条目文本并转义引号', () => {
    const entry = buildReleaseEntry('2026年08月29日-版本5', ['说明 A', "说明 B' 带引号"])
    expect(entry).toContain("version: '2026年08月29日-版本5'")
    expect(entry).toContain("signature: '',")
    expect(entry).toContain("'说明 A'")
    expect(entry).toContain("'说明 B\\' 带引号'")
  })
})