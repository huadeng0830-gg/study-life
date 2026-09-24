// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

/*
 * 影子副本（IndexedDB 安全副本）在写入失败时不能丢掉这批更新。
 *
 * 原实现先把待写队列清空、再去写；写失败只调用一次错误回调，队列里已经没有
 * 这批键了 —— 影子副本会一直停在旧值，直到用户下次恰好再改同一个键。
 * 这里覆盖：失败后重新排队、重试间隔指数退避（避免 240ms 死循环）、
 * 以及页面隐藏/关闭时的补写。
 *
 * 每个用例用 vi.resetModules() + 动态 import 拿一份全新的模块状态，
 * 否则上一个用例遗留的队列与失败计数会污染退避时长的断言。
 */

let vault = null
const errors = []

const errorsFor = (key) => errors.filter((entry) => entry.keys.includes(key))

async function freshVault({ indexedDB = undefined } = {}) {
  vi.resetModules()
  vi.stubGlobal('indexedDB', indexedDB)
  vault = await import('../src/composables/dataVault.js')
  vault.setMirrorErrorHandler((error, keys) => errors.push({ message: error.message, keys }))
  return vault
}

describe('影子副本写入失败的恢复', () => {
  beforeEach(() => {
    errors.length = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vault = null
  })

  it('失败后重新排队并重试，而不是把更新丢掉', async () => {
    await freshVault()
    vault.mirrorLocalValue('sl_tasks', '[{"id":"a"}]')

    expect(errorsFor('sl_tasks')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(240)
    expect(errorsFor('sl_tasks')).toHaveLength(1)

    // 重新排队 → 240ms 后必然还有第二次尝试。丢队列的话这里永远只有 1 次。
    await vi.advanceTimersByTimeAsync(240)
    expect(errorsFor('sl_tasks').length).toBeGreaterThanOrEqual(2)
  })

  it('重试间隔指数退避，不会每 240ms 空转一圈', async () => {
    await freshVault()
    vault.mirrorLocalValue('sl_notes', '[]')

    await vi.advanceTimersByTimeAsync(240) // 第 1 次失败，下一次 +240ms
    expect(errorsFor('sl_notes')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(240) // 第 2 次失败，下一次 +480ms
    expect(errorsFor('sl_notes')).toHaveLength(2)

    // 退避已经拉长：再等 479ms 不应该有第三次。
    await vi.advanceTimersByTimeAsync(479)
    expect(errorsFor('sl_notes')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(errorsFor('sl_notes')).toHaveLength(3)

    // 第 3 次失败后间隔变成 960ms。
    await vi.advanceTimersByTimeAsync(959)
    expect(errorsFor('sl_notes')).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(errorsFor('sl_notes')).toHaveLength(4)
  })

  it('页面隐藏时立即补写，不等防抖窗口', async () => {
    await freshVault()
    const original = Object.getOwnPropertyDescriptor(document, 'hidden')
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    try {
      await vault.initializeDataVault()
      vault.mirrorLocalValue('sl_expenses', '[]')
      expect(errorsFor('sl_expenses')).toHaveLength(0)

      // 不推进定时器，直接切到后台：应当立刻发起一次写入。
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
      expect(errorsFor('sl_expenses').length).toBeGreaterThanOrEqual(1)
    } finally {
      if (original) Object.defineProperty(document, 'hidden', original)
      else delete document.hidden
    }
  })

  it('pagehide 也会触发补写', async () => {
    await freshVault()
    await vault.initializeDataVault()
    vault.mirrorLocalValue('sl_focus_sessions', '[]')

    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(errorsFor('sl_focus_sessions').length).toBeGreaterThanOrEqual(1)
  })

  it('页面可见时不会无谓地提前补写', async () => {
    await freshVault()
    await vault.initializeDataVault()
    vault.mirrorLocalValue('sl_events', '[]')

    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(errorsFor('sl_events')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(240)
    expect(errorsFor('sl_events')).toHaveLength(1)
  })

  it('不再管理的键不会被排队', async () => {
    await freshVault()
    await vault.initializeDataVault()
    vault.mirrorLocalValue('other_key', '[]')
    vault.mirrorLocalValue('sl_transfer_undo', '[]')
    vault.mirrorLocalValue('sl_ok', null)
    await vi.advanceTimersByTimeAsync(5000)
    expect(errors).toHaveLength(0)
  })
})

/*
 * 宿主环境消失后的收尾（这条与 `npm test` 偶发 exit 1 直接相关）。
 *
 * 影子写盘有 240ms 防抖。用例跑完后 vitest 会拆除 happy-dom 环境：清掉全局
 * window/document，并在同一个 worker 里换上下一个测试文件的新 window。可是
 * **已经排进定时器队列的那一次冲刷照样会触发** —— happy-dom 的定时器底层就是
 * Node 定时器，环境拆除并不会把队列里已排好的那一个也收走。
 *
 * 于是旧环境留下的冲刷会照常走失败分支、照常调用错误回调，而那一声 console
 * 已经不属于任何测试/文件：vitest 会把它算作「环境拆除后仍在 pending 的
 * onUserConsoleLog 上报」，在汇总里记成 `Errors 1 error`，于是 1819 条用例
 * 全绿、`npm test` 依然以 exit 1 退出。下面锁定「宿主没了/换人了，就不再冲刷、
 * 也不再调度新定时器」。
 */
describe('宿主环境消失后不再继续影子写盘', () => {
  // 真定时器：这三条要观察防抖窗口真的跨过「环境消失」那一刻，
  // 假定时器会把 window.setTimeout 一起换掉，模拟不出宿主被拆除的样子。
  const realSetTimeout = globalThis.setTimeout
  const waitPastDebounce = () => new Promise((resolve) => realSetTimeout(resolve, 350))

  /*
   * 临时把全局 window 换成 `replacement`（undefined = 环境被拆除；另一个
   * Window = 同一进程里换上了新环境），执行完一定还原。
   *
   * 这里刻意不用 `vi.stubGlobal('window', …)`：happy-dom 的 window 与全局
   * setTimeout 是同一份别名，stubGlobal 把它换掉之后 `vi.unstubAllGlobals()`
   * 还原不回来，后面的用例会连带被拖垮（表现为 window.setTimeout 未定义）。
   */
  async function withWindow(replacement, body) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', { value: replacement, configurable: true, writable: true })
    try {
      return await body()
    } finally {
      if (original) Object.defineProperty(globalThis, 'window', original)
      else delete globalThis.window
    }
  }

  beforeEach(() => {
    vi.useRealTimers()
  })

  it('环境拆除后才触发的冲刷被丢弃，不产生错误回调', async () => {
    await freshVault()
    vault.mirrorLocalValue('sl_tasks', '[{"id":"a"}]')

    // 模拟环境拆除：全局 window 直接消失（vitest 拆除 happy-dom 就是这样）。
    await withWindow(undefined, async () => {
      await waitPastDebounce()
    })

    expect(errorsFor('sl_tasks')).toHaveLength(0)
  })

  it('同一进程里换上新 window 后，旧环境遗留的冲刷不会再执行', async () => {
    await freshVault()
    vault.mirrorLocalValue('sl_notes', '[]')
    // 模拟 isolate 模式下同一个 worker 换上下一个测试文件的环境：window 还在，
    // 但已经是**另一个对象**，旧环境的那批写盘不能再写进去。
    const { Window } = await import('happy-dom')
    await withWindow(new Window(), async () => {
      await waitPastDebounce()
    })

    expect(errorsFor('sl_notes')).toHaveLength(0)
  })

  it('宿主消失后的新写入不再排队，也不会再安排定时器', async () => {
    await freshVault()

    await withWindow(undefined, async () => {
      vault.mirrorLocalValue('sl_expenses', '[{"id":"b"}]')
      await waitPastDebounce()
    })

    expect(errors).toHaveLength(0)
  })
})

/*
 * 收尾取消待写盘（`cancelPendingMirrorWrites`，这条同样与 `npm test` 偶发 exit 1 相关）。
 *
 * 上面那一组只能挡住「**宿主已经消失之后**才触发」的冲刷。真正命中 `npm test` 的
 * 竞态在它前面一步：冲刷发生在**最后一个用例跑完、环境还没拆**的那条缝里 —— 此时
 * window 还在，守卫当然放行，失败回调里的那一声 console 就成了「cleanup 时仍在
 * pending 的 onUserConsoleLog 上报」，vitest 记成 `Errors 1 error`。所以测试收尾必须
 * 主动把待写盘连同定时器一起取消（`tests/helpers/mirrorTeardown.js`）。
 *
 * 第二块锁定的是**跨模块实例**的取消：`vi.resetModules()`（测试文件里到处都在用）
 * 会重新求值本模块，旧实例的定时器句柄就此丢失，只有「按宿主登记」才收拾得掉。
 */
describe('收尾取消待写盘', () => {
  beforeEach(() => {
    errors.length = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vault = null
  })

  it('取消之后即使越过退避窗口，也不会再冲刷、不再产生错误回调', async () => {
    await freshVault()
    vault.mirrorLocalValue('sl_tasks', '[{"id":"a"}]')

    vault.cancelPendingMirrorWrites()
    await vi.advanceTimersByTimeAsync(30000)

    // 不取消的话，这里会先失败一次、再按退避一直重试（那正是 exit 1 的来源）。
    expect(errors).toHaveLength(0)
  })

  it('重新求值模块后，旧实例遗留的定时器也能被取消', async () => {
    await freshVault()
    vault.mirrorLocalValue('sl_ledger', '[]')

    // 模拟测试文件里的 vi.resetModules()：旧实例还在定时器队列里，但句柄已经丢了。
    vi.resetModules()
    const nextVault = await import('../src/composables/dataVault.js')
    nextVault.setMirrorErrorHandler((error, keys) => errors.push({ message: error.message, keys }))
    nextVault.cancelPendingMirrorWrites()

    await vi.advanceTimersByTimeAsync(30000)
    expect(errors).toHaveLength(0)
  })
})