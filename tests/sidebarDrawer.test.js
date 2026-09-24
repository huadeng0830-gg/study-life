// @vitest-environment happy-dom
/**
 * 「更多功能」侧边抽屉（≤900px）的运行时行为。
 *
 * 【和 tests/sidebarMoreSheetEscape.test.js 的分工】那一份是既有守卫：`aria-expanded` 语义、
 * Escape 收起、关闭后焦点还给触发器、焦点不在浮层里时不抢焦点。它盯着**老行为不许退化**；
 * 这一份盯**新行为**：真正的模态抽屉——`role="dialog"` + 中文可访问名称、遮罩可见、
 * 初始焦点进抽屉、Tab 焦点循环、滚动锁（含与另一个 Modal 叠加时的引用计数）、
 * 以及三条主动关闭路径（× / 点遮罩 / 右划）。
 *
 * 【几何】面板**右锚定**（`right:0`，触发它的 `.more-trigger` 也是底栏最右一格），
 * 打开态 `translateX(0)`、藏起来往右 `+102%`，所以「右划关闭」的跟手方向与出场方向同向；
 * 右缘 18px 让给系统手势。这条不变量有独立断言（跟手方向 == 出场方向）。
 *
 * 【测试环境的边界，写清楚免得后人写出假绿】
 *  - `getBoundingClientRect()` 全 0、也不注入组件 CSS：所以"抽屉宽度"不量 DOM，
 *    而是 JS 用与 CSS 同源的常量复算（drawerDrag.js 的 drawerWidth），
 *    这里把 `window.innerWidth` 钉成 375px → 抽屉宽 320px、关闭阈值 102.4px。
 *  - 因此能断言的是**JS 驱动的内联 style**（`panel.style.transform`）、class、DOM 进出与
 *    状态，以及 `body.dataset.modalLockCount` 这些确定的东西。
 *  - `<Transition>` 的离场要 `nextTick` + 2×rAF + `nextTick`（见 settle()）——happy-dom
 *    不算 CSS 时长，Vue 靠两帧收尾。
 */
import { createApp, h, nextTick, ref } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Sidebar from '../src/components/Sidebar.vue'
import Modal from '../src/components/Modal.vue'
import { DRAWER_EXIT_SHIFT, drawerDirectionsAgree } from '../src/composables/drawerDrag.js'

/* ---------- 源码层判据的取材（CSS 不参与 vitest，只能在源码上查） ---------- */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readSource = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8')

/** 本仓铁律：凡是要 parse 文本，先剥注释——否则注释里的声明会被当成真声明。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
}

/** 取某个 .vue 的 `<style>` 块内容（已剥注释）。 */
function styleBlockOf(rel) {
  const raw = readSource(rel)
  const start = raw.indexOf('<style')
  const open = raw.indexOf('>', start)
  const end = raw.lastIndexOf('</style>')
  return stripComments(raw.slice(open + 1, end))
}

/**
 * 抽出叶子规则 `选择器 { 声明 }`。
 * 只吃**叶**规则（声明里不再有 `{`），正是我们要比的那些；`@media` 包装本身不产生条目。
 */
function leafRules(css) {
  const rules = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = pattern.exec(css)) !== null) {
    const selector = match[1].replace(/\s+/g, ' ').trim()
    if (!selector || selector.includes('@') || selector.includes(';')) continue
    rules.push({ selector, body: match[2] })
  }
  return rules
}

const zIndexOf = (rule) => {
  const match = /z-index\s*:\s*(-?\d+)/.exec(rule.body)
  return match ? Number(match[1]) : null
}

/** 选择器里最后一段（真正决定"这条规则是不是落在根节点上"的那一段）。 */
const lastCompound = (selector) => selector.split(/[\s>+~]+/).filter(Boolean).pop() ?? ''

/**
 * 选择器特异性 [id, 类+属性+伪类, 类型]。
 * Vue 的 scoped 样式会给**每个**选择器追加一个 `[data-v-xxx]` 属性，所以两边都 +1 属性，
 * 比较结果与编译后完全一致（本判据只在两份 scoped 样式之间比较，公平）。
 */
