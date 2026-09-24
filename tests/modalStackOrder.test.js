// @vitest-environment happy-dom
/**
 * 浮层层叠顺序必须由**打开顺序**决定，而不是由 Teleport 锚点的挂载时机决定。
 *
 * 【病灶】（UX_AUDIT_176_REPORT.md §4 第 26 条 / §1.74）
 * body 里所有 `.overlay` 的 z-index 原本是同一个常量（100，写在 Modal.vue 的 scoped
 * 样式里），于是谁盖在谁上面**完全由 DOM 顺序决定**；而 Teleport 的锚点在组件
 * **挂载时**创建。结果："随页面常驻"的浮层（只有 `:open`、没有 `v-if`）永远排在
 * "打开时才建锚点"的浮层之前——读屏与 Escape（overlayStack 的 isTopOverlay）认为
 * 后开的那个在最上层，眼睛看到的却是常驻那个压着它：**用户点不到本该显示的那颗
 * 按钮，而且不报错、不进控制台**。上一轮 confirm 迁移（24 处写成
 * `v-if="target" :open="Boolean(target)"`）只在迁移范围内把症状绕开了，没从根上修。
 *
 * 【修法】`Modal` 按它在共享浮层栈里的**当前位置**写内联 z-index
 * = `100 + min(深度, 9)`（overlayStack.js 的 overlayZIndexFor）。本文件盯的就是这条
 * 不变量：打开顺序决定层级、关闭后回落、上界不越过固定浮层、下界仍压过任务胶囊与抽屉。
 *
 * 【判据落在哪里，以及为什么只能落在这里】
 * vitest 不处理 CSS（`css: { include: [] }`），happy-dom 也没有布局，所以
 * **"谁真的画在上面"在本环境里验不了**。能验的只有两件事：
 *   1. **行为**：内联 `style.zIndex` 按打开顺序严格递增、关闭后回落/摘掉，且不与
 *      JS 写的 top/bottom/height 互相覆盖；
 *   2. **数值关系**：基础值/上界与源码里 90 / 95 / 110 / 130 / 240 这些**真实层级**
 *      的关系（数字一律从源码解析，不手抄——源码一改测试就得跟着说话）。
 * 任何"渲染层级已验证"的说法都超出本文件的能力范围；这里能证明的是
 * **浏览器拿到了一份正确的内联层级**。
 *
 * 【判别力】只断言"上层更大"是不够的：把实现改回常量也能让"不相等"之类的弱断言全绿。
 * 所以文件里复刻了一份改造前的实现（同一个常量层级、只靠 DOM 顺序），并证明
 * **同一套断言的"严格大于"那一条在它上面必然为假**——否则这个文件就是摆设。
 */
import { createApp, h, nextTick, ref, Teleport } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Modal from '../src/components/Modal.vue'
import {
  OVERLAY_BASE_Z_INDEX,
  OVERLAY_MAX_DEPTH,
  overlayCount,
  overlayZIndexAtDepth,
  overlayZIndexFor,
} from '../src/composables/overlayStack.js'
import { walkVueFiles } from './helpers/vueTemplate.js'

/* ---------------------------------------------------------------- 源码取材
 * vitest 不处理 CSS，源码是这些数字**唯一**可信的来源。铁律：先剥注释再 parse，
 * 否则说明性注释里的 `z-index: 100`（本文件自己就写了一堆）会被当成真声明。 */

/** 本文件里所有源码路径都是 **src 相对**（`components/Modal.vue`、`App.vue`、`style.css`）。 */
const srcDir = resolve(import.meta.dirname, '..', 'src')
const readSource = (rel) => readFileSync(resolve(srcDir, rel), 'utf8')

const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')

/** 某个文件的 CSS：`.vue` 取全部 `<style>` 块，`.css` 取整份文件，都已剥注释。 */
function cssOf(rel) {
  const raw = readSource(rel)
  if (!rel.endsWith('.vue')) return stripCssComments(raw)
  let out = ''
  let at = raw.indexOf('<style')
  while (at >= 0) {
    const open = raw.indexOf('>', at)
    const close = raw.indexOf('</style>', open)
    if (open < 0 || close < 0) break
    out += `${stripCssComments(raw.slice(open + 1, close))}\n`
    at = raw.indexOf('<style', close)
  }
  return out
}

