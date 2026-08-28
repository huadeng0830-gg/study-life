<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  items: { type: Array, required: true },
  itemKey: { type: [String, Function], default: 'id' },
  estimatedHeight: { type: Number, default: 84 },
  gap: { type: Number, default: 10 },
  overscan: { type: Number, default: 6 },
  threshold: { type: Number, default: 40 },
  fixedHeight: { type: Boolean, default: false },
})

const root = ref(null)
const scrollTop = ref(0)
const viewportHeight = ref(800)
const listTop = ref(0)
const measuredHeight = ref(props.estimatedHeight)
let frame = 0
let resizeObserver = null

const virtual = computed(() => props.items.length > props.threshold)
const step = computed(() => Math.max(1, measuredHeight.value + props.gap))
const windowSize = computed(() => Math.ceil(viewportHeight.value / step.value) + props.overscan * 2)
const start = computed(() => {
  if (!virtual.value) return 0
  const raw = Math.max(0, Math.floor((scrollTop.value - listTop.value) / step.value) - props.overscan)
  return Math.min(raw, Math.max(0, props.items.length - windowSize.value))
})
const end = computed(() => {
  if (!virtual.value) return props.items.length
  return Math.min(props.items.length, start.value + windowSize.value)
})
const visibleItems = computed(() => props.items.slice(start.value, end.value))
const topSpace = computed(() => virtual.value ? start.value * step.value : 0)
const bottomSpace = computed(() => virtual.value ? Math.max(0, (props.items.length - end.value) * step.value) : 0)

function keyFor(item, index) {
  if (typeof props.itemKey === 'function') return props.itemKey(item, index)
  return item?.[props.itemKey] ?? start.value + index
}

function measure() {
  if (!root.value) return
  const rect = root.value.getBoundingClientRect()
  const sample = [...root.value.children].find((element) => !element.classList.contains('virtual-spacer'))
  const sampleHeight = sample?.getBoundingClientRect().height
  if (!props.fixedHeight && sampleHeight > 0) measuredHeight.value = sampleHeight
  scrollTop.value = window.scrollY || document.documentElement.scrollTop || 0
  viewportHeight.value = window.innerHeight || document.documentElement.clientHeight || 800
  listTop.value = rect.top + scrollTop.value
}

function scheduleMeasure() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    measure()
  })
}

watch(() => props.items.length, () => nextTick(measure))

onMounted(() => {
  measure()
  window.addEventListener('scroll', scheduleMeasure, { passive: true })
  window.addEventListener('resize', scheduleMeasure, { passive: true })
  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(scheduleMeasure)
    resizeObserver.observe(root.value)
  }
})

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
  resizeObserver?.disconnect()
  window.removeEventListener('scroll', scheduleMeasure)
  window.removeEventListener('resize', scheduleMeasure)
})
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
.virtual-list { min-width: 0; }
.virtual-spacer { flex: 0 0 auto; width: 100%; pointer-events: none; }
</style>