function specificity(selector) {
  const text = selector.replace(/::?[\w-]+\([^)]*\)/g, '')
  const count = (re) => (text.match(re) ?? []).length
  const ids = count(/#[\w-]+/g)
  const classes = count(/\.[\w-]+/g)
  const attrs = count(/\[[^\]]*\]/g)
  const pseudos = count(/:(?!:)[\w-]+/g)
  const types = count(/(?:^|[\s>+~,])([a-zA-Z][\w-]*)/g)
  return [ids, classes + attrs + pseudos + 1 /* scoped 属性 */, types]
}

/** a 是否**严格**压过 b（相等 = 平手 = 不许，因为平手要看注入顺序）。 */
function outSpecifies(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }
  return false
}

/** 从 `translateX(200px)` / `translateX(102%)` 里取出数值（px 与 % 的符号比较是有意义的）。 */
function shiftOf(transform) {
  const match = /translateX\(\s*(-?[\d.]+)/.exec(transform ?? '')
  return match ? Number(match[1]) : 0
}

/** index 处所在的那个 `{` 是不是被 `@media …` 包着（返回该 at-rule 的开头，找不到返回 -1）。 */
function enclosingAtRule(css, index) {
  const stack = []
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (css[cursor] === '{') stack.push(cursor)
    else if (css[cursor] === '}') stack.pop()
  }
  if (!stack.length) return ''
  const open = stack[stack.length - 1]
  const head = css.slice(Math.max(0, open - 80), open).trim()
  return /@media[^{]*$/.test(head) ? head.slice(head.lastIndexOf('@media')) : ''
}

/** App.vue 的层叠阶梯注释里的真实数字（抬升必须落在梯子上，不能自己发明一套）。 */
function ladderComment() {
  const raw = readSource('src/App.vue')
  // 取「层叠阶梯」**前面的那一个** /* … */：用 indexOf/lastIndexOf 精确切，
  // 正则里写 `\/\*[\s\S]*?层叠阶梯` 会从更早的注释开始吞，把别的数字一起卷进来。
  const at = raw.indexOf('层叠阶梯')
  expect(at, 'App.vue 里那段「层叠阶梯」注释不见了——抬升数值的依据就没了').toBeGreaterThan(0)
  return raw.slice(raw.lastIndexOf('/*', at), raw.indexOf('*/', at))
}

function ladderRungs() {
  return [...ladderComment().matchAll(/\d+/g)].map((entry) => Number(entry[0]))
}

let app = null
let host = null
const mounted = []
const originalInnerWidth = window.innerWidth

beforeEach(() => {
  // 375px 宽的手机：min(86vw, 320px) = 320px。钉住它，阈值才是可算的常量。
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
})

afterEach(() => {
  app?.unmount()
  host?.remove()
  for (const entry of mounted.splice(0)) {
    entry.app.unmount()
    entry.root.remove()
  }
  app = null
  host = null
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
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
      { path: '/review', component: { template: '<div />' } },
      { path: '/events', component: { template: '<div />' } },
      { path: '/notes', component: { template: '<div />' } },
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
    backdrop: () => host.querySelector('.mobile-more-backdrop'),
    /** 打开抽屉并等挂载完成（overlayStack 的入栈在 watcher 里，要等一次 nextTick）。 */
    async open() {
      this.trigger.click()
      await nextTick()
      await nextTick()
      return this.sheet()
    },
  }
}

/** 挂一个真 Modal，用来测"抽屉 + 弹窗"的叠加（它和抽屉共用同一个 overlayStack）。 */
function mountModal(openRef) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const modalApp = createApp({
    render: () => h(Modal, {
      open: openRef.value,
      title: '叠加测试',
      onClose: () => { openRef.value = false },
    }),
  })
  modalApp.mount(root)
  mounted.push({ app: modalApp, root })
  return modalApp
}

/** 等 `<Transition>` 的离场走完（happy-dom 里 Vue 靠两帧收尾）。 */
async function settle() {
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  await nextTick()
}

/** 在目标元素上派发一次会冒泡的 Escape（真实键盘事件的路径：元素 → document）。 */
function pressEscape(target = document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

/** 合成一次 pointer 事件：happy-dom 的 PointerEvent 不带这些字段，只能自己 defineProperty。 */
function dispatchPointer(target, type, x, y, { time = 0, pointerType = 'touch', pointerId = 7 } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
    clientX: { value: x },
    clientY: { value: y },
    timeStamp: { value: time },
  })
  target.dispatchEvent(event)
}

