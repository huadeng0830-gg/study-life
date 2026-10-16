<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { accountUser } from '../../composables/accountAuth.js'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusStateBlock from '../../components/campus/CampusStateBlock.vue'
import CampusStatusMessages from '../../components/campus/CampusStatusMessages.vue'
import { CAMPUS_PAGE_SIZE, campusContentLabel, campusContentRoute, campusReportReasons, campusReportStatuses } from '../../composables/campusContentModel.js'
import { campusDateTimeLabel } from '../../composables/campusFormatting.js'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusMyReports, submitCampusReportAppeal } from '../../services/campusLife.js'

const page = useCampusLifePage()
const pageIndex = ref(0)
const appealDrafts = reactive(/** @type {Record<string, string>} */ ({}))
const appealBusy = ref('')

watch(() => accountUser.value?.id, () => {
  Object.keys(appealDrafts).forEach((key) => delete appealDrafts[key])
  appealBusy.value = ''
}, { flush: 'sync' })

async function refresh(index = pageIndex.value) {
  pageIndex.value = Math.max(0, index)
  const result = await page.load(() => campusMyReports(pageIndex.value), null, { cacheKey: ['reports', pageIndex.value] })
  for (const item of result?.reports || []) if (!(item.id in appealDrafts)) appealDrafts[item.id] = ''
  return result
}
onMounted(() => { void refresh() })

const total = () => page.data.value?.total || 0
const hasPages = () => total() > CAMPUS_PAGE_SIZE
async function submitAppeal(item) {
  if (appealBusy.value) return
  const reason = String(appealDrafts[item.id] || '').trim()
  if ([...reason].length < 10) { page.reportFailure('请至少补充 10 个字，说明原处理可能遗漏的事实或材料。'); return }
  appealBusy.value = item.id
  const ok = await page.act(() => submitCampusReportAppeal(item.id, reason, item.revision), '复核申请已提交；结果会显示在这条举报记录中。')
  if (appealBusy.value === item.id) appealBusy.value = ''
  if (ok) { delete appealDrafts[item.id]; await refresh() }
}
</script>

<template>
  <CampusLifeLayout title="我的举报" description="举报说明仅对你和有权限的审核人员可见。处理结果和依据会保留在这里。">
    <section class="campus-life-panel">
      <div class="campus-report-heading"><div><h2>处理进度</h2><p>审核人员会核对原内容，决定是否下架或作其他处理。</p></div><Button variant="outline" :disabled="page.loading.value" @click="refresh()">刷新</Button></div>
      <CampusStatusMessages :notice="page.notice.value" :error="page.actionError.value" />
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
          <div class="campus-life-meta"><Badge variant="outline">{{ campusContentLabel(item.target_type) }}</Badge><Badge variant="secondary">{{ item.appeal_status === 'accepted' ? '复核已采纳' : campusReportStatuses[item.status] || item.status }}</Badge><Badge v-if="item.appeal_status === 'pending_review'" variant="outline">复核中</Badge><span>{{ campusDateTimeLabel(item.created_at) }}</span></div>
          <h3>{{ campusReportReasons[item.reason] || '其他问题' }}</h3><p>{{ item.detail || '提交时没有补充说明。' }}</p>
          <div v-if="item.resolution" class="campus-report-resolution"><b>{{ item.appeal_status === 'none' ? '处理说明' : '原处理说明' }}</b><p>{{ item.resolution }}</p><small>{{ item.resolution_action === 'remove' ? '原内容已下架' : item.status === 'dismissed' ? '审核未认定举报成立' : '已核实并完成处理' }} · {{ campusDateTimeLabel(item.resolved_at) }}</small></div>
          <p v-if="item.status === 'pending_review' && item.response_due_at" class="campus-report-sla">处理目标：{{ campusDateTimeLabel(item.response_due_at) }} 前（{{ item.response_target_hours || 72 }} 小时目标；超时不会自动关闭）。</p>
          <div v-if="item.appeal_reason" class="campus-report-appeal"><b>我的申诉说明</b><p>{{ item.appeal_reason }}</p><p v-if="item.appeal_status === 'pending_review'">复核处理中，目标为 {{ campusDateTimeLabel(item.response_due_at) }} 前完成（{{ item.response_target_hours || 72 }} 小时目标）。</p><p v-else-if="item.appeal_status === 'accepted' || item.appeal_status === 'upheld'">复核结果：{{ item.appeal_status === 'accepted' ? '申诉已采纳' : '维持原结论' }} · {{ campusDateTimeLabel(item.appeal_resolved_at) }}</p><p v-if="item.appeal_resolution" class="campus-report-appeal-result">复核说明：{{ item.appeal_resolution }}</p></div>
          <p v-if="item.status === 'pending_review' && !item.resolution" class="campus-life-meta">等待审核人员核对，同一内容的待处理举报无需重复提交。</p>
          <form v-if="item.can_appeal" class="campus-report-appeal-form" @submit.prevent="submitAppeal(item)"><label :for="`appeal-${item.id}`">申请一次复核<textarea :id="`appeal-${item.id}`" v-model="appealDrafts[item.id]" maxlength="500" rows="3" :disabled="Boolean(appealBusy)" placeholder="补充原处理中可能遗漏的事实或材料；不要重复提交相同内容。" /></label><p>仅“未成立”的举报可在结果后 7 日内申诉一次（截止 {{ campusDateTimeLabel(item.appeal_deadline) }}）。复核由非原处理人完成；处理目标为 72 小时，超时仍会继续处理。</p><Button type="submit" variant="outline" :disabled="Boolean(appealBusy)">{{ appealBusy === item.id ? '正在提交…' : '提交复核申请' }}</Button></form>
          <RouterLink :to="campusContentRoute(item.target_type)">返回相关模块</RouterLink>
        </article>
        <nav v-if="hasPages()" class="campus-life-actions" aria-label="举报记录分页"><Button variant="outline" :disabled="page.loading.value || pageIndex === 0" @click="refresh(pageIndex - 1)">上一页</Button><span>第 {{ pageIndex + 1 }} 页 · 共 {{ total() }} 条</span><Button variant="outline" :disabled="page.loading.value || (pageIndex + 1) * CAMPUS_PAGE_SIZE >= total()" @click="refresh(pageIndex + 1)">下一页</Button></nav>
      </CampusStateBlock>
    </section>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-report-heading{display:flex;align-items:center;justify-content:space-between;gap:14px}.campus-report-resolution,.campus-report-appeal{display:grid;gap:8px;padding:16px;border-radius:var(--radius-9);background:var(--bg-tint)}.campus-report-resolution small{color:var(--muted);font-size:var(--fs-12)}.campus-report-sla,.campus-report-appeal-form>p,.campus-report-appeal>p{margin:0;color:var(--muted);font-size:var(--fs-12);line-height:1.7}.campus-report-appeal-form{display:grid;gap:10px;padding:16px;border:1px solid var(--border);border-radius:var(--radius-9)}.campus-report-appeal-form label{display:grid;gap:7px;font-size:var(--fs-13);font-weight:var(--fw-650)}.campus-report-appeal-form textarea{box-sizing:border-box;width:100%;min-height:88px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--bg);color:var(--text);font:inherit;font-weight:var(--fw-400);resize:vertical}.campus-report-appeal-form textarea:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.campus-report-appeal-form button{justify-self:start}.campus-report-appeal-result{white-space:pre-wrap}@media(max-width:520px){.campus-report-heading{align-items:flex-start;flex-direction:column}.campus-report-appeal-form button{justify-self:stretch}}
</style>
