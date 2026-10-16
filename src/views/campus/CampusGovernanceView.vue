<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { accountOpen, accountUser } from '../../composables/accountAuth.js'
import { useCampusGovernanceAccess } from '../../composables/campusGovernanceAccess.js'
import { useCampusLifePage } from '../../composables/campusLifePage.js'
import { CAMPUS_PAGE_SIZE, campusContentLabels, campusErrorMessage } from '../../composables/campusContentModel.js'
import { campusDateTimeLabel } from '../../composables/campusFormatting.js'
import { campusModerationQueue, campusModerationHistory, decideCampusModeration, resolveCampusReport, resolveCampusHelpDispute } from '../../services/campusLife.js'
import CampusReviewItem from '../../components/campus/CampusReviewItem.vue'
import CampusReviewerManager from '../../components/campus/CampusReviewerManager.vue'
import CampusCommunityAdmin from '../../components/campus/CampusCommunityAdmin.vue'
import CampusEmptyState from '../../components/campus/CampusEmptyState.vue'
import CampusLoadingState from '../../components/campus/CampusLoadingState.vue'
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Field, FieldGroup, FieldLabel } from '../../components/ui/field'
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'
import '../../components/campus/campus-life.css'
const { access, error: accessError, loading: accessLoading, refresh: refreshAccess } = useCampusGovernanceAccess()
const page = useCampusLifePage()
const history = useCampusLifePage()
const props = defineProps({ team: Boolean })
const route = useRoute()
const router = useRouter()
const allowedTabs = ['queue', 'history', 'reviewers', 'applications', 'audits']
const tab = computed({ get: () => allowedTabs.includes(String(route.query.tab)) ? String(route.query.tab) : (props.team ? 'reviewers' : 'queue'), set: value => { void router.replace({ query: { ...route.query, tab: value } }) } })
const type = ref('')
const pageIndex = ref(0)
const historyIndex = ref(0)
const busy = reactive({})
const actionError = ref('')
const notice = ref('')
const readableCount = computed(() => page.data.value?.total ?? '—')
const categoryOptions = Object.entries(campusContentLabels)
let actionGeneration = 0
watch(() => accountUser.value?.id, () => { actionGeneration += 1; actionError.value = ''; notice.value = ''; pageIndex.value = 0; historyIndex.value = 0; Object.keys(busy).forEach(key => delete busy[key]) }, { flush: 'sync' })
watch(access, value => { if (value?.reviewer && !props.team) void refresh(0) }, { immediate: true })
watch(type, () => { void refresh(0) })
watch([tab, access], ([value, identity]) => { if (value === 'history' && identity?.reviewer) void loadHistory(0) }, { immediate: true })
async function refresh(index = pageIndex.value) {
  if (!access.value?.reviewer) return
  pageIndex.value = Number.isSafeInteger(index) ? Math.max(0, index) : 0
  const result = await page.load(() => campusModerationQueue(pageIndex.value, { type: type.value }))
  if (result && !result.items?.length && pageIndex.value > 0) return refresh(pageIndex.value - 1)
  return result
}
async function loadHistory(index = historyIndex.value) { historyIndex.value = Math.max(0, index); return history.load(() => campusModerationHistory(historyIndex.value)) }
function keyOf(entry) { return `${entry.type}:${entry.item.id}` }
async function decide({ entry, decision, reason }) {
  const key = keyOf(entry)
  if (busy[key]) return
  const generation = actionGeneration
  busy[key] = true
  actionError.value = ''; notice.value = ''
  try {
    let result
    if (entry.type === 'report') result = await resolveCampusReport(entry.item.id, decision, reason, entry.item.revision, entry.item.target?.review_revision || entry.item.target?.revision)
    else if (entry.type === 'help_dispute') result = await resolveCampusHelpDispute(entry.item.id, decision, reason)
    else result = await decideCampusModeration(entry.type, entry.item.id, decision, reason, entry.item.review_revision || entry.item.revision)
    if (generation !== actionGeneration) return
    notice.value = result?.notificationSent === false ? '处理结果和审计已保存，通知暂未发送；相关同学仍可在个人记录中查看结果。' : '处理结果已保存，相关同学可查看结果和说明。'
    await refresh()
  } catch (cause) {
    if (generation !== actionGeneration) return
    actionError.value = campusErrorMessage(cause, '处理没有保存，请重试。')
    if (cause?.code === 'forbidden') await refreshAccess()
  } finally { if (generation === actionGeneration) busy[key] = false }
}
</script>