/**
 * 一次**慢速**右划：每 400ms 才移动一次，松手瞬间速度 ≈ 0。
 * 这样"关不关"完全由**位移**决定，不会被甩动阈值兜走——正是要测的那条。
 * 起手点 200px 在右缘守卫（375-18=357 起才守卫）之外。
 */
function slowDragRight(panel, dx, pointerType = 'touch') {
  dispatchPointer(panel, 'pointerdown', 200, 300, { time: 0, pointerType })
  dispatchPointer(panel, 'pointermove', 200 + dx / 2, 301, { time: 400, pointerType })
  dispatchPointer(panel, 'pointermove', 200 + dx, 302, { time: 800, pointerType })
  dispatchPointer(panel, 'pointerup', 200 + dx, 302, { time: 900, pointerType })
}

describe('抽屉的可访问性契约', () => {
  it('打开后是带中文名称的模态对话框，关闭态不是靠 aria-hidden 藏的', async () => {
    const ui = await mountSidebar()
    expect(ui.sheet(), '一开始不该有抽屉').toBe(null)
    expect(ui.backdrop()).toBe(null)

    const sheet = await ui.open()
    expect(sheet.getAttribute('role'), '抽屉必须自报是对话框').toBe('dialog')
    expect(sheet.getAttribute('aria-modal'), '模态语义：背后的内容对外不可达').toBe('true')
    expect(sheet.getAttribute('aria-label'), 'role=dialog 必须带可访问名称').toMatch(/[\u4e00-\u9fa5]/)
    expect(sheet.getAttribute('aria-label')).toBe('更多功能')
    expect(sheet.getAttribute('tabindex'), '初始焦点的落点').toBe('-1')
    // 绝不能用 aria-hidden 藏关闭态：里面全是可聚焦的 link/button，
    // aria-hidden 不改 Tab 序（tests/ariaHiddenFocusable.test.js 守这条）。
    expect(sheet.hasAttribute('aria-hidden')).toBe(false)
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('遮罩与面板是兄弟关系（遮罩不包着面板），且遮罩不是可聚焦控件', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()
    const backdrop = ui.backdrop()
    expect(backdrop, '打开时遮罩要可见').toBeTruthy()
    expect(sheet.contains(backdrop), '遮罩包着面板会让"点遮罩关闭"和内部点击打架').toBe(false)
    expect(backdrop.tagName).toBe('DIV')
    expect(backdrop.getAttribute('role')).toBe(null)
    // 焦点陷阱只圈面板，为了让 Tab 不穿到遮罩背后的页面上
    expect(backdrop.hasAttribute('tabindex')).toBe(false)
  })

  it('打开时焦点进入抽屉', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()
    expect(
      sheet.contains(document.activeElement),
      '键盘用户打开抽屉后，Tab 的第一站不该还在背后的底栏上',
    ).toBe(true)
  })
})

