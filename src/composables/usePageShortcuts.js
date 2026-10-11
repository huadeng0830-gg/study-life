/**
 * 页面内单键快捷键。
 *
 * 【为什么要有这三条让路条件】缺任何一条，「在输入框里打一个 n 就弹出一个表单」就会发生：
 *   1. 焦点在输入区就完全不接管——单键快捷键和打字最容易打架的就是这一点；
 *   2. 任何浮层（弹窗 / 确认框 / 操作菜单）开着就让路，否则快捷键会穿透到背后的页面，
 *      在「删除确认框」按一下 `n` 反而弹出一个新增表单，是很糟的体验；
 *   3. 按住 Ctrl / Meta / Alt 时让路，那些是浏览器和系统的组合键，不该抢。
 *
 * 全局层面已经有 Ctrl+K（全局搜索）和 1-8（切换页面），调用方自己避开这些键。
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { overlayCount } from './overlayStack.js'

function isTypingTarget(target) {
  const element = /** @type {HTMLElement | null} */ (target)
  if (!element) return false
  if (element.isContentEditable) return true
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * @param {Record<string, (event: KeyboardEvent) => void>} handlers 按键 → 处理函数。
 *   键名不分大小写；处理函数返回 `true` 表示已处理，调用方据此 `preventDefault`。
 */
export function usePageShortcuts(handlers) {
  function onKeydown(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    if (isTypingTarget(event.target) || overlayCount() > 0) return
    const handler = handlers[event.key] || handlers[event.key.toLowerCase()]
    if (!handler) return
    if (handler(event) === false) return
    event.preventDefault()
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}