/** 叶子规则 `选择器 { 声明 }`（声明里不再有 `{`）；`@media` 包装本身不产生条目。 */
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

/** 选择器里最后一段（决定"这条规则落在哪个元素上"的那一段）。 */
const lastCompound = (selector) => selector.split(/[\s>+~]+/).filter(Boolean).pop() ?? ''

/**
 * 从源码里解析某个选择器的 z-index，取**最小值**（同名字段若有多个声明，
 * 能盖住浮层的上限是其中最低的那个）。解析不到就直接失败——空转的区间判据等于没有。
 */
function minZFrom(files, selector, note) {
  const found = files.flatMap((rel) => leafRules(cssOf(rel))
    .filter((rule) => rule.selector.split(',').some((one) => lastCompound(one) === selector))
    .map(zIndexOf)
    .filter((z) => z !== null))
  expect(
    found.length,
    `${note}：从「${files.join(' / ')}」里解析不到「${selector}」的 z-index 声明，下面的区间判据会空转`,
  ).toBeGreaterThan(0)
  return Math.min(...found)
}

/** 全仓所有 `.overlay` 的 z-index 声明（每个 .vue 的 `<style>` + src/style.css）。 */
function everyOverlayZDeclaration() {
  const files = [
    ...walkVueFiles(srcDir).map((file) => file.slice(srcDir.length + 1).replace(/\\/g, '/')),
    'style.css',
  ]
  const out = []
  for (const rel of files) {
    for (const rule of leafRules(cssOf(rel))) {
      if (rule.selector !== '.overlay') continue
      const z = zIndexOf(rule)
      if (z !== null) out.push({ file: rel, z })
    }
  }
  return out
}

/** Modal.vue scoped `.overlay` 里那个数 = 基础层级的**真实来源**。 */
function overlayBaseFromSource() {
  const found = everyOverlayZDeclaration().filter((entry) => entry.file === 'components/Modal.vue')
  expect(found, 'Modal.vue 的 .overlay 必须声明基础层级（v-if 的 .modal-head z-index:2 不算）').toHaveLength(1)
  return found[0].z
}

/* ---------------------------------------------------------------- 运行时夹具 */

const mounted = []
const originalVisualViewport = window.visualViewport

function mount(render) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ render })
  app.mount(root)
  mounted.push({ app, root })
}

afterEach(() => {
  for (const { app, root } of mounted.splice(0)) {
    app.unmount()
    root.remove()
  }
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
  if (originalVisualViewport === undefined) delete window.visualViewport
  else Object.defineProperty(window, 'visualViewport', { configurable: true, value: originalVisualViewport })
  // 栈必须随卸载清空：留一条在里面，后面的用例就会带着上一个用例的深度起跑
  // （那时"深度 0 = 基础值"这条断言会莫名其妙地失败，排查成本很高）。
  expect(overlayCount(), 'unmount 之后浮层栈应当清空').toBe(0)
})

/** body 里所有 Modal 浮层（Modal Teleport 到 body，取最后一个匹配是既有惯例）。 */
const overlays = () => [...document.querySelectorAll('.overlay')]

/** 含某个内部元素的那个浮层。 */
function overlayOf(selector) {
  return overlays().find((overlay) => overlay.querySelector(selector)) ?? null
}

/** 内联层级；没写内联值时返回 null（而不是 NaN 或 0——"没写"和"写成 0"是两回事）。 */
function zOf(element) {
  const value = element?.style?.zIndex
  return value === undefined || value === '' ? null : Number(value)
}

/**
 * 本文件的判据核心：上层必须**严格大于**下层。
 * 判别力对照复用同一个函数，正是为了证明"旧实现下这一条必然为假"。
 */
function expectStrictlyAbove(lowerEl, upperEl, label) {
  const lower = zOf(lowerEl)
  const upper = zOf(upperEl)
  expect(lower, `${label}：下层浮层应当有内联 z-index`).not.toBeNull()
  expect(upper, `${label}：上层浮层应当有内联 z-index`).not.toBeNull()
  expect(upper, `${label}：后开的浮层内联 z-index 必须严格大于先开的（${upper} > ${lower}）`).toBeGreaterThan(lower)
}

