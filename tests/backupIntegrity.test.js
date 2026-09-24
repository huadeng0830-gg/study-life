// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

import DataManager from '../src/components/DataManager.vue'
import { clearSyncSpaceSettings } from '../src/composables/syncSpace.js'

/*
 * 备份文件的完整性校验。
 *
 * 导出（v7 起）会写入 checksum，但导入侧原来只在"checksum 恰好存在"时才校验。
 * 于是只要把 JSON 里的 checksum 字段整段删掉，一份被改过的备份就能顺利导入 ——
 * 校验和等于没有。现在 v7+ 必须带校验和，v1–v6 的老备份（含应急导出）不受影响。
 */

let mounted = null

async function mountDataManager() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', name: 'today', component: { render: () => h('div', 'today') } },
      { path: '/:pathMatch(.*)*', name: 'not-found', component: { render: () => h('div', 'not-found') } },
    ],
  })
  const app = createApp({ render: () => h(DataManager, { open: true }) })
  app.use(router)
  await router.push('/')
  await router.isReady()
  app.mount(root)
  mounted = { app, root }
  await nextTick()
}

async function checksumOf(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function makeData() {
  return { courses: [], countdowns: [] }
}

async function importBackup(payload) {
  const input = document.querySelector('input[type="file"][accept*="json"]')
  expect(input).toBeTruthy()
  const file = {
    name: 'backup.json',
    text: async () => JSON.stringify(payload),
  }
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change'))
  // validateBackup 内部要等 crypto.subtle.digest —— 它落在真实的任务队列上，
  // 不是几个微任务就能排空的，所以这里轮询等待终态（出错或渲染出预览）。
  const startedAt = Date.now()
  while (Date.now() - startedAt < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (errorText() || document.querySelector('.restore-preview')) break
  }
  await nextTick()
}

function errorText() {
  return document.querySelector('.error')?.textContent?.trim() || ''
}

describe('备份文件完整性校验', () => {
  beforeEach(() => {
    localStorage.clear()
    clearSyncSpaceSettings()
    window.location.hash = ''
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
    document.body.querySelectorAll('.overlay').forEach((element) => element.remove())
    vi.unstubAllGlobals()
  })

  it('v9 带正确校验和时导入成功', async () => {
    await mountDataManager()
    const data = makeData()
    await importBackup({
      app: 'study-life',
      version: 9,
      schema: 'study-life.backup/v1',
      checksum: await checksumOf(data),
      data,
    })
    expect(errorText()).toBe('')
    expect(document.querySelector('.restore-preview')).toBeTruthy()
  })

  it('v9 篡改数据后校验和不匹配会被拒绝', async () => {
    await mountDataManager()
    const data = makeData()
    const checksum = await checksumOf(data)
    await importBackup({
      app: 'study-life',
      version: 9,
      schema: 'study-life.backup/v1',
      checksum,
      // 校验和是按原始 data 算的，这里换掉数据（模拟手工改动文件）。
      data: { courses: [{ id: 'injected', name: '偷偷加的一门课' }], countdowns: [] },
    })
    expect(errorText()).toContain('校验失败')
  })

  it('v9 删掉校验和字段不能再绕过检查', async () => {
    await mountDataManager()
    await importBackup({ app: 'study-life', version: 9, schema: 'study-life.backup/v1', data: makeData() })
    expect(errorText()).toContain('缺少校验和')
  })

  it('v9 校验和不是字符串（例如被改成数字）同样按缺失处理', async () => {
    await mountDataManager()
    await importBackup({ app: 'study-life', version: 9, schema: 'study-life.backup/v1', checksum: 12345, data: makeData() })
    expect(errorText()).toContain('缺少校验和')
  })

  it('v9 的空字符串校验和也按缺失处理', async () => {
    await mountDataManager()
    await importBackup({ app: 'study-life', version: 9, schema: 'study-life.backup/v1', checksum: '', data: makeData() })
    expect(errorText()).toContain('缺少校验和')
  })

  it('v9 schema 不对时先报版本不受支持', async () => {
    await mountDataManager()
    await importBackup({ app: 'study-life', version: 9, schema: 'something-else', data: makeData() })
    expect(errorText()).toContain('版本不受支持')
  })

  it('老版本备份（v1–v6）没有校验和仍可导入', async () => {
    for (const version of [1, 6]) {
      await mountDataManager()
      await importBackup({ app: 'study-life', version, data: makeData() })
      expect(errorText()).toBe('')
      mounted.app.unmount()
      mounted.root.remove()
      document.body.querySelectorAll('.overlay').forEach((element) => element.remove())
      mounted = null
    }
  })

  it('应急导出（v1、无校验和）依旧可以恢复', async () => {
    const { createEmergencyBackup } = await import('../src/composables/emergencyExport.js')
    const backup = createEmergencyBackup()
    expect(backup.version).toBeLessThan(7)
    expect(backup.checksum).toBeUndefined()

    await mountDataManager()
    await importBackup(backup)
    expect(errorText()).toBe('')
  })
})