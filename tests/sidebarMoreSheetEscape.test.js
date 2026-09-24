// @vitest-environment happy-dom
/**
 * 「更多功能」浮层的 Escape 出口（第二十一轮）。
 *
 * 起因：`Modal`、`ActionSheet`、`ContextMenu` 三个浮层都处理 Escape，
 * 只有 `Sidebar.vue` 里这个自造浮层漏了——键盘用户必须一路 Tab 到
 * 「关闭更多功能」那个 × 才能收起来。已按同一约定补上。
 *
 * 【为什么必须做运行时测试】源码里"提到了 Escape"和"监听真的接上、按键真的关掉了"
 * 是两件事：监听挂在 `onMounted` 里、判断条件是 `showMobileMore`，任何一处写错
 * （比如挂到 `onBeforeUnmount`、或条件写反）源码扫描都看不出来。
 * 这里直接派发真实 keydown 事件看结果。
 *
 * 还验证了两条**精度**，免得这个行为变成"乱抢焦点"：
 *  - 浮层没开时按 Escape 什么都不做；
 *  - 焦点本来不在浮层里时按 Escape，不把用户在其他位置的焦点抢走。
 */
import { createApp, nextTick } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'
import Sidebar from '../src/components/Sidebar.vue'

let app = null
let host = null

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
})

async function mountSidebar() {
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/schedule', component: { template: '<div />' } },
      { path: '/tasks', component: { template: '<div />' } },
      { path: '/exams', component: { template: '<div />' } },
      { path: '/lists', component: { template: '<div />' } },
      { path: '/bills', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()

  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(Sidebar)
  app.use(router)
  app.mount(host)
  await nextTick()

  return {
    trigger: host.querySelector('.more-trigger'),
    sheet: () => host.querySelector('.mobile-more-sheet'),
  }
}

/**
 * 等 `<Transition>` 的离场走完。
 *
 * 浮层是 `v-if` 包在 `<Transition name="more-sheet">` 里的：状态变 false 之后
 * 元素**不会立刻**从 DOM 消失，要等离场结束。没有 CSS 时长时 Vue 靠 `nextFrame`
 * （两次 requestAnimationFrame）收尾。happy-dom 不会算 CSS，所以这里补上这两帧——
 * 这是测试环境的特性，不是产品行为。不补的话会误判成「Escape 没生效」。
 */
async function settle() {
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await nextTick()
}

/** 在目标元素上派发一次会冒泡的 Escape（真实键盘事件的路径：元素 → document）。 */
function pressEscape(target = document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

describe('「更多功能」浮层可以用 Escape 收起', () => {
  it('开着时按 Escape 会收起，并把焦点还给触发按钮', async () => {
    const ui = await mountSidebar()
    expect(ui.trigger, '找不到 .more-trigger 触发按钮').toBeTruthy()
    expect(ui.sheet(), '一开始不该有浮层').toBe(null)

    // 打开
    ui.trigger.click()
    await nextTick()
    expect(ui.sheet(), '点击触发按钮后浮层要出现').toBeTruthy()
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('true')

    // 焦点进到浮层里（真实用户会 Tab 进来），再从浮层内部按 Escape
    const closeBtn = ui.sheet().querySelector('button')
    expect(closeBtn, '浮层里应当有「关闭更多功能」按钮').toBeTruthy()
    closeBtn.focus()
    expect(ui.sheet().contains(document.activeElement), '前提：焦点确实在浮层里').toBe(true)

    pressEscape(closeBtn)
    await nextTick()
    // 关闭已生效：状态先翻转（DOM 移除要等离场）
    expect(ui.trigger.getAttribute('aria-expanded'), 'Escape 之后状态要变成收起').toBe('false')
    expect(ui.sheet()?.className, '浮层应当开始离场').toMatch(/more-sheet-leave/)

    await settle()
    expect(ui.sheet(), '离场结束后浮层要从 DOM 移除').toBe(null)
    // 焦点归位：浮层没了，里面的元素也从 DOM 消失，不拉回来焦点就掉在 body 上
    expect(document.activeElement, '焦点应当回到触发按钮').toBe(ui.trigger)
  })

  it('浮层没开时按 Escape 什么都不做', async () => {
    const ui = await mountSidebar()
    pressEscape()
    await settle()
    expect(ui.sheet()).toBe(null)
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('焦点不在浮层里时，Escape 不抢走用户的焦点', async () => {
    const ui = await mountSidebar()
    ui.trigger.click()
    await nextTick()
    expect(ui.sheet()).toBeTruthy()

    // 焦点放在侧边栏的某个导航项上（不在浮层内）
    const navItem = host.querySelector('.mobile-nav a')
    expect(navItem, '找不到移动端导航项').toBeTruthy()
    navItem.focus()
    pressEscape(navItem)
    await settle()

    expect(ui.sheet(), '浮层仍然要收起').toBe(null)
    expect(document.activeElement, '焦点不该被抢到触发按钮上').toBe(navItem)
  })
})