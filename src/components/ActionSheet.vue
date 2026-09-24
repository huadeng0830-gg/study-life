<script setup>
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import {
  createScrollLock,
  initialFocusTarget,
  isTopOverlay,
  pushOverlay,
  removeOverlay,
  topOverlay,
  trapTabKey,
} from '../composables/overlayStack.js'
import { animationsEnabled } from '../composables/motion.js'

/**
 * 底部操作菜单（Action Sheet）。
 *
 * 用法：让用户在几个动作之间做选择，而不是让每个动作都在页面上占一个按钮。
 *   <ActionSheet :open="show" title="更换头像" :actions="actions"
 *                @select="onSelect" @close="show = false" />
 *
 * actions: [{ key, label, icon?, hint?, tone?: 'default'|'primary'|'danger', disabled? }]
 *
 * 与 Modal 共用遮罩栈，所以「弹窗里再开操作菜单」时 Escape 只关最上面一层。
 */

let nextSheetId = 0

const props = defineProps({
  open: Boolean,
  title: String,
  description: String,
  actions: { type: Array, default: () => [] },
  cancelLabel: { type: String, default: '取消' },
})

const emit = defineEmits(['select', 'close'])

const panelEl = ref(null)
const overlayEl = ref(null)
const titleId = `action-sheet-title-${++nextSheetId}`
const entry = { modalEl: panelEl, previousFocus: null, active: false }
const scrollLock = createScrollLock()

function focusInitial() {
  nextTick(() => {
    if (!entry.active || !isTopOverlay(entry)) return
    initialFocusTarget(panelEl.value)?.focus?.({ preventScroll: true })
  })
}

