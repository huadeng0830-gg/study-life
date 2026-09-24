<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { animationsEnabled } from '../composables/motion.js'
import {
  WHEEL_ITEM_HEIGHT,
  WHEEL_VISIBLE_ROWS,
  wheelIndexForValue,
  wheelIndexFromScrollTop,
  wheelPadding,
  wheelScrollTopForIndex,
  wheelValueAtIndex,
} from '../composables/wheelPicker.js'

/**
 * 单列滚轮。
 *
 * 中间一行表示选中：靠 CSS scroll-snap 让松手后自动吸附到格子上，
 * 再用一次性定时器在滚动停止后做一次精确对齐并回传选中的值。
 * 定时器只在滚动期间存在，不会常驻。
 */

const SETTLE_DELAY = 130

const props = defineProps({
  values: { type: Array, required: true },
  modelValue: { type: Number, default: 0 },
  itemHeight: { type: Number, default: WHEEL_ITEM_HEIGHT },
  visibleRows: { type: Number, default: WHEEL_VISIBLE_ROWS },
  label: { type: String, default: '' },
  format: { type: Function, default: null },
})

const emit = defineEmits(['update:modelValue'])

const columnEl = ref(null)
let settleTimer = 0

const padding = computed(() => wheelPadding(props.itemHeight, props.visibleRows))
const columnHeight = computed(() => Math.max(1, props.itemHeight) * Math.max(1, props.visibleRows))
const currentIndex = computed(() => wheelIndexForValue(props.values, props.modelValue))

function textOf(value) {
  return props.format ? props.format(value) : String(value)
}

function scrollToIndex(index, behavior = 'auto') {
  const element = columnEl.value
  if (!element) return
  const top = wheelScrollTopForIndex(index, props.values, props.itemHeight)
  // 这是全组件唯一的程序化滚动入口，所以门控放在这里——4 个调用点（松手吸附、上下翻一格等）
  // 一次性都被覆盖，不用逐个改。显式传 'smooth' 会覆盖 CSS 的 scroll-behavior，
  // 所以 style.css 里那条 prefers-reduced-motion 降级规则管不到它（同一原理见 motion.js 文件头）。
  // 滚轮整列滚动的视觉位移最大，是前庭敏感用户最需要它停下的一处。
  const safeBehavior = behavior === 'smooth' && !animationsEnabled() ? 'auto' : behavior
  if (typeof element.scrollTo === 'function') element.scrollTo({ top, behavior: safeBehavior })
  else element.scrollTop = top
}

function settle() {
  const element = columnEl.value
  if (!element) return
  const index = wheelIndexFromScrollTop(element.scrollTop, props.values, props.itemHeight)
  const value = wheelValueAtIndex(props.values, index)
  if (value !== props.modelValue) emit('update:modelValue', value)
  // 即使 scroll-snap 已经吸附，也再对齐一次，保证落在整格位置上
  const target = wheelScrollTopForIndex(index, props.values, props.itemHeight)
  if (Math.abs(Number(element.scrollTop) - target) > 0.5) scrollToIndex(index, 'smooth')
}

function onScroll() {
  window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(settle, SETTLE_DELAY)
}

function moveBy(step) {
  const count = props.values.length
  if (!count) return
  const next = Math.min(count - 1, Math.max(0, currentIndex.value + step))
  emit('update:modelValue', wheelValueAtIndex(props.values, next))
  scrollToIndex(next, 'smooth')
}

function onKeydown(event) {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    moveBy(event.key === 'ArrowUp' ? -1 : 1)
    return
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : props.values.length - 1
    emit('update:modelValue', wheelValueAtIndex(props.values, next))
    scrollToIndex(next, 'smooth')
  }
}

// 外部换值（例如换了一个日程）时把滚轮拨到对应格子，
// 但如果当前已经停在该格上就不要动，避免和用户的手势打架。
watch(() => props.modelValue, () => {
  const element = columnEl.value
  if (!element) return
  if (wheelIndexFromScrollTop(element.scrollTop, props.values, props.itemHeight) === currentIndex.value) return
  scrollToIndex(currentIndex.value, 'smooth')
})

onMounted(() => scrollToIndex(currentIndex.value, 'auto'))
onBeforeUnmount(() => window.clearTimeout(settleTimer))
</script>

<template>
  <div class="wheel" :style="{ height: `${columnHeight}px` }">
    <div class="wheel-band" :style="{ height: `${itemHeight}px` }" aria-hidden="true"></div>
    <div
      ref="columnEl"
      class="wheel-column"
      role="listbox"
      tabindex="0"
      :aria-label="label || '滚轮选择'"
      :style="{ paddingTop: `${padding}px`, paddingBottom: `${padding}px` }"
      @scroll.passive="onScroll"
      @keydown="onKeydown"
    >
      <div
        v-for="value in values"
        :key="value"
        class="wheel-item"
        role="option"
        :aria-selected="value === modelValue"
        :class="{ on: value === modelValue }"
        :style="{ height: `${itemHeight}px` }"
      >{{ textOf(value) }}</div>
    </div>
  </div>
</template>

<style scoped>
.wheel {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.wheel-band {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  transform: translateY(-50%);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  border-radius: var(--radius-8);
  background: var(--primary-soft);
  pointer-events: none;
}
.wheel-column {
  position: relative;
  height: 100%;
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  outline: none;
  /* 上下淡出，形成滚轮的纵深 */
  mask-image: linear-gradient(to bottom, transparent, #000 22%, #000 78%, transparent);
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 22%, #000 78%, transparent);
}
.wheel-column::-webkit-scrollbar {
  display: none;
}
.wheel-column:focus-visible {
  box-shadow: inset 0 0 0 2px var(--primary);
  border-radius: var(--radius-10);
}
.wheel-item {
  display: flex;
  align-items: center;
  justify-content: center;
  scroll-snap-align: center;
  color: var(--ink-faint);
  font-size: var(--fs-19);
  font-variant-numeric: tabular-nums;
  transition: color var(--dur-fast, 150ms) var(--ease-standard, ease),
    transform var(--dur-fast, 150ms) var(--ease-standard, ease),
    opacity var(--dur-fast, 150ms) var(--ease-standard, ease);
}
.wheel-item.on {
  color: var(--primary);
  font-weight: var(--fw-800);
  transform: scale(1.06);
}
</style>