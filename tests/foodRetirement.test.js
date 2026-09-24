// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { retireFoodData } from '../src/composables/foodRetirement.js'
import { SYNC_KEYS, sanitizeSyncPayload } from '../src/composables/cloudSyncData.js'
import { DEFAULT_CATEGORIES } from '../src/composables/ledgerCategories.js'
import { backupProvidedFields, buildBackupRestoreValues } from '../src/composables/backupRestore.js'

describe('Food retirement compatibility', () => {
  beforeEach(() => localStorage.clear())

  it('backs up, clears Vault first, then removes exact local keys and writes the marker', async () => {
    localStorage.setItem('sl_food_places', JSON.stringify([{ id: 'old' }]))
    localStorage.setItem('sl_food_history', '[]')
    localStorage.setItem('sl_appearance', JSON.stringify({ foodPickerMode: 'wheel', signature: 'keep me' }))
    const removeVault = vi.fn().mockResolvedValue({ ok: true })
    const result = await retireFoodData({ exportBackup: vi.fn(() => ({ app: 'study-life' })), removeVault })
    expect(result.changed).toBe(true)
    expect(removeVault).toHaveBeenCalledWith(['sl_food_places', 'sl_food_history', 'sl_food_filters'])
    expect(localStorage.getItem('sl_food_places')).toBeNull()
    expect(JSON.parse(localStorage.getItem('sl_appearance'))).toEqual({ signature: 'keep me' })
    expect(JSON.parse(localStorage.getItem('sl_migrations'))['food-retirement-v1']).toBe(true)
  })

  it('retains data and does not write a marker when backup fails', async () => {
    localStorage.setItem('sl_food_places', JSON.stringify([{ id: 'old' }]))
    const removeVault = vi.fn()
    const result = await retireFoodData({ exportBackup: vi.fn(() => { throw new Error('download blocked') }), removeVault })
    expect(result).toMatchObject({ aborted: true, error: '旧数据备份失败，本次清理已取消，原数据仍保留。' })
    expect(localStorage.getItem('sl_food_places')).not.toBeNull()
    expect(localStorage.getItem('sl_migrations')).toBeNull()
    expect(removeVault).not.toHaveBeenCalled()
  })

  it('retains data and marker when the Vault cleanup cannot be confirmed', async () => {
    localStorage.setItem('sl_food_places', JSON.stringify([{ id: 'old' }]))
    const result = await retireFoodData({ exportBackup: vi.fn(() => ({ ok: true })), removeVault: vi.fn().mockResolvedValue({ ok: false }) })
    expect(result).toMatchObject({ aborted: true, error: '旧数据安全副本清理失败，本次清理已取消，原数据仍保留。' })
    expect(localStorage.getItem('sl_food_places')).not.toBeNull()
    expect(localStorage.getItem('sl_migrations')).toBeNull()
  })

  it('is idempotent after a successful retirement', async () => {
    localStorage.setItem('sl_food_places', JSON.stringify([{ id: 'old' }]))
    const exportBackup = vi.fn(() => ({ ok: true }))
    const removeVault = vi.fn().mockResolvedValue({ ok: true })
    await retireFoodData({ exportBackup, removeVault })
    await retireFoodData({ exportBackup, removeVault })
    expect(exportBackup).toHaveBeenCalledTimes(1)
    expect(removeVault).toHaveBeenCalledTimes(1)
  })

  it('ignores retired keys in old payloads and preserves the ledger food category', () => {
    expect(SYNC_KEYS).not.toContain('sl_food_places')
    expect(sanitizeSyncPayload({ sl_food_places: [{ id: 'old' }], sl_tasks: [] }).values).toEqual({ sl_tasks: [] })
    expect(DEFAULT_CATEGORIES.find((item) => item.key === 'food')).toMatchObject({ name: '餐饮' })
    expect(buildBackupRestoreValues({ foodPlaces: [{ id: 'old' }], tasks: [{ id: 'keep' }] }, backupProvidedFields({ foodPlaces: [{ id: 'old' }], tasks: [{ id: 'keep' }] }), { tasks: 'sl_tasks' })).toEqual({ sl_tasks: [{ id: 'keep' }] })
  })
})
