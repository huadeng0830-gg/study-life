// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { localStorage.clear(); vi.resetModules() })

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
})
