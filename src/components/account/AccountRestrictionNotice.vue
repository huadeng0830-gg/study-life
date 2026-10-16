<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { accountUser, openAccountSection } from '../../composables/accountAuth.js'
import { accountCloudRestricted, accountPublishingRestricted, accountRestrictions, restrictionStatus, refreshAccountRestrictions, clearAccountRestrictions, tickRestrictionClock } from '../../composables/accountRestrictions.js'
import { announceAlert } from '../../composables/liveRegion.js'
import AccountRestrictionStatus from './AccountRestrictionStatus.vue'
defineProps({ blocked: Boolean })
const restored = ref(false)
const hasUnread = computed(() => Object.values(accountRestrictions.value?.restrictions || {}).some(item => item.unread))
let timer = 0
let failures = 0
let mounted = true
let lastAttempt = 0
let previousBlocked = false
function visible() { return document.visibilityState !== 'hidden' && navigator.onLine !== false }
function schedule() {
  window.clearTimeout(timer)
  if (mounted && accountUser.value?.id && visible()) timer = window.setTimeout(poll, Math.min(900000, 120000 * 2 ** failures))
}
async function poll(force = false) {
  if (!mounted || !visible()) return
  if (Date.now() - lastAttempt < 15000) { schedule(); return }
  lastAttempt = Date.now()
  await refreshAccountRestrictions({ force })
  failures = restrictionStatus.value === 'error' ? Math.min(3, failures + 1) : 0
  schedule()
}
function resume() { tickRestrictionClock(); if (visible()) void poll(); else window.clearTimeout(timer) }
watch(() => accountUser.value?.id, () => {
  clearAccountRestrictions()
  failures = 0; lastAttempt = 0; restored.value = false; previousBlocked = false
  window.clearTimeout(timer)
  if (accountUser.value?.id) void poll(true)
}, { immediate: true })
watch([accountCloudRestricted, accountPublishingRestricted, hasUnread], ([account, publish, unread]) => {
  if (previousBlocked && !account && !publish) { restored.value = true; announceAlert('账号限制已解除，可以继续使用。') }
  if (unread) announceAlert(account ? '账号已封禁，请查看处理原因和解除时间。' : publish ? '账号当前禁止发布，请查看处理说明。' : '你有一条账号限制解除通知。')
  previousBlocked = Boolean(account || publish)
})
const clock = window.setInterval(tickRestrictionClock, 30000)
document.addEventListener('visibilitychange', resume)
window.addEventListener('online', resume)
window.addEventListener('offline', resume)
window.addEventListener('focus', resume)
onBeforeUnmount(() => {
  mounted = false
  window.clearTimeout(timer); window.clearInterval(clock)
  document.removeEventListener('visibilitychange', resume)
  window.removeEventListener('online', resume); window.removeEventListener('offline', resume); window.removeEventListener('focus', resume)
  clearAccountRestrictions()
})
</script>
<template>
  <aside v-if="accountCloudRestricted || accountPublishingRestricted || hasUnread || restored" class="account-restriction-notice" role="status">
    <span>{{ accountCloudRestricted ? '账号已封禁，云端功能暂停。' : accountPublishingRestricted ? '账号当前禁止发布或发送内容。' : restored ? '账号限制已解除，可以继续使用。' : '你有新的账号处理通知。' }}</span>
    <button type="button" @click="openAccountSection('overview')">查看原因与期限</button>
    <button v-if="restored && !hasUnread" type="button" aria-label="关闭恢复提示" @click="restored = false">关闭</button>
  </aside>
  <AccountRestrictionStatus v-if="blocked" />
</template>
<style scoped>
.account-restriction-notice { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px 16px; margin-bottom:16px; padding:12px 16px; border:1px solid var(--border); border-radius:var(--radius-8); background:var(--card); font-size:var(--fs-12); line-height:1.6; }
button { padding:0; border:0; color:var(--primary); background:transparent; font:inherit; font-weight:var(--fw-650); cursor:pointer; text-decoration:underline; }
</style>
