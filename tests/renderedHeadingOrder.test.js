// @vitest-environment happy-dom
/**
 * 渲染 DOM 级的标题顺序守卫（第二十五轮）。
 *
 * 【为什么必须渲染后才查】静态扫描看不见 `v-if` 分支：
 * 一个视图的 `<h1>` 可能只在某个分支里存在，而空态组件又会按 `level` 属性
 * 渲染成 h2/h3/h4——**只有挂载起来、把真实页面渲染出来，才知道真实的标题序列**。
 * 静态扫描此前只报出"没有 h1 的文件"（全是组件，组件内没有 h1 本来就是对的），
 * 而真实的跳级问题一个都看不到。
 *
 * 【为什么用真实路由表】`routes` 直接来自 `src/router/routes.js`（本轮从 main.js 抽出）。
 * 另抄一份路由清单必然随实现漂移，那就不是守卫了。
 *
 * 【为什么只看 main 里的标题】外壳导航区自己也有标题（侧栏分组等），
 * 它们是另一套层级；这条守卫管的是**页面内容**的标题结构。
 * 另外单独断言整个文档里恰好一个 `<h1>`，避免出现散落在页面之外的顶级标题。
 *
 * 【已知边界】判定可见性靠遍历祖先的 `display:none` / `visibility:hidden` /
 * `hidden` / `aria-hidden="true"`——`v-show` 隐藏的面板因此不会污染标题序列
 * （这正是需要它的原因：课程表等页面用 `v-show` 切标签页）。
 * 纯靠 CSS 类隐藏（样式表里 `display:none`）的情况看不到，属于已知边界。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { routes } from '../src/router/routes.js'
import { headingOrderIssues, isVisible, visibleHeadings } from './helpers/renderedHeadings.js'
import { gotoRoute, mountApp, settle } from './helpers/mountApp.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

// 与 backupIntegrity / dataManagerRestoreNav / dataManagerSync 三个既有测试保持一致：
// `virtual:pwa-register` 由构建期插件提供，测试环境里没有真实实现。
// 不 mock 它的话，一旦有页面加载到 `appUpdate.js` 就会抛出一个**未处理的** TypeError
// （虚拟模块被当成 file:// 路径交给 Node API）——所有用例仍然全绿，
// 但 vitest 会因为这次未处理错误整体退出 1，表现成"偶发检查失败"。
// 本文件加载的是**真实页面**（用桩路由的测试碰不到它），所以必须显式 mock。
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

/** 真实可导航的页面（排除重定向）。 */
const PAGES = routes.filter((record) => record.name && record.component && !record.redirect)
/** 兜底路由要访问一个不存在的地址。 */
const pathOf = (record) => (record.path.includes(':') ? '/不存在的地址' : record.path)

let mounted = null
const warnings = []
let warnSpy = null

beforeEach(() => {
  warnings.length = 0
  // 捕获控制台警告：vue-router 与 Vue 的警告是"代码写错但界面还能看"的典型信号，
  // 本轮就靠它抓到了 router-view 被放进 Transition 的真实缺陷。
  // Vue 的告警参数里混着响应式 Proxy，直接 `args.map(String)` 会在 Proxy 上抛
  // "Cannot convert object to primitive value"，那一声未处理的 rejection 会让 vitest
  // 整体退出 1（用例即使全绿也算失败），还会连带把断言变成超时。这里改成安全序列化。
  const safeText = (value) => {
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value) ?? String(value)
    } catch {
      return '[无法序列化的参数]'
    }
  }
  warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => { warnings.push(args.map(safeText).join(' ')) })
})

afterEach(() => {
  warnSpy?.mockRestore()
  warnSpy = null
  mounted?.unmount()
  mounted = null
  clearAnnouncement()
})

