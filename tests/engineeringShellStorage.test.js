// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountApp, settle } from './helpers/mountApp.js'
import { lastBackupAt } from '../src/composables/backupReminder.js'
import { localSafeMode } from '../src/composables/localSafeMode.js'

let mounted
let restoreState
afterEach(() => {
  mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  restoreState?.()
  restoreState = null
})

async function backupReminder() {
  const previousBackup = lastBackupAt.value
  const previousSafeMode = localSafeMode.value
  restoreState = () => { lastBackupAt.value = previousBackup; localSafeMode.value = previousSafeMode }
  lastBackupAt.value = ''
  localSafeMode.value = true
  localStorage.removeItem('sl_backup_nudge_at')
  let callback
  const schedule = window.setTimeout.bind(window)
  vi.spyOn(window, 'setTimeout').mockImplementation((handler, delay, ...args) => {
    if (delay === 6000) callback = handler
    return schedule(handler, delay, ...args)
  })
  mounted = await mountApp()
  expect(callback, '捕获真实 App.vue 挂载注册的备份提醒').toBeTypeOf('function')
  return callback
}

function storageFault(method, operation) {
  const storage = localStorage
  const fault = vi.fn(operation)
  vi.stubGlobal('localStorage', new Proxy(storage, {
    get(target, key) {
      if (key === method) return fault
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }))
  return fault
}

describe('应用外壳备份提醒的存储异常', () => {
  it('读取提醒时间被阻止时仍显示备份入口，不抛未捕获异常', async () => {
    const remind = await backupReminder()
    const read = localStorage.getItem.bind(localStorage)
    const fault = storageFault('getItem', (key) => {
      if (key === 'sl_backup_nudge_at') throw new DOMException('Fictional blocked storage', 'SecurityError')
      return read(key)
    })
    expect(() => remind()).not.toThrow()
    expect(fault).toHaveBeenCalledWith('sl_backup_nudge_at')
    await settle()
    expect(document.querySelector('.global-alert-stack')).not.toBeNull()
    expect([...document.querySelectorAll('.global-alert-stack button')].some((button) => button.textContent === '去备份')).toBe(true)
  })

  it('提醒时间写入配额不足时仍显示可关闭提醒', async () => {
    const remind = await backupReminder()
    const write = localStorage.setItem.bind(localStorage)
    const fault = storageFault('setItem', (key, value) => {
      if (key === 'sl_backup_nudge_at') throw new DOMException('Fictional full storage', 'QuotaExceededError')
      return write(key, value)
    })
    expect(() => remind()).not.toThrow()
    expect(fault).toHaveBeenCalledWith('sl_backup_nudge_at', expect.any(String))
    await settle()
    const close = document.querySelector('[aria-label="关闭备份提醒"]')
    expect(close).not.toBeNull()
    close.click()
    await settle()
    expect(document.querySelector('[aria-label="关闭备份提醒"]')).toBeNull()
    expect(mounted.host.querySelector('#main-content')).not.toBeNull()
  })

  it('最近已提醒时保持七天去重，避免反复打扰', async () => {
    const remind = await backupReminder()
    localStorage.setItem('sl_backup_nudge_at', new Date().toISOString())
    remind()
    await settle()
    expect(document.querySelector('[aria-label="关闭备份提醒"]')).toBeNull()
  })
})