describe('三条主动关闭路径', () => {
  it('× 按钮关闭，焦点还给触发按钮', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()
    sheet.querySelector('button').click()
    await settle()

    expect(ui.sheet()).toBe(null)
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(ui.trigger)
  })

  it('点遮罩关闭，焦点还给触发按钮', async () => {
    const ui = await mountSidebar()
    await ui.open()
    ui.backdrop().click()
    await settle()

    expect(ui.sheet()).toBe(null)
    expect(ui.backdrop()).toBe(null)
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(ui.trigger)
  })

  it('Escape 关闭（焦点原本在抽屉里），焦点还给触发按钮', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()
    const link = sheet.querySelector('.mobile-more-item')
    link.focus()
    pressEscape(link)
    await settle()

    expect(ui.sheet()).toBe(null)
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(ui.trigger)
  })

  it('右划位移足够：跟手 → 关闭', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()

    // 拖到一半先看跟手：位移完全来自 clientX，不是 CSS 计算的
    dispatchPointer(sheet, 'pointerdown', 200, 300, { time: 0 })
    dispatchPointer(sheet, 'pointermove', 240, 301, { time: 400 })
    expect(sheet.style.transform, '跟手位移必须由 JS 写内联样式').toBe('translateX(40px)')

    dispatchPointer(sheet, 'pointermove', 400, 302, { time: 800 })
    expect(sheet.style.transform).toBe('translateX(200px)')
    dispatchPointer(sheet, 'pointerup', 400, 302, { time: 900 })
    await nextTick()

    // 关闭：状态先翻转，面板被写到屏幕外（JS 驱动的内联 style），随后离场移除
    expect(ui.trigger.getAttribute('aria-expanded'), '位移超过阈值就该关').toBe('false')
    expect(ui.sheet()?.style.transform, '关闭位移要交接给离场（右锚 → 往右滑出）').toBe('translateX(102%)')
    expect(document.activeElement, '主动关闭后焦点回到触发按钮').toBe(ui.trigger)

    await settle()
    expect(ui.sheet()).toBe(null)
  })

  it('右划位移不足：回弹到开位，抽屉继续开着', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()

    slowDragRight(sheet, 40)
    await nextTick()

    expect(ui.sheet(), '位移不足不该关掉抽屉').toBeTruthy()
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('true')
    expect(sheet.style.transform, '松手后回弹到开位').toBe('translateX(0px)')

    await settle()
    expect(ui.sheet(), '回弹之后抽屉仍在').toBeTruthy()
    // 回弹动画结束后内联样式要摘掉，别一直挂着合成层
    await new Promise((resolve) => setTimeout(resolve, 240))
    expect(sheet.style.transform).toBe('')
    expect(sheet.style.transition).toBe('')
  })

  it('方向锁：纵向手势既不产生位移，也不关抽屉', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()

    dispatchPointer(sheet, 'pointerdown', 200, 300, { time: 0 })
    dispatchPointer(sheet, 'pointermove', 206, 390, { time: 400 })
    expect(sheet.style.transform, '纵向手势交还给滚动，抽屉一点都不该动').toBe('')
    dispatchPointer(sheet, 'pointerup', 206, 390, { time: 900 })
    await settle()

    expect(ui.sheet(), '纵向手势不能关掉抽屉').toBeTruthy()
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('鼠标拖动被忽略（桌面用 × / 遮罩 / Esc，不参与滑动手势）', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()

    slowDragRight(sheet, 300, 'mouse')
    await settle()

    expect(sheet.style.transform).toBe('')
    expect(ui.sheet()).toBeTruthy()
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('贴右缘起手让给系统边缘/返回手势，不会误关抽屉', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()

    // 面板右锚，守卫跟着面板走：375 宽视口下 clientX >= 357 属于系统手势区。
    // 终点故意写到屏幕外（700 → 位移 330px，远超 102.4px 阈值）：只有"守卫真的起了作用"
    // 才能解释面板一动不动、抽屉一直开着。
    dispatchPointer(sheet, 'pointerdown', 370, 300, { time: 0 })
    dispatchPointer(sheet, 'pointermove', 700, 302, { time: 800 })
    expect(sheet.style.transform, '右缘起手不该跟手').toBe('')
    dispatchPointer(sheet, 'pointerup', 700, 302, { time: 900 })
    await settle()

    expect(sheet.style.transform).toBe('')
    expect(ui.sheet()).toBeTruthy()
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('对照：同样的位移，只把起手点移出守卫区就照常关闭', async () => {
    // 与上一条构成判别力对照——同位移、同方向，唯一变量是起手点。
    // 少了它，"右缘起手不关"可能只是"这条位移本来就不关"而已。
    const ui = await mountSidebar()
    const sheet = await ui.open()

    dispatchPointer(sheet, 'pointerdown', 200, 300, { time: 0 })
    dispatchPointer(sheet, 'pointermove', 530, 302, { time: 800 })
    expect(sheet.style.transform).toBe('translateX(320px)')
    dispatchPointer(sheet, 'pointerup', 530, 302, { time: 900 })
    await settle()

    expect(ui.sheet(), '非边缘起手、同样 330px 位移 → 关').toBe(null)
  })

  it('指针被系统打断（pointercancel）时回弹，不当作一次关闭', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()

    dispatchPointer(sheet, 'pointerdown', 200, 300, { time: 0 })
    dispatchPointer(sheet, 'pointermove', 400, 302, { time: 400 })
    expect(sheet.style.transform).toBe('translateX(200px)')
    dispatchPointer(sheet, 'pointercancel', 400, 302, { time: 500 })
    await settle()

    expect(sheet.style.transform).toBe('')
    expect(ui.sheet(), '手势被打断不该关掉抽屉').toBeTruthy()
  })

  it('没有位移的点击不写任何内联样式（免得盖住离场过渡）', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()

    // 一次点击 = pointerdown + pointerup，方向锁从头到尾没锁上横向
    dispatchPointer(sheet, 'pointerdown', 200, 300, { time: 0 })
    dispatchPointer(sheet, 'pointerup', 200, 300, { time: 60 })
    await nextTick()

    expect(sheet.style.transform, '点击不该在面板上留下内联 transform').toBe('')
    expect(sheet.style.transition).toBe('')
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('true')
    // 点里面的导航项换页时，抽屉仍要能正常滑走（内联 transform 会盖住离场过渡）
    sheet.querySelector('.mobile-more-item').click()
    await nextTick()
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('false')
    expect(ui.sheet()?.style.transform ?? '', '没有被内联 transform 挡住').toBe('')
  })
})