<template>
  <div class="page campus-governance-page">

    <CampusLoadingState v-if="accessLoading">正在核验审核身份…</CampusLoadingState>
    <Alert v-else-if="!accountUser"><AlertTitle>登录后查看管理权限</AlertTitle><AlertDescription>总管理员可授权已验证邮箱的账号参与审核。<Button variant="outline" @click="accountOpen = true">登录账号</Button></AlertDescription></Alert>
    <Alert v-else-if="accessError"><AlertTitle>权限暂时无法读取</AlertTitle><AlertDescription>{{ accessError }} <Button variant="outline" @click="refreshAccess()">重新读取</Button></AlertDescription></Alert>
    <Alert v-else-if="!access?.reviewer"><AlertTitle>当前账号没有审核权限</AlertTitle><AlertDescription>可由总管理员按学校、校区授予审核权限。你仍可发布内容、查看投稿和举报记录。</AlertDescription></Alert>
    <template v-else>

      <Tabs v-model="tab" class="gap-5">
        <TabsList class="w-full justify-start overflow-x-auto"><TabsTrigger v-if="!team" value="queue">待处理 {{ readableCount }}</TabsTrigger><TabsTrigger v-if="!team" value="history">处理记录</TabsTrigger><TabsTrigger v-if="access.owner && team" value="reviewers">审核人员</TabsTrigger><TabsTrigger v-if="access.owner && team" value="applications">审核员申请</TabsTrigger><TabsTrigger v-if="access.owner && team" value="audits">随机复核</TabsTrigger></TabsList>
        <TabsContent value="queue" class="flex flex-col gap-4">
          <section class="campus-life-panel"><div class="campus-governance-toolbar"><div><h2>审核与举报</h2></div><Button variant="outline" :disabled="page.loading.value" @click="refresh()">刷新队列</Button></div><FieldGroup class="flex-row items-end gap-3"><Field><FieldLabel for="governance-type">内容分类</FieldLabel><NativeSelect id="governance-type" v-model="type"><NativeSelectOption value="">全部分类</NativeSelectOption><NativeSelectOption v-for="[value,label] in categoryOptions" :key="value" :value="value">{{ label }}{{ page.data.value?.counts?.[value] ? `（${page.data.value.counts[value]}）` : '' }}</NativeSelectOption></NativeSelect></Field><span class="campus-life-meta">{{ readableCount }} 条待处理</span></FieldGroup></section>
          <Alert v-if="actionError" variant="destructive" role="alert"><AlertTitle>本次操作未完成</AlertTitle><AlertDescription>{{ actionError }}</AlertDescription></Alert>
          <Alert v-if="notice" role="status"><AlertDescription>{{ notice }}</AlertDescription></Alert>
          <p v-if="page.error.value" role="alert" class="campus-life-inline-state error">{{ page.error.value }} <button class="text-button" @click="refresh()">重试</button></p>
          <CampusLoadingState v-if="page.loading.value && !page.data.value">正在读取授权范围内的内容…</CampusLoadingState>
          <CampusEmptyState v-else-if="page.data.value && !page.data.value.items?.length" title="当前分类没有待处理内容" description="新的投稿、举报和互助争议会显示在这里。" action="" />
          <CampusReviewItem v-for="entry in page.data.value?.items || []" :key="keyOf(entry)" :entry="entry" :busy="busy[keyOf(entry)]" @decide="decide" />
          <nav v-if="pageIndex || page.data.value?.hasMore" class="campus-life-actions" aria-label="审核队列分页"><Button variant="outline" :disabled="page.loading.value || pageIndex === 0" @click="refresh(pageIndex - 1)">上一页</Button><span>第 {{ pageIndex + 1 }} 页</span><Button variant="outline" :disabled="page.loading.value || !page.data.value?.hasMore" @click="refresh(pageIndex + 1)">下一页</Button></nav>
        </TabsContent>
        <TabsContent value="history" class="flex flex-col gap-4"><section class="campus-life-panel"><div class="campus-governance-toolbar"><div><h2>处理记录</h2></div><Button variant="outline" :disabled="history.loading.value" @click="loadHistory()">刷新记录</Button></div><p v-if="history.error.value" role="alert" class="campus-life-inline-state error">{{ history.error.value }}</p><CampusLoadingState v-if="history.loading.value">正在读取处理记录…</CampusLoadingState><CampusEmptyState v-else-if="!history.data.value?.events?.length" title="当前范围暂无处理记录" action="" /><article v-for="event in history.data.value?.events || []" :key="event.id" class="campus-life-card"><div class="campus-life-meta"><Badge variant="outline">{{ campusContentLabels[event.target_type] || '校园内容' }}</Badge><span>{{ event.school }} · {{ event.campus || '全校区' }}</span><span>{{ campusDateTimeLabel(event.created_at) }}</span></div><b>{{ ({approved:'审核通过',active:'已公开',open:'已公开',rejected:'退回或下架',resolved:'举报已处理',dismissed:'举报不成立',completed:'任务完成',cancelled:'任务取消'})[event.to_status] || event.to_status }}</b><p>{{ event.reason || '审核通过，未补充说明。' }}</p></article><nav class="campus-life-actions" aria-label="处理记录分页"><Button variant="outline" :disabled="history.loading.value || historyIndex === 0" @click="loadHistory(historyIndex - 1)">上一页</Button><span>第 {{ historyIndex + 1 }} 页</span><Button variant="outline" :disabled="history.loading.value || (history.data.value?.events?.length || 0) < CAMPUS_PAGE_SIZE" @click="loadHistory(historyIndex + 1)">下一页</Button></nav></section></TabsContent>
        <TabsContent v-if="access.owner && team" value="reviewers"><CampusReviewerManager /></TabsContent>
        <TabsContent v-if="access.owner && team" value="applications"><CampusCommunityAdmin mode="applications" /></TabsContent>
        <TabsContent v-if="access.owner && team" value="audits"><CampusCommunityAdmin mode="audits" /></TabsContent>

      </Tabs>
    </template>
  </div>
</template>

<style scoped>
.campus-governance-page{display:grid;gap:22px;max-width:1180px;margin:0 auto;padding-bottom:60px}.campus-governance-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px}.campus-governance-toolbar p{color:var(--muted);font-size:var(--fs-12);line-height:1.8}.campus-life-panel>.flex-row>.campus-life-meta{white-space:nowrap}@media(max-width:520px){.campus-governance-toolbar{align-items:flex-start;flex-direction:column}.campus-governance-page>.page-head{align-items:flex-start;flex-direction:column}}
</style>
