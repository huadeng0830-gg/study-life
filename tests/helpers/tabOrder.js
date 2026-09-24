/**
 * 渲染 DOM 级的 Tab 顺序与可访问名称判定（第二十六轮）。
 *
 * 放在 helpers：渲染类守卫会从多个测试文件复用（例如以后给弹窗加"焦点是否被留住"的守卫）。
 * 从测试文件里 import 会连带执行它的顶层代码、注册并运行它的用例，那是两个测试文件互相污染的写法。
 */

/** 算作"可交互"的标签：需要可访问名称，也不该被 tabindex="-1" 排除在 Tab 序之外。 */
export const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'])

/** 可聚焦元素的候选标签。注意是 `a[href]`：没有 href 的 `<a>` 根本进不了 Tab 序。 */
export const FOCUSABLE_SELECTOR = 'a[href], button, input, select, textarea, summary, [tabindex]'

/**
 * 计算可访问名称；取不到就返回空串。
 *
 * 顺序照可访问名称计算规范的主要来源排：
 * aria-label → aria-labelledby → 可见文本 → 后代 img 的 alt → title → 关联/包裹的 label → 提交类 input 的 value。
 * `aria-hidden` 的子树不算——它本来就不读给读屏。
 */
export function accessibleName(el) {
  const aria = el.getAttribute('aria-label')
  if (aria && aria.trim()) return aria.trim()

  const labelledby = el.getAttribute('aria-labelledby')
  if (labelledby && labelledby.trim()) {
    const text = labelledby
      .trim()
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim()
    if (text) return text
  }

  const text = textWithoutHidden(el)
  if (text) return text

  const img = el.querySelector?.('img[alt]')
  if (img && img.getAttribute('alt').trim()) return img.getAttribute('alt').trim()
  if (el.tagName === 'IMG' && el.getAttribute('alt')) return el.getAttribute('alt').trim()

  const title = el.getAttribute('title')
  if (title && title.trim()) return title.trim()

  if (el.id) {
    const label = el.ownerDocument.querySelector(`label[for="${el.id}"]`)
    if (label) {
      const labelText = textWithoutHidden(label)
      if (labelText) return labelText
    }
  }
  const wrapping = el.closest?.('label')
  if (wrapping) {
    const wrappingText = textWithoutHidden(wrapping)
    if (wrappingText) return wrappingText
  }
  if (el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(el.type)) {
    const value = (el.getAttribute('value') ?? '').trim()
    if (value) return value
  }
  return ''
}

/** 取可见文本（去掉 aria-hidden 子树），空白折叠。 */
function textWithoutHidden(el) {
  const clone = el.cloneNode(true)
  clone.querySelectorAll?.('[aria-hidden="true"]').forEach((node) => node.remove())
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * 取渲染后可聚焦的元素。
 *
 * @param {ParentNode} root
 * @param {(el: Element) => boolean} isVisible 可见性判定（复用 renderedHeadings 的那一个）
 */
export function focusableElements(root, isVisible) {
  return [...root.querySelectorAll(FOCUSABLE_SELECTOR)]
    .filter((el) => isVisible(el))
    .filter((el) => !el.hasAttribute('disabled'))
    .map((el) => ({
      el,
      tag: el.tagName,
      tabindex: el.hasAttribute('tabindex') ? Number(el.getAttribute('tabindex')) : null,
      tabbable: el.getAttribute('tabindex') !== '-1',
    }))
}

/**
 * 返回一页的问题列表（空数组表示合格）。
 *
 * @param {ReturnType<typeof focusableElements>} elements
 */
export function tabOrderIssues(elements) {
  const out = []
  for (const item of elements) {
    if (item.tabindex !== null && item.tabindex > 0) {
      out.push(`<${item.tag}> 带 tabindex="${item.tabindex}"：正数 tabindex 会插队到自然顺序之前`)
    }
    const interactive = INTERACTIVE_TAGS.has(item.tag) || (item.tabindex !== null && item.tabindex >= 0)
    if (!interactive) continue
    // `tabindex="-1"` 只在**可交互标签**上才是缺陷（键盘到不了）。
    // 非交互标签带 -1 是标准写法：跳过链接的落点（`<main tabindex="-1">`）、
    // 程序化聚焦的错误容器等，它们本来就不该出现在 Tab 序里。
    if (!item.tabbable && INTERACTIVE_TAGS.has(item.tag)) {
      // 例外：**roving tabindex 的复合控件**。ARIA 的标签页（以及其它"组内一个停靠点"
      // 的控件）本来就要求组里只有当前选中的那个留在 Tab 序列里，其余用方向键到达——
      // 所以组内成员带 -1 不是"到不了"，而是这一模式的正确形态（第三十轮加键盘模型时踩到）。
      // 但要保住这条规则的本意，豁免必须带上一个**硬前提**：
      // 组里得真的留了至少一个 Tab 停靠点。整组都是 -1 才是"键盘用户到不了"的真陷阱。
      const group = item.el.closest('[role="tablist"]')
      if (group && item.el.getAttribute('role') === 'tab') {
        const hasStop = [...group.querySelectorAll('[role="tab"]')].some((tab) => tab.tabIndex >= 0)
        if (hasStop) continue
        out.push(`<${item.tag}${describe(item.el)}> 所在的 tablist 整组都不在 Tab 序列里：键盘用户到不了这组标签页`)
        continue
      }
      out.push(`可交互的 <${item.tag}${describe(item.el)}> 带 tabindex="-1"：键盘用户 Tab 不到它`)
      continue
    }
    if (!accessibleName(item.el)) out.push(`<${item.tag}${describe(item.el)}> 没有可访问名称`)
  }
  return out
}

/** 短描述，用于失败信息里定位元素。 */
export function describe(el) {
  const id = el.id ? `#${el.id}` : ''
  const cls = typeof el.className === 'string' && el.className.trim()
    ? `.${el.className.trim().split(/\s+/).join('.')}`
    : ''
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 20)
  return `${id}${cls}${text ? `「${text}」` : ''}`
}

