// @vitest-environment happy-dom
/**
 * 真实 Tab 顺序与可访问名称守卫（第二十六轮）。
 *
 * 【为什么是"渲染后"才查】Tab 顺序是运行时的东西：哪些元素真的进了 Tab 序，
 * 取决于 `v-if`、`disabled`、`tabindex` 以及模板里的先后，静态扫描只能猜。
 * 一个直接的例子：全站源码里只有 **1 个** `<a>`，导航全是 `<RouterLink>`——
 * 只有渲染之后它们才变成真正可聚焦的 `<a href>`。
 *
 * 【补的是哪块空白】仓库已有三个相关守卫，覆盖的都是别的角度：
 *   - `formControlNames.test.js`：**静态**扫表单控件，而且是**存量棘轮**（有 baseline 上限）；
 *   - `keyboardReachability.test.js`：静态扫"只有鼠标能触发"的 div/span/li/td/tr；
 *   - `accessibleNames.test.js`：只针对少数具体组件。
 * "渲染后全站、按钮与链接这类非表单控件、以及真实 Tab 顺序"此前没人管。
 *
 * 【判据】
 *   1. 渲染后不得有 `tabindex` 大于 0 的元素——正数 tabindex 会插队到自然顺序之前，
 *      是"键盘顺序与视觉顺序不一致"最典型的来源；
 *   2. 可交互元素不得带 `tabindex="-1"`（那是 Tab 到不了）；
 *   3. 每个可交互元素都要有可访问名称；
 *   4. 渲染后的 DOM 里不得有**没有 href 的 `<a>`**——`<RouterLink>` 少了 `to`
 *      就会渲染成这种"看着像链接、键盘却到不了"的元素；
 *   5. 跳过链接必须是**第一个** Tab 停靠点，并且指向真实存在的 `main`；
 *   6. 同一页里 id 不得重复（重复会让 `label[for]` / `aria-labelledby` 指错元素）。
 *
 * 【零豁免】判据 2 不需要例外清单：带 `tabindex="-1"` 的只有两处——`<main>`
 * （本来就不是可交互元素），以及课程表网格里那些**非当前格**（第四十一轮起，
 * 网格是 roving tabindex：组内恰好留一个停靠点，其余 -1 是正确形态；判定时
 * 按"组内留了停靠点就不报"处理，见本文件后面的 roving 夹具）。第 4 条同理，
 * 当前命中数为 0。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { routes } from '../src/router/routes.js'
import { isVisible } from './helpers/renderedHeadings.js'
import { gotoRoute, mountApp, settle } from './helpers/mountApp.js'
import {
  accessibleName,
  describe as describeEl,
  duplicateIds,
  focusableElements,
  selectionStateIssues,
  tabOrderIssues,
} from './helpers/tabOrder.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

const PAGES = routes.filter((record) => record.name && record.component && !record.redirect)
const pathOf = (record) => (record.path.includes(':') ? '/不存在的地址' : record.path)

let mounted = null

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => {
  vi.restoreAllMocks()
  mounted?.unmount()
  mounted = null
  clearAnnouncement()
})

describe('渲染后的 Tab 顺序与可访问名称', () => {
  it('每个真实页面：无正数 tabindex、无不可聚焦链接、无可交互元素被排除、无无名控件', async () => {
    mounted = await mountApp({ routes })

    const problems = []
    let totalFocusable = 0
    let totalTabbable = 0
    for (const record of PAGES) {
      await gotoRoute(mounted, pathOf(record))
      const label = `${record.meta?.title || record.path}（${record.path}）`
      const all = focusableElements(document, isVisible)
      totalFocusable += all.length
      totalTabbable += all.filter((item) => item.tabbable).length
      // 懒加载占位不承载操作，不参与判定
      const judged = all.filter((item) => !item.el.closest('.route-fallback'))
      for (const issue of tabOrderIssues(judged)) problems.push(`${label}：${issue}`)
      for (const el of document.querySelectorAll('a:not([href])')) {
        if (el.closest('.route-fallback')) continue
        problems.push(`${label}：<a> 没有 href，键盘到不了：${describeEl(el)}`)
      }
    }

    // 规模自证：扫不到元素说明守卫已经与实现脱节
    expect(PAGES.length, '真实页面列表为空，守卫在守空气').toBeGreaterThanOrEqual(9)
    expect(totalFocusable, '一个可聚焦元素都没扫到，守卫在守空气').toBeGreaterThanOrEqual(200)
    expect(totalTabbable, '一个进入 Tab 序的元素都没有，守卫在守空气').toBeGreaterThanOrEqual(200)
    expect(problems).toEqual([])
  })

  it('跳过链接是第一个 Tab 停靠点，并指向真实存在的 main', async () => {
    mounted = await mountApp({ routes })
    for (const record of PAGES) {
      await gotoRoute(mounted, pathOf(record))
      const tabbable = focusableElements(document, isVisible).filter((item) => item.tabbable)
      const first = tabbable[0]
      expect(first, `${record.path} 没有任何 Tab 停靠点`).toBeTruthy()
      expect(first.el.tagName, `${record.path} 的第一个 Tab 停靠点应该是跳过链接`).toBe('A')
      expect(first.el.className).toContain('skip-to-content')

      const target = document.querySelector(first.el.getAttribute('href'))
      expect(target, `${record.path} 的跳过链接指向了不存在的目标`).toBeTruthy()
      expect(target.tagName, `${record.path} 的跳过链接目标应该是 main`).toBe('MAIN')
    }
  })

  it('同一页里 id 不重复', async () => {
    mounted = await mountApp({ routes })
    const problems = []
    for (const record of PAGES) {
      await gotoRoute(mounted, pathOf(record))
      for (const id of duplicateIds(document)) problems.push(`${record.path}：id「${id}」重复`)
    }
    expect(problems).toEqual([])
  })

  it('成组可选项里，选中态不能只存在于视觉 class 中', async () => {
    // 本轮靠这条规则找到了真实缺陷：侧栏 6 个主题色按钮只有 `class="on"`，
    // 而**同一个功能**在个性化设置面板里是用 `:aria-pressed` 暴露的——
    // 读屏用户听不出当前选的是哪个主题（WCAG 4.1.2 的"值"）。
    mounted = await mountApp({ routes })
    const problems = []
    for (const record of PAGES) {
      await gotoRoute(mounted, pathOf(record))
      for (const issue of selectionStateIssues(document)) problems.push(`${record.path}：${issue}`)
    }
    expect(problems).toEqual([])
  })

  it('逐个点过每组的每一项后，选中态依然暴露在外面', async () => {
    // 只扫"当前渲染状态"有个真实盲区：某一项的 `:aria-pressed` 绑定写错/漏写时，
    // 只要它**当前没被选中**，`class="{ on: false }"` 就不渲染 class，扫描看不到它。
    // 所以这里把每组每一项都点一遍，每点一次复查一次选中态。
    // 这道补充是必要的：侧栏主题点与专注时长按钮那两次真实缺陷，都属于"整组都缺"，
    // 而"只缺某一项"的写法同样会让读屏失去选中信息。
    mounted = await mountApp({ routes })
    let clicked = 0
    const problems = []
    for (const record of PAGES) {
      await gotoRoute(mounted, pathOf(record))
      const groups = [...document.querySelectorAll('#main-content [role="group"], #main-content [role="tablist"]')]
      for (const group of groups) {
        const items = [...group.querySelectorAll('button')].filter((button) => isVisible(button))
        if (items.length < 2) continue
        for (const item of items) {
          item.click()
          await settle()
          clicked++
          for (const issue of selectionStateIssues(document)) {
            const label = item.textContent.trim().slice(0, 12) || item.getAttribute('aria-label') || '无名'
            problems.push(`${record.path} 点「${label}」后：${issue}`)
          }
          if (problems.length > 12) break
        }
        if (problems.length > 12) break
      }
      if (problems.length > 12) break
    }
    expect(clicked, '一个分组项都没点到，守卫在守空气').toBeGreaterThanOrEqual(10)
    expect(problems).toEqual([])
  })

  it('页面上渲染出来的每个 tablist 都要响应方向键', async () => {
    // 静态规则只能查"@keydown 接上了没有"，查不出接上的处理函数是不是真起作用。
    // 这里对**真实渲染**出来的 tablist 按一次 →，要求选中项真的换到下一个 tab。
    // （模态框里的 tablist 在页面级测试里不会渲染，那部分靠 tabKeys.test.js 的单元测试。）
    mounted = await mountApp({ routes })
    let checked = 0
    const problems = []
    for (const record of PAGES) {
      await gotoRoute(mounted, pathOf(record))
      for (const tablist of document.querySelectorAll('#main-content [role="tablist"]')) {
        const tabs = [...tablist.querySelectorAll('[role="tab"]')]
        if (tabs.length < 2) continue
        const before = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
        if (before < 0) { problems.push(`${record.path}：tablist 里没有选中的 tab`); continue }
        checked++
        tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
        await settle()
        const after = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
        if (after !== (before + 1) % tabs.length) {
          problems.push(`${record.path}：按 → 之后选中项从 ${before} 变成了 ${after}，应为 ${(before + 1) % tabs.length}`)
        }
      }
    }
    expect(checked, '一个渲染出来的 tablist 都没按到，守卫在守空气').toBeGreaterThanOrEqual(1)
    expect(problems).toEqual([])
  })
})

/* ---------------- 夹具：判定必须能被证伪 ---------------- */

