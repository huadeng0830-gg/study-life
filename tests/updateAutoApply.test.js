// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import { AUTO_APPLY_SESSION_KEY, createUpdateAutoApplyGate, startUpdateAutoApply } from '../src/composables/updateAutoApply.js'
import { overlayStackRevision } from '../src/composables/overlayStack.js'

function gateWith({ overlays = 0, pending = { ok: true, pendingKeys: [] },
  preferences = { autoApply: true, autoCheck: true } } = {}) {
  return createUpdateAutoApplyGate({ session: sessionStorage, isOverlayOpen: () => overlays > 0,
    pendingWrites: () => pending, preferences })
}

afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

describe('更新自动应用的判定', () => {
  it('资源就绪、无未落盘改动、无浮层时自动应用', () => {
    expect(gateWith().decide('ready')).toMatchObject({ apply: true, reason: 'ready' })
  })

  it('未落盘的改动优先于自动更新：宁可等，也不丢数据', () => {
    expect(gateWith({ pending: { ok: false, pendingKeys: ['sl_tasks'] } }).decide('ready'))
      .toMatchObject({ apply: false, reason: 'pending-writes' })
  })

  it('浮层打开时不打断正在填的表单', () => {
    expect(gateWith({ overlays: 1 }).decide('ready')).toMatchObject({ apply: false, reason: 'overlay-open' })
  })

  it('只有 ready 才自动应用；下载中、出错、已是最新都不动', () => {
    for (const stage of ['idle', 'checking', 'downloading', 'available', 'installing', 'verifying',
      'manual-reload', 'completed', 'blocked', 'warning', 'error', 'latest'])
      expect(gateWith().decide(stage).apply, stage).toBe(false)
  })

  it('用户关掉自动应用或自动检查后不再自动重载', () => {
    expect(gateWith({ preferences: { autoApply: false, autoCheck: true } }).decide('ready').reason).toBe('preference-off')
    expect(gateWith({ preferences: { autoApply: true, autoCheck: false } }).decide('ready').reason).toBe('auto-check-off')
  })

  it('同一会话只自动应用一次，避免重载循环', () => {
    const gate = gateWith()
    expect(gate.decide('ready').apply).toBe(true)
    gate.markApplied()
    expect(gate.decide('ready')).toMatchObject({ apply: false, reason: 'already-applied' })
    // 标记必须在 sessionStorage：它要跨过自动重载本身，否则新页面会再次判定「该更新」。
    expect(sessionStorage.getItem(AUTO_APPLY_SESSION_KEY)).toBe('1')
  })

  it('落盘检查抛错时按「有未落盘改动」处理，不冒险重载', () => {
    const gate = createUpdateAutoApplyGate({ session: sessionStorage, isOverlayOpen: () => false,
      pendingWrites: () => { throw new Error('storage blocked') }, preferences: { autoApply: true, autoCheck: true } })
    expect(gate.decide('ready')).toMatchObject({ apply: false, reason: 'pending-check-failed' })
  })
})

describe('启动自动应用的接线', () => {
  it('stage 变 ready 时调用一次 apply，并在存在浮层时等待', async () => {
    const state = reactive({ stage: 'downloading' })
    const apply = vi.fn()
    let overlays = 1
    const stop = startUpdateAutoApply({ state, apply, windowRef: window, recheckMs: 60000,
      gate: createUpdateAutoApplyGate({ session: sessionStorage, isOverlayOpen: () => overlays > 0,
        pendingWrites: () => ({ ok: true, pendingKeys: [] }), preferences: { autoApply: true, autoCheck: true } }) })
    state.stage = 'ready'
    await nextTick()
    expect(apply).not.toHaveBeenCalled()
    overlays = 0
    // 浮层关闭后重试，而不是永远错过这次更新 —— 生产里由浮层栈版本号触发。
    overlayStackRevision.value += 1
    await nextTick()
    expect(apply).toHaveBeenCalledTimes(1)
    stop()
  })

  it('缺少 state 或 apply 时不接线也不抛错', () => {
    expect(typeof startUpdateAutoApply({ state: null, apply: null })).toBe('function')
    expect(typeof startUpdateAutoApply()).toBe('function')
  })
})