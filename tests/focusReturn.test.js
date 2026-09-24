// @vitest-environment happy-dom
/**
 * 聚焦态的「返回列表」（第五十四轮）。
 *
 * 【层级模型（本条的判据取向）】路由全是一级平级，**没有父级**；深层态其实是
 * `?focus=<id>`（外加账本/今天页的 `?section=`）这种**聚焦态**。所以这里不验
 * "面包屑有几级"（那是编出来的层级），只验两件真实的事：
 *   ① 处在聚焦态时，外壳上出现一条明确的返回入口；
 *   ② 点它只清掉**聚焦**参数，不顺手清掉视图状态（`tab` / `date`）。
 * 第 ② 条就是判别力所在：「把整个 query 清空」是最省事也最容易写的错误实现，
 * 下面有一条纯函数夹具专门把它钉出来。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { FOCUS_QUERY_KEYS, hasFocusQuery, queryWithoutFocus } from '../src/composables/focusReturn.js'
import { mountApp, gotoRoute, settle } from './helpers/mountApp.js'
import { routes } from '../src/router/routes.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let mounted = null
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => {
  vi.restoreAllMocks()
  mounted?.unmount()
  mounted = null
  clearAnnouncement()
})

const returnButton = () => document.querySelector('.focus-return')
const query = () => mounted.router.currentRoute.value.query

describe('纯函数：只删聚焦键，保留视图状态', () => {
  it('识别聚焦态（focus 与 section 都算）', () => {
    expect(hasFocusQuery({})).toBe(false)
    expect(hasFocusQuery(undefined)).toBe(false)
    expect(hasFocusQuery({ tab: 'review' })).toBe(false)
    expect(hasFocusQuery({ focus: 'tx1' })).toBe(true)
    expect(hasFocusQuery({ section: 'bill' })).toBe(true)
  })

  it('删掉 focus / section，tab 与 date 原样保留', () => {
    expect(queryWithoutFocus({ focus: 'tx1', section: 'bill', tab: 'review', date: '2026-01-05' }))
      .toEqual({ tab: 'review', date: '2026-01-05' })
  })

  it('判别力自证：「把整个 query 清空」这个省事实现会在这条夹具上失败', () => {
    const naiveClearEverything = () => ({})
    const fixture = { focus: 'tx1', tab: 'review' }
    expect(naiveClearEverything(fixture)).not.toEqual(queryWithoutFocus(fixture))
  })

  it('FOCUS_QUERY_KEYS 只包含聚焦语义的键（不含视图状态键）', () => {
    expect(FOCUS_QUERY_KEYS).toEqual(['focus', 'section'])
    for (const viewKey of ['tab', 'date']) expect(FOCUS_QUERY_KEYS).not.toContain(viewKey)
  })
})

describe('外壳上的返回入口', () => {
  it('没有聚焦参数时不渲染（平时对布局与焦点序零影响）', async () => {
    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/tasks')
    expect(returnButton()).toBeNull()
  })

  it('带 ?focus= 时出现，点击后清掉参数并自己消失', async () => {
    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/tasks?focus=abc')
    expect(returnButton(), '聚焦态应出现返回入口').toBeTruthy()

    returnButton().click()
    await settle()

    expect(query().focus).toBeUndefined()
    expect(returnButton(), '退出聚焦后入口应消失').toBeNull()
  })

  it('只删聚焦键：其它查询参数必须活下来', async () => {
    mounted = await mountApp({ routes })
    // 【为什么这里用合成键 `keep` 而不是 `tab`】这个夹具踩过两次同一个坑：
    //   1. 带 `section=bill` 时，账本自己的 `focusBill()` 会为了让那笔账单可见主动把
    //      分区切到"固定账单"——那是**正确行为**，但让 `tab` 的取值不再由本组件决定；
    //   2. 只带 `tab=review&focus=tx1` 也不行：账本的聚焦逻辑会在数据就绪后**异步**
    //      改写 `tab`。批量负载下已观察到偶发红（期望 `review`、实际 `bills`，
    //      失败耗时 61ms vs 通过的 ~198ms）——**偶发的守卫比没有守卫更糟**，它会训练人忽略红。
    // 换成任何视图都不会改写的合成键之后，这条判据与账本的异步行为彻底解耦；
    // 判别力还在：把整份 query 清空的实现会连 `keep` 一起删掉。
    // `tab` 逐字保留由**纯函数层**那条 `tab=review` 的对照负责（那里没有异步、没有视图）。
    await gotoRoute(mounted, '/bills?tab=review&focus=tx1&keep=1')
    expect(returnButton()).toBeTruthy()

    returnButton().click()
    await settle()

    expect(query().focus).toBeUndefined()
    expect(query().keep, '视图状态不该被顺带清掉').toBe('1')
    // 对 `tab` 只断言"还在"：它的取值会被账本自己异步改写（见上）；而且账本对**默认**分区
    // 本来就不写 URL 参数，所以这里不能断言它一定等于某个值。
    expect(query().tab, '视图状态键被整个删掉了').toBeDefined()
  })

  it('只有 ?section= 时也算聚焦态（账本"定位到某笔账单"的深链）', async () => {
    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills?section=bill')
    expect(returnButton()).toBeTruthy()
  })
})

describe('返回入口的静态口径', () => {
  const source = readFileSync(resolve(root, 'src/components/FocusReturn.vue'), 'utf8')

  it('用 replace 而不是 push（退出聚焦态不该再压一条历史记录）', () => {
    expect(source).toContain('router.replace(')
    expect(source).not.toContain('router.push(')
  })

  it('聚焦参数由 composable 判定，组件里不重复写死键名', () => {
    expect(source).toContain("composables/focusReturn.js")
    expect(source).not.toContain("query.focus")
  })
})