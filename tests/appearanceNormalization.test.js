// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { normalizeAppearanceValue, normalizeWallpaperConfig } from '../src/composables/appearance.js'

describe('外观存储值归一化', () => {
  it('把损坏的枚举与嵌套值收回到可用默认值', () => {
    expect(normalizeAppearanceValue({
      quoteMode: 'surprise',
      fixedQuoteIndex: 12,
      signature: 8,
      showQuote: 'yes',
      scheduleSkin: 'unknown',
      quotes: ['有效文字'],
      swipeActions: { tasks: { left: 'run-script', right: 'edit' }, lists: { left: 'delete', right: 'unknown' } },
    })).toMatchObject({
      quoteMode: 'daily',
      fixedQuoteIndex: 0,
      signature: '',
      showQuote: true,
      scheduleSkin: 'classic',
      swipeActions: { tasks: { left: 'complete', right: 'edit' }, lists: { left: 'delete', right: 'edit' } },
    })
  })

  it('限制壁纸数值到界面提供的范围并验证位置、适配与目标模式', () => {
    const normalized = normalizeWallpaperConfig({ targets: {
      global: { enabled: true, blur: 500, brightness: 20, overlay: -1, opacity: 150, position: 'url(javascript:alert(1))', fit: 'stretch' },
      home: { mode: 'own', blur: '7', brightness: '120', overlay: 40, opacity: 80, position: 'right center', fit: 'contain' },
    } })
    expect(normalized.targets.global).toMatchObject({
      enabled: true, blur: 20, brightness: 50, overlay: 0, opacity: 100,
      position: 'center center', fit: 'auto',
    })
    expect(normalized.targets.home).toMatchObject({
      mode: 'own', blur: 7, brightness: 120, overlay: 40, opacity: 80,
      position: 'right center', fit: 'contain',
    })
    expect(normalized.targets.schedule.mode).toBe('inherit')
  })
})
