import { ref } from 'vue'

/**
 * 全局搜索面板的开合状态。
 *
 * 【为什么放在模块里，而不是 App 的 props/emit 里】
 * 面板本身由 `Sidebar.vue` 拥有：它负责懒加载（`defineAsyncComponent`）与悬停/聚焦时预热。
 * 而打开它的**快捷键**属于 `App.vue` 的全局 keydown——仓库自己的约定写在
 * Sidebar 的注释里：「App 的全局 keydown 只管 Ctrl+K 与数字快捷键」。
 * 两边各占一半，于是用一个模块级 ref 共享，避免为了一个布尔值在组件之间拉一整套管道。
 * `composables/liveRegion.js` 的 `liveMessage` / `liveAlert` 已经是同一个模式。
 */
export const searchOpen = ref(false)

export function openSearch() {
  searchOpen.value = true
}

export function closeSearch() {
  searchOpen.value = false
}