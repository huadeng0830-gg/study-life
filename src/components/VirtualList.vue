<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { animationsEnabled } from '../composables/motion.js'

const props = defineProps({
  items: { type: Array, required: true },
  itemKey: { type: [String, Function], default: 'id' },
  estimatedHeight: { type: Number, default: 84 },
  gap: { type: Number, default: 10 },
  overscan: { type: Number, default: 6 },
  threshold: { 
    type: Number, 
    default: () => typeof window !== 'undefined' ? Math.max(20, Math.floor(window.innerHeight / 60)) : 40 
  },
  fixedHeight: { type: Boolean, default: false },
  // Optional view-only size resolver. It keeps grouped projections accurate
  // without requiring a ResizeObserver for every recycled row.
  itemHeight: { type: [Number, Function], default: null },
  revealKey: { type: [String, Number], default: '' },
  revealBehavior: { type: String, default: 'smooth' },
  revealNonVirtual: { type: Boolean, default: false },
})

const root = ref(null)
const scrollTop = ref(0)
const viewportHeight = ref(800)
const listTop = ref(0)
const measuredHeight = ref(props.estimatedHeight)
let frame = 0
let resizeObserver = null
let active = false

const virtual = computed(() => props.items.length > props.threshold)
const step = computed(() => Math.max(1, measuredHeight.value + props.gap))
const windowSize = computed(() => Math.ceil(viewportHeight.value / step.value) + props.overscan * 2)
const hasItemHeights = computed(() => typeof props.itemHeight === 'function' || Number.isFinite(Number(props.itemHeight)))

function resolveItemHeight(item, index) {
  const candidate = typeof props.itemHeight === 'function'
    ? props.itemHeight(item, index)
    : props.itemHeight
  const height = Number(candidate)
  return Number.isFinite(height) && height > 0 ? height : Math.max(1, measuredHeight.value)
}

const metrics = computed(() => {
  if (!hasItemHeights.value) return null
  const offsets = new Array(props.items.length + 1)
  const heights = new Array(props.items.length)
  let total = 0
  offsets[0] = 0
  for (let index = 0; index < props.items.length; index += 1) {
    const height = resolveItemHeight(props.items[index], index)
    heights[index] = height
    total += height
    if (index < props.items.length - 1) total += props.gap
    offsets[index + 1] = total
  }
  return { offsets, heights, total }
})

function upperBound(values, target) {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (values[middle] <= target) low = middle + 1
    else high = middle
  }
  return low
}

function itemIndexAtOffset(offset) {
  const current = metrics.value
  if (!current || !props.items.length) return 0
  return Math.min(props.items.length - 1, Math.max(0, upperBound(current.offsets, Math.max(0, offset)) - 1))
}

const start = computed(() => {
  if (!virtual.value) return 0
  if (metrics.value) {
    const relative = Math.max(0, scrollTop.value - listTop.value)
    return Math.max(0, itemIndexAtOffset(relative) - props.overscan)
  }
  const raw = Math.max(0, Math.floor((scrollTop.value - listTop.value) / step.value) - props.overscan)
  return Math.min(raw, Math.max(0, props.items.length - windowSize.value))
})
const end = computed(() => {
  if (!virtual.value) return props.items.length
  if (metrics.value) {
    const relative = Math.max(0, scrollTop.value - listTop.value)
    const visibleEnd = relative + viewportHeight.value
    const visibleEndIndex = Math.max(1, upperBound(metrics.value.offsets, Math.max(0, visibleEnd - 0.000001)))
    return Math.min(props.items.length, Math.max(start.value + 1, visibleEndIndex + props.overscan))
  }
  return Math.min(props.items.length, start.value + windowSize.value)
})
const visibleItems = computed(() => props.items.slice(start.value, end.value))
const topSpace = computed(() => {
  if (!virtual.value) return 0
  return metrics.value ? metrics.value.offsets[start.value] : start.value * step.value
})
const bottomSpace = computed(() => {
  if (!virtual.value) return 0
  return metrics.value
    ? Math.max(0, metrics.value.total - metrics.value.offsets[end.value])
    : Math.max(0, (props.items.length - end.value) * step.value)
})

function keyFor(item, index) {
  if (typeof props.itemKey === 'function') return props.itemKey(item, index)
  return item?.[props.itemKey] ?? start.value + index
}

