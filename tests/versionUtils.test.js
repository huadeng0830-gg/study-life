import { describe, expect, it } from 'vitest'
import {
  buildReleaseEntry,
  formatDateKey,
  MAX_RELEASE_ENTRIES,
  nextVersion,
  replaceCurrentNotes,
  trimReleaseUpdates,
  validateReleaseNotes,
} from '../scripts/version-utils.mjs'

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

describe('trimReleaseUpdates', () => {
  function configWithVersions(versions) {
    const entries = versions.map((version, index) => [
      '  {',
      `    version: '${version}',`,
      `    signature: 'sig${index}',`,
      '    notes: [',
      `      '说明${index}：长度足够的一条说明',`,
      '    ],',
      '  },',
    ].join('\n'))
    return [
      "export const RELEASE_SOURCE_SIGNATURE = 'abc'",
      'export const RELEASE_UPDATES = Object.freeze([',
      entries.join('\n'),
      '])',
      '',
    ].join('\n')
  }

  it('超过上限时只保留顶部 max 条', () => {
    const versions = ['v5', 'v4', 'v3', 'v2', 'v1']
    const trimmed = trimReleaseUpdates(configWithVersions(versions), 3)
    expect(trimmed).toContain("version: 'v5'")
    expect(trimmed).toContain("version: 'v4'")
    expect(trimmed).toContain("version: 'v3'")
    expect(trimmed).not.toContain("version: 'v2'")
    expect(trimmed).not.toContain("version: 'v1'")
    expect(trimmed.match(/^  \{$/gm).length).toBe(MAX_RELEASE_ENTRIES)
    expect(trimmed.trimEnd().endsWith('])')).toBe(true)
    expect(trimmed.startsWith("export const RELEASE_SOURCE_SIGNATURE = 'abc'")).toBe(true)
  })

  it('未超限时原样返回', () => {
    const config = configWithVersions(['v3', 'v2', 'v1'])
    expect(trimReleaseUpdates(config, 3)).toBe(config)
  })

  it('结构不符时原样返回，不写坏文件', () => {
    expect(trimReleaseUpdates('完全不是 release.config', 3)).toBe('完全不是 release.config')
    expect(trimReleaseUpdates('', 3)).toBe('')
  })
})

/**
 * 第三十二轮补的写入前校验。
 *
 * 起因是一次真实的翻车：`--notes "\"/\" 打开全局搜索…"` 经 PowerShell 传进去
 * 只剩一个反斜杠，脚本照写不误，直到 tests/releaseNotes.test.js 才报红——
 * 门禁红了一整轮才被发现。于是把两条契约（够长、没被 shell 弄坏）做成纯函数，
 * 让 bump 脚本在**写入之前**就拒绝。
 */
describe('validateReleaseNotes', () => {
  it('正常说明没有问题', () => {
    expect(validateReleaseNotes(['按 / 打开全局搜索并直接聚焦搜索框'])).toEqual([])
    expect(validateReleaseNotes(['说明一：把搜索面板的焦点问题修好', '说明二：补上写入前的校验'])).toEqual([])
  })

  it('说明太短会被拦下（更新弹窗里那只是占位噪音）', () => {
    const problems = validateReleaseNotes(['太短'])
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('太短')
    expect(problems[0]).toContain('"太短"')
  })

  it('空数组 / 全空说明会被拦下', () => {
    expect(validateReleaseNotes([]).length).toBe(1)
    expect(validateReleaseNotes([undefined, null]).length).toBe(2)
  })

  it('认出被 shell 吃掉引号的痕迹：整条只剩反斜杠', () => {
    const problems = validateReleaseNotes(['\\'])
    expect(problems.some((p) => p.includes('只剩反斜杠'))).toBe(true)
  })

  it('认出转义被弄坏的痕迹：平白多出 \\"', () => {
    const problems = validateReleaseNotes(['打开全局搜索 \\" 快捷键接好了'])
    expect(problems.some((p) => p.includes('\\"'))).toBe(true)
  })
})

describe('replaceCurrentNotes', () => {
  const CONFIG = [
    "export const RELEASE_SOURCE_SIGNATURE = 'abc'",
    'export const RELEASE_UPDATES = Object.freeze([',
    '  {',
    "    version: '2026年09月20日-版本9',",
    "    signature: 'sig9',",
    '    notes: [',
    "      '旧说明一：够了长度',",
    '    ],',
    '  },',
    '  {',
    "    version: '2026年09月19日-版本8',",
    "    signature: 'sig8',",
    '    notes: [',
    "      '更旧的说明：别动我',",
    '    ],',
    '  },',
    '])',
  ].join('\n')

  it('只替换当前版本那条的说明，历史条目原样不动', () => {
    const next = replaceCurrentNotes(CONFIG, ['新说明一：写清楚了', '新说明二：也够长度'])
    expect(next).not.toBeNull()
    expect(next).toContain("      '新说明一：写清楚了',")
    expect(next).toContain("      '新说明二：也够长度',")
    expect(next).not.toContain('旧说明一')
    // 历史条目必须一字不动
    expect(next).toContain("      '更旧的说明：别动我',")
    expect(next).toContain("    signature: 'sig8',")
    expect(next).toContain("    notes: [\n      '更旧的说明：别动我',\n    ],")
  })

  it('保留其它字段与括号结构（条目数不变）', () => {
    const next = replaceCurrentNotes(CONFIG, ['新说明：长度足够'])
    expect(next.match(/notes: \[/g).length).toBe(2)
    expect(next.match(/^  \{$/gm).length).toBe(2)
    expect(next.startsWith("export const RELEASE_SOURCE_SIGNATURE = 'abc'")).toBe(true)
    expect(next.trimEnd().endsWith('])')).toBe(true)
  })

  it('说明里的引号照样会被转义', () => {
    const next = replaceCurrentNotes(CONFIG, ["带'引号'的说明文本"])
    expect(next).toContain("'带\\'引号\\'的说明文本'")
  })

  it('结构对不上时返回 null，交给调用方报错而不是写坏文件', () => {
    expect(replaceCurrentNotes('完全不是 release.config.js 的内容', ['说明够长了'])).toBeNull()
    expect(replaceCurrentNotes('export const RELEASE_UPDATES = Object.freeze([\n  {\n    version: 1,\n  },\n])', ['说明够长了'])).toBeNull()
    expect(replaceCurrentNotes('', ['说明够长了'])).toBeNull()
  })
})