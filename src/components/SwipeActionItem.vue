<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const GESTURE_THRESHOLD = 10
const SNAP_RATIO = 0.36

const props = defineProps({
  // actions are revealed by a left swipe. The legacy label props remain
  // compatible with the original one-action-per-direction component API.
  actions: { type: Array, default: () => [] },
  leftLabel: { type: String, default: '' },
  rightLabel: { type: String, default: '' },
  leftTone: { type: String, default: 'primary' },
  rightTone: { type: String, default: 'primary' },
  actionWidth: { type: Number, default: 70 },
  open: Boolean,
  disabled: Boolean,
})

const emit = defineEmits(['swipe', 'action', 'update:open'])
const content = ref(null)
const leftActions = computed(() => props.actions.length
  ? props.actions
  : props.leftLabel ? [{ key: 'left', label: props.leftLabel, tone: props.leftTone }] : [])
const rightActions = computed(() => props.actions.length
  ? []
  : props.rightLabel ? [{ key: 'right', label: props.rightLabel, tone: props.rightTone }] : [])
const leftDistance = computed(() => Math.max(1, leftActions.value.length * props.actionWidth))
const rightDistance = computed(() => Math.max(1, rightActions.value.length * props.actionWidth))

let pointerId = null
let startX = 0
let startY = 0
let originOffset = 0
let offset = 0
let dragging = false
let horizontal = false
let suppressClick = false
let resetTimer = 0
let settleTimer = 0
let openDirection = 'left'

function distanceFor(direction) {
  return direction === 'right' ? rightDistance.value : leftDistance.value
}

function setOffset(value, animate = false, direction = openDirection) {
  const distance = distanceFor(direction)
  const min = direction === 'right' ? 0 : -distance
  const max = direction === 'right' ? distance : 0
  offset = Math.max(min, Math.min(max, value))
  if (!content.value) return
  window.clearTimeout(settleTimer)
  if (offset === 0 && !animate) {
    // Keep idle rows in the normal paint path. A zero transform still creates
    // a compositor layer on every recycled transaction row.
    content.value.style.transition = ''
    content.value.style.transform = ''
    content.value.style.willChange = ''
    return
  }
  // 释放后的回弹：用统一的弹性缓动 token，越过终点再收回，
  // 让“松手归位 / 吸附展开”有轻微回弹而不是生硬的匀速停住。
  // 时长保持 180ms，与下面 190ms 的收尾清理保持原有时序。
  content.value.style.transition = animate
    ? 'transform 180ms var(--ease-spring, cubic-bezier(.34, 1.56, .64, 1))'
    : 'none'
  content.value.style.transform = `translate3d(${offset}px,0,0)`
  content.value.style.willChange = 'transform'
  if (offset === 0 && animate) {
    settleTimer = window.setTimeout(() => {
      if (!dragging && !props.open && offset === 0) {
        content.value?.style.removeProperty('transition')
        content.value?.style.removeProperty('transform')
        content.value?.style.removeProperty('will-change')
      }
    }, 190)
  }
}

function settleOpen(open, direction = openDirection, animate = true) {
  openDirection = direction
  setOffset(open ? (direction === 'right' ? rightDistance.value : -leftDistance.value) : 0, animate, direction)
  emit('update:open', Boolean(open))
}

function resetGesture(preserveOpen = props.open) {
  settleOpen(preserveOpen, openDirection, false)
  pointerId = null
  dragging = false
  horizontal = false
  originOffset = offset
}

function onPointerDown(event) {
  if (props.disabled || event.pointerType === 'mouse') return
  if (event.clientX <= 18) return
  if (event.target?.closest?.('button, input, select, textarea, a')) return
  window.clearTimeout(resetTimer)
  pointerId = event.pointerId
  startX = event.clientX
  startY = event.clientY
  openDirection = props.open ? openDirection : 'left'
  originOffset = props.open
    ? (openDirection === 'right' ? rightDistance.value : -leftDistance.value)
    : 0
  offset = originOffset
  dragging = true
  horizontal = false
  suppressClick = false
  content.value?.setPointerCapture?.(event.pointerId)
}

function onPointerMove(event) {
  if (!dragging || event.pointerId !== pointerId) return
  const dx = event.clientX - startX
  const dy = event.clientY - startY
  if (!horizontal) {
    if (Math.abs(dx) < GESTURE_THRESHOLD && Math.abs(dy) < GESTURE_THRESHOLD) return
    if (Math.abs(dy) >= Math.abs(dx)) {
      resetGesture()
      return
    }
    horizontal = true
  }
  event.preventDefault?.()
  const direction = dx < 0 || originOffset < 0 ? 'left' : 'right'
  const hasActions = direction === 'left' ? leftActions.value.length : rightActions.value.length
  const raw = originOffset + dx
  const distance = distanceFor(direction)
  const next = hasActions
    ? Math.max(-distance, Math.min(0, raw))
    : raw * 0.16
  setOffset(next, false, direction)
  suppressClick = Math.abs(dx) > GESTURE_THRESHOLD
}