describe('焦点陷阱', () => {
  it('Tab 与 Shift+Tab 都在抽屉内循环，不会穿到背后的底栏', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()
    const focusables = [...sheet.querySelectorAll('button, a[href]')]
    expect(focusables.length, '抽屉里应当有链接与按钮').toBeGreaterThan(3)
    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    last.focus()
    sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement, '最后一个元素按 Tab 要绕回第一个').toBe(first)

    first.focus()
    sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement, '第一个元素按 Shift+Tab 要绕到最后一个').toBe(last)
  })

  it('焦点被放到抽屉外时，Tab 会被拉回抽屉里（模态不允许穿出去）', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()
    const outside = host.querySelector('.mobile-nav a')
    outside.focus()
    expect(sheet.contains(document.activeElement)).toBe(false)

    sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(sheet.contains(document.activeElement), 'Tab 之后焦点必须回到抽屉内部').toBe(true)
  })

  it('抽屉关着时 Tab 不受影响（陷阱只在打开期间生效）', async () => {
    const ui = await mountSidebar()
    const navItem = host.querySelector('.mobile-nav a')
    navItem.focus()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(navItem)
  })
})

describe('滚动锁', () => {
  it('打开时锁住页面并在关闭后完全回落', async () => {
    const ui = await mountSidebar()
    expect(document.body.style.overflow).toBe('')

    await ui.open()
    expect(document.body.dataset.modalLockCount, '滚动锁用引用计数').toBe('1')
    expect(document.body.dataset.modalOpen).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')

    pressEscape(ui.sheet().querySelector('button'))
    await settle()
    expect(document.body.dataset.modalLockCount).toBeUndefined()
    expect(document.body.dataset.modalOpen).toBeUndefined()
    expect(document.body.style.overflow).toBe('')
  })

  it('与另一个 Modal 叠加：关掉弹窗后抽屉的锁还在，关掉抽屉才完全解锁', async () => {
    const ui = await mountSidebar()
    await ui.open()
    expect(document.body.dataset.modalLockCount).toBe('1')

    const modalOpen = ref(true)
    mountModal(modalOpen)
    await nextTick()
    await nextTick()
    expect(document.body.dataset.modalLockCount, '弹窗再叠一层').toBe('2')
    expect(document.querySelector('.overlay'), '弹窗确实挂上来了').toBeTruthy()

    modalOpen.value = false
    await nextTick()
    await settle()
    expect(document.body.dataset.modalLockCount, '弹窗关掉后只回落一层').toBe('1')
    expect(document.body.dataset.modalOpen).toBe('true')
    expect(document.body.style.overflow, '抽屉还开着，页面必须仍然锁着').toBe('hidden')
    expect(ui.trigger.getAttribute('aria-expanded'), '弹窗关掉不该连带关掉抽屉').toBe('true')

    pressEscape(ui.sheet().querySelector('button'))
    await settle()
    expect(document.body.dataset.modalLockCount).toBeUndefined()
    expect(document.body.style.overflow).toBe('')
  })

  it('弹窗压在抽屉上时，Escape 只关最上面那一层', async () => {
    const ui = await mountSidebar()
    await ui.open()

    const modalOpen = ref(true)
    mountModal(modalOpen)
    await nextTick()
    await nextTick()

    pressEscape(document.body)
    await nextTick()
    expect(document.querySelector('.overlay'), 'Escape 该关掉最上面的弹窗').toBe(null)
    expect(ui.sheet(), '抽屉在下面，不该被同一次按键收掉').toBeTruthy()
    expect(ui.trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.dataset.modalLockCount).toBe('1')
  })

  it('侧边栏整个卸载时不会把滚动锁留在 body 上', async () => {
    const ui = await mountSidebar()
    await ui.open()
    expect(document.body.dataset.modalLockCount).toBe('1')

    app.unmount()
    app = null
    await nextTick()
    expect(document.body.dataset.modalLockCount).toBeUndefined()
    expect(document.body.style.overflow).toBe('')
  })
})

