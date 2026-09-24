<script setup>
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { isTopOverlay, pushOverlay, removeOverlay, topOverlay, trapTabKey } from '../composables/overlayStack.js'
import { pointMenuPlacement } from '../composables/menuPlacement.js'

/**
 * 长按 / 右键上下文菜单。
 *
 * 菜单出现在触点附近，并且只作用于被按住的那一条内容；
 * 与 Modal、ActionSheet 共用浮层栈，所以 Escape 先关菜单再关弹窗。
 * 这里不锁页面滚动——上下文菜单跟着触点走，滚动会直接关掉它。
 */

const props = defineProps({
  open: Boolean,
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  title: String,
  items: { type: Array, default: () => [] },
})

const emit = defineEmits(['select', 'close'])

// role="menu" 需要可访问名称，否则读屏只念出「菜单」，不知道是哪个菜单。
// 与 Modal / ActionSheet 同一套做法：有可见标题就让 aria-labelledby 指过去；
// title 是可选的（目前只有考试页传），没传时退化成一句通用名称，不留空名。
let nextMenuId = 0
const titleId = `context-menu-title-${++nextMenuId}`

const panelEl = ref(null)
const entry = { modalEl: panelEl, previousFocus: null, active: false }
const placement = ref({ left: 0, top: 0 })
const positioned = ref(false)

function place() {
  nextTick(() => {
    const panel = panelEl.value
    if (!panel) return
    const rect = panel.getBoundingClientRect?.()
    placement.value = pointMenuPlacement(
      { x: props.x, y: props.y },
      { width: rect?.width || 0, height: rect?.height || 0 },
      { width: window.innerWidth, height: window.innerHeight },
    )
    positioned.value = true
    panel.focus?.({ preventScroll: true })
  })
}

function onKeydown(event) {
  if (!isTopOverlay(entry)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  trapTabKey(event, panelEl.value)
}

function onOutsidePointerDown(event) {
  if (!isTopOverlay(entry)) return
  if (panelEl.value?.contains(event.target)) return
  emit('close')
}

function activate() {
  if (entry.active) return
  entry.previousFocus = document.activeElement
  entry.active = true
  positioned.value = false
  pushOverlay(entry)
  document.addEventListener('keydown', onKeydown)
  // 捕获阶段监听，保证在行内点击处理器之前先关掉菜单
  document.addEventListener('pointerdown', onOutsidePointerDown, true)
  window.addEventListener('scroll', emitClose, true)
  window.addEventListener('resize', emitClose)
  window.addEventListener('blur', emitClose)
  place()
}

function cleanup() {
  if (!entry.active) return
  const wasTop = isTopOverlay(entry)
  removeOverlay(entry)
  entry.active = false
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', onOutsidePointerDown, true)
  window.removeEventListener('scroll', emitClose, true)
  window.removeEventListener('resize', emitClose)
  window.removeEventListener('blur', emitClose)
  positioned.value = false
  if (wasTop) {
    const next = topOverlay()
    if (next?.modalEl?.value?.contains?.(entry.previousFocus)) entry.previousFocus?.focus?.({ preventScroll: true })
    else if (entry.previousFocus?.isConnected) entry.previousFocus.focus?.({ preventScroll: true })
  }
}

function emitClose() {
  if (entry.active) emit('close')
}

watch(() => props.open, (open) => {
  if (open) activate()
  else cleanup()
}, { immediate: true })

onActivated(() => { if (props.open) activate() })
onDeactivated(cleanup)
onBeforeUnmount(cleanup)

function choose(item) {
  if (item?.disabled) return
  emit('select', item)
}
</script>

<template>
  <Teleport to="body">
    <!-- 菜单原来只有进场动画，关闭时瞬间消失，和 Modal / ActionSheet 的
         进出场节奏不一致。补上离场过渡：向菜单原点收缩并淡出。 -->
    <Transition name="context-menu">
      <div
        v-if="open"
        ref="panelEl"
        class="context-menu"
        role="menu"
        :aria-labelledby="title ? titleId : undefined"
        :aria-label="title ? undefined : '操作菜单'"
        tabindex="-1"
        :style="{ left: `${placement.left}px`, top: `${placement.top}px`, visibility: positioned ? 'visible' : 'hidden' }"
        @pointerdown.stop
        @contextmenu.prevent
      >
        <p v-if="title" :id="titleId" class="context-menu-title">{{ title }}</p>
        <button
          v-for="item in items"
          :key="item.key || item.label"
          type="button"
          role="menuitem"
          class="context-menu-item"
          :class="item.tone || 'default'"
          :disabled="item.disabled"
          @click="choose(item)"
        >
          <span v-if="item.icon" class="context-menu-icon" aria-hidden="true">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </button>
        <p v-if="!items.length" class="context-menu-empty">没有可执行的操作</p>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 130;
  min-width: 168px;
  max-width: min(260px, calc(100vw - 16px));
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--card);
  box-shadow: 0 12px 32px rgba(24, 38, 76, 0.18);
  animation: context-menu-in var(--dur-fast, 150ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
  transform-origin: top left;
  /* 容器带 tabindex="-1"，打开时会被程序聚焦；去掉裸 outline:none，
     让全局 :focus-visible 焦点环在键盘路径上仍然可见。 */
}
.context-menu-title {
  padding: 6px 10px 5px;
  color: var(--ink-faint);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 42px;
  padding: 9px 11px;
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
  text-align: left;
  border: 0;
  border-radius: 9px;
  background: transparent;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--dur-fast, 150ms) var(--ease-standard, ease);
}
.context-menu-item:hover:not(:disabled) {
  background: var(--bg);
}
.context-menu-item:active:not(:disabled) {
  background: var(--primary-soft);
}
.context-menu-item:disabled {
  opacity: 0.45;
}
.context-menu-item.danger {
  color: var(--danger);
}
.context-menu-item.danger:hover:not(:disabled) {
  /* 原来写死 #feecec，在深色主题下是浅粉底配亮红字，几乎读不出来。
     与 .btn-danger 保持一致，用危险色混出随主题变化的底色。 */
  background: color-mix(in srgb, var(--danger) 12%, var(--card));
}
.context-menu-icon {
  flex: 0 0 18px;
  text-align: center;
}
.context-menu-empty {
  padding: 12px 10px;
  color: var(--ink-faint);
  font-size: 12px;
  text-align: center;
}

@keyframes context-menu-in {
  from { opacity: 0; transform: scale(0.94); }
}

/* 离场：向 transform-origin（左上角的触点方向）收缩淡出。
   时长与 easing 走同一套令牌；prefers-reduced-motion 与「流畅优先」下
   style.css 的全局规则会把时长压到 0.01ms，等同于直接消失。 */
.context-menu-leave-active {
  transition: opacity var(--dur-fast, 150ms) var(--ease-standard, ease),
    transform var(--dur-fast, 150ms) var(--ease-standard, ease);
}
.context-menu-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>