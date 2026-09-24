// @vitest-environment happy-dom
/**
 * 标签页语义守卫（第二十七轮）。
 *
 * 【背景：勘察到的真实缺口】全站有 10 个 `role="tablist"`、32 个 `role="tab"`，
 * 而 `role="tabpanel"` **一个都没有**、`aria-controls` 也**一个都没有**——
 * 也就是读屏会念「标签页 1/3、已选中」，但**这块标签页控制的内容没有被标记成面板**，
 * 面板与 tab 的程序化关联是断的（WCAG 1.3.1 / 4.1.2 的"关系"）。
 * 其中 `ExceptionsModal` 更严重：它的 `role="tablist"` 里的子元素**根本不是 `role="tab"`** ✗——
 * ARIA 硬性要求 `tablist` 拥有 `tab`，那是明确的违规，不是"最佳实践缺失"。
 *
 * 【本轮补了什么】只补**面板容器已经存在**的那些分区（纯加属性，零结构改动）：
 *   - `AppearanceSettings.vue`：5 个分区面板全补齐 ✓
 *   - `LocalTransfer.vue`：发送 / 扫码接收 2 个面板 ✓
 *   - `LedgerView.vue` 账本分区：账本 / 固定账单 / 回顾 3 个面板 ✓
 *   - `TimeSettingsModal.vue` 作息导入方式：粘贴 / 图片 2 个面板 ✓
 *   - `ExceptionsModal.vue`：补上缺失的 `role="tab"` + `aria-selected`，并把 `.exception-form` 标成面板 ✓
 * 另外**没有**加 `aria-controls`：这些面板是 `v-if` 切换的，未选中时并不在 DOM 里，
 * 给未选中的 tab 加 `aria-controls` 只会得到一个指向空气的引用（比不加更糟）。
 * 面板用 `aria-labelledby` 反向指回**当前选中**的 tab——那个 tab 一定在 DOM 里，引用必然解析得到。
 *
 * 【还没补的（写清楚，不用白名单糊过去）】——第二十九轮起已经没有了。
 * 本文件在第二十八、二十九轮经历了这样一条演进，值得记下来：
 *   - 第二十八轮：把 6 组**没有面板的筛选控件**从 tab 语义收敛为 `role="group"` + `aria-pressed`
 *     （待办筛选、日程状态、清单分类、账本分类方向/分类视图、作息识别结果筛选）；
 *   - 第二十九轮：给剩下的真标签页补完面板——`TimeSettingsModal` 的「设置分区」
 *     （`v-show` 的 plans 面板 + 原先是 `<template v-if>` 的 base 面板，换成了包裹层并复制了
 *     父级 `.settings` 的 flex 布局与 18px 间距，避免间距塌成 0），
 *     再把「回放时间范围」与「设备绑定方式」这两处**重塑内容 / 状态机**的控件也收敛掉。
 *   于是欠账归零，"存量清单棘轮"退役，判据升级为**零豁免**的关系完整性检查：
 *   每个 tab 带 `id`、每个面板带 `aria-labelledby`，且静态标签下每个 tab 的 id 都必须被面板引用到。
 *   现在全站只有 5 个 `tablist`，全部是真标签页、全部有面板（15 个 tab / 15 个面板）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { routes } from '../src/router/routes.js'
import { isVisible } from './helpers/renderedHeadings.js'
import { gotoRoute, mountApp, settle } from './helpers/mountApp.js'
import { tabPanelRefIssues } from './helpers/tabOrder.js'
import { readTemplate, walkVueFiles } from './helpers/vueTemplate.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

const ROOT = resolve(import.meta.dirname, '..')

/**
 * 统计某个模板里 role="tab" / role="tabpanel" / 带 id 的 tab / 带 labelledby 的面板。
 *
 * 【为什么不再需要"存量清单"（第二十九轮）】
 * 第二十七轮开始时全站 32 个 `role="tab"` 却一个 `role="tabpanel"` 都没有，
 * 所以当时用清单棘轮逐条登记欠账。第二十八、二十九轮把没有面板的筛选控件
 * 收敛为 `role="group"` + `aria-pressed`、并给剩下的真标签页补齐了面板，
 * 欠账归零——于是清单退役，判据直接升级为**零豁免**的关系完整性检查。
 */
