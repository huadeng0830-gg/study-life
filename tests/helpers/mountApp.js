/**
 * 挂载整个应用外壳（`App.vue`）的测试夹具（第二十四轮）。
 *
 * 【为什么需要它】有几类不变量只有**渲染出来**才谈得上检查：
 *   - 渲染后的标题顺序（源文件里各组件各写各的 `<h2>`，只有挂载后才知道真实先后）；
 *   - 真实 Tab 顺序（哪些元素真的进了 tab order，取决于隐藏状态与 disabled）；
 *   - 应用外壳自己的播报通道是否真的常驻在 DOM 里。
 * 另外 `App.vue` 里那几处 app 级提示由状态标志驱动，不挂载就无法驱动。
 *
 * 【为什么用桩路由】`App.vue` 只提供外壳（侧栏 + `<router-view>` + 播报区），
 * 断言外壳不该顺手把全部懒加载视图拉起来（慢且易受视图内部实现影响）。
 * 需要真实视图时把 `routes` 传进来即可。
 *
 * 【用完必须 unmount】外壳挂载时会起定时器与监听器；测试必须在 `afterEach` 里
 * 调 `unmount()`，并在结束时 `clearAnnouncement()`，否则播报内容会漏到下一个用例。
 *
 * 【挂真实路由的测试还要 mock PWA 虚拟模块】传入真实 `routes` 时页面会加载到
 * `appUpdate.js`，它 import 的是构建期虚拟模块 `virtual:pwa-register`。
 * 测试文件里加一行（三处既有测试的写法一致）：
 *   `vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))`
 * 不加的话会抛一个**未处理的** TypeError：所有用例仍全绿，但 vitest 整体退出 1。
 */
import { nextTick } from 'vue'
import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from '../../src/App.vue'
import { markReleaseSeen } from '../../src/composables/releaseNotes.js'

/** 默认桩路由：一个空页面，足以让外壳渲染完整。 */
const STUB_ROUTES = [
  { path: '/', name: 'home', component: { name: 'StubHome', template: '<div class="stub-home">桩页面</div>' } },
  { path: '/:pathMatch(.*)*', name: 'stub-catch-all', component: { name: 'StubNotFound', template: '<div class="stub-404">桩兜底</div>' } },
]

/**
 * 挂载 `App.vue`，返回外壳、路由与卸载函数。
 *
 * @param {{ routes?: import('vue-router').RouteRecordRaw[], hash?: string, markReleaseSeen?: boolean }} [options]
 * @returns {Promise<{ app: import('vue').App, host: HTMLElement, router: import('vue-router').Router, settle: () => Promise<void>, unmount: () => void }>}
 */
export async function mountApp({ routes = STUB_ROUTES, hash = '/', markReleaseSeen: seen = true } = {}) {
  // 【为什么夹具要主动把「更新说明」标记成已读】（第五十四轮）
  // 全新 profile（localStorage 干净）下，应用**会**在启动时弹出「✨ 已更新」更新说明——
  // 那是**正确行为**，不是噪声。但 `UpdateNotes` 在 `App.vue` 里是
  // `defineAsyncComponent`，所以它**什么时候挂上来是一个时序问题**：于是任何
  // 「body 里还剩几个浮层 / 最上层浮层是谁」的断言，实际测的是那个异步分块有没有赶上。
  // 第五十四轮把版本号从 48 提到 49 时，`confirmDialogMigration` 里一条
  // 「取消后确认框应关闭」就从**靠运气绿**翻成了红（收到的浮层是更新说明，不是确认框，
  // 详见报告 §1.82）。而仓库里本来已经有 6 处测试各自 `remove()` 掉全部 `.overlay`
  // 来绕开它——与其让每个守卫各踩一遍，不如在这里把状态固定下来：
  // **夹具默认扮演「回访用户」**，让这类整体断言只反映被测组件。
  // 需要验证"首次启动确实会弹"的用例请显式传 `markReleaseSeen: false`
  // （`tests/updateNotesModal.test.js` 就是这么写的）。
  if (seen) markReleaseSeen()

  const router = createRouter({ history: createWebHashHistory(), routes })
  const host = document.createElement('div')
  host.className = 'test-app-host'
  document.body.appendChild(host)

  const app = createApp(App)
  app.use(router)
  await router.isReady()
  // ⚠ 必须**无条件**把初始路由归位。hash 历史是全局的：上一个测试最后停在
  // `#/不存在的地址`，下一个 `mountApp` 就会**从 404 页开始**——随后离开 404 页的
  // 过渡会卡住，`#main-content` 永久为空（既没有视图也没有加载占位），
  // 于是任何等待"视图就绪"的守卫都会跑满轮询直到超时。
  // 原来写成 `if (hash !== '/')` 时，恰恰在默认值 '/' 上跳过了归位，泄漏就这样发生。
  await router.replace(hash)
  app.mount(host)
  await settle()
  // 必须等**初始视图**真正就绪再交还给测试。初始路由组件也是懒加载的：
  // 如果测试在它还在加载时就 `push()` 到别处，两者会撞车，视图会**永远**
  // 停在 `.route-fallback` 上（第二十七轮实测：刚挂载就导航到 /bills 会一直卡住，
  // 而先走一步 '/' 再导航就正常）。这个竞态属于夹具的问题，不该让每个守卫各踩一遍。
  await waitForView()

  return {
    app,
    host,
    router,
    settle,
    unmount() {
      app.unmount()
      host.remove()
    },
  }
}

