// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

vi.mock('../src/composables/dataVault.js', () => ({
  clearDataVault: vi.fn(async () => true), mirrorLocalValue: vi.fn(async () => true),
  mirrorLocalValues: vi.fn(async () => true), setMirrorErrorHandler: vi.fn(), setMirrorTimingHandler: vi.fn(),
}))

let app, host
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); localStorage.clear() })
afterEach(() => {
  app?.unmount(); host?.remove(); app = null; host = null
  vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers()
})

async function modal() {
  const { default: TimeSettingsModal } = await import('../src/components/schedule/TimeSettingsModal.vue')
  const schemes = await import('../src/composables/recognitionSchemes.js')
  const { accountDataOwner } = await import('../src/composables/accountSyncIdentity.js')
  const shared = await import('../src/composables/timeSettingsShared.js')
  accountDataOwner.value = 'fictional-owner-a'
  shared.pasteText.value = '虚构校区\n第一节课 08:00-08:45'
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp(TimeSettingsModal, { show: false, courseCountByPeriodId: () => 0 })
  const instance = app.mount(host)
  return { run: instance.$.setupState.runParsePaste, schemes, accountDataOwner, shared }
}

describe('粘贴作息的真实设置入口保留识别会话归属', () => {
  it('冷加载解析期间换号，旧文本不进入新账号草稿', async () => {
    const context = await modal()
    const pending = context.run()
    context.accountDataOwner.value = 'fictional-owner-b'
    await pending
    expect(context.schemes.recognitionDraft.value).toBeNull()
    expect(context.shared.settingsToast.value).not.toContain('识别完成')
  })

  it('解析期间换号再切回原账号，旧会话仍然失效', async () => {
    const context = await modal()
    const pending = context.run()
    context.accountDataOwner.value = 'fictional-owner-b'
    context.accountDataOwner.value = 'fictional-owner-a'
    await pending
    expect(context.schemes.recognitionDraft.value).toBeNull()
    expect(context.shared.settingsToast.value).not.toContain('识别完成')
  })

  it('识别暂存加载期间放弃，设置入口接受空结果而不抛异常', async () => {
    const context = await modal()
    const realStart = context.schemes.startRecognition
    vi.spyOn(context.schemes, 'startRecognition').mockImplementationOnce((...args) => {
      const pending = realStart(...args)
      context.schemes.clearRecognition()
      return pending
    })
    await expect(context.run()).resolves.toBeUndefined()
    expect(context.schemes.recognitionDraft.value).toBeNull()
    expect(context.shared.settingsToast.value).not.toContain('识别完成')
  })
})