/**
 * 判别力自证（夹具）：证明"位移不足不关"这条不是空断言。
 *
 * 如果判定恒返回"关"，第一条会红；恒返回"不关"，第二条会红。
 * 两条并排放在一起跑，就是在组件层面对"不足/足够"这对边界做对照——
 * 少了它，"位移不足不关"可能只是每次都恰好没关（比如手势压根没起手）而已。
 */
describe('判别力自证：位移不足与足够在组件层面对照', () => {
  it('同一个 helper 只改位移：40px 不关、200px 关', async () => {
    const short = await mountSidebar()
    const shortSheet = await short.open()
    slowDragRight(shortSheet, 40)
    await settle()
    const shortStillOpen = short.sheet() !== null
    app.unmount()
    app = null
    host.remove()
    host = null

    const long = await mountSidebar()
    const longSheet = await long.open()
    slowDragRight(longSheet, 200)
    await settle()
    const longStillOpen = long.sheet() !== null

    expect(shortStillOpen, '位移不足：抽屉要留着').toBe(true)
    expect(longStillOpen, '位移足够：抽屉要关掉').toBe(false)
    expect(shortStillOpen, '两种位移给出同一结论 → 这条判定没有判别力').not.toBe(longStillOpen)
  })

  it('前提自证：手势确实起手了——位移足够的那次拖动过程里面板真的动了', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()
    dispatchPointer(sheet, 'pointerdown', 200, 300, { time: 0 })
    dispatchPointer(sheet, 'pointermove', 340, 302, { time: 800 })
    expect(sheet.style.transform, '没起手的话这里会空 → "位移不足不关"就成了假绿').toBe('translateX(140px)')
    dispatchPointer(sheet, 'pointercancel', 340, 302, { time: 900 })
  })
})

/**
 * 这次返工的起因就是方向：面板左锚时"手指往右拖、面板跟着往右走、松手却往左飞出去"。
 * 光把 CSS 改成右锚还不够——**跟手方向与出场方向必须同号**，所以这里把它单独立一条断言，
 * 并且断言的是**运行时的两个真实数字**（拖动中的内联 style、松手后的内联 style），
 * 不是源码里的字面量。源码层的 off-canvas 数值另有判据（见下一个 describe）。
 */
