<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { accountUser } from '../../composables/accountAuth.js'
import { createScrollLock, initialFocusTarget, isTopOverlay, overlayStackRevision, overlayZIndexFor, pushOverlay, removeOverlay, topOverlay, trapTabKey } from '../../composables/overlayStack.js'
import { listCampusMessages, sendCampusMessage } from '../../services/campusLife.js'
import { campusErrorMessage } from '../../composables/campusContentModel.js'
import { campusMonthDayTimeLabel } from '../../composables/campusFormatting.js'
import { RefreshCw, Send, X } from '@lucide/vue'
import { Button } from '../ui/button'

const props = defineProps({
  targetType: { type: String, required: true },
  targetId: { type: String, required: true },
  recipientId: { type: String, required: true },
  recipientName: { type: String, default: '校园用户' },
})
const emit = defineEmits(['close'])
const messages = ref([])
const dialog = ref(null)
const messageList = ref(null)
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
    if (generation === requestGeneration && key === currentKey()) {
      messages.value = result.messages || []
      await nextTick()
      if (generation === requestGeneration && key === currentKey() && messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight
    }
  } catch (cause) {
    if (generation === requestGeneration && key === currentKey()) error.value = campusErrorMessage(cause, '暂时无法读取私信。')
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
    if (key === currentKey()) error.value = campusErrorMessage(cause, '私信没有发送。')
  } finally {
    if (key === currentKey()) sending.value = false
  }
}
// 这一处的代际判断是有意保留的：除了账号切换，还要挡「同一个账号换了一个
// 收信人」的迟到响应，所以除了计数还要比对 currentKey()。比其它校园文件更严。
function timeLabel(value) {
  return campusMonthDayTimeLabel(value)
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
        <header><div><span class="campus-life-eyebrow">校内私密联系</span><h2>{{ recipientName }}</h2></div><div class="campus-chat-tools"><Button variant="ghost" size="icon" type="button" aria-label="刷新私信" :disabled="loading" @click="load"><RefreshCw /></Button><Button variant="ghost" size="icon" type="button" aria-label="关闭私信" @click="emit('close')"><X /></Button></div></header>
        <p class="campus-life-inline-state">只在当前交易、互助或认领双方之间显示。不要发送验证码、证件信息或账号密码。</p>
        <div ref="messageList" class="campus-chat-messages" role="log" aria-label="私信记录" aria-live="polite" :aria-busy="loading">
          <p v-if="loading" class="campus-life-state" role="status">正在读取私信…</p>
          <p v-else-if="!messages.length" class="campus-life-state">这里还没有消息。</p>
          <article v-for="message in messages" :key="message.id" class="campus-chat-message" :class="{ 'is-mine': message.sender_id === accountUser?.id }"><small>{{ message.sender_id === accountUser?.id ? '我' : recipientName }}</small><p>{{ message.body }}</p><small>{{ timeLabel(message.created_at) }}</small></article>
        </div>
        <form class="campus-chat-compose" @submit.prevent="send"><label class="sr-only" for="campus-chat-body">消息内容</label><textarea id="campus-chat-body" v-model="draft" maxlength="1500" required placeholder="在这里沟通公共区域的交接方式…" /><Button type="submit" :disabled="sending || !draft.trim() || !accountUser"><Send data-icon="inline-start" />{{ sending ? '发送中…' : '发送' }}</Button></form>
        <p v-if="error" class="campus-life-inline-state error" role="alert">{{ error }}</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.campus-chat-backdrop{position:fixed;z-index:100;inset:0;display:grid;place-items:center;padding:16px;background:#10192788}.campus-chat-dialog{display:grid;grid-template-rows:auto auto minmax(180px,1fr) auto auto;gap:12px;width:min(600px,100%);max-height:min(85vh,760px);padding:18px;border:1px solid var(--border);border-radius:var(--radius-16);background:var(--card);box-shadow:var(--shadow-md)}.campus-chat-dialog header{display:flex;justify-content:space-between;align-items:center}.campus-chat-dialog h2{margin:3px 0 0;font-size:20px}.campus-chat-messages{display:flex;flex-direction:column;gap:8px;overflow:auto;padding:8px;background:var(--bg-tint);border-radius:var(--radius-12)}.campus-chat-message{align-self:flex-start;max-width:90%;padding:9px 12px;border:1px solid var(--border);border-radius:12px;background:var(--card)}.campus-chat-message p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.campus-chat-message small{display:block;margin-top:5px;color:var(--muted);font-size:11px}.campus-chat-compose{display:flex;align-items:end;gap:8px}.campus-chat-compose textarea{flex:1;min-height:56px;max-height:140px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit;resize:vertical}
.campus-chat-tools{display:flex;gap:4px}.campus-chat-dialog{width:min(600px,100%);height:min(680px,85dvh);max-height:85dvh;padding:22px;gap:16px}.campus-chat-messages{padding:14px;gap:14px;overscroll-behavior:contain}.campus-chat-message{max-width:85%;padding:10px 14px}.campus-chat-message.is-mine{align-self:flex-end;background:var(--primary-soft);border-color:transparent}.campus-chat-message>small:first-child{margin:0 0 6px;font-weight:var(--fw-650)}.campus-chat-message p{font-size:var(--fs-13);line-height:1.8}.campus-chat-compose textarea{min-width:0;line-height:1.6}.campus-chat-compose textarea:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
@media(max-width:520px){.campus-chat-backdrop{padding:10px}.campus-chat-dialog{padding:16px;gap:12px;width:100%;height:min(720px,90dvh);max-height:90dvh;grid-template-rows:auto auto minmax(0,1fr) auto auto}.campus-chat-compose textarea{font-size:16px}.campus-chat-dialog h2{font-size:var(--fs-18)}.campus-chat-tools button,.campus-chat-compose button{min-height:44px}}
</style>
