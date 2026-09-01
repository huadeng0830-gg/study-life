import { computed, watchEffect } from 'vue'
import { useStoredRef } from './store'

// auto 根据设备和用户的“减少动态效果”偏好降级；用户也可以强制开启或关闭。
export const performanceMode = useStoredRef('sl_performance_mode', 'auto')

export function normalizePerformanceMode(value) {
  if (value === 'low') return 'on'
  if (value === 'high') return 'off'
  return ['auto', 'on', 'off'].includes(value) ? value : 'auto'
}

const normalizedInitialMode = normalizePerformanceMode(performanceMode.value)
if (performanceMode.value !== normalizedInitialMode) performanceMode.value = normalizedInitialMode

export function isIOSDevice() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  // iPadOS 13+ 常伪装为 Mac；触摸点可与普通 macOS 区分。
  return /iPad|iPhone|iPod/i.test(ua)
    || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1)
}

function deviceNeedsReducedEffects() {
  if (typeof window === 'undefined') return false
  const memory = Number(navigator.deviceMemory)
  const cores = Number(navigator.hardwareConcurrency)
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  // Safari 对全屏滤镜、半透明层和保留多个复杂页面的内存回收较保守。
  // iOS 的“自动”模式始终优先流畅；用户仍可在个性化中手动选择“完整效果”。
  return isIOSDevice()
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
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
