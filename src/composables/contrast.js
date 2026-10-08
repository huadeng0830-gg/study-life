import { watchEffect } from 'vue'
import { useStoredRef } from './store/core.js'

/**
 * 高对比度模式。
 *
 * CSS 侧的落点是 style.css 的 `:root[data-contrast='high']`（以及深色变体）。
 * 系统级的 `prefers-contrast: more` 由 CSS 单独处理，不经过这里 —— 两条路互不干扰：
 * 系统开了就生效，应用内也开了同样生效，显式关掉（data-contrast='normal'）才压制系统设置。
 *
 * 刻意不复用 `sl_appearance`：那个键会被整对象比对与归一化写回，
 * 而备份恢复测试断言它保持原样；这里单独用一个键，语义更清楚，也不会牵连归一化逻辑。
 */
export const highContrast = useStoredRef('sl_high_contrast', false)

/** 把开关写进根节点；显式关闭时写 normal，用于压制系统的 prefers-contrast: more。 */
export function applyHighContrast(value) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (value === 'high') root.dataset.contrast = 'high'
  else if (value === 'normal') root.dataset.contrast = 'normal'
  else delete root.dataset.contrast
}

watchEffect(() => {
  applyHighContrast(highContrast.value ? 'high' : 'auto')
})