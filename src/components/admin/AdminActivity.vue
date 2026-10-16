<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { campusModerationHistory } from '../../services/campusLife.js'
import { platformAdminRequest } from '../../services/platformAdmin.js'
import { campusDateTimeLabel } from '../../composables/campusFormatting.js'
/** @typedef {{ id: string, category: string, label: string, title: string, outcome: string, failed: boolean, reason: string, changeDetails: string, createdAt: string, targetId: string }} ActivityRow */
const rows = ref(/** @type {ActivityRow[]} */ ([]))
const loading = ref(false)
const errors = ref(/** @type {string[]} */ ([]))
const category = ref('')
const page = ref(0)
const pageSize = 20
let revision = 0
const filtered = computed(() => rows.value.filter(row => !category.value || row.category === category.value))
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const visible = computed(() => filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize))
watch(category, () => { page.value = 0 })
async function refresh() {
  const run = ++revision
  loading.value = true
  const sources = [
    { category: 'accounts', label: '账号', load: () => platformAdminRequest('audit_list', { limit: 20, category: 'accounts' }) },
    { category: 'feedback', label: '反馈', load: () => platformAdminRequest('audit_list', { limit: 20, category: 'feedback' }) },
    { category: 'places', label: '地点', load: () => platformAdminRequest('place_review_audit', { limit: 20 }) },
    { category: 'campus', label: '校园', load: () => campusModerationHistory(0) },
  ]
  const results = await Promise.allSettled(sources.map(source => source.load()))
  if (revision !== run) return
  const next = []
  const failures = []
  const seen = new Set()
  results.forEach((result, index) => {
    const source = sources[index]
    if (result.status === 'rejected') { failures.push(source.label); return }
    const records = source.category === 'campus' ? result.value?.events || [] : Array.isArray(result.value) ? result.value : []
    for (const event of records.slice(0, 20)) {
      const place = source.category === 'places' || (source.category === 'campus' && event.target_type === 'place')
      const feedbackAudit = source.category === 'feedback' || (source.category === 'accounts' && String(event.action || '').startsWith('feedback.'))
      const category = place ? 'places' : feedbackAudit ? 'feedback' : source.category
      const id = `${category}:${event.id}`
      if (seen.has(id)) continue
      seen.add(id)
      next.push({
        id, category, label: place ? '地点' : feedbackAudit ? '反馈' : source.label,
        title: feedbackAudit ? '处理反馈' : source.category === 'accounts' ? ({ 'user.suspend': '封禁账号', 'user.restore': '解除账号封禁', 'user.publish_restrict': '设置禁止发布', 'user.publish_restore': '解除禁止发布', 'reviewer.grant': '授予审核权限', 'reviewer.revoke': '撤销审核权限', 'registration.open': '恢复注册', 'registration.pause': '暂停注册' })[event.action] || '账号管理' : place ? ((event.decision || event.to_status) === 'approved' ? '通过地点' : '拒绝地点') : ({ approved: '审核通过', active: '已公开', open: '已公开', rejected: '退回或下架', resolved: '举报已处理', dismissed: '举报不成立', completed: '任务完成', cancelled: '任务取消' })[event.to_status] || '校园内容处理',
        outcome: source.category === 'campus' ? '已保存' : ({ started: '处理中', succeeded: '已完成', failed: '失败' })[event.outcome] || '未知',
        failed: event.outcome === 'failed', reason: event.reason || '',
        changeDetails: feedbackAudit ? [
          event.change_details?.fromStatus && event.change_details?.toStatus
            ? `状态：${event.change_details.fromStatus} → ${event.change_details.toStatus}` : '',
          event.change_details?.fromVisibility && event.change_details?.toVisibility
            ? `公开方式：${event.change_details.fromVisibility} → ${event.change_details.toVisibility}` : '',
          event.change_details?.rewardIssued ? `发放贡献豆：${Number(event.change_details.reward) || 0}` : '',
        ].filter(Boolean).join(' · ') : '',
        createdAt: event.created_at,
        targetId: feedbackAudit ? event.change_details?.feedbackId || '' : event.place_id || event.target_user_id || event.target_id || '',
      })
    }
  })
  rows.value = next.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  errors.value = failures
  page.value = Math.min(page.value, pageCount.value - 1)
  loading.value = false
}
onMounted(refresh)
onBeforeUnmount(() => { revision += 1 })
</script>
<template>
  <section class="admin-activity" aria-labelledby="admin-activity-title">
    <div class="activity-toolbar"><h2 id="admin-activity-title">最近操作</h2><label>类型<select v-model="category"><option value="">全部类型</option><option value="accounts">账号</option><option value="feedback">反馈</option><option value="places">地点</option><option value="campus">校园</option></select></label><button type="button" class="text-button" :disabled="loading" @click="refresh">{{ loading ? '刷新中' : '刷新' }}</button></div>
    <p class="activity-limit">每类展示最近 20 条；校园完整记录可在内容审核中查询。</p>
    <p v-if="errors.length" role="alert">{{ errors.join('、') }}记录暂不可用。<button type="button" class="text-button" @click="refresh">重试</button></p>
    <p v-if="loading && !rows.length" role="status">正在读取操作记录…</p>
    <p v-else-if="!visible.length">当前没有操作记录。</p>
    <ul v-else class="activity-list" :aria-busy="loading"><li v-for="row in visible" :key="row.id"><details><summary><span class="activity-category">{{ row.label }}</span><b>{{ row.title }}</b><span :class="{ 'activity-failed': row.failed }">{{ row.outcome }}</span><time :datetime="row.createdAt">{{ campusDateTimeLabel(row.createdAt) }}</time></summary><p>{{ row.reason || '未补充说明。' }}</p><p v-if="row.changeDetails" class="activity-target">{{ row.changeDetails }}</p><p v-if="row.targetId" class="activity-target">{{ row.label }}编号：{{ row.targetId }}</p></details></li></ul>
    <nav v-if="pageCount > 1" class="activity-pagination" aria-label="操作记录分页"><button type="button" class="text-button" :disabled="page === 0" @click="page--">上一页</button><span>{{ page + 1 }} / {{ pageCount }}</span><button type="button" class="text-button" :disabled="page >= pageCount - 1" @click="page++">下一页</button></nav>
  </section>
