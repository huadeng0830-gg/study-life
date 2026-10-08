// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp, h, nextTick } from 'vue'
import AppearanceSettings from '../src/components/AppearanceSettings.vue'
import TimeSettingsModal from '../src/components/schedule/TimeSettingsModal.vue'
import { appearanceTab, timeImportTab, timeSettingsTab } from '../src/composables/modalSections.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

/**
 * 浮层内部分区的记忆。
 *
 * 【被守住的需求】关闭再打开浮层 → 回到上次所在的分区。
 * 外观设置和作息设置都可能在父级重新挂载；把分区状态存在共享 ref 后，
 * 关闭再打开仍会回到用户停留的位置。
 *
 * 【为什么用"挂载 → 切换 → 卸载 → 重新挂载"来测】
 * 只断言"模块级 ref 赋值后还在"是同义反复（ESM 模块本来就单例）。要证明的是
 * **用户可见的那条路径**：切到别的分区、关掉（组件真的被销毁）、再打开，仍然停在那里。
 *
 * 【为什么查的是 document 而不是挂载点】
 * `Modal.vue` 把内容 Teleport 到 `document.body`（和 ActionSheet 一样），分区按钮因此
 * 不在 `createApp` 的挂载容器里。这里统一从 document 取，并取**最后一个**匹配节点，
 * 避免上一次挂载的残留被误认成新的。
 *
 * 【为什么还要一条静态棘轮】
 * 行为测试只能证明"现在对"。日后有人在 `@open` watcher 里重新加回 `tab.value = 'theme'`，
 * 行为测试**不会**变红（它挂载时读到的就是被重置前的值），于是会静默退回旧观感。
 * 静态那条专门盯住"重置行不许回来"，并按仓库惯例给了判别力自证。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mountedApps = []

function mount(component, props) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp({ render: () => h(component, props) })
  app.mount(host)
  mountedApps.push({ app, host })
  return host
}

/** 卸载最近一次挂载 —— 模拟父组件用 `v-if` 把浮层销毁（记忆必须活过这次销毁）。 */
function unmountLast() {
  const entry = mountedApps.pop()
  entry.app.unmount()
  entry.host.remove()
}

function latest(selector) {
  const nodes = [...document.querySelectorAll(selector)]
  return nodes[nodes.length - 1] || null
}

function tabsOf(label) {
  const lists = [...document.querySelectorAll(`[role="tablist"][aria-label="${label}"]`)]
  expect(lists.length, `没找到分区列表：${label}`).toBeGreaterThan(0)
  const tabs = [...lists[lists.length - 1].querySelectorAll('[role="tab"]')]
  expect(tabs.length, `${label} 的分区少于两个`).toBeGreaterThan(1)
  return tabs
}

function selectedIndex(label) {
  return tabsOf(label).findIndex((button) => button.getAttribute('aria-selected') === 'true')
}

function clickTabAt(label, index) {
  tabsOf(label)[index].click()
}

function clickSelector(selector) {
  const button = latest(selector)
  expect(button, `没找到分区按钮：${selector}`).toBeTruthy()
  button.click()
}

afterEach(() => {
  for (const { app, host } of mountedApps.splice(0)) {
    app.unmount()
    host.remove()
  }
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
  // 分区记忆刻意跨"组件生命周期"保留，但不该跨用例互相污染：每个用例自己先归位。
  appearanceTab.value = 'theme'
  timeSettingsTab.value = 'plans'
  timeImportTab.value = 'paste'
})

describe('外观设置：关闭再打开回到上次的分区', () => {
  it('默认仍是第一个分区（没用过的用户观感与改造前一致）', async () => {
    mount(AppearanceSettings, { open: true })
    await nextTick()
    expect(selectedIndex('个性化设置分区')).toBe(0)
  })

  it('切到第三个分区后卸载再重新挂载，仍停在该分区', async () => {
    mount(AppearanceSettings, { open: true })
    await nextTick()
    expect(selectedIndex('个性化设置分区')).toBe(0)

    clickSelector('#appearance-tab-quotes')
    await nextTick()
    expect(selectedIndex('个性化设置分区')).toBe(2)

    unmountLast()
    await nextTick()

    mount(AppearanceSettings, { open: true })
    await nextTick()
    expect(selectedIndex('个性化设置分区')).toBe(2)
  })

  it('点分区走的是那个共享 ref，而不是各点各的局部状态', async () => {
    mount(AppearanceSettings, { open: true })
    await nextTick()
    clickSelector('#appearance-tab-layout')
    await nextTick()
    expect(appearanceTab.value).toBe('layout')
    expect(selectedIndex('个性化设置分区')).toBe(3)
  })
})

