<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
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
  // 循环刻度：首尾相接（小时 23 之后回到 0、分钟 59 之后回到 0），
  // 可以一直朝同一个方向拨下去，永远滚不到头。
  cyclic: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const columnEl = ref(null)
let settleTimer = 0
const optionIdPrefix = 'wheel-' + useId()

const padding = computed(() => wheelPadding(props.itemHeight, props.visibleRows))
const columnHeight = computed(() => Math.max(1, props.itemHeight) * Math.max(1, props.visibleRows))

/** 一份刻度的格数。 */
const cycleLength = computed(() => Math.max(1, props.values.length))

/**
 * 循环模式：把同一份刻度连铺若干份，中间那份才是「真正的」落点，
 * 每次松手后都把滚动位置搬回中间那份。因为各份内容完全相同，这一搬的位移
 * 正好是整条刻度的整数倍，画面逐像素不变，用户只会看到一条滚不到头的刻度带。
 *
 * 份数按刻度长度取：一份越长，一次快拨能跑的距离越远、需要的余量越大；
 * 短刻度（小时 24 格）反过来要多铺几份，否则一次快拨就撞到硬边界。
 */
const copies = computed(() => {
  if (!props.cyclic) return 1
  return cycleLength.value >= 48 ? 5 : 7
})
const renderValues = computed(() => {
  if (!props.cyclic) return props.values
  const list = props.values
  const out = []
  for (let copy = 0; copy < copies.value; copy += 1) {
    for (let index = 0; index < list.length; index += 1) out.push(list[index])
  }
  return out
})
/** 中间那份的起始序号，循环模式下的默认落点。 */
const middleIndex = computed(() => Math.floor(copies.value / 2) * cycleLength.value)
const currentIndex = computed(() => {
  const offset = wheelIndexForValue(props.values, props.modelValue)
  return props.cyclic ? middleIndex.value + offset : offset
})
function optionId(index) {
  return optionIdPrefix + '-option-' + index
}
const activeOptionId = computed(() => props.values.length ? optionId(currentIndex.value) : undefined)

/** 只有中间那份的刻度是真选项，其余几份是循环用的备份，读屏应当忽略。 */
function isMiddleCopy(index) {
  return !props.cyclic || (index >= middleIndex.value && index < middleIndex.value + cycleLength.value)
}
function isSelected(index, value) {
  return props.cyclic ? index === currentIndex.value : value === props.modelValue
}

function textOf(value) {
  return props.format ? props.format(value) : String(value)
}

function scrollToIndex(index, behavior = 'auto') {
  const element = columnEl.value
  if (!element) return
  const top = wheelScrollTopForIndex(index, renderValues.value, props.itemHeight)
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
  const list = renderValues.value
  const index = wheelIndexFromScrollTop(element.scrollTop, list, props.itemHeight)
  const value = wheelValueAtIndex(list, index)
  if (value !== props.modelValue) emit('update:modelValue', value)
  if (props.cyclic) {
    recenter(index)
    return
  }
  // 即使 scroll-snap 已经吸附，也再对齐一次，保证落在整格位置上
  const target = wheelScrollTopForIndex(index, list, props.itemHeight)
  if (Math.abs(Number(element.scrollTop) - target) > 0.5) scrollToIndex(index, 'smooth')
}

/** 循环模式：把落点搬回中间那份，于是永远没有「到底」可言。 */
function recenter(index) {
  const element = columnEl.value
  if (!element) return
  const length = cycleLength.value
  const target = middleIndex.value + ((index % length) + length) % length
  const top = wheelScrollTopForIndex(target, renderValues.value, props.itemHeight)
  if (target === index) {
    // 已经在中间那份，和普通滚轮一样只做一次整格对齐
    if (Math.abs(Number(element.scrollTop) - top) > 0.5) scrollToIndex(target, 'smooth')
    return
  }
  // 换一份：位移是整条刻度的整数倍，画面一样，所以瞬时定位而不是平滑滚动
  scrollToIndex(target, 'auto')
}

function onScroll() {
  window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(settle, SETTLE_DELAY)
}

function moveBy(step) {
  const list = renderValues.value
  const count = list.length
  if (!count) return
  const next = props.cyclic
    ? currentIndex.value + step
    : Math.min(count - 1, Math.max(0, currentIndex.value + step))
  emit('update:modelValue', wheelValueAtIndex(list, next))
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
    const list = renderValues.value
    const next = event.key === 'Home'
      ? (props.cyclic ? middleIndex.value : 0)
      : (props.cyclic ? middleIndex.value + cycleLength.value - 1 : list.length - 1)
    emit('update:modelValue', wheelValueAtIndex(list, next))
    scrollToIndex(next, 'smooth')
  }
}

// 外部换值（例如换了一个日程）时把滚轮拨到对应格子，
// 但如果当前已经停在该格上就不要动，避免和用户的手势打架。
watch(() => props.modelValue, () => {
  const element = columnEl.value
  if (!element) return
  if (wheelIndexFromScrollTop(element.scrollTop, renderValues.value, props.itemHeight) === currentIndex.value) return
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
      :aria-activedescendant="activeOptionId"
      :aria-label="label || '滚轮选择'"
      :style="{ paddingTop: `${padding}px`, paddingBottom: `${padding}px` }"
      @scroll.passive="onScroll"
      @keydown="onKeydown"
    >
      <div
        v-for="(value, index) in renderValues"
        :key="index"
        :id="optionId(index)"
        class="wheel-item"
        :role="isMiddleCopy(index) ? 'option' : 'presentation'"
        :aria-hidden="isMiddleCopy(index) ? undefined : 'true'"
        :aria-selected="isSelected(index, value)"
        :class="{ on: isSelected(index, value) }"
        :style="{ height: `${itemHeight}px` }"
      >{{ textOf(value) }}</div>
    </div>
  </div>
</template>

<style scoped>
.wheel {
  position: relative;
  /* flex-basis 必须是 auto，而不是 flex:1 给的 0%。
     父容器 .time-wheel-column 是 column 方向的 flex，主轴就是高度，
     flex-basis:0% 会让内联的 height(itemHeight × visibleRows)整个失效，
     这一格于是按内容高度撑开——24 项就是 1232px。.wheel-column 用的是
     height:100%，跟着一起撑开，scrollHeight === clientHeight，
     滚轮没有可滚的距离，手势全部被外层 .modal-body 吃掉，时间根本改不动。
     0 0 auto 让内联高度按预期生效。 */
  flex: 0 0 auto;
  /* 父容器的 align-items:center 会把这一格收缩成 min-content 宽度，
     也就是「两个数字」那么宽(实测 23px)，刻度被压扁成一团。
     align-self 覆盖它，让滚轮铺满整列。 */
  align-self: stretch;
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
  /* 不要 mask 淡出：淡出把 00→23 切成上下两截，看着像断开的几段而不是一条连续的刻度带。
     现在整条刻度带是连续可见的，靠 .wheel-item.on 的高亮和 .wheel-band 指示当前值。 */
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