/**
 * `#main-content` 里的**视图根节点**。
 *
 * 【为什么不能用 firstElementChild】`#main-content` 里的子节点不只有视图：
 * 外壳会往它前面插自己的节点 —— 全局告警占位 `.global-alert-reserve`
 * （有同步/保存/备份告警时才在）与聚焦态的 `<FocusReturn>`。视图永远在**最后**。
 *
 * 原来的夹具取 `firstElementChild`，于是只要外壳在启动后插了一条告警占位
 * （备份提醒、同步提示，都是几秒后才出现的定时器），"视图根"就变成了那个
 * 常驻占位元素 —— 它的节点身份在切页面时**不变**。
 * 而 `gotoRoute` 的判据正是"视图根必须换过"，于是每一次导航都等满 400 次轮询
 * （约 4 秒）。一条要访问 9 个页面的守卫因此要跑 30 多秒，撞破测试超时 ——
 * 而且是**整片一起红**，单跑却能过。实测每个页面其实 30~290ms 就绪了。
 */
function viewRootOf(main) {
  const root = main?.lastElementChild ?? null
  if (!root) return null
  // 外壳节点永远不是"这一页的视图"。
  if (root.classList.contains('global-alert-reserve') || root.classList.contains('focus-return')) return null
  return root
}

/** 当前 `#main-content` 里是否已经是真实视图（而不是加载占位或外壳节点）。 */
function isViewReady(main) {
  const root = viewRootOf(main)
  return Boolean(root) && !main.querySelector('.route-fallback')
}

/**
 * 等初始视图渲染完成。轮询之间用**真实时间**：懒加载视图的模块图很大
 * （OCR、表格解析、xlsx…），首次约需 200ms，只等两帧 rAF 会误判。
 */
async function waitForView() {
  for (let i = 0; i < 400; i++) {
    if (isViewReady(document.querySelector('#main-content'))) break
    await settle()
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  await settle()
}

/** 等 Vue 把这一轮改动刷完（过渡动画的离场要多等两帧，见 §1.32 的教训）。 */
export async function settle() {
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await nextTick()
}

/**
 * 导航到某个路径并**等目标视图真的渲染出来**。
 *
 * 【判据】等**根节点身份**发生变化（证明视图真的换了）且 `#main-content` 已就绪
 * （有内容、且不再显示 `.route-fallback` 加载占位）。
 *
 * 为什么不用"DOM 连续两次完全一致"来判稳定：实测各页面的稳定期只有 2~4 次轮询，
 * 要求更多就会**永远等不到**（第二十七轮踩过，表现为每页跑满 400 次轮询、测试 5s 超时）。
 * 节点身份不受页面内文字/时钟持续更新的干扰，也不会把"加载占位"误当成稳定。
 *
 * @param {{ router: import('vue-router').Router }} app 由 `mountApp` 返回的对象
 * @param {string} path 目标路径
 * @returns {Promise<HTMLElement | null>} 渲染完成后的 `#main-content`
 */
export async function gotoRoute(app, path) {
  // 已经在目标页面或目标路由重定向回当前页面时，不必要求视图根节点换过。
  const beforeRoute = app.router.currentRoute.value
  const alreadyThere = beforeRoute.path === path
  // ⚠ 必须**在 push 之前**抓旧视图的根节点。模块已被缓存时（同一测试文件里第二次
  // 导入同一个视图），视图会在 push 期间就同步换好；若在 push 之后才抓，
  // 抓到的"旧节点"其实已经是新视图，于是"根节点必须变过"永远不成立 →
  // 每页跑满 400 次轮询 → 测试超时（第二十七轮实测）。
  // 取的是 viewRootOf（最后一个子节点）而不是 firstElementChild，理由见该函数注释。
  const before = viewRootOf(document.querySelector('#main-content'))
  await app.router.push(path)
  const routeChanged = app.router.currentRoute.value !== beforeRoute
  const samePathAfterNavigation = app.router.currentRoute.value.path === beforeRoute.path

  for (let i = 0; i < 400; i++) {
    await settle()
    const main = document.querySelector('#main-content')
    const root = viewRootOf(main)
    if (isViewReady(main) && (alreadyThere || samePathAfterNavigation || routeChanged || root !== before)) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  await settle()
  return document.querySelector('#main-content')
}

/** 在挂载好的外壳里查询（元素可能被 Teleport 到 body，所以默认从 body 查）。 */
export function shellQuery(selector, root = document.body) {
  return root.querySelector(selector)
}

export function shellQueryAll(selector, root = document.body) {
  return [...root.querySelectorAll(selector)]
}
