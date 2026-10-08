// @vitest-environment happy-dom
/**
 * 账本分区与 URL 的一致性（第三十一轮）。
 *
 * 【缺口】`LedgerView` 一直在**读** `route.query.tab`（所以 `#/bills?tab=review`
 * 这样的深链是能用的），但全仓**没有一处写它**：点分区不会更新地址栏。
 * 结果是刷新、分享链接、加书签之后分区就丢了，而且 URL 与界面互相矛盾——
 * 又是"契约只做了一半"的形状。
 *
 * 【这里验什么】写入侧补上之后：点分区 / 用方向键切分区，URL 都要跟着变；
 * 回到默认分区要把参数去掉（URL 保持干净）；脏参数要被清掉；深链要照旧能用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { mountApp, gotoRoute, settle } from './helpers/mountApp.js'
import { routes } from '../src/router/routes.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

let mounted = null
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => {
  vi.restoreAllMocks()
  mounted?.unmount()
  mounted = null
  clearAnnouncement()
})

const queryTab = () => mounted.router.currentRoute.value.query.tab
const clickTab = async (id) => {
  document.querySelector(id).click()
  await settle()
}
const isPanelShown = (id) => Boolean(document.querySelector(`[role="tabpanel"][aria-labelledby="${id}"]`))

describe('账本分区与 URL 的双向一致', () => {
  it('点击分区会把分区写进 URL', async () => {
    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills')

    expect(queryTab(), '默认分区不该往 URL 里塞参数').toBeUndefined()
    await clickTab('#ledger-tab-review')
    expect(queryTab(), '点了回顾就要写进 URL').toBe('review')
    expect(isPanelShown('ledger-tab-review')).toBe(true)

    await clickTab('#ledger-tab-bills')
    expect(queryTab()).toBe('bills')
  })

  it('回到默认分区时把参数去掉，URL 保持干净', async () => {
    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills?tab=review')
    expect(queryTab()).toBe('review')

    await clickTab('#ledger-tab-ledger')
    expect(queryTab(), '回到默认分区应删掉参数而不是写成 tab=ledger').toBeUndefined()
  })

  it('用方向键切换分区时，URL 同样跟着变', async () => {
    // 键盘路径和点击路径必须落到同一个状态上，否则就会出现
    // "键盘切了分区但地址栏还是旧的"这种只在一种输入方式下出现的 bug。
    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills')

    const tablist = document.querySelector('.ledger-tabs')
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await settle()
    expect(queryTab()).toBe('bills')

    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }))
    await settle()
    expect(queryTab()).toBe('review')
  })

  it('深链照旧能用：直接带参数打开就落在对应分区', async () => {
    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills?tab=review')
    expect(document.querySelector('#ledger-tab-review').getAttribute('aria-selected')).toBe('true')
    expect(isPanelShown('ledger-tab-review')).toBe(true)
    expect(queryTab(), '合法的深链参数不该被写回逻辑改掉').toBe('review')
  })

  it('看不懂的参数会被清掉，并回落默认分区', async () => {
    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills?tab=zzz')
    expect(document.querySelector('#ledger-tab-ledger').getAttribute('aria-selected'), '非法值回落账本').toBe('true')
    expect(queryTab(), '脏参数应被清掉，别留在地址栏里骗人').toBeUndefined()
  })

  it('不改动 URL 上的其它参数', async () => {
    mounted = await mountApp({ routes })
    // 【哨兵键必须是账本页不会去动的那个】
    // 原先用 `focus=abc`。但 `?focus=` 恰恰是账本页**设计上会主动清掉**的：
    // LedgerView 的 highlightTransaction/focusBill 消费完深链之后会调
    // clearFocusFromRoute（见 focusReturn.test.js 里同一件事的记录）。
    // 于是这条断言测到的不是"写分区会不会吃掉别的参数"，而是"深链被消费掉没有" ——
    // 换成任何视图都不改写的合成键 `keep` 之后，两件事才彻底解耦，
    // 判别力不变：把整份 query 清空的实现照样会把它删掉。
    await gotoRoute(mounted, '/bills?keep=abc')
    await clickTab('#ledger-tab-review')
    expect(queryTab()).toBe('review')
    expect(mounted.router.currentRoute.value.query.keep, '写分区不能把别的参数吃掉').toBe('abc')
  })

  it('写分区用的是 replace，不在历史里堆层', async () => {
    // 切换分区属于页内状态：用 push 的话，手机返回键要先把三个分区倒着走一遍
    // 才能真正离开账本页。这条守住"用 replace"这个决定。
    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills')
    const before = window.history.length
    await clickTab('#ledger-tab-review')
    await clickTab('#ledger-tab-bills')
    expect(window.history.length, '切分区不该新增历史条目').toBe(before)
  })
})