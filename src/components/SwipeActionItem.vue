<script setup>
import { onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  leftLabel: { type: String, default: '' },
  rightLabel: { type: String, default: '' },
  leftTone: { type: String, default: 'primary' },
  rightTone: { type: String, default: 'primary' },
  disabled: Boolean,
})

const emit = defineEmits(['swipe'])
const content = ref(null)
let pointerId = null
let startX = 0
let startY = 0
let offset = 0
let dragging = false
let horizontal = false
let suppressClick = false
let resetTimer = 0

function setOffset(value, animate = false) {
  offset = Math.max(-104, Math.min(104, value))
  if (!content.value) return
  content.value.style.transition = animate ? 'transform 180ms cubic-bezier(.2,.8,.2,1)' : 'none'
  content.value.style.transform = `translate3d(${offset}px,0,0)`
}

function reset(animate = true) {
  setOffset(0, animate)
  pointerId = null
  dragging = false
  horizontal = false
}

function onPointerDown(event) {
  if (props.disabled || event.pointerType !== 'touch') return
  if (event.target.closest('button, input, select, textarea, a')) return
  window.clearTimeout(resetTimer)
  pointerId = event.pointerId
  startX = event.clientX
  startY = event.clientY
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
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    if (Math.abs(dy) >= Math.abs(dx)) {
      reset(false)
      return
    }
    horizontal = true
  }
  const allowed = dx < 0 ? Boolean(props.leftLabel) : Boolean(props.rightLabel)
  setOffset(allowed ? dx : dx * 0.16)
  suppressClick = Math.abs(dx) > 10
}

function onPointerEnd(event) {
  if (!dragging || event.pointerId !== pointerId) return
  const direction = offset < 0 ? 'left' : 'right'
  const label = direction === 'left' ? props.leftLabel : props.rightLabel
  const shouldRun = horizontal && Math.abs(offset) >= 72 && label
  reset(true)
  if (shouldRun) emit('swipe', direction)
  resetTimer = window.setTimeout(() => { suppressClick = false }, 260)
}

function onClickCapture(event) {
  if (!suppressClick) return
  event.preventDefault()
  event.stopPropagation()
}

onBeforeUnmount(() => window.clearTimeout(resetTimer))
</script>

<template>
  <div class="swipe-item" @click.capture="onClickCapture">
    <div class="swipe-actions" aria-hidden="true">
      <div v-if="rightLabel" class="swipe-action left-edge" :class="rightTone">{{ rightLabel }}</div>
      <div v-if="leftLabel" class="swipe-action right-edge" :class="leftTone">{{ leftLabel }}</div>
    </div>
    <div
      ref="content"
      class="swipe-content"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="reset(false)"
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
  justify-content: space-between;
}
.swipe-action {
  display: flex;
  align-items: center;
  min-width: 104px;
  padding: 0 15px;
  color: #fff;
  font-size: 12px;
  font-weight: 800;
}
.swipe-action.primary { background: var(--primary); }
.swipe-action.success { background: #14966d; }
.swipe-action.danger { background: var(--danger); }
.swipe-action.muted { background: #667085; }
.left-edge { justify-content: flex-start; text-align: left; }
.right-edge { justify-content: flex-end; margin-left: auto; text-align: right; }
.swipe-content {
  position: relative;
  z-index: 1;
  min-width: 0;
  touch-action: pan-y;
  will-change: transform;
}
@media (hover: hover) and (pointer: fine) {
  .swipe-content { touch-action: auto; will-change: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .swipe-content { transition-duration: 0ms !important; }
}
</style>
