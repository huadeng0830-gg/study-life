import { computed, watchEffect } from 'vue'
import { useStoredRef } from './store.js'

// auto 根据设备和用户的“减少动态效果”偏好降级；用户也可以强制开启或关闭。
export const performanceMode = useStoredRef('sl_performance_mode', 'auto')

function deviceNeedsReducedEffects() {
  if (typeof window === 'undefined') return false
  const memory = Number(navigator.deviceMemory)
  const cores = Number(navigator.hardwareConcurrency)
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    || (Number.isFinite(memory) && memory <= 4)
    || (Number.isFinite(cores) && cores <= 4)
    || Boolean(connection?.saveData)
}

export const reducedEffects = computed(() =>
  performanceMode.value === 'on'
  || (performanceMode.value === 'auto' && deviceNeedsReducedEffects())
)

// 统一提供 CSS 开关，避免每个页面各自判断设备能力。
watchEffect(() => {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.performance = reducedEffects.value ? 'reduced' : 'full'
})
