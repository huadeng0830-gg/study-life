// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

import DataManager from '../src/components/DataManager.vue'
import { clearSyncSpaceSettings, randomSecret, saveSyncSpaceSettings } from '../src/composables/syncSpace.js'
import { cloudMetadata, connectionState } from '../src/composables/cloudSync.js'
import { deviceProfile } from '../src/composables/deviceIdentity.js'

let mounted = null
const originalOnLine = navigator.onLine

function mountDataManager() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ render: () => h(DataManager, { open: true }) })
  app.mount(root)
  mounted = { app, root }
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

async function waitForSelector(selector) {
  await vi.waitFor(() => expect(document.querySelector(selector)).not.toBeNull(), { timeout: 3_000 })
}

beforeEach(() => {
  localStorage.clear()
  clearSyncSpaceSettings()
  connectionState.value = 'disconnected'
  cloudMetadata.value = {
    exists: true,
    revision: 1,
    updatedAt: null,
    updatedByDeviceId: null,
    updatedByDeviceName: null,
    devices: [{ id: deviceProfile.value.id, name: deviceProfile.value.name, lastSeenAt: null }],
  }
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.root.remove()
  mounted = null
  document.body.querySelectorAll('.overlay').forEach((element) => element.remove())
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnLine })
  vi.unstubAllGlobals()
})

