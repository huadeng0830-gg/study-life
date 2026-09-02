import { describe, expect, it } from 'vitest'
import { menuPlacementFor } from '../src/composables/menuPlacement.js'

describe('移动端卡片操作菜单', () => {
  it('按钮靠近屏幕底部时向上展开，避免编辑和删除被裁掉', () => {
    expect(menuPlacementFor({ top: 738, bottom: 760 }, 800)).toBe('up')
    expect(menuPlacementFor({ top: 98, bottom: 120 }, 800)).toBe('down')
  })
})