describe('作息设置：分区同样记得住（改造前靠"实例常驻"意外保留）', () => {
  const settingsProps = () => ({ show: true, courseCountByPeriodId: () => 0 })

  it('切到第二个分区后卸载再挂载，仍停在该分区', async () => {
    mount(TimeSettingsModal, settingsProps())
    await nextTick()
    expect(selectedIndex('设置分区')).toBe(0)

    clickTabAt('设置分区', 1)
    await nextTick()
    expect(timeSettingsTab.value).toBe('base')

    unmountLast()
    await nextTick()

    mount(TimeSettingsModal, settingsProps())
    await nextTick()
    expect(selectedIndex('设置分区')).toBe(1)
  })

  it('以 show=true 首次挂载不再抛暂时性死区错误（第五十四轮修掉的真实缺陷）', async () => {
    // 组件自己的注释写明"以 v-if 方式首次挂载时 props.show 已经是 true"是必须支持的路径，
    // 但 immediate watcher 当时排在 batchOpen/importOpen 等 ref 的声明之前，
    // 一执行就 ReferenceError，组件连挂载都完不成。这条在修之前是红的。
    expect(() => mount(TimeSettingsModal, settingsProps())).not.toThrow()
    await nextTick()
    expect(selectedIndex('设置分区')).toBe(0)
  })
})

/* ---------- 静态棘轮：重置行不许回来 ---------- */

const FILES = {
  'AppearanceSettings.vue': 'src/components/AppearanceSettings.vue',
  'TimeSettingsModal.vue': 'src/components/schedule/TimeSettingsModal.vue',
}

/** 只剥块注释与"行首"行注释：不去动字符串里的 `//`（否则会把 URL 当注释截断）。 */
function stripJsComments(text) {
  return String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const RESET_PATTERNS = [
  { name: '外观设置又重置回第一分区', file: 'AppearanceSettings.vue', pattern: /tab\.value\s*=\s*'theme'/ },
  { name: '作息导入又重置回粘贴', file: 'TimeSettingsModal.vue', pattern: /importTab\.value\s*=\s*'paste'/ },
]

const LOCAL_REF_PATTERNS = [
  { name: '外观设置又用组件内 ref 装分区', file: 'AppearanceSettings.vue', pattern: /const\s+tab\s*=\s*ref\(/ },
  { name: '作息设置又用组件内 ref 装分区', file: 'TimeSettingsModal.vue', pattern: /const\s+(settingsTab|importTab)\s*=\s*ref\(/ },
]

function scan(sources, patterns) {
  const hits = []
  for (const rule of patterns) {
    const text = sources[rule.file]
    if (text === undefined) continue
    if (rule.pattern.test(text)) hits.push(`${rule.file}: ${rule.name}`)
  }
  return hits
}

function readStripped() {
  return Object.fromEntries(Object.entries(FILES).map(([name, path]) => [name, stripJsComments(readFileSync(resolve(root, path), 'utf8'))]))
}

describe('分区记忆的静态棘轮', () => {
  it('两个仍在使用分区的组件里都不再有"打开时重置分区"的行', () => {
    expect(scan(readStripped(), RESET_PATTERNS)).toEqual([])
  })

  it('两个仍在使用分区的组件都用模块级 ref 装分区，不再各自 new 一个', () => {
    expect(scan(readStripped(), LOCAL_REF_PATTERNS)).toEqual([])
    for (const path of Object.values(FILES)) {
      expect(readFileSync(resolve(root, path), 'utf8')).toContain('composables/modalSections.js')
    }
  })

  it('判别力自证：同一套扫描对"改造前"的写法必须报红', () => {
    const before = {
      'AppearanceSettings.vue': "const tab = ref('theme')\nfunction open(){ tab.value = 'theme' }",
      'TimeSettingsModal.vue': "const importTab = ref('paste')\nfunction toggle(){ importTab.value = 'paste' }",
    }
    expect(scan(before, RESET_PATTERNS).length).toBe(2)
    expect(scan(before, LOCAL_REF_PATTERNS).length).toBe(2)
  })

  it('判别力自证：注释里的重置写法不算命中，而不剥注释时同一份文本会命中', () => {
    const commented = { 'AppearanceSettings.vue': "// 以前这里有 tab.value = 'theme'\n/* tab.value = 'theme' */\nconst tab = appearanceTab" }
    // 剥注释后不命中……
    expect(scan({ 'AppearanceSettings.vue': stripJsComments(commented['AppearanceSettings.vue']) }, RESET_PATTERNS)).toEqual([])
    // ……但同一份**未剥注释**的文本会命中：证明这条规则本身有牙齿，是"剥注释"这一步在起作用。
    expect(scan(commented, RESET_PATTERNS).length).toBe(1)
  })
})