function mountFixture(html) {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

describe('夹具', () => {
  let host = null
  afterEach(() => { host?.remove(); host = null })

  it('可访问名称：各来源都要认，取不到要返回空串', () => {
    host = mountFixture(`
      <button id="n-aria" aria-label="关闭">×</button>
      <button id="n-text">保存</button>
      <button id="n-hidden-only"><span aria-hidden="true">🎉</span></button>
      <button id="n-title" title="提示"> </button>
      <span id="lb" hidden>外部标签</span>
      <button id="n-labelledby" aria-labelledby="lb"></button>
      <label for="n-for">目标日期</label><input id="n-for" />
      <label>包裹式<input id="n-wrap" /></label>
      <input id="n-submit" type="submit" value="提交" />
      <button id="n-img"><img alt="图标按钮" src="x.png" /></button>
      <button id="n-empty"></button>
      <a id="n-link" href="/x"></a>
    `)
    const nameOf = (id) => accessibleName(host.querySelector(`#${id}`))
    expect(nameOf('n-aria')).toBe('关闭')
    expect(nameOf('n-text')).toBe('保存')
    // 只有 aria-hidden 的 emoji：读屏听不到，等于没有名字
    expect(nameOf('n-hidden-only')).toBe('')
    expect(nameOf('n-title')).toBe('提示')
    expect(nameOf('n-labelledby')).toBe('外部标签')
    expect(nameOf('n-for')).toBe('目标日期')
    expect(nameOf('n-wrap')).toBe('包裹式')
    expect(nameOf('n-submit')).toBe('提交')
    expect(nameOf('n-img')).toBe('图标按钮')
    // 空按钮与空链接：没有任何名称来源
    expect(nameOf('n-empty')).toBe('')
    expect(nameOf('n-link')).toBe('')
  })

  it('Tab 顺序问题：正数 tabindex、tabindex="-1" 的可交互元素、无名元素都要报出来', () => {
    host = mountFixture(`
      <button id="t-jump" tabindex="3">插队</button>
      <button id="t-minus" tabindex="-1">Tab 到不了</button>
      <button id="t-named" aria-label="有名字"><span aria-hidden="true">×</span></button>
      <main id="t-main" tabindex="-1">主内容</main>
      <input id="t-ok" type="text" aria-label="搜索" />
      <button id="t-unnamed"></button>
    `)
    const issues = tabOrderIssues(focusableElements(host, isVisible))
    expect(issues.some((line) => line.includes('tabindex="3"'))).toBe(true)
    expect(issues.some((line) => line.includes('Tab 不到它'))).toBe(true)
    expect(issues.some((line) => line.includes('没有可访问名称'))).toBe(true)
    // 非交互的 main 带 -1 是正常写法（跳过链接的落点），不许误报
    expect(issues.some((line) => line.includes('MAIN'))).toBe(false)
    // 有名字的按钮内部用 aria-hidden 的符号，也不许误报
    expect(issues.some((line) => line.includes('有名字'))).toBe(false)
    expect(issues).toHaveLength(3)
  })

  it('roving tabindex：组内留了停靠点就不报，整组都排除才报', () => {
    // 第三十轮给标签页装上 roving tabindex 后，未选中的 tab 带 -1 是**正确形态**
    // （组内用方向键到达），所以规则要放行；但豁免必须带硬前提——
    // 组里得真的留着一个 Tab 停靠点，否则整组标签页键盘用户都到不了。
    host = mountFixture(`
      <div role="tablist" aria-label="正常组">
        <button role="tab" aria-selected="true" tabindex="0">选中的</button>
        <button role="tab" aria-selected="false" tabindex="-1">未选中的</button>
      </div>
      <div role="tablist" aria-label="坏组">
        <button role="tab" aria-selected="false" tabindex="-1">全都被排除</button>
        <button role="tab" aria-selected="false" tabindex="-1">一个都进不去</button>
      </div>
      <button id="still-caught" tabindex="-1">组外还是照报</button>
    `)
    const issues = tabOrderIssues(focusableElements(host, isVisible))
    expect(issues.some((line) => line.includes('正常组')), '正常 roving 组不该被报').toBe(false)
    expect(issues.some((line) => line.includes('未选中的')), '正常 roving 的未选中项不该被报').toBe(false)
    expect(issues.filter((line) => line.includes('整组都不在 Tab 序列里')), '整组被排除的两个 tab 都要报').toHaveLength(2)
    // 组外那个 -1 按钮仍然要照报，且报错信息必须点出是哪一个元素
    const outside = issues.filter((line) => line.includes('带 tabindex="-1"：键盘用户 Tab 不到它'))
    expect(outside).toHaveLength(1)
    expect(outside[0], '报错信息要能定位到具体元素').toContain('组外还是照报')
  })

  it('隐藏与 disabled 的元素不算 Tab 停靠点', () => {
    host = mountFixture(`
      <button style="display:none">藏起来</button>
      <div aria-hidden="true"><button>读屏不看</button></div>
      <button disabled>禁用</button>
      <button>真按钮</button>
    `)
    const items = focusableElements(host, isVisible)
    // disabled 的按钮仍在 DOM 里、但不算可聚焦
    expect(items.map((item) => item.el.textContent)).toEqual(['真按钮'])
  })

  it('重复 id 要报出来', () => {
    host = mountFixture('<div id="dup"></div><span id="dup"></span><p id="only"></p>')
    expect(duplicateIds(host)).toEqual(['dup'])
  })

  it('选中态规则：抓得住纯视觉选中，也放行各种正当写法', () => {
    host = mountFixture(`
      <div role="group" aria-label="主题色切换">
        <button class="theme-dot on" aria-label="蓝色主题"></button>
      </div>
      <div role="group" aria-label="主题色选择">
        <button class="theme-cell on" aria-pressed="true">蓝色</button>
      </div>
      <nav role="group" aria-label="导航">
        <a class="active router-link-active" href="/x">首页</a>
        <button class="router-link-active">复合类名不算选中态</button>
        <button class="current-theme">前缀复合类名也不算选中态</button>
      </nav>
      <button class="on">不在任何分组里的按钮</button>
      <div role="radiogroup" aria-label="时长">
        <button role="radio" class="selected" aria-checked="true">25 分钟</button>
      </div>
    `)
    const issues = selectionStateIssues(host)
    // 只有第一组命中：视觉选中 + 没有任何 ARIA
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('主题色切换')
    expect(issues[0]).toContain('蓝色主题')
    // 有 aria-pressed / aria-checked 的一律放行
    expect(issues.some((line) => line.includes('主题色选择'))).toBe(false)
    expect(issues.some((line) => line.includes('时长'))).toBe(false)
    // `<a>` 的 active 由 aria-current 表达，是另一套语义，不按本规则要求
    expect(issues.some((line) => line.includes('首页'))).toBe(false)
    // 复合类名 `router-link-active` 不是选中态
    expect(issues.some((line) => line.includes('复合类名'))).toBe(false)
    // 前缀复合类名 `current-theme` 也不是（后边界同样要卡住）
    expect(issues.some((line) => line.includes('前缀复合类名'))).toBe(false)
    // 不在成组可选项里的按钮不看
    expect(issues.some((line) => line.includes('不在任何分组'))).toBe(false)
  })
})