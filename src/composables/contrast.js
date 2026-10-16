import { watchEffect } from 'vue'
import { useStoredRef } from './store/core.js'

/**
 * 高对比度模式。
 *
 * CSS 侧的落点是 style.css 的 `:root[data-contrast='high']`（以及深色变体）。
 * 系统级的 `prefers-contrast: more` 由 CSS 单独处理，不经过这里 —— 两条路互不干扰：
 * 系统开了就生效，应用内也开了同样生效。
 *
 * 【第三态为什么不做】`applyHighContrast` 支持 `normal`（显式压制系统设置），
 * 但界面只暴露「跟随系统 / 始终开启」两态。做成三态需要把 `sl_high_contrast`
 * 从布尔改成字符串，而它是**进备份与账号同步**的键：backupArchive 会强制校验
 * `typeof === 'boolean'`，旧设备拿到 `'normal'` 会被 `Boolean('normal')` 读成 `true`，
 * 结果反而**开启**高对比。跨设备回归风险大于收益，所以本轮只做两态；
 * 真要三态，应另起一个独立键，而不是改这个同步键的类型。
 *
 * 刻意不复用 `sl_appearance`：那个键会被整对象比对与归一化写回，
 * 而备份恢复测试断言它保持原样；这里单独用一个键，语义更清楚，也不会牵连归一化逻辑。
 */
export const highContrast = useStoredRef('sl_high_contrast', false)

/** 把开关写进根节点。`normal`（压制系统设置）当前没有界面入口，理由见文件头注释。 */
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