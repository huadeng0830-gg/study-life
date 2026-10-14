<script setup>
import { onMounted, ref } from 'vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusEmptyState from '../../components/campus/CampusEmptyState.vue'
import CampusLoadingState from '../../components/campus/CampusLoadingState.vue'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusContentLabels, campusContentRoute, campusReportReasons, campusReportStatuses } from '../../composables/campusContentModel.js'
import { campusMyReports } from '../../services/campusLife.js'
const page = useCampusLifePage()
const pageIndex = ref(0)
async function refresh(index = pageIndex.value) {
  pageIndex.value = Math.max(0, index)
  return page.load(() => campusMyReports(pageIndex.value))
}
function dateLabel(value) { return value ? new Date(value).toLocaleString('zh-CN') : '' }
onMounted(() => { void refresh() })
</script>

<template>
  <CampusLifeLayout title="我的举报" description="举报说明仅对你和有权限的审核人员可见。处理结果和依据会保留在这里。">
    <section class="campus-life-panel">
      <div class="campus-report-heading"><div><h2>处理进度</h2><p>审核人员会核对原内容，决定是否下架或作其他处理。</p></div><Button variant="outline" :disabled="page.loading.value" @click="refresh()">刷新</Button></div>
      <p v-if="page.error.value" role="alert" class="campus-life-inline-state error">{{ page.error.value }} <button class="text-button" @click="refresh()">重试</button></p>
      <CampusLoadingState v-if="page.loading.value && !page.data.value">正在读取举报记录…</CampusLoadingState>
      <CampusEmptyState v-else-if="page.data.value && !page.data.value.reports?.length" title="暂时没有举报记录" description="发现不准确、侵犯隐私或违规的校园内容时，可以在内容卡片上提交举报。" action="浏览校园" to="/campus" />
      <article v-for="item in page.data.value?.reports || []" :key="item.id" class="campus-life-card">
        <div class="campus-life-meta"><Badge variant="outline">{{ campusContentLabels[item.target_type] || '校园内容' }}</Badge><Badge variant="secondary">{{ campusReportStatuses[item.status] || item.status }}</Badge><span>{{ dateLabel(item.created_at) }}</span></div>
        <h3>{{ campusReportReasons[item.reason] || '其他问题' }}</h3><p>{{ item.detail || '提交时没有补充说明。' }}</p>
        <div v-if="item.resolution" class="campus-report-resolution"><b>处理说明</b><p>{{ item.resolution }}</p><small>{{ item.resolution_action === 'remove' ? '原内容已下架' : item.status === 'dismissed' ? '审核未认定举报成立' : '已核实并完成处理' }} · {{ dateLabel(item.resolved_at) }}</small></div>
        <p v-else class="campus-life-meta">等待审核人员核对，同一内容的待处理举报无需重复提交。</p>
        <RouterLink :to="campusContentRoute(item.target_type)">返回相关模块</RouterLink>
      </article>
      <nav v-if="page.data.value?.total > 30" class="campus-life-actions" aria-label="举报记录分页"><Button variant="outline" :disabled="page.loading.value || pageIndex === 0" @click="refresh(pageIndex - 1)">上一页</Button><span>第 {{ pageIndex + 1 }} 页 · 共 {{ page.data.value.total }} 条</span><Button variant="outline" :disabled="page.loading.value || (pageIndex + 1) * 30 >= page.data.value.total" @click="refresh(pageIndex + 1)">下一页</Button></nav>
    </section>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-report-heading{display:flex;align-items:center;justify-content:space-between;gap:14px}.campus-report-resolution{display:grid;gap:8px;padding:16px;border-radius:var(--radius-9);background:var(--bg-tint)}.campus-report-resolution small{color:var(--muted);font-size:var(--fs-12)}
</style>