/**
 * 改造前的实现复刻：**同一个常量层级**，谁在上层只由 DOM 顺序决定。
 * 常量直接取 Modal.vue scoped 样式里那一个数（`overlayBaseFromSource`），
 * 不在夹具里另抄一遍——否则夹具与实现各写一个数，对照就失去意义。
 *
 * 用 `h()` 而不是模板字符串：夹具要尽量少依赖运行环境（不牵扯模板编译器）。
 */
const LegacyOverlay = {
  props: { open: Boolean, actionId: String, legacyZ: Number },
  setup(props) {
    return () => (props.open
      ? h(Teleport, { to: 'body' }, [
        h('div', { class: 'overlay legacy-overlay', style: { zIndex: String(props.legacyZ) } }, [
          h('div', { class: 'modal' }, [h('button', { id: props.actionId }, '旧实现按钮')]),
        ]),
      ])
      : null)
  },
}

/* ---------------------------------------------------------------- 行为 */

describe('行为：层叠顺序由打开顺序决定', () => {
  it('常驻浮层先挂载、后开的浮层后挂载 → 后开的严格更大', async () => {
    const lateOpen = ref(false)
    mount(() => h('div', [
      h(Modal, { open: true, title: '常驻' }, { default: () => h('button', { id: 'resident-action' }, '常驻按钮') }),
      lateOpen.value ? h(Modal, { open: true, title: '后开' }, { default: () => h('button', { id: 'late-action' }, '后开按钮') }) : null,
    ]))
    await nextTick()

    const resident = overlayOf('#resident-action')
    expect(resident, '常驻浮层应当已渲染').not.toBeNull()
    expect(zOf(resident), '栈里只有它一个 → 基础值').toBe(OVERLAY_BASE_Z_INDEX)
    expect(overlayOf('#late-action'), '后开的浮层此刻还没打开').toBeNull()

    lateOpen.value = true
    await nextTick()

    const late = overlayOf('#late-action')
    expect(late, '后开的浮层应当已渲染').not.toBeNull()
    expectStrictlyAbove(resident, late, '后开的浮层')
    expect(zOf(late), '深度 1 → 基础值 + 1（恰好一格，不是随便大一点）').toBe(OVERLAY_BASE_Z_INDEX + 1)
    // 判据必须落在**内联** style 上：vitest 不处理 CSS，靠样式表就等于什么都没验
    expect(late.getAttribute('style') ?? '', '层级必须写在元素的内联样式里').toContain('z-index')
  })

  it('常驻浮层锚点更早、打开更晚时，它必须压在先开的 v-if 浮层之上（§4 第 26 条的真实场景）', async () => {
    const residentOpen = ref(false)
    mount(() => h('div', [
      h(Modal, { open: residentOpen.value, title: '常驻' }, { default: () => h('button', { id: 'resident-action' }, '常驻按钮') }),
      h(Modal, { open: true, title: '先开' }, { default: () => h('button', { id: 'early-action' }, '先开按钮') }),
    ]))
    await nextTick()

    residentOpen.value = true
    await nextTick()

    const resident = overlayOf('#resident-action')
    const early = overlayOf('#early-action')
    expect(resident, '常驻浮层应当已打开').not.toBeNull()
    expect(early, '先开的浮层应当还在').not.toBeNull()
    // 前置事实：常驻浮层的 Teleport 锚点在**挂载时**就建好了，所以 DOM 顺序把它排在前面。
    // 这正是旧实现必然出错的地方——**只有 z-index 能把它放到上面**。
    expect(
      overlays().indexOf(resident),
      '常驻浮层的锚点应当仍在 DOM 里更靠前（否则这条用例就没在考 z-index）',
    ).toBeLessThan(overlays().indexOf(early))
    expectStrictlyAbove(early, resident, '后打开的常驻浮层')
    expect(zOf(resident)).toBe(OVERLAY_BASE_Z_INDEX + 1)
  })

  it('关闭后不留永久抬高的层：剩下那个回落，重新打开按当时的深度重算', async () => {
    const residentOpen = ref(true)
    const upperOpen = ref(false)
    mount(() => h('div', [
      h(Modal, { open: residentOpen.value, title: '常驻' }, { default: () => h('button', { id: 'resident-action' }, '常驻按钮') }),
      upperOpen.value ? h(Modal, { open: true, title: '上层' }, { default: () => h('button', { id: 'upper-action' }, '上层按钮') }) : null,
    ]))
    await nextTick()

    upperOpen.value = true
    await nextTick()
    expectStrictlyAbove(overlayOf('#resident-action'), overlayOf('#upper-action'), '上层')
    expect(zOf(overlayOf('#upper-action'))).toBe(OVERLAY_BASE_Z_INDEX + 1)

    // 关掉**下面**那个：上面那个的深度从 1 回到 0，抬高的值必须跟着摘掉
    residentOpen.value = false
    await nextTick()
    expect(overlayOf('#resident-action'), '关掉的浮层应当离开 DOM').toBeNull()
    expect(
      zOf(overlayOf('#upper-action')),
      '下层关闭后，剩下的浮层必须回落到基础值——不许留下永久抬高的层',
    ).toBe(OVERLAY_BASE_Z_INDEX)

    // 重新打开常驻浮层：它这次是**后开**的，按当时的深度重算（而不是沿用关闭前的旧值）
    residentOpen.value = true
    await nextTick()
    const resident = overlayOf('#resident-action')
    const upper = overlayOf('#upper-action')
    expect(
      overlays().indexOf(resident),
      '重新打开时锚点仍在前面——所以"在上面"只能来自 z-index',
    ).toBeLessThan(overlays().indexOf(upper))
    expectStrictlyAbove(upper, resident, '重新打开的常驻浮层')
    expect(zOf(resident)).toBe(OVERLAY_BASE_Z_INDEX + 1)

    // 再关掉**上面**那个：留下来的那个同样回落
    upperOpen.value = false
    await nextTick()
    expect(zOf(overlayOf('#resident-action')), '上层关闭后应当回落').toBe(OVERLAY_BASE_Z_INDEX)
  })

  it('内联 z-index 与 JS 写的 top/bottom/height 共存，互不覆盖', async () => {
    // 钉一个视觉视口，让 syncViewportGeometry 真的写 top/height（见 modal.test.js）
    const visualViewport = { height: 430, offsetTop: 12, addEventListener() {}, removeEventListener() {} }
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport })
    const upperOpen = ref(false)
    mount(() => h('div', [
      h(Modal, { open: true, title: '常驻' }, { default: () => h('button', { id: 'resident-action' }, '常驻按钮') }),
      upperOpen.value ? h(Modal, { open: true, title: '上层' }, { default: () => h('button', { id: 'upper-action' }, '上层按钮') }) : null,
    ]))
    await nextTick()

    const resident = overlayOf('#resident-action')
    expect(resident.style.top, 'JS 写的 top 必须还在').toBe('12px')
    expect(resident.style.height, 'JS 写的 height 必须还在').toBe('430px')
    expect(zOf(resident)).toBe(OVERLAY_BASE_Z_INDEX)

    // 深度变化会触发重渲染（绑定的 style 对象变了）——重渲染不许把另外三个属性清掉。
    // 这正是 overlayStyle 必须绑 `{}` 而不是 `null` 的原因：Vue 的 patchStyle 在
    // next 为 null 且 prev 有值时走 removeAttribute('style')，会连 top/height 一起抹掉。
    upperOpen.value = true
    await nextTick()
    expect(resident.style.top, '重渲染后 top 不许被清掉').toBe('12px')
    expect(resident.style.height, '重渲染后 height 不许被清掉').toBe('430px')
    expect(zOf(resident)).toBe(OVERLAY_BASE_Z_INDEX)
    expect(zOf(overlayOf('#upper-action'))).toBe(OVERLAY_BASE_Z_INDEX + 1)

    // 上层关闭 → 常驻浮层重渲染后 top/height 仍在
    upperOpen.value = false
    await nextTick()
    expect(resident.style.top).toBe('12px')
    expect(resident.style.height).toBe('430px')
  })
})