/**
 * 导航到某个路径并等懒加载视图渲染出来。
 *
 * 注意这里必须等**真实时间**：懒加载视图会拉起一大片模块图（OCR、表格解析…），
 * 只等两帧 rAF 会在 `route-fallback` 加载占位上就收工，于是"一个标题都没扫到"。
 * 那不是守卫在守空气，而是守卫跑得太早——两者必须分清楚。
 */
describe('渲染后的标题顺序', () => {
  it('每个真实页面的标题都不跳级', async () => {
    mounted = await mountApp({ routes })

    const problems = []
    let headingTotal = 0
    for (const record of PAGES) {
      const main = await gotoRoute(mounted, pathOf(record))
      expect(main, `路由 ${record.path} 没有渲染出 main 内容`).toBeTruthy()
      const headings = visibleHeadings(main)
      headingTotal += headings.length
      for (const issue of headingOrderIssues(headings)) {
        problems.push(`${record.meta?.title || record.path}（${record.path}）：${issue}`)
      }
      // 整个文档里也只能有一个 h1（防止顶级标题散落到页面之外）
      const strayH1 = [...document.querySelectorAll('h1')].filter((el) => !main.contains(el) && isVisible(el))
      expect(strayH1.map((el) => el.textContent.trim()), `${record.path} 的 h1 跑到了 main 之外`).toEqual([])
    }

    // 规模自证：页面数与标题数归零说明这条守卫已经与实现脱节
    expect(PAGES.length, '真实页面列表为空，守卫在守空气').toBeGreaterThanOrEqual(9)
    expect(headingTotal, '一个标题都没扫到，守卫在守空气').toBeGreaterThanOrEqual(9)
    expect(problems).toEqual([])
  })

  it('导航过程中不得出现 router-view / transition 相关的框架警告', async () => {
    mounted = await mountApp({ routes })
    for (const record of PAGES) await gotoRoute(mounted, pathOf(record))

    // 这条守卫来自本轮的发现：`<router-view>` 被放在 `<Transition>` 里时，
    // vue-router 4 每次都打警告，并且过渡/keep-alive 不按预期生效。
    // 警告是"界面看着还行、代码已经写错"的信号，值得单独钉住。
    const framework = warnings.filter((line) => /router-view|<transition>|<keep-alive>|keep-alive/i.test(line))
    expect(framework, `框架在警告路由写法有问题：\n${framework.join('\n')}`).toEqual([])
  })

  it('夹具：跳级、缺 h1、多个 h1、首个不是 h1 都要报出来', () => {
    expect(headingOrderIssues([{ level: 1, text: '页' }, { level: 2, text: '节' }, { level: 3, text: '小节' }])).toEqual([])
    // 降级不报（h3 回到 h2 是正常的）
    expect(headingOrderIssues([{ level: 1, text: '页' }, { level: 3, text: '小节' }, { level: 2, text: '节' }])).toHaveLength(1)
    expect(headingOrderIssues([{ level: 2, text: '节' }])).toHaveLength(2) // 没 h1 + 首个不是 h1
    expect(headingOrderIssues([{ level: 1, text: 'a' }, { level: 1, text: 'b' }])).toHaveLength(1)
    expect(headingOrderIssues([{ level: 1, text: '页' }, { level: 4, text: '深处' }])).toHaveLength(1)
    expect(headingOrderIssues([{ level: 1, text: '页' }, { level: 2, text: 'a' }, { level: 4, text: 'b' }])[0]).toContain('跳级')
  })

  it('夹具：可见性判断要认得出 v-show 那种隐藏（否则隐藏面板会污染标题序列）', () => {
    const host = document.createElement('div')
    host.innerHTML = '<h2>可见</h2><div style="display:none"><h3>藏起来</h3></div><div aria-hidden="true"><h3>读屏不看</h3></div><div hidden><h3>hidden 属性</h3></div>'
    document.body.appendChild(host)
    expect(visibleHeadings(host).map((h) => h.text)).toEqual(['可见'])
    host.remove()
  })
})