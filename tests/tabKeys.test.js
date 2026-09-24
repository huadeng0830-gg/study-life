// @vitest-environment happy-dom
/**
 * 标签页键盘模型（第三十轮）。
 *
 * 【缺口是什么】第二十七～二十九轮把全站的 tab 语义清理干净了（5 个 tablist、全是真标签页、
 * 都有面板），但 APG 标签页契约的**键盘那一半**一直缺着：没有 roving tabindex，
 * 也没有 ←/→、Home/End。也就是说 `role="tab"` 对外宣告的交互契约里，
 * 「组内用方向键切换」这一条是做不到的——和"只有 class 没有 aria-selected"同类。
 *
 * 【这里验什么】
 *   1. 单元：`useTabKeys` 的键位映射、环绕、roving tabindex、否决权、不吞无关按键；
 *   2. 集成：真实渲染出来的账本页分区，按 → 之后选中项、焦点、面板三者一起换。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountApp, gotoRoute, settle } from './helpers/mountApp.js'
import { useTabKeys } from '../src/composables/tabKeys.js'
import { routes } from '../src/router/routes.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

afterEach(() => {
  document.body.innerHTML = ''
})

/* ---------------- 单元：键位与状态 ---------------- */

function makeList(keys) {
  const host = document.createElement('div')
  host.setAttribute('role', 'tablist')
  host.innerHTML = keys.map((key) => `<button type="button" role="tab" id="tab-${key}">${key}</button>`).join('')
  document.body.appendChild(host)
  return host
}

function mountKeys({ keys, initial }) {
  const host = makeList(keys)
  let active = initial
  let selectResult = true
  const selected = []
  const controller = useTabKeys({
    keys,
    active: () => active,
    select: (key) => {
      selected.push(key)
      if (selectResult === false) return false
      active = key
      return true
    },
  })
  host.addEventListener('keydown', controller.onKeydown)
  return { host, controller, selected, get active() { return active }, veto: (v) => { selectResult = v } }
}

function press(host, key) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  host.dispatchEvent(event)
  return event
}

describe('useTabKeys：键位映射', () => {
  it('←/→ 在组内移动，并在两端环绕', () => {
    const t = mountKeys({ keys: ['a', 'b', 'c'], initial: 'a' })
    press(t.host, 'ArrowRight')
    expect(t.active).toBe('b')
    press(t.host, 'ArrowRight')
    expect(t.active).toBe('c')
    press(t.host, 'ArrowRight')
    expect(t.active, '从最后一个再按 → 应绕回第一个').toBe('a')
    press(t.host, 'ArrowLeft')
    expect(t.active, '从第一个再按 ← 应绕到最后一个').toBe('c')
  })

  it('Home / End 直达两端', () => {
    const t = mountKeys({ keys: ['a', 'b', 'c', 'd'], initial: 'b' })
    press(t.host, 'End')
    expect(t.active).toBe('d')
    press(t.host, 'Home')
    expect(t.active).toBe('a')
  })

  it('焦点跟着选中项走（automatic activation）', () => {
    const t = mountKeys({ keys: ['a', 'b'], initial: 'a' })
    t.host.querySelector('#tab-a').focus()
    expect(document.activeElement.id, '起始焦点应在当前选中的 tab 上').toBe('tab-a')
    press(t.host, 'ArrowRight')
    expect(document.activeElement.id, '切换后焦点必须跟着走').toBe('tab-b')
  })

  it('方向键与 Home/End 都要 preventDefault（否则会移动插入符 / 滚动页面）', () => {
    const t = mountKeys({ keys: ['a', 'b'], initial: 'a' })
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      expect(press(t.host, key).defaultPrevented, `${key} 应被拦截`).toBe(true)
    }
  })

  it('不吞掉与自己无关的按键', () => {
    const t = mountKeys({ keys: ['a', 'b'], initial: 'a' })
    const event = press(t.host, 'a')
    expect(event.defaultPrevented, '普通字符键不该被拦').toBe(false)
    expect(t.selected, '不该发生任何切换').toEqual([])
    expect(t.active).toBe('a')
  })

  it('只有一个 tab 时，方向键不会切到自己身上', () => {
    const t = mountKeys({ keys: ['only'], initial: 'only' })
    press(t.host, 'ArrowRight')
    expect(t.selected, '没有可切的目标就不该调用 select').toEqual([])
    expect(t.active).toBe('only')
  })
})

describe('useTabKeys：roving tabindex 与否决权', () => {
  it('只有当前选中的 tab 留在 Tab 序列里', () => {
    const t = mountKeys({ keys: ['a', 'b', 'c'], initial: 'b' })
    expect(t.controller.tabIndexFor('a')).toBe(-1)
    expect(t.controller.tabIndexFor('b')).toBe(0)
    expect(t.controller.tabIndexFor('c')).toBe(-1)
    expect(t.controller.activeTabIndex()).toBe(1)
  })

  it('select 返回 false 表示切换被否决：不移动焦点，也不改变选中项', () => {
    const t = mountKeys({ keys: ['a', 'b'], initial: 'a' })
    t.host.querySelector('#tab-a').focus()
    t.veto(false)
    press(t.host, 'ArrowRight')
    expect(t.active, '被否决后选中项不变').toBe('a')
    expect(document.activeElement.id, '被否决后焦点不能跑到没被选中的 tab 上').toBe('tab-a')
  })
})

/* ---------------- 集成：真实渲染出来的标签页 ---------------- */

describe('账本页分区：真实渲染下的键盘切换', () => {
  it('三个分区只留一个 Tab 停靠点，按 → 后选中项、焦点、面板一起换', async () => {
    const mounted = await mountApp({ routes })
    // 注意：账本页的路由是 /bills（分区自身的键才叫 ledger/bills/review）。
    await gotoRoute(mounted, '/bills')

    const tablist = document.querySelector('.ledger-tabs')
    expect(tablist, '账本分区应该渲染出来').toBeTruthy()
    const tabs = [...tablist.querySelectorAll('[role="tab"]')]
    expect(tabs.length).toBe(3)
    expect(tabs.map((tab) => tab.getAttribute('tabindex')), '只有选中的分区在 Tab 序列里').toEqual(['0', '-1', '-1'])

    tabs[0].focus()
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await settle()

    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(tabs[0].getAttribute('aria-selected')).toBe('false')
    expect(document.activeElement, '焦点应落在新选中的分区上').toBe(tabs[1])
    expect(
      document.querySelector('[role="tabpanel"][aria-labelledby="ledger-tab-bills"]'),
      '面板必须跟着切换',
    ).toBeTruthy()
    expect(tabs.map((tab) => tab.getAttribute('tabindex')), 'roving 位置也要跟着换').toEqual(['-1', '0', '-1'])
  })
})