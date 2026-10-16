<script setup>
import { onMounted, ref } from 'vue'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusStateBlock from '../../components/campus/CampusStateBlock.vue'
import CampusStatusMessages from '../../components/campus/CampusStatusMessages.vue'
import { CAMPUS_PAGE_SIZE, campusContentLabel, campusContentRoute, campusReportReasons, campusReportStatuses } from '../../composables/campusContentModel.js'
import { campusDateTimeLabel } from '../../composables/campusFormatting.js'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusMyReports } from '../../services/campusLife.js'

const page = useCampusLifePage()
const pageIndex = ref(0)

async function refresh(index = pageIndex.value) {
  pageIndex.value = Math.max(0, index)
  return page.load(() => campusMyReports(pageIndex.value), null, { cacheKey: ['reports', pageIndex.value] })
}
onMounted(() => { void refresh() })

const total = () => page.data.value?.total || 0
const hasPages = () => total() > CAMPUS_PAGE_SIZE
</script>

<template>
  <CampusLifeLayout title="我的举报" description="举报说明仅对你和有权限的审核人员可见。处理结果和依据会保留在这里。">
    <section class="campus-life-panel">
      <div class="campus-report-heading"><div><h2>处理进度</h2><p>审核人员会核对原内容，决定是否下架或作其他处理。</p></div><Button variant="outline" :disabled="page.loading.value" @click="refresh()">刷新</Button></div>
      <CampusStatusMessages :error="page.actionError.value" />
      <CampusStateBlock
        :loading="page.loading.value"
        :loaded="Boolean(page.data.value)"
        :error="page.error.value"
        :empty="!page.data.value?.reports?.length"
        loading-text="正在读取举报记录…"
        empty-title="暂时没有举报记录"
        empty-description="发现不准确、侵犯隐私或违规的校园内容时，可以在内容卡片上提交举报。"
        empty-action="浏览校园"
        empty-to="/campus"
        @retry="refresh()"
      >
        <!-- 内容与空状态共用同一个分支：旧模板把 v-for 写在 v-else 链之外，
             于是「没有举报记录」会和举报列表同时出现在页面上。 -->
        <article v-for="item in page.data.value.reports" :key="item.id" class="campus-life-card">
          <div class="campus-life-meta"><Badge variant="outline">{{ campusContentLabel(item.target_type) }}</Badge><Badge variant="secondary">{{ campusReportStatuses[item.status] || item.status }}</Badge><span>{{ campusDateTimeLabel(item.created_at) }}</span></div>
          <h3>{{ campusReportReasons[item.reason] || '其他问题' }}</h3><p>{{ item.detail || '提交时没有补充说明。' }}</p>
          <div v-if="item.resolution" class="campus-report-resolution"><b>处理说明</b><p>{{ item.resolution }}</p><small>{{ item.resolution_action === 'remove' ? '原内容已下架' : item.status === 'dismissed' ? '审核未认定举报成立' : '已核实并完成处理' }} · {{ campusDateTimeLabel(item.resolved_at) }}</small></div>
          <p v-else class="campus-life-meta">等待审核人员核对，同一内容的待处理举报无需重复提交。</p>
          <RouterLink :to="campusContentRoute(item.target_type)">返回相关模块</RouterLink>
        </article>
        <nav v-if="hasPages()" class="campus-life-actions" aria-label="举报记录分页"><Button variant="outline" :disabled="page.loading.value || pageIndex === 0" @click="refresh(pageIndex - 1)">上一页</Button><span>第 {{ pageIndex + 1 }} 页 · 共 {{ total() }} 条</span><Button variant="outline" :disabled="page.loading.value || (pageIndex + 1) * CAMPUS_PAGE_SIZE >= total()" @click="refresh(pageIndex + 1)">下一页</Button></nav>
      </CampusStateBlock>
    </section>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-report-heading{display:flex;align-items:center;justify-content:space-between;gap:14px}.campus-report-resolution{display:grid;gap:8px;padding:16px;border-radius:var(--radius-9);background:var(--bg-tint)}.campus-report-resolution small{color:var(--muted);font-size:var(--fs-12)}
</style>