/* ---------------------------------------------------------------- 判别力 */

describe('判别力对照：改造前的实现必须被同一条断言抓住', () => {
  it('常量层级 + 只靠 DOM 顺序时，「严格大于」必然为假', async () => {
    const legacyZ = overlayBaseFromSource()
    const lateOpen = ref(false)
    mount(() => h('div', [
      h(LegacyOverlay, { open: true, actionId: 'legacy-resident-action', legacyZ }),
      lateOpen.value ? h(LegacyOverlay, { open: true, actionId: 'legacy-late-action', legacyZ }) : null,
    ]))
    await nextTick()
    lateOpen.value = true
    await nextTick()

    const lower = overlayOf('#legacy-resident-action')
    const upper = overlayOf('#legacy-late-action')
    // 前置：两个浮层都在，且 DOM 顺序确实把后开的排在后面——旧实现的"视觉顺序"就是这个，
    // 所以在只有一层的场景里它看起来完全正常，问题只在"层级被锚点时机决定"。
    expect(lower, '夹具的下层浮层应当在').not.toBeNull()
    expect(upper, '夹具的上层浮层应当在').not.toBeNull()
    expect(
      overlays().indexOf(upper),
      '夹具的前提是后开的那个排在 DOM 后面（否则它连"看起来在上面"都做不到）',
    ).toBeGreaterThan(overlays().indexOf(lower))

    // 旧实现：两层的层级是同一个常量（改造前 CSS 里就一个 100）
    expect(zOf(lower), '旧实现里下层就是那个常量').toBe(legacyZ)
    expect(zOf(upper), '旧实现里上层也是同一个常量').toBe(legacyZ)

    // ⇒ 同一套断言的"严格大于"这一条在旧实现下**必然为假**。
    // 这里不只断言"抛错"，还要断言**是"严格大于"那一条抛的**——否则夹具可能因为
    // 元素都找不到之类的无关原因失败，看起来同样"有牙齿"，实际什么都没证明。
    let message = ''
    try {
      expectStrictlyAbove(lower, upper, '旧实现夹具')
    } catch (error) {
      message = String(error?.message ?? error)
    }
    expect(message, '旧实现必须被"严格大于"这一条抓住').toContain('旧实现夹具')
    expect(message, '而且失败原因必须是"严格大于"不成立').toContain('严格大于')

    // 反面对照：同一套断言在**当前**实现上用同样的挂载顺序是成立的（见上面第一个用例），
    // 所以这条对照证明的是"断言有牙齿"，而不是"断言恒假"。
  })
})