describe('跟手方向 == 出场方向', () => {
  it('组件层：拖动中的内联位移与松手后的出场位移同号', async () => {
    const ui = await mountSidebar()
    const sheet = await ui.open()

    dispatchPointer(sheet, 'pointerdown', 200, 300, { time: 0 })
    dispatchPointer(sheet, 'pointermove', 400, 302, { time: 800 })
    const dragShift = shiftOf(sheet.style.transform)
    expect(dragShift, '跟手位移由 JS 写内联 style，且方向向右').toBe(200)

    dispatchPointer(sheet, 'pointerup', 400, 302, { time: 900 })
    await nextTick()
    const exitShift = shiftOf(ui.sheet().style.transform)
    expect(exitShift, '出场位移百分比（右锚 → 正号）').toBe(102)

    expect(
      drawerDirectionsAgree(dragShift, exitShift),
      `跟手 +${dragShift}px 与出场 ${exitShift}% 符号必须一致：不一致就是"手指往右拖、面板往左飞"`,
    ).toBe(true)
  })

  it('源码层：CSS 的进出场位移与 JS 的 DRAWER_EXIT_SHIFT 是同一个数', async () => {
    const rules = leafRules(styleBlockOf('src/components/Sidebar.vue'))
    const enter = rules.find((rule) => rule.selector.includes('.more-sheet-enter-from'))
    const leave = rules.find((rule) => rule.selector.includes('.more-sheet-leave-to'))
    expect(enter, '找不到 .more-sheet-enter-from 规则').toBeTruthy()
    expect(leave, '找不到 .more-sheet-leave-to 规则').toBeTruthy()

    for (const [name, rule] of [['enter-from', enter], ['leave-to', leave]]) {
      const cssShift = shiftOf(rule.body.match(/translateX\([^)]*\)/)?.[0])
      expect(cssShift, `.more-sheet-${name} 必须与 drawerDrag.js 的 DRAWER_EXIT_SHIFT 一致`).toBe(DRAWER_EXIT_SHIFT)
      expect(cssShift, 'off-canvas 必须是正号（向右），否则出场方向与跟手方向相反').toBeGreaterThan(0)
    }
  })
})

/**
 * 层叠抬升：抽屉与遮罩都在 `.sidebar` 内部，而 `.sidebar` 自己
 * （`position: fixed` + `z-index`）就是一个层叠上下文——里面的 z-index 再大也逃不出去。
 * 于是 `.task-pill`(90) 会浮在遮罩之上、抽屉开着还能点到后面的东西。所以要在打开期间
 * 把**根节点**整体抬到 .task-pill 之上、仍在弹窗之下。
 *
 * 【为什么必须查源码】vitest 不处理 CSS：挂载断言看不见 z-index 到底谁赢，
 * 更不能发现"选择器特异性和 App.vue 那条打平、于是被注入顺序吃掉"这种失效。
 */
