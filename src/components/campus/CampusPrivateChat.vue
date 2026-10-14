<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { accountUser } from '../../composables/accountAuth.js'
import { createScrollLock, initialFocusTarget, isTopOverlay, overlayStackRevision, overlayZIndexFor, pushOverlay, removeOverlay, topOverlay, trapTabKey } from '../../composables/overlayStack.js'
import { listCampusMessages, sendCampusMessage } from '../../services/campusLife.js'

const props = defineProps({
  targetType: { type: String, required: true },
  targetId: { type: String, required: true },
  recipientId: { type: String, required: true },
  recipientName: { type: String, default: '校园用户' },
})
const emit = defineEmits(['close'])
const messages = ref([])
const dialog = ref(null)
const draft = ref('')
const loading = ref(false)
const sending = ref(false)
const error = ref('')
let requestGeneration = 0
const scrollLock = createScrollLock()
let previousFocus = null
const overlayEntry = { modalEl: dialog, active: false, onBack: () => emit('close') }
const overlayStyle = computed(() => {
  void overlayStackRevision.value
  return { zIndex: overlayZIndexFor(overlayEntry) ?? 100 }
})

function onKeydown(event) {
  if (!overlayEntry.active || !isTopOverlay(overlayEntry)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  trapTabKey(event, dialog.value)
}
function activateOverlay() {
  if (overlayEntry.active || typeof document === 'undefined') return
  previousFocus = document.activeElement
  overlayEntry.active = true
  pushOverlay(overlayEntry)
  scrollLock.lock()
  document.addEventListener('keydown', onKeydown)
  nextTick(() => {
    if (overlayEntry.active && isTopOverlay(overlayEntry)) initialFocusTarget(dialog.value)?.focus?.({ preventScroll: true })
  })
}
function cleanupOverlay() {
  const wasTop = overlayEntry.backDismissed || isTopOverlay(overlayEntry)
  if (!overlayEntry.active) return
  overlayEntry.active = false
  removeOverlay(overlayEntry)
  scrollLock.unlock()
  if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeydown)
  if (!wasTop) return
  const next = topOverlay()
  if (next) {
    if (next.modalEl?.value?.contains(previousFocus)) previousFocus?.focus?.({ preventScroll: true })
    else initialFocusTarget(next.modalEl?.value)?.focus?.({ preventScroll: true })
  } else if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true })
}

function currentKey() {
  return [accountUser.value?.id || '', props.targetType, props.targetId, props.recipientId].join(':')
}

async function load() {
  const key = currentKey()
  const generation = ++requestGeneration
  if (!accountUser.value?.id) {
    messages.value = []
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    const result = await listCampusMessages(props.targetType, props.targetId, props.recipientId)
    if (generation === requestGeneration && key === currentKey()) messages.value = result.messages || []
  } catch (cause) {
    if (generation === requestGeneration && key === currentKey()) error.value = cause?.message || '暂时无法读取私信。'
  } finally {
    if (generation === requestGeneration && key === currentKey()) loading.value = false
  }
}
async function send() {
  if (!draft.value.trim() || sending.value) return
  const key = currentKey()
  sending.value = true
  error.value = ''
  try {
    await sendCampusMessage(props.targetType, props.targetId, props.recipientId, draft.value)
    if (key !== currentKey()) return
    draft.value = ''
    await load()
  } catch (cause) {
    if (key === currentKey()) error.value = cause?.message || '私信没有发送。'
  } finally {
    if (key === currentKey()) sending.value = false
  }
}
function timeLabel(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}
watch(() => [accountUser.value?.id || '', props.targetType, props.targetId, props.recipientId], () => {
  requestGeneration += 1
  messages.value = []
  draft.value = ''
  error.value = ''
  loading.value = false
  sending.value = false
  if (accountUser.value?.id) void load()
}, { immediate: true })
onMounted(() => activateOverlay())
onUnmounted(() => {
  requestGeneration += 1
  cleanupOverlay()
})
</script>

<template>
  <Teleport to="body">
      <div class="campus-chat-backdrop" :style="overlayStyle" @click.self="emit('close')">
        <section ref="dialog" class="campus-chat-dialog" role="dialog" aria-modal="true" :aria-label="`与${recipientName}联系`" tabindex="-1">
        <header><div><span class="campus-life-eyebrow">校内私密联系</span><h2>{{ recipientName }}</h2></div><button class="icon-button" type="button" aria-label="关闭私信" @click="emit('close')">×</button></header>
        <p class="campus-life-inline-state">只在当前交易、互助或认领双方之间显示。不要发送验证码、证件信息或账号密码。</p>
        <div class="campus-chat-messages" aria-live="polite">
          <p v-if="loading" class="campus-life-state" role="status">正在读取私信…</p>
          <p v-else-if="!messages.length" class="campus-life-state">这里还没有消息。</p>
          <article v-for="message in messages" :key="message.id" class="campus-chat-message"><p>{{ message.body }}</p><small>{{ timeLabel(message.created_at) }}</small></article>
        </div>
        <form class="campus-chat-compose" @submit.prevent="send"><label class="sr-only" for="campus-chat-body">消息内容</label><textarea id="campus-chat-body" v-model="draft" maxlength="1500" required placeholder="沟通校园公共区域交接方式…" /><button class="btn btn-primary" type="submit" :disabled="sending">{{ sending ? '发送中…' : '发送' }}</button></form>
        <p v-if="error" class="campus-life-inline-state error" role="alert">{{ error }}</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.campus-chat-backdrop{position:fixed;z-index:100;inset:0;display:grid;place-items:center;padding:16px;background:#10192788}.campus-chat-dialog{display:grid;grid-template-rows:auto auto minmax(180px,1fr) auto auto;gap:12px;width:min(600px,100%);max-height:min(85vh,760px);padding:18px;border:1px solid var(--border);border-radius:var(--radius-16);background:var(--card);box-shadow:var(--shadow-md)}.campus-chat-dialog header{display:flex;justify-content:space-between;align-items:center}.campus-chat-dialog h2{margin:3px 0 0;font-size:20px}.campus-chat-messages{display:flex;flex-direction:column;gap:8px;overflow:auto;padding:8px;background:var(--bg-tint);border-radius:var(--radius-12)}.campus-chat-message{align-self:flex-start;max-width:90%;padding:9px 12px;border:1px solid var(--border);border-radius:12px;background:var(--card)}.campus-chat-message p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.campus-chat-message small{display:block;margin-top:5px;color:var(--muted);font-size:11px}.campus-chat-compose{display:flex;align-items:end;gap:8px}.campus-chat-compose textarea{flex:1;min-height:56px;max-height:140px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit;resize:vertical}
</style>