function scrollToIndex(index, behavior = props.revealBehavior) {
  if (!props.items.length || typeof window === 'undefined' || typeof window.scrollTo !== 'function') return
  const safeIndex = Math.min(props.items.length - 1, Math.max(0, Number(index) || 0))
  const offset = metrics.value ? metrics.value.offsets[safeIndex] : safeIndex * step.value
  const height = metrics.value ? metrics.value.heights[safeIndex] : measuredHeight.value
  const targetTop = listTop.value + offset
  const nextTop = Math.max(0, targetTop - viewportHeight.value / 2 + height / 2)
  // 平滑滚动是 JS 发起的动画，不受 CSS 的 prefers-reduced-motion 降级规则约束，
  // 因此必须自己问一次 animationsEnabled()，否则「流畅优先」用户仍会看到长距离滚动动画。
  window.scrollTo({ top: nextTop, behavior: behavior === 'smooth' && !animationsEnabled() ? 'auto' : behavior })
  scheduleMeasure()
}

function scrollToKey(key, behavior = props.revealBehavior) {
  const target = String(key ?? '').trim()
  if (!target) return
  const index = props.items.findIndex((item, itemIndex) => String(keyFor(item, itemIndex)) === target)
  if (index >= 0) scrollToIndex(index, behavior)
}

function revealItem() {
  if (!active) return
  const target = String(props.revealKey ?? '').trim()
  if (!target || (!virtual.value && !props.revealNonVirtual)) return
  const index = props.items.findIndex((item, itemIndex) => String(keyFor(item, itemIndex)) === target)
  if (index < 0) return
  scrollToIndex(index)
}

function measure() {
  if (!root.value) return
  const rect = root.value.getBoundingClientRect()
  // 只有按估算高度自适应时才需要采样真实行高；已提供固定高度或精确行高
  // 函数时跳过 DOM 遍历与二次测量，避免滚动过程中每帧都触发布局读取。
  if (!props.fixedHeight && typeof props.itemHeight !== 'function') {
    const sample = root.value.querySelector?.(':scope > :not(.virtual-spacer)')
    const sampleHeight = sample?.getBoundingClientRect?.().height
    // 只在明显变化时更新。行高变了会改变 topSpace、进而改变根节点的位置，
    // 而根节点正被 ResizeObserver 观察 —— 1px 级的抖动会让
    // 「改高度 → 位置变 → 重新测量 → 再改高度」形成回环，表现为滚动时行高抖动。
    // 4px 的滞回足以滤掉次像素与字体加载带来的微小差异。
    if (sampleHeight > 0 && Math.abs(sampleHeight - measuredHeight.value) > 4) {
      measuredHeight.value = sampleHeight
    }
  }
  scrollTop.value = window.scrollY || document.documentElement.scrollTop || 0
  viewportHeight.value = window.innerHeight || document.documentElement.clientHeight || 800
  listTop.value = rect.top + scrollTop.value
}

function scheduleMeasure() {
  if (!active || frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (!active) return
    measure()
  })
}

watch(() => props.items.length, () => nextTick(() => {
  if (!active) return
  measure()
  revealItem()
}))
watch(() => props.revealKey, () => nextTick(revealItem))

function attachObservers() {
  if (active) return
  active = true
  measure()
  window.addEventListener('scroll', scheduleMeasure, { passive: true })
  window.addEventListener('resize', scheduleMeasure, { passive: true })
  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(scheduleMeasure)
    resizeObserver.observe(root.value)
  }
}

function detachObservers() {
  if (!active) return
  active = false
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('scroll', scheduleMeasure)
  window.removeEventListener('resize', scheduleMeasure)
}

onMounted(attachObservers)
onActivated(attachObservers)
onDeactivated(detachObservers)
onBeforeUnmount(detachObservers)

defineExpose({ scrollToIndex, scrollToKey })
</script>

<template>
  <div ref="root" class="virtual-list" :data-virtual="virtual ? 'on' : 'off'">
    <div v-if="topSpace" class="virtual-spacer" :style="{ height: `${topSpace}px` }" aria-hidden="true"></div>
    <template v-for="(item, index) in visibleItems" :key="keyFor(item, index)">
      <slot :item="item" :index="start + index"></slot>
    </template>
    <div v-if="bottomSpace" class="virtual-spacer" :style="{ height: `${bottomSpace}px` }" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
.virtual-list {
  min-width: 0;
  /* 阻止浏览器滚动锚定与虚拟列表的占位高度调整互相拉扯，消除快速滚动抖动。 */
  overflow-anchor: none;
}
.virtual-spacer { flex: 0 0 auto; width: 100%; pointer-events: none; }
</style>
