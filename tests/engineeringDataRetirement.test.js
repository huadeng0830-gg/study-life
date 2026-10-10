// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmergencyBackup } from '../src/composables/emergencyExport.js'
import { retireFoodData } from '../src/composables/foodRetirement.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

describe('退役数据备份的真实导出链路', () => {
  it('删除旧餐饮及快递数据之前，紧急备份携带完整原始内容', async () => {
    localStorage.clear()
    const legacy = {
      sl_food_places: [{ id: 'fictional-food-place', name: '虚构餐馆' }],
      sl_food_history: [{ id: 'fictional-food-history', date: '2026-10-01' }],
      sl_food_filters: { selected: 'fictional-food-filter' },
      sl_packages: [{ id: 'fictional-package', note: '虚构取件记录' }],
    }
    for (const [key, value] of Object.entries(legacy)) localStorage.setItem(key, JSON.stringify(value))
    let archive
    const result = await retireFoodData({
      exportBackup: () => { archive = createEmergencyBackup(); return archive },
      removeVault: vi.fn(async () => ({ ok: true })),
    })
    expect(result).toMatchObject({ changed: true })
    expect(archive.data).toMatchObject({
      foodPlaces: legacy.sl_food_places,
      foodHistory: legacy.sl_food_history,
      foodFilters: legacy.sl_food_filters,
      packages: legacy.sl_packages,
    })
  })
})