function onKeydown(event) {
  if (!props.open || !isTopOverlay(entry)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  trapTabKey(event, panelEl.value)
}

function activate() {
  if (entry.active) return
  entry.previousFocus = document.activeElement
  entry.active = true
  pushOverlay(entry)
  document.addEventListener('keydown', onKeydown)
  scrollLock.lock()
  focusInitial()
}

function cleanup() {
  if (!entry.active) return
  const wasTop = isTopOverlay(entry)
  removeOverlay(entry)
  entry.active = false
  document.removeEventListener('keydown', onKeydown)
  scrollLock.unlock()
  if (!wasTop) return
  const next = topOverlay()
  if (next?.modalEl?.value?.contains?.(entry.previousFocus)) {
    entry.previousFocus?.focus?.({ preventScroll: true })
  } else if (next) {
    nextTick(() => { if (isTopOverlay(next)) initialFocusTarget(next.modalEl.value)?.focus?.({ preventScroll: true }) })
  } else if (entry.previousFocus?.isConnected) {
    entry.previousFocus.focus?.({ preventScroll: true })
  }
}

watch(() => props.open, (open) => {
  if (open) activate()
  else cleanup()
}, { immediate: true })

onActivated(() => { if (props.open) activate() })
onDeactivated(cleanup)
onBeforeUnmount(cleanup)

function choose(action) {
  if (action?.disabled) return
  emit('select', action)
}

/**
 * 各项依次出现，而不是整块一起盖上来。
 * 关闭动效时延迟直接为 0，避免「减少动态效果」下元素卡在透明状态等延迟。
 */
function itemDelay(index) {
  if (!animationsEnabled()) return '0ms'
  return `${Math.min(index, 6) * 26}ms`
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" ref="overlayEl" class="sheet-overlay" @click.self="emit('close')">
      <div
        ref="panelEl"
        class="sheet"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        :aria-labelledby="title ? titleId : undefined"
      >
        <div class="sheet-card sheet-head" :style="{ '--item-delay': itemDelay(0) }">
          <h3 v-if="title" :id="titleId">{{ title }}</h3>
          <p v-if="description">{{ description }}</p>
        </div>

        <div class="sheet-card sheet-actions">
          <button
            v-for="(action, index) in actions"
            :key="action.key || action.label"
            type="button"
            class="sheet-action"
            :class="action.tone || 'default'"
            :disabled="action.disabled"
            :style="{ '--item-delay': itemDelay(index + 1) }"
            @click="choose(action)"
          >
            <span v-if="action.icon" class="sheet-action-icon" aria-hidden="true">{{ action.icon }}</span>
            <span class="sheet-action-copy">
              <b>{{ action.label }}</b>
              <small v-if="action.hint">{{ action.hint }}</small>
            </span>
          </button>
          <p v-if="!actions.length" class="sheet-empty">没有可执行的操作</p>
        </div>

        <button
          type="button"
          class="sheet-card sheet-cancel"
          :style="{ '--item-delay': itemDelay(actions.length + 1) }"
          @click="emit('close')"
        >{{ cancelLabel }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 12px max(10px, env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left, 0px));
  background: rgba(30, 40, 70, 0.35);
  animation: sheet-overlay-in var(--dur-fast, 150ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.sheet {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(460px, 100%);
  /* 横屏刘海时顶部也会被吃掉：max-height 扣掉 top 安全区，不再只减固定 40px。 */
  max-height: calc(100dvh - 40px - env(safe-area-inset-top, 0px));
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  /* 不写 outline:none：.sheet 带 tabindex="-1"，程序聚焦时需要可见焦点环。 */
}
.sheet-card {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--card);
  box-shadow: var(--shadow-md, 0 8px 24px rgba(35, 52, 93, 0.08));
  animation: sheet-item-in var(--dur-base, 220ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
  animation-delay: var(--item-delay, 0ms);
}
.sheet-head {
  padding: 14px 16px;
  text-align: center;
}
.sheet-head h3 {
  font-size: 13.5px;
  font-weight: 750;
}
.sheet-head p {
  margin-top: 3px;
  color: var(--ink-faint);
  font-size: 11.5px;
  line-height: 1.45;
}
.sheet-actions {
  overflow: hidden;
  padding: 4px;
}
.sheet-action {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  min-height: 50px;
  padding: 11px 12px;
  color: var(--text);
  text-align: left;
  border: 0;
  border-radius: 11px;
  background: transparent;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--dur-fast, 150ms) var(--ease-standard, ease);
}
.sheet-action + .sheet-action {
  border-top: 1px solid var(--border);
  border-radius: 0 0 11px 11px;
}
.sheet-action:hover:not(:disabled) {
  background: var(--bg);
}
.sheet-action:active:not(:disabled) {
  background: var(--primary-soft);
}
.sheet-action:disabled {
  opacity: 0.45;
}
.sheet-action.danger {
  color: var(--danger);
}
.sheet-action.danger:hover:not(:disabled) {
  /* 写死 #feecec 在深色主题下是「浅粉底 + 亮红字」，只有 2.44:1。 */
  background: color-mix(in srgb, var(--danger) 12%, var(--card));
}
.sheet-action.primary {
  color: var(--primary);
  font-weight: 700;
}
.sheet-action-icon {
  flex: 0 0 26px;
  font-size: 20px;
  line-height: 1;
  text-align: center;
}
.sheet-action-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sheet-action-copy b {
  font-size: 14px;
  font-weight: 650;
}
.sheet-action-copy small {
  color: var(--ink-faint);
  font-size: 11px;
  line-height: 1.4;
}
.sheet-empty {
  padding: 16px;
  color: var(--ink-faint);
  font-size: 12px;
  text-align: center;
}
.sheet-cancel {
  min-height: 50px;
  padding: 14px;
  color: var(--ink-soft);
  font-size: 14.5px;
  font-weight: 700;
  touch-action: manipulation;
}
.sheet-cancel:hover {
  color: var(--text);
  background: var(--bg);
}

@keyframes sheet-overlay-in {
  from { opacity: 0; }
}
@keyframes sheet-item-in {
  from { opacity: 0; transform: translateY(14px); }
}
</style>