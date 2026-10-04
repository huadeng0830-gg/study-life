<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { attachFloatingSlot, createFloatingSlot, detachFloatingSlot, useFloatingOffset } from '../composables/floatingStack.js'

// update:open 必须登记：六个调用点全都写的是 `v-model:open="toast.open"`，
// 而这个组件原本只 emit close/action，于是 v-model 展开出来的 onUpdate:open
// 变成一个无人监听的穿透属性，每次自动消失都不会把 open 置回 false。
// 现在各处之所以「看起来能用」，只是因为它们又额外补了一个 @close="toast.open = false"。
// 少了 update:open 之后，v-model 本身就完整了（close 时两个通道都写 false，幂等），
// 也不会再有新调用点忘记补 @close 就得到一条永远不消失的提示。
const emit = defineEmits(['close', 'action', 'update:open'])

const props = defineProps({
  open: Boolean,
  message: String,
  type: { type: String, default: 'info' }, // info | success | warning | error
  duration: { type: Number, default: 3200 },
  actionLabel: String,
  undoFn: Function,
  viewFn: Function,
})

let timer = null

// KeepAlive 会同时保留多个页面实例，于是多个 <Toast> 可能一起显示。
// 用共享浮层栈给每个实例占一个坑位，同时出现时依次向上错开，
// 而不是全部叠在 bottom:18px 的同一个点上互相覆盖。
// 其他底部浮层（快速记录成功提示、全局错误提示）也接在同一套栈上。
const slotId = createFloatingSlot()
const stackOffset = useFloatingOffset(slotId, 56)

// 关闭的两个通道一起发：close 给显式监听（@close），update:open 给 v-model:open。
// 两者都写 open=false，幂等，重复发没有副作用。
function closeToast() {
  emit('update:open', false)
  emit('close')
}

function show() {
  attachFloatingSlot(slotId)
  if (timer) window.clearTimeout(timer)
  if (props.duration > 0) {
    timer = window.setTimeout(() => {
      closeToast()
    }, props.duration)
  }
}

function hide() {
  detachFloatingSlot(slotId)
  if (timer) window.clearTimeout(timer)
  timer = null
  closeToast()
}

function doAction() {
  if (props.undoFn) {
    props.undoFn()
    hide()
    emit('action', 'undo')
  } else if (props.viewFn) {
    props.viewFn()
    emit('action', 'view')
  }
}

watch(() => props.open, (open) => {
  if (open) show()
  else hide()
}, { immediate: true })

onBeforeUnmount(hide)

const typeClass = computed(() => ({
  info: 'toast-info',
  success: 'toast-success',
  warning: 'toast-warning',
  error: 'toast-error',
}[props.type] || 'toast-info'))
</script>

<template>
  <Transition name="toast">
    <div v-if="open" class="toast" :class="typeClass" role="status" aria-live="polite" :style="{ '--stack-offset': `${stackOffset}px` }">
      <span class="toast-message">{{ message }}</span>
      <div v-if="actionLabel" class="toast-actions">
        <button v-if="undoFn" type="button" class="toast-btn toast-undo" @click="doAction">{{ actionLabel }}</button>
        <button v-else-if="viewFn" type="button" class="toast-btn toast-view" @click="doAction">{{ actionLabel }}</button>
      </div>
      <button type="button" class="toast-close tap-target" aria-label="关闭" @click="hide">✕</button>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  /* --stack-offset 由 floatingStack 按同时显示的浮层数量给出，
     同时出现多条提示时依次向上排开，不再互相压盖。 */
  bottom: calc(18px + env(safe-area-inset-bottom) + var(--stack-offset, 0px));
  z-index: 200;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(560px, calc(100vw - 32px));
  padding: 10px 14px;
  border-radius: var(--radius-10);
  font-size: var(--fs-13);
  box-shadow: var(--shadow-md);
  pointer-events: auto;
}
.toast-info {
  color: var(--text);
  border: 1px solid var(--border);
  background: var(--card);
}
/* 这三种语义提示原来都是「写死的浅色底 + 写死的深色字」：
   .toast-info 用令牌、另外三个不用，同一个位置在深色主题下会一条深、三条惨白。
   而且写死的字色本身就压不住底：.toast-success 是 #0d9463 配 #effaf6，只有 3.62:1
   （AA 要 4.5:1），.toast-warning 是 4.48:1，同样不达标。
   改用 --success / --warning / --danger 并把底也从 --card 混出来：
   两个主题都跟着主题走，对比度分别是 4.88:1 / 5.16:1 / 4.96:1（浅色）
   与 6.72:1 / 6.72:1 / 5.12:1（深色）。 */
.toast-success {
  color: var(--success);
  border: 1px solid color-mix(in srgb, var(--success) 35%, var(--card));
  background: color-mix(in srgb, var(--success) 10%, var(--card));
}
.toast-warning {
  color: var(--warning);
  border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--card));
  background: color-mix(in srgb, var(--warning) 10%, var(--card));
}
.toast-error {
  color: var(--danger);
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--card));
  background: color-mix(in srgb, var(--danger) 8%, var(--card));
}
.toast-message {
  flex: 1;
  min-width: 0;
}
.toast-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
}
.toast-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  min-height: 24px;
  padding: 4px 9px;
  font-size: var(--fs-11-5);
  font-weight: var(--fw-700);
  border: 0;
  border-radius: var(--radius-6);
  cursor: pointer;
}
.toast-undo,
.toast-view {
  color: var(--primary);
  background: var(--primary-soft);
}
.toast-close {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  color: var(--ink-faint);
  font-size: var(--fs-14);
  line-height: 1;
  border: none;
  border-radius: var(--radius-6);
  background: transparent;
}
.toast-close:hover {
  color: var(--ink-soft);
  background: var(--bg-tint);
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--dur-fast, 150ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
    transform var(--dur-fast, 150ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
@media (max-width: 900px) {
  .toast {
    bottom: calc(86px + env(safe-area-inset-bottom) + var(--stack-offset, 0px));
  }
}
</style>