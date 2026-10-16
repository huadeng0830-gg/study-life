<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowRight, RefreshCw } from '@lucide/vue'
import { campusFeedbackAdminList } from '../../services/campusCommunity.js'
import { campusModerationQueue } from '../../services/campusLife.js'
import { platformAdminRequest } from '../../services/platformAdmin.js'
const props = defineProps({ owner: Boolean })
/** @typedef {{ id: string, title: string, to: string, count: number|null }} QueueRow */
const rows = ref(/** @type {QueueRow[]} */ ([]))
const loading = ref(false)
let revision = 0
async function refresh() {
  const run = ++revision
  loading.value = true
  const tasks = [
    ...(props.owner ? [
      { id: 'feedback', title: '待处理反馈', to: '/admin/feedback?status=pending', load: () => campusFeedbackAdminList({ status: 'pending', view: 'summary', limit: 1 }) },
      { id: 'progress', title: '处理中的反馈', to: '/admin/feedback?status=processing', load: () => campusFeedbackAdminList({ status: 'processing', view: 'summary', limit: 1 }) },
    ] : []),
    { id: 'campus', title: '校园投稿与举报', to: '/admin/campus', load: () => campusModerationQueue(0) },
    ...(props.owner ? [{ id: 'places', title: '待审核地点', to: '/platform-admin?section=places', load: () => platformAdminRequest('places_pending', { page: 1 }) }] : []),
  ]
  const results = await Promise.allSettled(tasks.map(task => task.load()))
  if (run !== revision) return
  rows.value = tasks.map((task, index) => {
    const result = results[index]
    return { id: task.id, title: task.title, to: task.to, count: result.status === 'fulfilled' && Number.isSafeInteger(result.value?.total) ? result.value.total : null }
  })
  loading.value = false
}
onMounted(refresh)
onBeforeUnmount(() => { revision += 1 })
</script>
<template>
  <section class="admin-inbox" aria-labelledby="admin-inbox-title">
    <div class="admin-inbox-heading"><h2 id="admin-inbox-title">待办队列</h2><button type="button" class="text-button" :disabled="loading" @click="refresh"><RefreshCw :size="16" aria-hidden="true" />{{ loading ? '刷新中' : '刷新' }}</button></div>
    <p v-if="loading && !rows.length" role="status">正在读取待办…</p>
    <ul v-else :aria-busy="loading"><li v-for="row in rows" :key="row.id"><RouterLink :to="row.to"><span>{{ row.title }}</span><strong v-if="row.count !== null" :class="{ pending: row.count > 0 }">{{ row.count }}</strong><span v-else class="admin-inbox-unavailable">暂不可用</span><ArrowRight :size="18" aria-hidden="true" /></RouterLink></li></ul>
  </section>
</template>
<style scoped>
.admin-inbox{border:1px solid var(--border);border-radius:var(--radius-12);background:var(--card);padding:22px}.admin-inbox-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.admin-inbox-heading h2{margin:0;font-size:var(--fs-17)}.admin-inbox-heading button{display:flex;align-items:center;gap:6px;min-height:44px}.admin-inbox ul{list-style:none;margin:0;padding:0}.admin-inbox li+li{border-top:1px solid var(--border)}.admin-inbox li a{display:flex;align-items:center;gap:16px;min-height:76px;padding:16px 4px;color:var(--text);text-decoration:none}.admin-inbox li a:hover{color:var(--primary)}.admin-inbox li a:focus-visible{outline:var(--focus-width) solid var(--focus-solid);outline-offset:var(--focus-offset)}.admin-inbox li a>span:first-child{flex:1}.admin-inbox strong{font-size:var(--fs-24);color:var(--muted);font-variant-numeric:tabular-nums}.admin-inbox strong.pending{color:var(--primary)}.admin-inbox-unavailable{font-size:var(--fs-13);color:var(--muted)}@media(max-width:520px){.admin-inbox{padding:16px}.admin-inbox li a{gap:10px;min-height:68px}}
</style>
