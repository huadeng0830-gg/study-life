<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { accountUser } from '../../composables/accountAuth.js'
import { Button } from '../../components/ui/button'
import CampusConfirmDialog from '../../components/campus/CampusConfirmDialog.vue'
import CampusEmptyState from '../../components/campus/CampusEmptyState.vue'
import CampusLifeLayout from '../../components/campus/CampusLifeLayout.vue'
import CampusStateBlock from '../../components/campus/CampusStateBlock.vue'
import CampusStatusMessages from '../../components/campus/CampusStatusMessages.vue'
import { CAMPUS_RESUBMITTABLE_STATUSES, CAMPUS_SUBMISSION_DOMAINS, campusStatusLabel, flattenCampusSubmissions } from '../../composables/campusContentModel.js'
import { useCampusConfirm } from '../../composables/campusConfirm.js'
import { campusDateLabel } from '../../composables/campusFormatting.js'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { campusLifeMine, withdrawCampusContent } from '../../services/campusLife.js'

const page = useCampusLifePage()
const confirm = useCampusConfirm()
const confirmRequest = confirm.pending
const withdrawing = ref(false)
const searchText = ref('')
const domainFilter = ref('all')
const statusFilter = ref('all')
const pageIndex = ref(0)
const PAGE_SIZE = 20

watch(() => accountUser.value?.id, () => { confirm.close(); withdrawing.value = false }, { flush: 'sync' })

const items = computed(() => flattenCampusSubmissions(page.data.value))
const statusGroups = {
  pending: ['pending', 'pending_review'],
  active: ['approved', 'active', 'open', 'published'],
  returned: ['rejected'],
  withdrawn: ['withdrawn'],
}
const statusTabs = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'active', label: '已公开' },
  { key: 'returned', label: '需跟进' },
  { key: 'withdrawn', label: '已撤回' },
]
const statusCounts = computed(() => ({
  all: items.value.length,
  pending: items.value.filter((item) => statusGroups.pending.includes(item.status)).length,
  active: items.value.filter((item) => statusGroups.active.includes(item.status)).length,
  returned: items.value.filter((item) => statusGroups.returned.includes(item.status)).length,
  withdrawn: items.value.filter((item) => statusGroups.withdrawn.includes(item.status)).length,
}))
const filteredItems = computed(() => {
  const query = searchText.value.trim().toLocaleLowerCase()
  return items.value.filter((item) => {
    if (domainFilter.value !== 'all' && item.domainKey !== domainFilter.value) return false
    if (statusFilter.value !== 'all') {
      const group = statusGroups[statusFilter.value]
      if (!group?.includes(item.status)) return false
    }
    if (!query) return true
    return [item.title, item.label, item.reason, campusStatusLabel(item.status)]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query))
  })
})
const pageCount = computed(() => Math.max(1, Math.ceil(filteredItems.value.length / PAGE_SIZE)))
const pageItems = computed(() => filteredItems.value.slice(pageIndex.value * PAGE_SIZE, (pageIndex.value + 1) * PAGE_SIZE))
const hasActiveFilters = computed(() => Boolean(searchText.value.trim()) || domainFilter.value !== 'all' || statusFilter.value !== 'all')
const canResubmit = (item) => CAMPUS_RESUBMITTABLE_STATUSES.includes(item.status) && Boolean(item.resubmitType || item.domainKey === 'courseReviews')
function clearFilters() { searchText.value = ''; domainFilter.value = 'all'; statusFilter.value = 'all' }

watch([searchText, domainFilter, statusFilter], () => { pageIndex.value = 0 })
watch(pageCount, (count) => { if (pageIndex.value >= count) pageIndex.value = count - 1 })

async function refresh({ forceRefresh = false } = {}) { return page.load(() => campusLifeMine({ view: 'summary' }, { forceRefresh }), null, { cacheKey: ['mine', 'summary'] }) }

function askWithdraw(item) {
  confirm.ask({
    title: '撤回这条校园内容？',
    message: `撤回「${item.title}」后，同学们将无法在公开列表查看，审核员也不再处理此版本。之后仍可修改并重新提交审核。`,
    confirmLabel: '确认撤回',
    tone: 'danger',
    onConfirm: () => withdraw(item),
  })
}

async function withdraw(item) {
  if (withdrawing.value) return
  withdrawing.value = true
  const ok = await page.act(() => withdrawCampusContent(item.targetType, item.id, item.revision), '内容已撤回，已退出公开展示或待审队列。')
  withdrawing.value = false
  if (ok) await refresh()
}

onMounted(() => { void refresh() })
</script>