function onPointerEnd(event) {
  if (!dragging || event.pointerId !== pointerId) return
  const wasOpen = props.open
  const direction = offset < 0 ? 'left' : 'right'
  const distance = distanceFor(direction)
  const hasActions = direction === 'left' ? leftActions.value.length : rightActions.value.length
  const opening = !wasOpen && direction === 'left'
  const shouldOpen = hasActions && horizontal && (
    opening
      ? Math.abs(offset) >= distance * SNAP_RATIO
      : (direction === 'left' ? offset <= -distance * (1 - SNAP_RATIO) : offset >= distance * (1 - SNAP_RATIO))
  )
  const nextOpen = wasOpen ? shouldOpen || (!horizontal && wasOpen) : shouldOpen
  settleOpen(nextOpen, direction, true)
  pointerId = null
  dragging = false
  horizontal = false
  if (nextOpen && !wasOpen) emit('swipe', direction)
  resetTimer = window.setTimeout(() => { suppressClick = false }, 260)
}

function onAction(action) {
  settleOpen(false, openDirection, true)
  suppressClick = true
  emit('action', action.key ?? action)
  resetTimer = window.setTimeout(() => { suppressClick = false }, 260)
}

function onClickCapture(event) {
  if (!props.open && !suppressClick) return
  event.preventDefault()
  event.stopPropagation()
  if (props.open) settleOpen(false, openDirection, true)
}

watch(() => props.open, (value) => {
  if (!dragging) settleOpen(value, openDirection, true)
})

onMounted(() => {
  setOffset(props.open ? (openDirection === 'right' ? rightDistance.value : -leftDistance.value) : 0, false)
})

onBeforeUnmount(() => {
  window.clearTimeout(resetTimer)
  window.clearTimeout(settleTimer)
})
</script>

<template>
  <div class="swipe-item" :style="{ '--swipe-action-width': `${actionWidth}px` }">
    <!-- 这些动作按钮只靠位移藏起来：幕布合上时它们仍在 DOM 里，原本也仍然可聚焦，
         于是键盘用户会 Tab 到一排看不见的「编辑 / 删除」上（WCAG 2.4.7 焦点可见）。
         收起时移出 Tab 序，滑开后再放回去。
         注意：这不代表编辑/删除对键盘就没了——调用方（账本）的每一行现在都是可聚焦的
         role="button"，回车打开详情面板，那里有编辑/再记一次/退款/删除等全部真按钮。 -->
    <div v-if="leftActions.length" class="swipe-actions left-swipe-actions">
      <button
        v-for="action in leftActions"
        :key="action.key || action.label"
        type="button"
        class="swipe-action"
        :class="action.tone || 'primary'"
        :tabindex="open ? 0 : -1"
        :aria-label="action.ariaLabel || action.label"
        @click.stop="onAction(action)"
      >{{ action.label }}</button>
    </div>
    <div v-if="rightActions.length" class="swipe-actions right-swipe-actions">
      <button
        v-for="action in rightActions"
        :key="action.key || action.label"
        type="button"
        class="swipe-action"
        :class="action.tone || 'primary'"
        :tabindex="open ? 0 : -1"
        :aria-label="action.ariaLabel || action.label"
        @click.stop="onAction(action)"
      >{{ action.label }}</button>
    </div>
    <div
      ref="content"
      class="swipe-content"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="resetGesture()"
      @click.capture="onClickCapture"
    >
      <slot></slot>
    </div>
  </div>
</template>

<style scoped>
.swipe-item {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border-radius: 12px;
  contain: layout paint;
}
.swipe-actions {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: stretch;
}
.left-swipe-actions { justify-content: flex-end; }
.right-swipe-actions { justify-content: flex-start; }
.swipe-action {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 var(--swipe-action-width);
  width: var(--swipe-action-width);
  min-width: var(--swipe-action-width);
  padding: 0 7px;
  border: 0;
  /* 底色分两类，文字色必须跟着变：
     - 跟着主题走的实色底（--primary / --danger）在暗色主题下是亮色，
       白字只有 2.8~3.2:1，必须用 --on-primary / --on-danger（深色字）。
     - 写死的深色底（绿 #0f7a58 / 灰 #667085）白字始终达标，保持 #fff。 */
  color: var(--on-primary, #fff);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}
.swipe-action.primary { background: var(--primary); color: var(--on-primary, #fff); }
/* 原来是 #14966d，配 12px 白字只有 3.74:1（AA 要 4.5:1）。压深到 #0f7a58 得 5.3:1。 */
.swipe-action.success { background: #0f7a58; color: #fff; }
.swipe-action.danger { background: var(--danger); color: var(--on-danger, #fff); }
.swipe-action.muted { background: #667085; color: #fff; }
.swipe-action.neutral { background: var(--primary-soft); color: var(--primary); }
.swipe-action:focus-visible { outline: 2px solid var(--text); outline-offset: -3px; }
.swipe-content {
  position: relative;
  z-index: 1;
  min-width: 0;
  background: var(--card);
  touch-action: pan-y;
}
@media (hover: hover) and (pointer: fine) {
  .swipe-content { touch-action: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .swipe-content { transition: none !important; }
}
</style>