/* ---------------------------------------------------------------- 数值区间 */

describe('数值区间：全部从源码解析，不手抄常量', () => {
  it('上界：最大可能取值必须低于 .sheet-overlay / .context-menu / 同步告警层', () => {
    const maxOverlayZ = OVERLAY_BASE_Z_INDEX + OVERLAY_MAX_DEPTH
    const sheetZ = minZFrom(
      ['components/ActionSheet.vue', 'components/AppearanceSettings.vue'],
      '.sheet-overlay',
      '底部操作面板',
    )
    const menuZ = minZFrom(['components/ContextMenu.vue'], '.context-menu', '右键菜单')
    const syncZ = minZFrom(['App.vue'], '.global-sync-alert', '同步告警')
    const safeModeZ = minZFrom(['App.vue'], '.global-safe-mode-alert', '安全模式 / 持久化告警')
    const quickRecordZ = minZFrom(['App.vue'], '.quick-record-toast', '快速记录提示')
    const errorZ = minZFrom(['App.vue'], '.global-error-toast', '全局错误提示')

    for (const [label, value] of [
      ['.sheet-overlay（底部操作面板）', sheetZ],
      ['.context-menu（右键菜单）', menuZ],
      ['.global-sync-alert（同步告警）', syncZ],
      ['.global-safe-mode-alert（安全模式告警）', safeModeZ],
      ['.quick-record-toast（快速记录提示）', quickRecordZ],
      ['.global-error-toast（全局错误提示）', errorZ],
    ]) {
      expect(
        maxOverlayZ,
        `浮层最大取值 ${maxOverlayZ} 必须严格低于 ${label} 的 ${value}，否则弹窗会盖住它`,
      ).toBeLessThan(value)
    }

    // 上界必须真的**夹住**：深度再涨也不会越过它（否则"深度一多就越过 110"）
    expect(overlayZIndexAtDepth(OVERLAY_MAX_DEPTH)).toBe(maxOverlayZ)
    expect(overlayZIndexAtDepth(OVERLAY_MAX_DEPTH + 1), '超深必须夹在上界，不许继续爬').toBe(maxOverlayZ)
    expect(overlayZIndexAtDepth(50)).toBe(maxOverlayZ)
    // 深度为负 / 非数字不该造出比基础值更低的层
    expect(overlayZIndexAtDepth(-3)).toBe(OVERLAY_BASE_Z_INDEX)
    expect(overlayZIndexAtDepth(undefined)).toBe(OVERLAY_BASE_Z_INDEX)
  })

  it('下界：浮层值必须仍然压过 .task-pill(90) 与抽屉打开态(95)', () => {
    const pillZ = minZFrom(['App.vue', 'components/TaskCenter.vue'], '.task-pill', '移动端任务胶囊')
    const drawerZ = minZFrom(['components/Sidebar.vue'], '.sidebar.drawer-open', '抽屉打开态')

    // 最小可能取值（深度 0）就是基础值：它也必须高于两者，否则移动端抽屉会盖住弹窗
    expect(overlayZIndexAtDepth(0)).toBe(OVERLAY_BASE_Z_INDEX)
    expect(OVERLAY_BASE_Z_INDEX, `基础值必须高于 .task-pill(${pillZ})`).toBeGreaterThan(pillZ)
    expect(OVERLAY_BASE_Z_INDEX, `基础值必须高于抽屉打开态(${drawerZ})`).toBeGreaterThan(drawerZ)
    expect(
      OVERLAY_BASE_Z_INDEX + OVERLAY_MAX_DEPTH,
      `连"最浅的上一层"(${OVERLAY_BASE_Z_INDEX + 1}) 都要压过抽屉(${drawerZ})`,
    ).toBeGreaterThan(drawerZ)
  })

  it('来源一致性：JS 的基础值 / 上界与源码里的 `.overlay` 声明没有漂移', () => {
    const declarations = everyOverlayZDeclaration()
    expect(declarations.length, '至少要能解析出 Modal.vue 里那条 .overlay 基础层级').toBeGreaterThan(0)
    for (const { file, z } of declarations) {
      expect(
        z,
        `「${file}」里 .overlay 的 z-index(${z}) 与 overlayStack.js 的 OVERLAY_BASE_Z_INDEX(${OVERLAY_BASE_Z_INDEX}) 漂移了`,
      ).toBe(OVERLAY_BASE_Z_INDEX)
    }
    expect(
      declarations.map((entry) => entry.file),
      '基础层级的真实来源是 Modal.vue 的 scoped 样式（style.css 里只有一条打印用的 display:none）',
    ).toContain('components/Modal.vue')

    // 上界必须是"基础值 + 递增量"算出来的，而不是另写一个数
    expect(Number.isSafeInteger(OVERLAY_BASE_Z_INDEX), '基础值必须是整数').toBe(true)
    expect(OVERLAY_MAX_DEPTH, '递增量必须是正整数').toBeGreaterThan(0)
    expect(Number.isSafeInteger(OVERLAY_MAX_DEPTH)).toBe(true)
    expect(overlayZIndexAtDepth(OVERLAY_MAX_DEPTH)).toBe(OVERLAY_BASE_Z_INDEX + OVERLAY_MAX_DEPTH)

    // 上界也真的在最低的固定浮层之下（数值仍从源码解析）
    const sheetZ = minZFrom(
      ['components/ActionSheet.vue', 'components/AppearanceSettings.vue'],
      '.sheet-overlay',
      '底部操作面板',
    )
    expect(overlayZIndexAtDepth(1e6), '再深也要停在 .sheet-overlay 之下').toBeLessThan(sheetZ)
  })

  it('overlayZIndexFor：不在栈里返回 null（调用方据此摘掉内联值）', () => {
    const stray = { modalEl: { value: null }, active: false }
    expect(overlayZIndexFor(stray), '没入栈的浮层不该有层级，否则关闭后永远抬着').toBeNull()
  })
})