describe('层叠抬升：抽屉打开时必须压过 .task-pill', () => {
  it('行为：打开时根节点带 drawer-open，关闭后摘掉（不留一个永久抬高的侧边栏）', async () => {
    const ui = await mountSidebar()
    const root = host.querySelector('.sidebar')
    expect(root, '找不到根节点 .sidebar').toBeTruthy()
    expect(root.classList.contains('drawer-open'), '关着的时候不该抬高层叠').toBe(false)

    const sheet = await ui.open()
    expect(root.classList.contains('drawer-open'), '抽屉打开 → 根节点进入抬高态').toBe(true)

    sheet.querySelector('button').click()
    await settle()
    expect(root.classList.contains('drawer-open'), '关闭后必须回到原值').toBe(false)
  })

  it('源码：抬升规则的数值落在层叠阶梯的空档里（> .task-pill，< 弹窗与告警层）', () => {
    const rungs = ladderRungs()
    expect(rungs.length, '层叠阶梯至少要有几个数字，否则下面的区间没意义').toBeGreaterThanOrEqual(4)
    // 阶梯注释里的 .task-pill 档位，和代码里那条规则对得上（注释与实现不许漂移）
    const taskPillRung = Number(/(\d+)\s*\.task-pill/.exec(readSource('src/App.vue'))[1])
    expect(taskPillRung).toBe(90)
    // 第五十四轮末：`App.vue` 里那条 `.task-pill{z-index:90}` 是**死规则**（`.task-pill` 是
    // TaskCenter.vue 的内部类，父组件的 scope 属性加不到那个节点上），已按可达性判据清掉；
    // 真正生效的一直是 TaskCenter.vue 自己样式块里的那条（探针实测 z-index:90）。
    // 所以这里改从**属主组件**取材——断言的含义不变（"阶梯注释里的档位必须与实现一致"），
    // 只是取材位置跟着规则的所有权走。若哪天有人把死规则又写回 App.vue，本用例不会再被骗过。
    const pillRule = leafRules(styleBlockOf('src/components/TaskCenter.vue'))
      .find((rule) => lastCompound(rule.selector) === '.task-pill' && zIndexOf(rule) !== null)
    expect(zIndexOf(pillRule), 'TaskCenter.vue 里 .task-pill 的 z-index 必须和阶梯注释一致').toBe(taskPillRung)

    // 阶梯里 .task-pill 之上最近的一档（240 同步告警）
    const nextRung = rungs.filter((rung) => rung > taskPillRung).sort((a, b) => a - b)[0]
    expect(nextRung, '阶梯里应当有 .task-pill 之上的档位').toBeGreaterThan(taskPillRung)

    // 弹窗遮罩：抽屉开着再点「个性化」时，弹窗必须盖住**整个**侧边栏（含底栏）
    const modalZ = Math.min(
      ...leafRules(styleBlockOf('src/components/Modal.vue'))
        .map(zIndexOf)
        .filter((value) => value !== null && value > taskPillRung),
    )
    expect(modalZ, 'Modal.vue 里应当有高于 .task-pill 的遮罩层').toBeGreaterThan(taskPillRung)

    const raised = leafRules(styleBlockOf('src/components/Sidebar.vue'))
      .filter((rule) => lastCompound(rule.selector).includes('.drawer-open') && zIndexOf(rule) !== null)
    expect(raised, '找不到打开态的抬升规则（选择器里应当带 .drawer-open）').toHaveLength(1)
    const raisedZ = zIndexOf(raised[0])
    expect(raisedZ, `抬升后的 ${raisedZ} 必须压过 .task-pill(${taskPillRung})，否则胶囊浮在遮罩上`).toBeGreaterThan(taskPillRung)
    expect(raisedZ, `抬升后的 ${raisedZ} 必须低于弹窗遮罩(${modalZ})，否则底栏浮在弹窗上面`).toBeLessThan(modalZ)
    expect(raisedZ, `抬升后的 ${raisedZ} 必须低于阶梯里下一档(${nextRung})`).toBeLessThan(nextRung)
  })

  it('源码：抬升规则写在 ≤900px 的媒体查询里（桌面的层叠阶梯不受影响）', () => {
    const css = styleBlockOf('src/components/Sidebar.vue')
    const at = css.indexOf('.sidebar.drawer-open')
    expect(at, '找不到 .sidebar.drawer-open 规则').toBeGreaterThan(0)
    const enclosing = enclosingAtRule(css, at)
    expect(enclosing, `抬升规则必须包在移动端媒体查询里，实际包在「${enclosing || '(顶层)'}」里`).toMatch(/@media[^{]*max-width:\s*900px/)
  })

  it('源码：抬升规则的特异性严格大于其它 .sidebar 层叠规则（不许打字平局）', () => {
    // App.vue 里有一条 scoped `.sidebar { z-index: 20 }`——Vue 3 的 scoped 样式会作用于
    // **子组件的根节点**，所以它是真生效的。只写 `.sidebar` 抬升的话两者特异性相同，
    // 胜负由两份样式的注入顺序决定，抬升很可能被吃掉，而 vitest 不处理 CSS、测不出来。
    const mine = leafRules(styleBlockOf('src/components/Sidebar.vue'))
      .find((rule) => lastCompound(rule.selector).includes('.drawer-open') && zIndexOf(rule) !== null)
    expect(mine).toBeTruthy()

    const rivals = [
      ...leafRules(styleBlockOf('src/App.vue')),
      ...leafRules(styleBlockOf('src/components/Sidebar.vue')),
    ].filter((rule) => rule !== mine
      && lastCompound(rule.selector).includes('.sidebar')
      && !lastCompound(rule.selector).includes('.drawer-open')
      && zIndexOf(rule) !== null)

    expect(rivals.length, '应当能找到 App.vue / Sidebar.vue 里对 .sidebar 的 z-index 声明').toBeGreaterThanOrEqual(1)
    const mineSpec = specificity(mine.selector)
    for (const rival of rivals) {
      expect(
        outSpecifies(mineSpec, specificity(rival.selector)),
        `「${mine.selector}」(${mineSpec.join(',')}) 必须严格压过「${rival.selector}」(${specificity(rival.selector).join(',')})，否则平局要看注入顺序`,
      ).toBe(true)
    }
  })
})