export function tabCounts(template) {
  const tabTags = [...template.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]).filter((tag) => /(?:^|\s):?role="tab"/.test(tag))
  const panelTags = [...template.matchAll(/<(?:div|section|template)\b[^>]*>/g)].map((m) => m[0]).filter((tag) => /(?:^|\s):?role="tabpanel"/.test(tag))
  return {
    tabs: tabTags.length,
    panels: panelTags.length,
    tabTags,
    panelTags,
    tabsWithId: tabTags.filter((tag) => /(?:^|\s):?id=/.test(tag)).length,
    panelsWithLabel: panelTags.filter((tag) => /(?:^|\s):?aria-labelledby=/.test(tag)).length,
    tabsWithTabIndex: tabTags.filter((tag) => /(?:^|\s):?tabindex=/.test(tag)).length,
    tabIds: tabTags.map((tag) => /(?:^|\s)id="([^"]+)"/.exec(tag)?.[1]).filter(Boolean),
    labelledIds: [...template.matchAll(/(?<!:)\b(?:aria-labelledby)="([^"]+)"/g)].map((m) => m[1]),
    hasDynamicLabel: /:aria-labelledby=/.test(template),
  }
}

describe('标签页语义：关系完整性（零豁免）', () => {
  it('标签页关系必须完整：每个 tab 带 id、每个面板带 aria-labelledby，且静态标签下互相指得到', () => {
    // 【第二十九轮起这条是零豁免的】此前的"存量清单"已经清零：全站只剩 5 个 tablist，
    // 全都是真标签页、都有面板。所以不再需要棘轮，直接要求关系完整。
    const problems = []
    let checkedPairs = 0
    for (const file of walkVueFiles(resolve(ROOT, 'src'))) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
      const counts = tabCounts(readTemplate(file))
      if (!counts.tabs && !counts.panels) continue
      if (counts.tabsWithId !== counts.tabs) {
        problems.push(`${rel}：${counts.tabs - counts.tabsWithId} 个 tab 还没有 id，面板无法用 aria-labelledby 指回来`)
      }
      if (counts.panelsWithLabel !== counts.panels) {
        problems.push(`${rel}：${counts.panels - counts.panelsWithLabel} 个 tabpanel 没有 aria-labelledby`)
      }
      // 光有 id 还不够，必须**真的被某个面板引用到**。
      // 只在该文件的面板全部使用静态 aria-labelledby 时才能静态核对；用绑定表达式时
      // （如 ExceptionsModal 的标签由 computed 按 form.type 决定，那确实依赖运行时状态）
      // 静态解析不到，这里不假装检查。
      if (!counts.hasDynamicLabel) {
        for (const id of counts.tabIds) {
          if (!counts.labelledIds.includes(id)) {
            problems.push(`${rel}：tab 的 id「${id}」没有被任何面板的 aria-labelledby 引用到`)
          } else checkedPairs++
        }
      }
    }
    expect(problems).toEqual([])
    // 规模自证：必须真的核对过若干对引用，否则这条守卫在守空气
    expect(checkedPairs, '一条 tab→面板引用都没核对到').toBeGreaterThanOrEqual(10)
  })

  it('已经收敛为 group 的 5 个文件不得再出现 tab 语义', () => {
    // 第二十八轮收敛了 3 个筛选控件（待办筛选、日程状态、清单分类），
    // 第二十九轮又收敛了 2 个（回放时间范围、设备绑定方式）。
    // 单独锁一条，是为了让"收敛被回退"有明确的失败信息。
    for (const file of [
      'src/views/TasksView.vue',
      'src/views/EventsView.vue',
      'src/views/ListsView.vue',
      'src/components/MemoryView.vue',
      'src/components/SyncPairingModal.vue',
    ]) {
      const template = readTemplate(resolve(ROOT, file))
      expect(template, `${file} 不应再有 tab 语义`).not.toMatch(/role="tab(list)?"/)
      expect(template, `${file} 的切换控件应暴露选中状态`).toMatch(/:aria-pressed="/)
    }
  })

  it('tablist 与 tab 必须成对出现（有 tablist 就得有 tab，有 tab 就得在 tablist 里）', () => {
    // 这条是**零豁免**的：今天全站每个有 tablist 的文件都有 tab，反之亦然。
    // 它专门堵住"tablist 的子元素不是 tab"这一类硬性违规——
    // 第二十七轮在 ExceptionsModal 里修掉的正是这种，而只数 tab 的存量清单抓不到它
    // （把容器改回 tablist 但一个 tab 都不留时，清单不会响）。
    const problems = []
    for (const file of walkVueFiles(resolve(ROOT, 'src'))) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
      const template = readTemplate(file)
      const listCount = (template.match(/role="tablist"/g) ?? []).length
      const counts = tabCounts(template)
      if (listCount > 0 && counts.tabs === 0) problems.push(`${rel}：有 role="tablist" 却没有任何 role="tab"（ARIA 要求 tablist 拥有 tab）`)
      if (counts.tabs > 0 && listCount === 0) problems.push(`${rel}：有 role="tab" 却不在任何 role="tablist" 里`)
      if (counts.panels > 0 && counts.tabs === 0) problems.push(`${rel}：有 role="tabpanel" 却没有 role="tab"`)
    }
    expect(problems).toEqual([])
  })

  it('标签页的键盘契约要落地：每个 tab 带 tabindex、每个 tablist 绑定 @keydown', () => {
    // 【第三十轮】标上 role="tab" 就宣告了 APG 的键盘契约（roving tabindex +
    // ←/→ + Home/End）。只有 role 没有键击，和"只有 class="on" 没有 aria-selected"
    // 是同一类问题：宣告了做不到的事。
    // 静态只能查"接线是否接上"；键位行为由 tests/tabKeys.test.js 的单元与渲染级测试负责。
    const problems = []
    let tabsChecked = 0
    for (const file of walkVueFiles(resolve(ROOT, 'src'))) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
      const template = readTemplate(file)
      const counts = tabCounts(template)
      if (!counts.tabs && !counts.panels) continue

      for (const tag of counts.tabTags) {
        tabsChecked++
        if (!/(?:^|\s):?tabindex=/.test(tag)) problems.push(`${rel}：一个 tab 没有 tabindex（roving tabindex 缺位，键盘用户要逐个 Tab 穿过整组）`)
      }
      const lists = [...template.matchAll(/<div\b[^>]*>/gs)].map((m) => m[0]).filter((tag) => /role="tablist"/.test(tag))
      for (const tag of lists) {
        if (!/@keydown=/.test(tag)) problems.push(`${rel}：一个 tablist 没有绑定 @keydown（方向键切换没接上）`)
      }
    }
    expect(problems).toEqual([])
    expect(tabsChecked, '一个 tab 都没查到，这条守卫在守空气').toBeGreaterThanOrEqual(10)
  })
})

