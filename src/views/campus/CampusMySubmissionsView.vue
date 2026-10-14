<script setup>
import { computed, onMounted } from 'vue'
import CampusEmptyState from '../../components/campus/CampusEmptyState.vue'
import CampusLoadingState from '../../components/campus/CampusLoadingState.vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusLifeMine } from '../../services/campusLife.js'

const page = useCampusLifePage()
const resubmitTypes = {
  teachers: 'teacher', courses: 'course', assignments: 'assignment', listings: 'market', helpTasks: 'help',
  shuttleRoutes: 'shuttle', shuttleCorrections: 'shuttle_correction', shuttleExceptions: 'shuttle_exception',
  lostFound: 'lost', events: 'event', guides: 'guide',
}
const domains = [
  ['teachers', '教师资料', '/campus/courses', (item) => item.name],
  ['courses', '课程资料', '/campus/courses', (item) => item.name],
  ['assignments', '授课安排', '/campus/courses', (item) => item.term],
  ['courseReviews', '课程评价', '/campus/courses', (item) => item.note || '课程体验'],
  ['listings', '二手信息', '/campus/market', (item) => item.title],
  ['helpTasks', '互助任务', '/campus/help', (item) => item.title],
  ['shuttleRoutes', '校车线路', '/campus/shuttle', (item) => item.name],
  ['shuttleCorrections', '线路纠错', '/campus/shuttle', (item) => item.detail],
  ['shuttleExceptions', '特殊班次', '/campus/shuttle', (item) => `${item.service_date} · ${item.exception_type}`],
  ['lostFound', '失物信息', '/campus/lost-found', (item) => item.title],
  ['events', '校园活动', '/campus/events', (item) => item.title],
  ['guides', '校园指南', '/campus/guides', (item) => item.title],
]
const statusLabels = {
  pending_review: '等待审核', approved: '已通过', active: '公开中', open: '公开中', published: '已发布',
  reserved: '已预留', sold: '已成交', withdrawn: '已下架', rejected: '未通过', pending: '等待处理',
  accepted: '已接受', resolved: '已处理', dismissed: '未成立', retired: '已归档', returned: '已归还',
  claim_pending: '认领处理中', closed: '已关闭', cancelled: '已取消', ended: '已结束', needs_review: '需要复核',
}
const items = computed(() => domains.flatMap(([key, label, route, titleOf]) => (page.data.value?.[key] || []).map((item) => ({
  key: `${key}:${item.id}`,
  label,
  route,
  resubmitType: resubmitTypes[key] || '',
  id: item.id,
  title: String(titleOf(item) || '未命名内容'),
  status: item.review_status || item.status || 'pending',
  reason: item.review_reason || item.resolution || '',
  date: item.updated_at || item.created_at || '',
}))).sort((left, right) => String(right.date).localeCompare(String(left.date))))

async function refresh() { return page.load(campusLifeMine) }
function dateLabel(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
onMounted(() => { void refresh() })
</script>

<template>
  <CampusLifeLayout title="我的校园投稿" description="集中查看自己提交的校园内容与审核结果。公开审核不代表学校或商户身份认证。">
    <template #default>
      <section class="campus-life-panel">
        <div class="campus-mine-heading"><div><h2>投稿记录</h2><p>待审核内容不会出现在公开列表；拒绝意见会显示在对应记录下。</p></div><button class="btn btn-ghost" type="button" :disabled="page.loading.value" @click="refresh">{{ page.loading.value ? '读取中…' : '刷新' }}</button></div>
        <CampusLoadingState v-if="page.loading.value && !page.data.value">正在读取你的校园投稿…</CampusLoadingState>
        <p v-else-if="page.error.value" class="campus-life-inline-state error" role="alert">{{ page.error.value }} <button class="text-button" type="button" @click="refresh">重试</button></p>
        <CampusEmptyState v-else-if="!items.length" title="你的校园分享，从这里开始" description="发布后的内容和审核进度会集中显示在这里。" action="去发布" to="/campus/publish" />
        <div v-else class="campus-mine-list">
          <article v-for="item in items" :key="item.key" class="campus-mine-row">
            <div><span class="campus-life-tag">{{ item.label }}</span><h3>{{ item.title }}</h3><p v-if="item.reason" class="campus-mine-reason">审核意见：{{ item.reason }}</p><small v-if="dateLabel(item.date)">更新于 {{ dateLabel(item.date) }}</small></div>
            <div class="campus-life-actions"><b>{{ statusLabels[item.status] || item.status }}</b><RouterLink class="text-button" :to="item.route">查看模块</RouterLink><RouterLink v-if="item.status === 'rejected' && item.resubmitType" class="text-button" :to="{ path: '/campus/publish', query: { editType: item.resubmitType, id: item.id } }">修改并重新提交</RouterLink><RouterLink v-else-if="item.status === 'rejected' && item.key.startsWith('courseReviews:')" class="text-button" :to="item.route">修改课程评价</RouterLink></div>
          </article>
        </div>
      </section>
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-mine-heading,.campus-mine-row{display:flex;justify-content:space-between;align-items:center;gap:12px}.campus-mine-heading p{margin:5px 0 0;color:var(--muted)}.campus-mine-list{display:grid;gap:8px}.campus-mine-row{padding:12px;border:1px solid var(--border);border-radius:var(--radius-12)}.campus-mine-row h3{margin:6px 0}.campus-mine-row small{color:var(--muted)}.campus-mine-reason{color:var(--danger);overflow-wrap:anywhere}@media(max-width:520px){.campus-mine-heading,.campus-mine-row{align-items:flex-start;flex-direction:column}}
</style>
