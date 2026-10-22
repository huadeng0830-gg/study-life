// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import QuickRecordSettings from '../src/components/QuickRecordSettings.vue'
import { DEFAULT_SETTINGS_POLICY, settings } from '../src/composables/settingsPolicy.js'

let app
let host
let previousSettings

beforeEach(() => {
  previousSettings = {
    ...settings.value,
    recentTypes: [...(settings.value.recentTypes || [])],
    defaultReminders: { ...settings.value.defaultReminders },
  }
  settings.value = {
    ...DEFAULT_SETTINGS_POLICY,
    recentTypes: [...DEFAULT_SETTINGS_POLICY.recentTypes],
    defaultReminders: { ...DEFAULT_SETTINGS_POLICY.defaultReminders },
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(QuickRecordSettings, { open: true })
  app.mount(host)
})

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
  settings.value = previousSettings
  previousSettings = null
})

describe('全局记录与提醒设置', () => {
  it('按实际作用范围分组显示设置，并保留账户默认值编辑', async () => {
    await nextTick()
    expect([...document.querySelectorAll('.settings-group h3')].map((heading) => heading.textContent.trim()))
      .toEqual(['常用与启动', '快速记录', '全局默认值', '提醒默认值'])
    expect(document.body.textContent).toContain('记录与提醒设置')
    expect(document.querySelector('select')).toBeTruthy()
    expect(document.querySelector('input[type="checkbox"]')).toBeTruthy()
    expect(document.querySelectorAll('input[type="number"]')).toHaveLength(3)

    const account = document.querySelector('input[placeholder="例如：微信 / 现金"]')
    account.value = '现金'
    account.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(settings.value.defaultAccount).toBe('现金')
  })
})