</template>
<style scoped>
.admin-activity{padding:22px;border:1px solid var(--border);border-radius:var(--radius-12);background:var(--card);min-width:0}.activity-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:16px}.activity-toolbar h2{margin:0 auto 0 0;font-size:var(--fs-17)}.activity-toolbar label{display:flex;align-items:center;gap:8px;font-size:var(--fs-13)}.activity-toolbar select{min-height:40px;max-width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-7);background:var(--card);color:var(--text);font:inherit}.activity-limit{color:var(--muted);font-size:var(--fs-12);margin:12px 0 20px}.activity-list{list-style:none;margin:0;padding:0}.activity-list li{border-top:1px solid var(--border)}.activity-list summary{display:flex;align-items:center;gap:14px;flex-wrap:wrap;min-height:64px;padding:14px 0;cursor:pointer;font-size:var(--fs-13)}.activity-list b{flex:1;min-width:90px}.activity-category{color:var(--muted)}.activity-list time{color:var(--muted);font-size:var(--fs-12)}.activity-list details p{margin:0 0 18px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}.activity-failed{color:var(--danger)}.activity-pagination{display:flex;align-items:center;justify-content:flex-end;gap:16px;margin-top:16px}.activity-pagination button{min-height:44px}@media(max-width:520px){.admin-activity{padding:16px}.activity-list summary{gap:8px}.activity-list time{width:100%}}
.activity-target{color:var(--muted);font-size:var(--fs-12)}
</style>
