<script setup>
import { onActivated, onBeforeUnmount, onDeactivated, watch } from 'vue'

const emit = defineEmits(['close'])

const props = defineProps({
  open: Boolean,
  title: String,
  wide: Boolean,
  medium: Boolean,
})

function onKeydown(event) {
  if (event.key === 'Escape' && props.open) emit('close')
}

let bodyLocked = false

function lockBody() {
  if (bodyLocked) return
  bodyLocked = true
  const count = Number(document.body.dataset.modalLockCount) || 0
  document.body.dataset.modalLockCount = String(count + 1)
  document.body.dataset.modalOpen = 'true'
  document.body.style.overflow = 'hidden'
}

function unlockBody() {
  if (!bodyLocked) return
  bodyLocked = false
  const nextCount = Math.max(0, (Number(document.body.dataset.modalLockCount) || 1) - 1)
  if (nextCount > 0) {
    document.body.dataset.modalLockCount = String(nextCount)
    return
  }
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
}

function activate() {
  document.addEventListener('keydown', onKeydown)
  lockBody()
}

function cleanup() {
  document.removeEventListener('keydown', onKeydown)
  unlockBody()
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      activate()
    } else {
      cleanup()
    }
  },
  { immediate: true }
)

onActivated(() => { if (props.open) activate() })
onDeactivated(cleanup)
onBeforeUnmount(cleanup)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <div
        class="modal"
        :class="{ wide, medium }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? 'modal-title' : undefined"
      >
        <div class="modal-head">
          <h3 id="modal-title">{{ title }}</h3>
          <button type="button" class="close" aria-label="关闭弹窗" @click="emit('close')">✕</button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div v-if="$slots.foot" class="modal-foot">
          <slot name="foot" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(30, 40, 70, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
  animation: fade-in 0.16s ease-out;
}
.modal {
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 14px;
  width: 420px;
  max-width: 100%;
  max-height: 85vh;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(30, 40, 80, 0.2);
  animation: modal-in 0.18s ease-out;
}
.modal.wide {
  width: min(920px, 100%);
}
.modal.medium {
  width: min(540px, 100%);
}
.modal-head {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 0;
}
.close {
  border: none;
  background: transparent;
  font-size: 16px;
  color: var(--muted);
  width: 32px;
  height: 32px;
  border-radius: 8px;
}
.close:hover {
  background: var(--bg);
  color: var(--text);
}
.modal-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 18px 22px 22px;
}
.modal-foot {
  flex: 0 0 auto;
  padding: 12px 22px calc(14px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--border);
  background: #fff;
}

@keyframes fade-in {
  from { opacity: 0; }
}

@keyframes modal-in {
  from { transform: translateY(8px) scale(0.98); }
}

@media (max-width: 520px) {
  .overlay {
    align-items: flex-end;
    padding: 0;
  }

  .modal {
    width: 100%;
    max-height: 92vh;
    max-height: 92dvh;
    border-radius: 18px 18px 0 0;
  }

  .modal-head {
    padding: 15px 16px 10px;
    border-bottom: 1px solid var(--border);
    background: #fff;
  }

  .modal-body {
    padding: 14px 16px calc(18px + env(safe-area-inset-bottom));
  }
}
</style>