describe('DataManager 多设备同步入口', () => {
  it('刷新后仍能从待确认加入状态继续生成合并预览', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url.endsWith('/space/revision')) {
        return jsonResponse({
          exists: true,
          revision: 1,
          devices: [{ id: deviceProfile.value.id, name: deviceProfile.value.name }],
        })
      }
      if (url.endsWith('/pull')) {
        return jsonResponse({
          ok: true,
          exists: true,
          revision: 1,
          payload: '',
          metadata: { revision: 1 },
        })
      }
      throw new Error(`unexpected endpoint: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    saveSyncSpaceSettings({
      spaceId: 'AB7K-P9M2-X4DQ',
      deviceCredential: randomSecret(),
      payloadKey: randomSecret(),
      autoSyncEnabled: false,
      bootstrapPending: true,
    })

    mountDataManager()
    await flushUi()

    expect(document.querySelector('.bootstrap-actions')).not.toBeNull()
    const mainAction = document.querySelector('.sync-main-action')
    expect(mainAction?.textContent).toContain('查看并确认')
    await mainAction.click()
    await flushUi()
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/pull'))).toBe(true)
  })

  it('绑定设置已恢复但连接校验尚未完成时，添加设备仍可触发配对流程', async () => {
    saveSyncSpaceSettings({
      spaceId: 'AB7K-P9M2-X4DQ',
      deviceCredential: randomSecret(),
      payloadKey: randomSecret(),
      autoSyncEnabled: false,
    })
    mountDataManager()
    await nextTick()

    const addButton = [...document.querySelectorAll('.sync-devices button')].find((button) => button.textContent.includes('添加设备'))
    expect(addButton).toBeTruthy()
    expect(addButton.disabled).toBe(false)
  })

  it('点击添加设备会请求 pair create/prepare 并显示二维码，即使自动同步关闭', async () => {
    const pairingToken = randomSecret()
    const fetchMock = vi.fn(async (url) => {
      if (url.endsWith('/space/revision')) return jsonResponse({ exists: true, revision: 1, devices: [{ id: deviceProfile.value.id, name: deviceProfile.value.name }] })
      if (url.endsWith('/pair/create')) return jsonResponse({ ok: true, spaceId: 'AB7K-P9M2-X4DQ', pairingToken, expiresAt: new Date(Date.now() + 600_000).toISOString() })
      if (url.endsWith('/pair/prepare')) return jsonResponse({ ok: true })
      throw new Error(`unexpected endpoint: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: false })
    mountDataManager()
    await nextTick()

    const addButton = [...document.querySelectorAll('.sync-devices button')].find((button) => button.textContent.includes('添加设备'))
    await addButton.click()
    await waitForSelector('.pair-qr')

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining(['/api/sync/pair/create', '/api/sync/pair/prepare']))
    expect(document.querySelector('.pair-qr')).not.toBeNull()
    expect(document.querySelector('.pair-create-state')).toBeNull()
  })

  it.each([
    [401, '此设备的同步授权已失效，请重新绑定。'],
    [429, '请求过于频繁，请稍后再试'],
  ])('pair create 返回 %s 时保留弹窗并显示明确错误，不渲染空二维码', async (status, message) => {
    const fetchMock = vi.fn(async (url) => {
      if (url.endsWith('/space/revision')) return jsonResponse({ exists: true, revision: 1, devices: [{ id: deviceProfile.value.id, name: deviceProfile.value.name }] })
      return jsonResponse({ error: message }, status, status === 429 ? { 'Retry-After': '60' } : {})
    })
    vi.stubGlobal('fetch', fetchMock)
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: false })
    mountDataManager()
    await nextTick()

    const addButton = [...document.querySelectorAll('.sync-devices button')].find((button) => button.textContent.includes('添加设备'))
    await addButton.click()
    await waitForSelector('.pair-create-state [role="alert"]')

    expect(document.querySelector('.pair-create-state [role="alert"]')?.textContent).toContain(message)
    expect(document.querySelector('.pair-qr')).toBeNull()
    expect([...document.querySelectorAll('.pair-create-state button')].some((button) => button.textContent.includes('重新生成'))).toBe(true)
  })

  it('pair create 失败后点击重新生成只重新执行一次请求并可恢复显示二维码', async () => {
    const pairingToken = randomSecret()
    let createCalls = 0
    const fetchMock = vi.fn(async (url) => {
      if (url.endsWith('/space/revision')) return jsonResponse({ exists: true, revision: 1, devices: [{ id: deviceProfile.value.id, name: deviceProfile.value.name }] })
      if (url.endsWith('/pair/create')) {
        createCalls += 1
        return createCalls === 1
          ? jsonResponse({ error: '暂时无法生成配对信息，请稍后重试。' }, 500)
          : jsonResponse({ ok: true, spaceId: 'AB7K-P9M2-X4DQ', pairingToken, expiresAt: new Date(Date.now() + 600_000).toISOString() })
      }
      if (url.endsWith('/pair/prepare')) return jsonResponse({ ok: true })
      throw new Error(`unexpected endpoint: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: false })
    mountDataManager()
    await nextTick()

    const addButton = [...document.querySelectorAll('.sync-devices button')].find((button) => button.textContent.includes('添加设备'))
    await addButton.click()
    await waitForSelector('.pair-create-state [role="alert"]')
    await [...document.querySelectorAll('.pair-create-state button')].find((button) => button.textContent.includes('重新生成')).click()
    await waitForSelector('.pair-qr')

    expect(createCalls).toBe(2)
    expect(document.querySelector('.pair-qr')).not.toBeNull()
  })

  it('离线点击添加设备只显示联网提示，不打开空配对弹窗', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const fetchMock = vi.fn(async () => jsonResponse({ exists: true, revision: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: false })
    mountDataManager()
    await nextTick()

    const addButton = [...document.querySelectorAll('.sync-devices button')].find((button) => button.textContent.includes('添加设备'))
    await addButton.click()
    await nextTick()

    expect(document.querySelector('.pair-create-state')).toBeNull()
    expect(document.querySelector('.pair-scan')).toBeNull()
    expect(document.body.textContent).toContain('添加设备需要联网')
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/pair/create'))).toBe(false)
  })

  it('自动同步关闭时仍每 15 秒刷新设备元数据，配对成功后列表从 1 台收敛为 2 台', async () => {
    vi.useFakeTimers()
    let revisionCalls = 0
    const phone = { id: 'phone-device', name: '我的 iPhone', lastSeenAt: new Date().toISOString() }
    const fetchMock = vi.fn(async (url) => {
      if (url.endsWith('/space/revision')) {
        revisionCalls += 1
        return jsonResponse({ exists: true, revision: 1, devices: revisionCalls > 1 ? [{ id: deviceProfile.value.id, name: deviceProfile.value.name }, phone] : [{ id: deviceProfile.value.id, name: deviceProfile.value.name }] })
      }
      throw new Error(`unexpected endpoint: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: false })
    mountDataManager()
    await vi.advanceTimersByTimeAsync(0)
    expect(document.body.textContent).toContain('1 台')

    await vi.advanceTimersByTimeAsync(15_000)
    await nextTick()

    expect(revisionCalls).toBeGreaterThanOrEqual(2)
    expect(document.body.textContent).toContain('2 台')
    vi.useRealTimers()
  })
})
