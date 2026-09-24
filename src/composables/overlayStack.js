/**
 * 浮层共享基础设施：遮罩栈、页面滚动锁、焦点陷阱。
 *
 * Modal 与 ActionSheet 等所有覆盖层共用同一套栈，原因是嵌套场景：
 * 个性化弹窗里再弹出操作菜单时，Escape 只能关掉最上面那一层，
 * 滚动锁也只能在最后一层关闭后才解除。各自维护一份栈会互相抢焦点。
 *
 * 这个栈同时是**层叠顺序的唯一依据**：`Modal` 按每个浮层在栈里的当前位置写内联
 * z-index（见下面的 overlayZIndexFor），所以"谁在上层"由**打开顺序**决定，
 * 而不是由 Teleport 锚点的**挂载时机**决定。
 */

import { ref } from 'vue'

const stack = []

/**
 * 栈版本号：每次入栈/出栈 +1。
 *
 * 存在的唯一理由是让 Vue 侧重算内联 z-index：栈本身是普通数组（不参与响应式），
 * 而"谁在上层"必须随栈变动实时更新——不只是新开的浮层要按当前深度取值，
 * **下面**的浮层关闭后，上面那些的深度会整体 -1，留在原地的必须跟着回落，
 * 否则会留下永久抬高的层（见 Modal.vue 的 overlayStyle）。
 */
export const overlayStackRevision = ref(0)

/**
 * 浮层基础层级与最大递增量。
 *
 * 【为什么上界是 9】`.overlay` 的固定层级是 100，而它上面还压着几档固定浮层：
 * `.sheet-overlay` 110（ActionSheet / 外观设置的底部面板）、`.context-menu` 130、
 * App.vue 的同步告警 240+。按深度递增必须**停在这些之下**，所以递增量有硬上界，
 * 9 让最大取值停在 109：无论同时开多少层，都不可能越过 110 去盖住底部面板与右键菜单。
 * （110/130/240 这几个数字由 tests/modalStackOrder.test.js 从源码解析后断言，
 * 这里不抄写它们，避免两处各写一个数。）
 */
export const OVERLAY_BASE_Z_INDEX = 100
export const OVERLAY_MAX_DEPTH = 9

/** 给定栈深度算内联 z-index（纯函数；超深时夹在上界，不会继续往上爬）。 */
export function overlayZIndexAtDepth(depth) {
  const level = Math.max(0, Math.trunc(Number(depth) || 0))
  return OVERLAY_BASE_Z_INDEX + Math.min(level, OVERLAY_MAX_DEPTH)
}

/**
 * 某条浮层此刻应当写在**内联** style 上的 z-index。
 *
 * 按它在共享栈里的**当前位置**算，而不是按挂载时机：Teleport 的锚点在组件**挂载时**
 * 创建，所以"随页面常驻"的浮层（只有 `:open`、没有 `v-if`）在 body 里永远排在
 * "打开时才建锚点"的浮层之前；只靠 DOM 顺序就会出现"眼睛看到的在上面，
 * Escape 与读屏（isTopOverlay）却认为另一个在最上层"——用户点不到本该显示的那颗按钮，
 * 而且不报错（UX_AUDIT_176_REPORT.md §4 第 26 条 / §1.74）。
 *
 * @returns {number|null} 不在栈里（已关闭）返回 null，调用方据此**摘掉**内联值，
 *   不留永久抬高的层；重新打开时再按当时的深度重算。
 */
export function overlayZIndexFor(entry) {
  const index = stack.indexOf(entry)
  return index < 0 ? null : overlayZIndexAtDepth(index)
}

export function pushOverlay(entry) {
  stack.push(entry)
  overlayStackRevision.value += 1
}

export function removeOverlay(entry) {
  const index = stack.indexOf(entry)
  if (index >= 0) {
    stack.splice(index, 1)
    overlayStackRevision.value += 1
  }
}

export function isTopOverlay(entry) {
  return stack.length > 0 && stack[stack.length - 1] === entry
}

export function topOverlay() {
  return stack[stack.length - 1] || null
}

export function overlayCount() {
  return stack.length
}

/**
 * 每个覆盖层实例持有一个锁。计数写在 body.dataset.modalLockCount，
 * 多层叠加时只有最后一层关闭才恢复滚动。
 *
 * 进入锁之前 body 的内联 overflow 只记录一次（第一层锁时），
 * 由最后一层解锁时写回。这样嵌套弹窗无论以什么顺序关闭，
 * 都不会把「锁之前就存在的内联值」抹成空字符串。
 */
let savedBodyOverflow = ''

export function createScrollLock() {
  let locked = false
  return {
    lock() {
      if (locked || typeof document === 'undefined') return
      locked = true
      const count = Number(document.body.dataset.modalLockCount) || 0
      if (count === 0) savedBodyOverflow = document.body.style.overflow
      document.body.dataset.modalLockCount = String(count + 1)
      document.body.dataset.modalOpen = 'true'
      document.body.style.overflow = 'hidden'
    },
    unlock() {
      if (!locked || typeof document === 'undefined') return
      locked = false
      const nextCount = Math.max(0, (Number(document.body.dataset.modalLockCount) || 1) - 1)
      if (nextCount > 0) {
        document.body.dataset.modalLockCount = String(nextCount)
        return
      }
      delete document.body.dataset.modalLockCount
      delete document.body.dataset.modalOpen
      document.body.style.overflow = savedBodyOverflow || ''
      savedBodyOverflow = ''
    },
  }
}

export const FOCUSABLE_SELECTOR = 'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, object, embed, [contenteditable="true"], [tabindex]:not([tabindex="-1"])'

/** 容器内当前可见、可聚焦的元素（跳过 hidden / display:none / visibility:hidden）。 */
export function focusableWithin(root) {
  return [...(root?.querySelectorAll(FOCUSABLE_SELECTOR) || [])].filter((element) => {
    if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return false
    // checkVisibility 让浏览器在样式树里自己判断，不必为每个候选元素强制一次
    // 样式计算——弹窗里控件一多，原来每次 Tab 都要把全部候选算一遍。
    if (typeof element.checkVisibility === 'function') {
      try {
        return element.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })
      } catch {
        // 旧实现不接受参数或参数名不同，落到下面的回退分支。
      }
    }
    const style = window.getComputedStyle?.(element)
    return !style || (style.display !== 'none' && style.visibility !== 'hidden')
  })
}

/** 首次聚焦目标：[autofocus] 优先，其次第一个可聚焦元素，最后容器本身。 */
export function initialFocusTarget(root) {
  return root?.querySelector('[autofocus]') || focusableWithin(root)[0] || root
}

/**
 * 处理 Tab / Shift+Tab 的焦点循环。命中边界时把焦点绕回另一端。
 * @returns {boolean} 是否已经处理该按键
 */
export function trapTabKey(event, root) {
  if (event.key !== 'Tab') return false
  const elements = focusableWithin(root)
  if (!elements.length) {
    event.preventDefault()
    root?.focus?.()
    return true
  }
  const first = elements[0]
  const last = elements[elements.length - 1]
  const active = document.activeElement
  const outside = !root?.contains(active)
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault()
    last.focus()
    return true
  }
  if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault()
    first.focus()
    return true
  }
  return false
}