import { onBeforeUnmount, watch } from 'vue'

/**
 * 「就地弹出的浮层」的关闭规则：点外部关、Esc 关。
 *
 * 这个模式此前只有触发按钮上的一次 toggle——点别处不动、Esc 也没用。
 * 在快速记录里更糟：Esc 一路冒到 Modal 的 document 级监听，把整个面板关掉，
 * 连用户填好、正准备挑分类的那张草稿一起丢掉。
 *
 * 监听挂在 **capture** 阶段：Esc 先被这里处理并 stopPropagation，
 * Modal（冒泡阶段）就收不到了，于是 Esc 只关浮层、不关整个面板。
 *
 * @param {import('vue').Ref<string|number|null>} openId 打开中的浮层 id，空值表示已关闭
 * @param {{ selector: string }} options selector 为「属于这个浮层内部」的元素，命中则不关闭
 */
export function useDismissableLayer(openId, { selector }) {
  function dismiss(event) {
    if (!openId.value) return
    if (event.type === 'keydown') {
      if (event.key !== 'Escape') return
      // 只拦 Esc：其余按键必须照常冒泡，否则输入框里打字会被吞掉。
      event.stopPropagation()
      openId.value = null
      return
    }
    const target = event.target
    const element = target && typeof target.closest === 'function' ? target : null
    if (element?.closest(selector)) return
    openId.value = null
  }

  const listeners = ['pointerdown', 'keydown']
  function attach() {
    for (const type of listeners) document.addEventListener(type, dismiss, true)
  }
  function detach() {
    for (const type of listeners) document.removeEventListener(type, dismiss, true)
  }

  // 只在浮层打开期间挂监听：关着的时候监听器只会白白占用事件分发。
  watch(openId, (id) => { if (id) attach(); else detach() })
  onBeforeUnmount(detach)
}