/* ---------------- 渲染后：引用必须真的解析得到 ---------------- */

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

describe('渲染后：面板与 tab 的引用', () => {
  it('每个 tabpanel 的 aria-labelledby 都指向当前选中的 tab', async () => {
    mounted = await mountApp({ routes })
    let checked = 0
    const problems = []
    for (const record of PAGES) {
      await gotoRoute(mounted, pathOf(record))
      const panels = document.querySelectorAll('[role="tabpanel"]')
      checked += panels.length
      for (const issue of tabPanelRefIssues(document)) problems.push(`${record.path}：${issue}`)
    }
    expect(checked, '一个面板都没渲染出来，守卫在守空气').toBeGreaterThanOrEqual(1)
    expect(problems).toEqual([])
  })

  it('切到另一个分区后，面板的 aria-labelledby 跟着切到新的选中 tab', async () => {
    mounted = await mountApp({ routes })
    await gotoRoute(mounted, '/bills')
    const tabs = [...document.querySelectorAll('[role="tab"]')].filter((el) => el.closest('#main-content'))
    expect(tabs.length, '账本页的分区 tab 没渲染出来').toBeGreaterThanOrEqual(3)

    for (const tab of tabs) {
      tab.click()
      await settle()
      expect(tabPanelRefIssues(document), `点击「${tab.textContent.trim()}」后引用断了`).toEqual([])
      const panel = document.querySelector('[role="tabpanel"]')
      if (panel) {
        expect(document.getElementById(panel.getAttribute('aria-labelledby'))?.textContent.trim()).toBe(tab.textContent.trim())
      }
    }
  })
})

describe('夹具：引用检查必须能被证伪', () => {
  let host = null
  afterEach(() => { host?.remove(); host = null })

  function fixture(html) {
    host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    return host
  }

  it('指向空气、指向非 tab、指向未选中的 tab 都要报出来', () => {
    expect(tabPanelRefIssues(fixture(`
      <button id="a" role="tab" aria-selected="true">甲</button>
      <div id="pa" role="tabpanel" aria-labelledby="a"></div>
    `), document)).toEqual([])

    expect(tabPanelRefIssues(fixture('<div role="tabpanel"></div>')).length).toBe(1)
    expect(tabPanelRefIssues(fixture('<div role="tabpanel" aria-labelledby="missing"></div>')).length).toBe(1)
    expect(tabPanelRefIssues(fixture('<span id="x">不是 tab</span><div role="tabpanel" aria-labelledby="x"></div>')).length).toBe(1)
    expect(tabPanelRefIssues(fixture('<button id="y" role="tab" aria-selected="false">乙</button><div role="tabpanel" aria-labelledby="y"></div>')).length).toBe(1)
  })

  it('计数函数要认得出多行写法与 :aria-labelledby', () => {
    const counts = tabCounts(`
      <div role="tablist">
        <button
          :id="'a'"
          role="tab"
          :aria-selected="true"
        >甲</button>
        <button role="tab" aria-selected="false">乙</button>
      </div>
      <section role="tabpanel" :aria-labelledby="'a'"></section>
    `)
    expect(counts.tabs).toBe(2)
    expect(counts.panels).toBe(1)
    expect(counts.tabsWithId).toBe(1)
    expect(counts.panelsWithLabel).toBe(1)
  })
})