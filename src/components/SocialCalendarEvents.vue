<script setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { accountUser } from '../composables/accountAuth.js'
import { appNow } from '../composables/timeContext.js'
import { dateInZone } from '../../supabase/functions/campus-social/availability.js'
import { socialRequest, subscribeSocialNotifications } from '../services/social.js'
import { formatDateTime } from '../composables/intlFormatters.js'

const props = defineProps({ scope: { type: String, default: 'upcoming' } })
const items = ref([])
const timeZone = ref('Asia/Shanghai')
const loading = ref(false)
const error = ref('')
let stopRealtime = null
let requestGeneration = 0
let active = true

const upcoming = computed(() => {
  const now = appNow.value.getTime()
  return items.value
    .filter((item) => item.status === 'confirmed' && Date.parse(item.ends_at) > now)
    .filter((item) => props.scope !== 'today' || dateInZone(Date.parse(item.starts_at), timeZone.value) === dateInZone(appNow.value.getTime(), timeZone.value))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
})

function formatTime(value, { date = true } = {}) {
  return formatDateTime(value, {
    timeZone: timeZone.value,
    ...(date ? { month: 'numeric', day: 'numeric', weekday: 'short' } : {}),
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
}

function startsSoon(item) {
  const delta = Date.parse(item.starts_at) - appNow.value.getTime()
  return delta >= 0 && delta <= 2 * 60 * 60_000
}

async function load(token = requestGeneration) {
  const user = accountUser.value
  if (!user?.id || !user.email_confirmed_at) { items.value = []; return }
  loading.value = true
  error.value = ''
  try {
    const [profile, result] = await Promise.all([socialRequest('profile_get'), socialRequest('invitations_list')])
    if (token !== requestGeneration) return
    timeZone.value = profile.profile?.timezone || 'Asia/Shanghai'
    items.value = result.invitations || []
  } catch (cause) {
    if (token === requestGeneration) error.value = cause.message || '暂时无法读取好友邀约。'
  } finally {
    if (token === requestGeneration) loading.value = false
  }
}

async function setup(userId) {
  requestGeneration++
  const token = requestGeneration
  stopRealtime?.()
  stopRealtime = null
  items.value = []
  error.value = ''
  if (!userId || !accountUser.value?.email_confirmed_at) return
  await load(token)
  try {
    stopRealtime = await subscribeSocialNotifications(userId, () => { void load(token) })
  } catch (cause) {
    if (token === requestGeneration && !error.value) error.value = cause.message || '实时提醒暂不可用。'
  }
}

watch(() => accountUser.value?.id || '', (userId) => { if (active) void setup(userId) }, { immediate: true })
onActivated(() => { active = true; void setup(accountUser.value?.id || '') })
onDeactivated(() => { active = false; requestGeneration++; stopRealtime?.(); stopRealtime = null })
onBeforeUnmount(() => { requestGeneration++; stopRealtime?.() })
</script>

<template>
  <section v-if="loading || error || upcoming.length" class="social-calendar panel" :aria-label="scope === 'today' ? '今天的好友邀约' : '好友邀约日程'">
    <header class="social-calendar-head">
      <div><span class="eyebrow">共同日程</span><h2>{{ scope === 'today' ? '今天的好友邀约' : '已确认的好友邀约' }}</h2></div>
      <router-link to="/together" class="panel-link">管理邀约 →</router-link>
    </header>
    <p v-if="loading" class="social-calendar-state">正在读取已确认邀约…</p>
    <p v-else-if="error" class="social-calendar-state error" role="alert">{{ error }} <router-link to="/together">打开一起约</router-link></p>
    <div v-else class="social-calendar-list">
      <article v-for="item in upcoming" :key="item.id" class="social-calendar-item">
        <span class="social-calendar-mark" aria-hidden="true">👥</span>
        <div class="social-calendar-copy">
          <div class="social-calendar-title"><b>{{ item.title }}</b><span v-if="startsSoon(item)" class="soon-tag">即将开始</span></div>
          <span>{{ formatTime(item.starts_at) }} – {{ formatTime(item.ends_at, { date: false }) }} · 和 {{ item.peer?.profile?.nickname || '好友' }}</span>
          <small v-if="item.location">📍 {{ item.location }}</small>
        </div>
      </article>
      <p v-if="!upcoming.length && !loading" class="social-calendar-state">{{ scope === 'today' ? '今天还没有待参加的好友邀约。' : '暂无即将开始的好友邀约。' }}</p>
    </div>
  </section>
</template>

<style scoped>
.social-calendar { margin:0 0 14px; padding:15px 17px; border:1px solid var(--border); border-radius:var(--card-radius); background:var(--card); }
.social-calendar-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:9px; }
.social-calendar-head h2 { margin:3px 0 0; font-size:var(--fs-15); }
.eyebrow { color:var(--primary); font-size:var(--fs-10); font-weight:var(--fw-800); letter-spacing:.04em; }
.panel-link { color:var(--primary); font-size:var(--fs-11); font-weight:var(--fw-700); text-decoration:none; white-space:nowrap; }
.social-calendar-list { display:grid; gap:6px; }
.social-calendar-item { display:flex; align-items:flex-start; gap:9px; padding:9px 10px; border-radius:var(--radius-9); background:var(--bg-tint); }
.social-calendar-mark { display:grid; flex:0 0 30px; place-items:center; width:30px; height:30px; border-radius:var(--radius-8); background:var(--primary-soft); }
.social-calendar-copy { display:grid; min-width:0; gap:3px; color:var(--ink-soft); font-size:var(--fs-12); }
.social-calendar-title { display:flex; align-items:center; flex-wrap:wrap; gap:7px; color:var(--text); }
.social-calendar-copy > span { font-size:var(--fs-11); }
.social-calendar-copy small { color:var(--muted); font-size:var(--fs-10); }
.soon-tag { padding:2px 6px; border-radius:var(--radius-pill); color:var(--warning); background:color-mix(in srgb,var(--warning) 10%,var(--card)); font-size:var(--fs-10); font-weight:var(--fw-700); }
.social-calendar-state { margin:4px 0; color:var(--muted); font-size:var(--fs-11); line-height:1.5; }
.social-calendar-state.error { color:var(--danger); }
.social-calendar-state a { color:inherit; }
@media (max-width:520px) { .social-calendar { padding:13px; } }
</style>
