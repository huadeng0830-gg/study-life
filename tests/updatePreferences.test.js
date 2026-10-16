// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { localStorage.clear(); vi.resetModules(); vi.useRealTimers() })

describe('本机更新偏好', () => {
  it('默认启用低频自动检查和轻量提醒，并将偏好持久化在本机', async () => {
    const preferences = await import('../src/composables/updatePreferences.js')
    expect(preferences.updatePreferences).toMatchObject({ autoCheck: true, showReminder: true, deferredVersion: '' })
    expect(preferences.setUpdatePreference('autoCheck', false)).toBe(true)
    expect(preferences.setUpdatePreference('showReminder', false)).toBe(true)
    vi.resetModules()
    const restored = await import('../src/composables/updatePreferences.js')
    expect(restored.updatePreferences).toMatchObject({ autoCheck: false, showReminder: false })
  })

  it('暂缓同一版本的提醒，但在新版本到达时重新显示', async () => {
    const preferences = await import('../src/composables/updatePreferences.js')
    expect(preferences.shouldShowUpdateReminder('1.2.0')).toBe(true)
    expect(preferences.deferUpdateReminder('1.2.0')).toBe(true)
    expect(preferences.shouldShowUpdateReminder('1.2.0')).toBe(false)
    expect(preferences.shouldShowUpdateReminder('1.2.1')).toBe(true)
    expect(preferences.setUpdatePreference('autoCheck', 'yes')).toBe(false)
  })

  it('「稍后提醒」只在静默期内有效，过期后重新提醒同一版本', async () => {
    const preferences = await import('../src/composables/updatePreferences.js')
    expect(preferences.deferUpdateReminder('1.2.0')).toBe(true)
    const deferredAt = preferences.updatePreferences.deferredAt
    expect(deferredAt).toBeGreaterThan(0)
    expect(preferences.shouldShowUpdateReminder('1.2.0', deferredAt + 1000)).toBe(false)
    // 没有到期时间时点一次就是**永久静音该版本**，用户会以为提示坏了。
    expect(preferences.shouldShowUpdateReminder('1.2.0', deferredAt + preferences.DEFER_REMINDER_TTL_MS + 1)).toBe(true)
  })

  it('即使版本状态不变，24 小时后也会响应式地恢复提醒', async () => {
    vi.useFakeTimers()
    const preferences = await import('../src/composables/updatePreferences.js')
    expect(preferences.deferUpdateReminder('1.2.0')).toBe(true)
    expect(preferences.shouldShowUpdateReminder('1.2.0')).toBe(false)
    await vi.advanceTimersByTimeAsync(preferences.DEFER_REMINDER_TTL_MS + 1)
    expect(preferences.shouldShowUpdateReminder('1.2.0')).toBe(true)
  })

  it('旧的永久静音记录会被迁移：静默期视为已过，且偏好搬进 sl_ 键', async () => {
    localStorage.setItem('study_life_update_preferences_v1',
      JSON.stringify({ autoCheck: false, showReminder: true, deferredVersion: '1.2.0' }))
    vi.resetModules()
    const preferences = await import('../src/composables/updatePreferences.js')
    expect(preferences.updatePreferences.autoCheck).toBe(false)
    expect(preferences.updatePreferences.deferredVersion).toBe('1.2.0')
    expect(preferences.shouldShowUpdateReminder('1.2.0')).toBe(true)
    expect(localStorage.getItem('sl_update_preferences_v1')).toContain('deferredVersion')
  })

  it('自动应用开关可持久化，默认开启', async () => {
    const preferences = await import('../src/composables/updatePreferences.js')
    expect(preferences.updatePreferences.autoApply).toBe(true)
    expect(preferences.setUpdatePreference('autoApply', false)).toBe(true)
    vi.resetModules()
    const restored = await import('../src/composables/updatePreferences.js')
    expect(restored.updatePreferences.autoApply).toBe(false)
  })
})