/** 找出同一棵子树里重复出现的 id（重复 id 会让 label/aria-labelledby 指向错误的元素）。 */
export function duplicateIds(root = document) {
  const seen = new Map()
  for (const el of root.querySelectorAll('[id]')) {
    const id = el.getAttribute('id')
    if (!id) continue
    seen.set(id, (seen.get(id) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id)
}

/**
 * 找出标签页面板与它的 tab 之间**断掉的**引用（第二十七轮）。
 *
 * 本轮的补齐只加了属性，所以最该验证的就是"这些引用真的解析得到"：
 *   - `role="tabpanel"` 必须带 `aria-labelledby`；
 *   - 它指向的元素必须存在；
 *   - 必须确实是 `role="tab"`；
 *   - 而且必须是**当前选中**的那个 tab（`aria-selected="true"`）。
 *
 * 为什么不做成"每个 tab 都必须有面板"：`role="tab"` 在仓库里也被用在筛选控件上，
 * 那些控件没有面板可指——这部分欠账由 `tests/tabPanelSemantics.test.js`
 * 的文件清单显式记录（只减不增），不在这里假装检查。
 */
export function tabPanelRefIssues(root = document) {
  const out = []
  for (const panel of root.querySelectorAll('[role="tabpanel"]')) {
    const ref = panel.getAttribute('aria-labelledby')
    const label = panel.className ? `「${String(panel.className).split(/\s+/)[0]}」` : ''
    if (!ref || !ref.trim()) {
      out.push(`tabpanel${label} 没有 aria-labelledby，读屏念不出这块面板叫什么`)
      continue
    }
    const target = panel.ownerDocument.getElementById(ref.trim())
    if (!target) {
      out.push(`tabpanel${label} 的 aria-labelledby="${ref}" 指向了不存在的元素`)
      continue
    }
    if (!target.matches('[role="tab"]')) {
      out.push(`tabpanel${label} 的 aria-labelledby="${ref}" 指向的不是 tab`)
      continue
    }
    if (target.getAttribute('aria-selected') !== 'true') {
      out.push(`tabpanel${label} 的 aria-labelledby="${ref}" 指向的 tab 不是当前选中项`)
    }
  }
  return out
}

/**
 * 表示"这一项当前被选中"的 class 名。
 * 用 `(?:^|\s)…(?:\s|$)` 卡边界，所以 `router-link-active` 这类复合名**不会**被误判成选中态。
 */
const SELECTED_CLASS = /(?:^|\s)(?:on|active|selected|checked|current)(?:\s|$)/

/** 能表达"选中"的 ARIA 属性。 */
const SELECTED_ARIA = ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current']

/**
 * 找出"选中态只存在于视觉里"的按钮。
 *
 * 起因是一个真实缺陷：侧栏的 6 个主题色按钮用 `:class="{ on: themeKey === key }"`
 * 标记当前主题，却没有任何 ARIA 属性——读屏用户听不出现在选的是哪一个
 * （WCAG 4.1.2，名称/角色/**值**）。而**同一个功能**在个性化设置面板里
 * 是用 `:aria-pressed` 暴露的，所以这同时是"仓库内部不一致"。
 *
 * 判据（三条同时成立）：
 *   1. 是 `<button>`（`<a>` 排除在外：导航链接的 `active` 由 `aria-current` 表达，
 *      那是另一套语义，不该按这条规则要求 `aria-pressed`）；
 *   2. 位于 `role="group"` / `radiogroup` / `tablist` 这类**成组可选项**容器内；
 *   3. 带 SELECTED_CLASS 里的选中态 class，但没有 SELECTED_ARIA 里的任何一个。
 *
 * 【边界】判定靠 class 名（`on` / `active` / `selected` …），这是约定俗成但非强制；
 * 若某处用别的 class 名标记选中且不暴露 ARIA，本规则看不到。这条守卫的价值在于
 * 覆盖仓库自己的命名习惯，不能声称覆盖所有情况。
 */
export function selectionStateIssues(root = document) {
  const out = []
  for (const group of root.querySelectorAll('[role="group"], [role="radiogroup"], [role="tablist"]')) {
    const groupName = group.getAttribute('aria-label') || group.className || '(无名分组)'
    for (const button of group.querySelectorAll('button')) {
      const classes = button.getAttribute('class') || ''
      if (!SELECTED_CLASS.test(classes)) continue
      if (SELECTED_ARIA.some((attr) => button.hasAttribute(attr))) continue
      out.push(`「${groupName}」里的按钮用 class 标记了选中态却没有 ARIA：「${(button.textContent ?? '').trim().slice(0, 12) || button.getAttribute('aria-label') || button.getAttribute('title') || '(无文本)'}」`)
    }
  }
  return out
}