<template>
  <CampusLifeLayout title="我的校园投稿" description="集中查看自己提交的校园内容与审核结果。公开审核不代表学校或商户身份认证。">
    <template #default>
      <section class="campus-life-panel">
        <div class="campus-mine-heading"><div><h2>投稿记录</h2><p>发布 → 等待审核 → 公开展示。退回后可修改重提；每类显示最近 100 条记录。</p></div><button class="btn btn-ghost" type="button" :disabled="page.loading.value" @click="refresh({ forceRefresh: true })">{{ page.loading.value ? '读取中…' : '刷新' }}</button></div>
        <CampusStatusMessages :notice="page.notice.value" :error="page.actionError.value" />
        <CampusStateBlock
          :loading="page.loading.value"
          :loaded="Boolean(page.data.value)"
          :error="page.error.value"
          :empty="!items.length"
          loading-text="正在读取你的校园投稿…"
          empty-title="你的校园分享，从这里开始"
          empty-description="发布后的内容和审核进度会集中显示在这里。"
          empty-action="去发布"
          empty-to="/campus/publish"
          @retry="refresh()"
        >
          <div v-if="items.length" class="campus-mine-workspace">
            <div class="campus-mine-summary" aria-label="投稿状态统计">
              <button v-for="item in statusTabs" :key="item.key" type="button" :aria-pressed="statusFilter === item.key" :class="{ selected: statusFilter === item.key }" @click="statusFilter = item.key"><span>{{ item.label }}</span><b>{{ statusCounts[item.key] }}</b></button>
            </div>
            <div class="campus-mine-filters">
              <label>搜索投稿<input v-model="searchText" type="search" maxlength="80" placeholder="按标题、类别或处理说明查找" /></label>
              <label>投稿类别<select v-model="domainFilter"><option value="all">全部类别</option><option v-for="domain in CAMPUS_SUBMISSION_DOMAINS" :key="domain.key" :value="domain.key">{{ domain.label }}</option></select></label>
              <button v-if="hasActiveFilters" class="text-button" type="button" @click="clearFilters">清除筛选</button>
            </div>
            <p class="campus-mine-result-count" role="status">{{ filteredItems.length ? `显示 ${pageIndex * PAGE_SIZE + 1}–${Math.min((pageIndex + 1) * PAGE_SIZE, filteredItems.length)} 条，共 ${filteredItems.length} 条` : '没有符合条件的投稿' }}</p>
            <div v-if="pageItems.length" class="campus-mine-list">
              <article v-for="item in pageItems" :key="item.key" class="campus-mine-row">
                <div><span class="campus-life-tag">{{ item.label }}</span><h3>{{ item.title }}</h3><p v-if="item.reason" class="campus-mine-reason">处理说明：{{ item.reason }}</p><small v-if="campusDateLabel(item.date)">更新于 {{ campusDateLabel(item.date) }}</small></div>
                <div class="campus-life-actions"><b>{{ campusStatusLabel(item.status) }}</b><Button v-if="item.canWithdraw" variant="ghost" :disabled="withdrawing" @click="askWithdraw(item)">撤回</Button><RouterLink class="text-button" :to="item.route">查看模块</RouterLink><RouterLink v-if="canResubmit(item) && item.resubmitType" class="text-button" :to="{ path: '/campus/publish', query: { editType: item.resubmitType, id: item.id } }">修改并重新提交</RouterLink><RouterLink v-else-if="canResubmit(item)" class="text-button" :to="item.route">修改课程评价</RouterLink></div>
              </article>
            </div>
            <CampusEmptyState v-else title="没有找到匹配的投稿" description="试试调整搜索词、类别或状态筛选。"><Button variant="outline" @click="clearFilters">清除筛选</Button></CampusEmptyState>
            <nav v-if="filteredItems.length > PAGE_SIZE" class="campus-mine-pagination" aria-label="投稿记录分页"><Button variant="outline" :disabled="pageIndex === 0" @click="pageIndex--">上一页</Button><span>第 {{ pageIndex + 1 }} / {{ pageCount }} 页</span><Button variant="outline" :disabled="pageIndex + 1 >= pageCount" @click="pageIndex++">下一页</Button></nav>
          </div>
        </CampusStateBlock>
      </section>
      <CampusConfirmDialog :request="confirmRequest" @confirm="confirm.confirm()" @close="confirm.close()" />
    </template>
  </CampusLifeLayout>
</template>

<style scoped>
.campus-mine-heading,.campus-mine-row{display:flex;justify-content:space-between;align-items:center;gap:12px}.campus-mine-heading p{margin:5px 0 0;color:var(--muted)}.campus-mine-workspace{display:grid;gap:14px}.campus-mine-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.campus-mine-summary button{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;min-height:56px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--card);color:var(--text);font:inherit;text-align:left;cursor:pointer}.campus-mine-summary button:focus-visible{outline:var(--focus-width) solid var(--focus-solid);outline-offset:var(--focus-offset)}.campus-mine-summary button.selected{border-color:var(--primary);background:var(--primary-soft);color:var(--primary)}.campus-mine-summary button b{font-size:var(--fs-17);font-variant-numeric:tabular-nums}.campus-mine-filters{display:grid;grid-template-columns:minmax(180px,1fr) minmax(150px,.6fr) auto;align-items:end;gap:10px}.campus-mine-filters label{display:grid;gap:5px;color:var(--muted);font-size:var(--fs-11)}.campus-mine-filters :is(input,select){box-sizing:border-box;width:100%;min-width:0;min-height:42px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--card);color:var(--text);font:inherit;font-size:var(--fs-12)}.campus-mine-result-count{margin:0;color:var(--muted);font-size:var(--fs-11)}.campus-mine-list{display:grid;gap:8px}.campus-mine-row{padding:12px;border:1px solid var(--border);border-radius:var(--radius-12)}.campus-mine-row h3{margin:6px 0}.campus-mine-row small{color:var(--muted)}.campus-mine-reason{color:var(--danger);overflow-wrap:anywhere}.campus-mine-pagination{display:flex;align-items:center;justify-content:center;gap:12px}.campus-mine-pagination span{color:var(--muted);font-size:var(--fs-11)}@media(max-width:760px){.campus-mine-summary{grid-template-columns:repeat(3,minmax(0,1fr))}.campus-mine-filters{grid-template-columns:1fr 1fr}.campus-mine-filters>button{grid-column:1/-1;justify-self:start}}@media(max-width:520px){.campus-mine-heading,.campus-mine-row{align-items:flex-start;flex-direction:column}.campus-mine-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.campus-mine-filters{grid-template-columns:1fr}.campus-mine-filters>button{grid-column:auto}}
</style>
