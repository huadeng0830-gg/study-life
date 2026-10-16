<script setup>
import { ThumbsUp } from '@lucide/vue'
import { useFeedbackSupport } from '../composables/feedbackSupport.js'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { accountOpen, accountUser } from '../composables/accountAuth.js'
import { campusFeedbackPublicList, myCampusFeedback, submitCampusFeedback, campusFeedbackMessages } from '../services/campusCommunity.js'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { campusErrorMessage } from '../composables/campusContentModel.js'
import { campusDateLabel, campusDateTimeLabel } from '../composables/campusFormatting.js'
import { useCampusRequest } from '../composables/campusRequest.js'
import { useCampusGovernanceAccess } from '../composables/campusGovernanceAccess.js'
import { feedbackStatusLabels as statusLabels, feedbackCategoryLabels as categoryLabels, feedbackStatusHelp } from '../composables/feedbackModel.js'
import { NativeSelect, NativeSelectOption } from '../components/ui/native-select'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '../components/ui/field'
import { Alert, AlertTitle, AlertDescription } from '../components/ui/alert'
import { Input } from '../components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog'
import { nextTick } from 'vue'
const { access } = useCampusGovernanceAccess()

const filters = [{ value: '', label: '全部反馈' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]
const selectedStatus = ref('')
const selectedCategory = ref('')
const sort = ref('updated')
const searchDraft = ref('')
const search = ref('')
const composeOpen = ref(false)
const detailOpen = ref(false)
const feedbackOpener = ref(/** @type {HTMLElement|null} */ (null))
const composeOpener = ref(/** @type {HTMLElement|null} */ (null))
function restoreDetailFocus(event) { event.preventDefault(); if (feedbackOpener.value?.isConnected) feedbackOpener.value.focus() }
function restoreComposeFocus(event) { event.preventDefault(); if (composeOpener.value?.isConnected) composeOpener.value.focus() }
const selectedItem = ref(/** @type {any} */ (null))
const detailLoading = ref(false)
const detailError = ref('')
const detailRequest = useCampusRequest()
async function openFeedback(item, event) {
  feedbackOpener.value = event?.currentTarget || null
  detailOpen.value = true; selectedItem.value = null; detailError.value = ''; detailLoading.value = true
  const revision = detailRequest.begin()
  try {
    const result = await campusFeedbackPublicList({ id: item.id, limit: 1, view: 'detail' })
    if (!detailRequest.live(revision)) return
    selectedItem.value = result.items?.find(row => row.id === item.id) || null
    if (!selectedItem.value) detailError.value = '这条反馈已不再公开，请刷新列表。'
  } catch (cause) { if (detailRequest.live(revision)) detailError.value = campusErrorMessage(cause, '反馈详情暂时无法读取。') }
  finally { if (detailRequest.live(revision)) detailLoading.value = false }
}
watch(detailOpen, open => { if (!open) { detailRequest.invalidate(); selectedItem.value = null } })
function runSearch() { search.value = searchDraft.value.trim(); offset.value = 0; void refresh() }
async function openMine() { mineOpen.value = true; await nextTick(); document.querySelector('.account-section-toggle')?.scrollIntoView({ block: 'center' }) }
function clearFilters() { const filtersChanged = Boolean(selectedCategory.value || selectedStatus.value || sort.value !== 'updated'); searchDraft.value = ''; search.value = ''; selectedCategory.value = ''; selectedStatus.value = ''; sort.value = 'updated'; offset.value = 0; if (!filtersChanged) void refresh() }
const items = ref(/** @type {any[]} */ ([]))
const support = useFeedbackSupport(items, selectedItem)
const mineOffset = ref(0)
const mineTotal = ref(0)
async function changeMinePage(next) { mineOffset.value = next; await refreshMine() }
const mine = ref(/** @type {any[]} */ ([]))
const loading = ref(false)
const mineLoading = ref(false)
const submitting = ref(false)
// 两条错误线：公开列表读不到时整块内容要换成错误态；
// 某个后台刷新失败不该把用户刚看到的错误顶掉，也不该盖住列表。
const loadError = ref('')
const error = ref('')
const notice = ref('')
const mineOpen = ref(false)
const draft = reactive({ category: 'product', title: '', body: '', anonymous: true })
const privateThreads = reactive(/** @type {Record<string, any[]>} */ ({}))
const privateDrafts = reactive(/** @type {Record<string, string>} */ ({}))
const privateBusy = ref('')
const request = useCampusRequest()
const mineRequest = useCampusRequest()
const privateRequest = useCampusRequest()
const submitRequest = useCampusRequest()
const offset = ref(0)
const total = ref(0)
const pageSize = 20
const signedIn = computed(() => Boolean(accountUser.value?.id))
const emptyMessage = computed(() => search.value || selectedStatus.value || selectedCategory.value ? '没有符合当前条件的反馈。' : '内容检查通过的反馈会在这里公开。')

async function focusComposer(event) {
  composeOpener.value = event?.currentTarget || null
  composeOpen.value = true
  await nextTick()
  document.getElementById('feedback-title')?.focus()
}

async function refresh({ forceRefresh = false } = {}) {
  const revision = request.begin()
  loading.value = true
  loadError.value = ''
  try {
    const result = await campusFeedbackPublicList({ status: selectedStatus.value, category: selectedCategory.value, q: search.value, sort: sort.value, view: 'summary', limit: pageSize, offset: offset.value }, { forceRefresh })
    if (request.live(revision)) {
      const count = Number.isInteger(result.total) ? result.total : (result.items || []).length
      if (offset.value > 0 && offset.value >= count) { offset.value = Math.max(0, Math.floor((count - 1) / pageSize) * pageSize); return refresh() }
      items.value = result.items || []; total.value = count
    }
  } catch (cause) {
    if (request.live(revision)) loadError.value = campusErrorMessage(cause, '公开建议暂时无法读取。')
  } finally {
    if (request.live(revision)) loading.value = false
  }
}
async function refreshMine() {
  if (!signedIn.value) { mine.value = []; return }
  const revision = mineRequest.begin()
  mineLoading.value = true
  try {
    const result = await myCampusFeedback({ offset: mineOffset.value, limit: pageSize })
    if (mineRequest.live(revision)) {
      const count = result.total ?? (result.items || []).length
      if (mineOffset.value > 0 && mineOffset.value >= count) { mineOffset.value = Math.max(0, Math.floor((count - 1) / pageSize) * pageSize); return refreshMine() }
      mine.value = result.items || []; mineTotal.value = count
    }
  } catch (cause) {
    // 后台刷新失败不该抢占前台动作的错误提示，只提示在这块区域里。
    if (mineRequest.live(revision)) error.value = campusErrorMessage(cause, '暂时无法读取你的建议。')
  } finally {
    if (mineRequest.live(revision)) mineLoading.value = false
  }
}
watch([selectedStatus, selectedCategory, sort], () => { offset.value = 0; void refresh() })
async function changePage(next) { offset.value = next; await refresh() }
watch(() => accountUser.value?.id, () => {
  request.invalidate()
  detailOpen.value = false
  composeOpen.value = false
  mine.value = []; mineOffset.value = 0; mineTotal.value = 0
  error.value = ''
  notice.value = ''
  submitting.value = false
  mineLoading.value = false; privateBusy.value = ''
  draft.title = ''; draft.body = ''; draft.anonymous = true
  Object.keys(privateDrafts).forEach((key) => delete privateDrafts[key])
  void refresh()
  Object.keys(privateThreads).forEach((key) => delete privateThreads[key])
  if (mineOpen.value) void refreshMine()
}, { flush: 'sync' })
watch(mineOpen, (open) => { if (open) void refreshMine() })
onMounted(() => { void refresh() })

async function submit() {
  if (!signedIn.value) { accountOpen.value = true; return }
  if (submitting.value) return
  error.value = ''; notice.value = ''
  if (draft.title.trim().length < 4 || draft.body.trim().length < 10) { error.value = '标题至少 4 个字，建议内容至少 10 个字。'; return }
  submitting.value = true
  const revision = submitRequest.begin()
  try {
    await submitCampusFeedback({ ...draft })
    if (!submitRequest.live(revision)) return
    draft.title = ''; draft.body = ''; draft.category = 'product'
    composeOpen.value = false
    notice.value = '反馈已提交，可在“我的反馈”中查看。内容检查通过后将按你选择的署名方式公开。'
    mineOffset.value = 0
    mineOpen.value = true
    await refreshMine()
  } catch (cause) { if (submitRequest.live(revision)) error.value = campusErrorMessage(cause, '提交没有完成，请稍后重试。') }
  finally { if (submitRequest.live(revision)) submitting.value = false }
}

async function openPrivateThread(item) {
  const revision = privateRequest.begin()
  privateBusy.value = item.id
  try {
    const result = (await campusFeedbackMessages(item.id)).messages || []
    if (privateRequest.live(revision)) privateThreads[item.id] = result
  } catch (cause) {
    if (privateRequest.live(revision)) error.value = campusErrorMessage(cause, '私信暂时无法读取。')
  } finally {
    if (privateRequest.live(revision)) privateBusy.value = ''
  }
}
async function sendPrivateMessage(item) {
  const body = (privateDrafts[item.id] || '').trim()
  if (!body || privateBusy.value) return
  const revision = privateRequest.begin()
  privateBusy.value = item.id
  try {
    const result = (await campusFeedbackMessages(item.id, body)).messages || []
    if (!privateRequest.live(revision)) return
    privateThreads[item.id] = result
    privateDrafts[item.id] = ''
  } catch (cause) {
    if (privateRequest.live(revision)) error.value = campusErrorMessage(cause, '私信没有发送。')
  } finally {
    if (privateRequest.live(revision)) privateBusy.value = ''
  }
}
function handlePrivateThreadToggle(event, item) {
  const details = /** @type {HTMLDetailsElement|null} */ (event.currentTarget)
  if (details?.open) void openPrivateThread(item)
}
</script>

<template>
  <div class="page feedback-page">
    <header class="page-head"><div class="page-head-main"><h1 class="page-title">反馈与建议</h1><p class="page-desc">提交问题与建议，查看公开处理进展。</p></div><div class="feedback-head-actions"><Button v-if="access?.owner" as-child variant="outline"><RouterLink to="/admin/feedback">处理反馈</RouterLink></Button><Button v-if="signedIn" variant="outline" @click="openMine">我的反馈</Button><Button @click="focusComposer">提交反馈</Button></div></header>

    <Alert v-if="error" variant="destructive" role="alert"><AlertTitle>操作未完成</AlertTitle><AlertDescription>{{ error }}</AlertDescription></Alert>
    <Alert v-if="notice" role="status"><AlertTitle>已收到</AlertTitle><AlertDescription>{{ notice }}</AlertDescription></Alert>

    <Dialog v-model:open="detailOpen">
    <section class="feedback-public" aria-labelledby="feedback-public-title">
      <div class="feedback-section-heading"><div><h2 id="feedback-public-title">公开反馈 <small>{{ total }} 条</small></h2></div><Button variant="outline" :disabled="loading" @click="refresh({ forceRefresh: true })">刷新</Button></div>
      <form class="feedback-search" role="search" aria-label="搜索公开反馈" @submit.prevent="runSearch"><label class="sr-only" for="feedback-search">搜索全部反馈</label><Input id="feedback-search" v-model="searchDraft" type="search" maxlength="100" placeholder="搜索标题或内容" /><Button type="submit" :disabled="loading">搜索</Button></form>
      <div class="feedback-filters"><Field><FieldLabel for="feedback-status">状态</FieldLabel><NativeSelect id="feedback-status" v-model="selectedStatus"><NativeSelectOption v-for="filter in filters" :key="filter.value" :value="filter.value">{{ filter.label }}</NativeSelectOption></NativeSelect></Field><Field><FieldLabel for="feedback-list-category">分类</FieldLabel><NativeSelect id="feedback-list-category" v-model="selectedCategory"><NativeSelectOption value="">全部分类</NativeSelectOption><NativeSelectOption v-for="(label,value) in { product: '产品体验', campus: '校园功能', accessibility: '无障碍', other: '其他' }" :key="value" :value="value">{{ label }}</NativeSelectOption></NativeSelect></Field><Field><FieldLabel for="feedback-sort">排序</FieldLabel><NativeSelect id="feedback-sort" v-model="sort"><NativeSelectOption value="supported">最多支持</NativeSelectOption><NativeSelectOption value="updated">最近进展</NativeSelectOption><NativeSelectOption value="newest">最新提交</NativeSelectOption></NativeSelect></Field><Button v-if="search || selectedStatus || selectedCategory || sort !== 'updated'" variant="ghost" @click="clearFilters">清除筛选</Button></div>
      <p v-if="search" class="feedback-results" role="status">“{{ search }}”的搜索结果 · {{ total }} 条</p>
      <Alert v-if="support.error.value" variant="destructive" role="alert"><AlertTitle>点赞暂未完成</AlertTitle><AlertDescription>{{ support.error.value }} <Button variant="outline" :disabled="support.loading.value" @click="support.refresh">重试</Button></AlertDescription></Alert>
      <Alert v-if="loadError" variant="destructive" role="alert"><AlertTitle>反馈暂时无法读取</AlertTitle><AlertDescription>{{ loadError }} <Button variant="outline" :disabled="loading" @click="refresh">重新读取</Button></AlertDescription></Alert>
      <div v-else-if="loading" class="feedback-state" role="status">正在读取公开建议…</div>
      <div v-else-if="!items.length" class="feedback-state"><b>{{ emptyMessage }}</b><span>如果你遇到问题，也可以提交一条新的建议。</span><button type="button" class="btn btn-ghost" :disabled="loading" @click="refresh">重新读取</button></div>
      <div v-else class="feedback-list"><div class="feedback-table-head" aria-hidden="true"><span>支持</span><span>反馈</span><span>状态</span><span>最近更新</span></div>
        <article v-for="item in items" :key="item.id" class="feedback-row">
          <button type="button" class="feedback-support" :class="{ supported: support.liked[item.id] }" :aria-pressed="Boolean(support.liked[item.id])" :aria-label="`${support.liked[item.id] ? '取消点赞' : '点赞支持'}：${item.title}，${item.like_count || 0} 人支持`" :disabled="support.disabled(item.id)" @click="support.toggle(item)"><ThumbsUp :size="16" aria-hidden="true" /><span>{{ item.like_count || 0 }}</span></button>
          <DialogTrigger as-child><button type="button" class="feedback-row-open" @click="openFeedback(item, $event)"><span class="feedback-row-main"><b>{{ item.title }}</b><span class="feedback-row-meta">{{ categoryLabels[item.category] || '反馈' }}<span>{{ item.public_author_name || '匿名用户' }}</span></span></span><Badge :variant="item.status === 'resolved' ? 'secondary' : 'outline'">{{ statusLabels[item.status] || item.status }}</Badge><time>{{ campusDateLabel(item.updated_at || item.created_at) }}</time></button></DialogTrigger>
        </article>
      </div>
      <nav v-if="total > pageSize" class="feedback-pagination" aria-label="公开建议分页"><Button variant="outline" size="sm" :disabled="loading || offset === 0" @click="changePage(0)">首页</Button><Button variant="outline" size="sm" :disabled="loading || offset === 0" @click="changePage(offset - pageSize)">上一页</Button><span>第 {{ Math.floor(offset / pageSize) + 1 }} / {{ Math.ceil(total / pageSize) }} 页 · {{ total }} 条</span><Button variant="outline" size="sm" :disabled="loading || offset + pageSize >= total" @click="changePage(offset + pageSize)">下一页</Button><Button variant="outline" size="sm" :disabled="loading || offset + pageSize >= total" @click="changePage(Math.floor((total - 1) / pageSize) * pageSize)">末页</Button></nav>
    </section>
    <DialogContent class="max-h-[88dvh] overflow-y-auto sm:max-w-3xl" @close-auto-focus="restoreDetailFocus"><DialogHeader><DialogTitle>{{ selectedItem?.title || '反馈详情' }}</DialogTitle><DialogDescription>公开反馈、管理员回复与处理时间线</DialogDescription></DialogHeader><p v-if="detailLoading" role="status">正在读取这条反馈…</p><Alert v-else-if="detailError" variant="destructive"><AlertTitle>反馈暂时无法读取</AlertTitle><AlertDescription>{{ detailError }}</AlertDescription></Alert><div v-else-if="selectedItem" class="feedback-detail"><div class="feedback-row-body"><div class="feedback-row-meta"><Badge variant="outline">{{ categoryLabels[selectedItem.category] || '建议' }}</Badge><Badge :variant="selectedItem.status === 'resolved' ? 'secondary' : 'outline'">{{ statusLabels[selectedItem.status] || selectedItem.status }}</Badge><span>{{ selectedItem.public_author_name || '匿名用户' }}</span></div><p class="feedback-status-help">{{ feedbackStatusHelp[selectedItem.status] }}</p><p class="feedback-text">{{ selectedItem.body }}</p><Button variant="outline" :aria-pressed="Boolean(support.liked[selectedItem.id])" :disabled="support.disabled(selectedItem.id)" @click="support.toggle(selectedItem)"><ThumbsUp :size="16" aria-hidden="true" />{{ support.liked[selectedItem.id] ? '已支持' : '点赞支持' }} {{ selectedItem.like_count || 0 }}</Button><p v-if="selectedItem.reward_issued" class="feedback-reward">贡献奖励 · 管理员设置奖励 {{ selectedItem.reward_beans || 0 }} 个贡献豆</p><div v-if="selectedItem.public_reply" class="admin-reply"><b>管理员回复</b><p>{{ selectedItem.public_reply }}</p></div><p v-if="selectedItem.public_reason" class="not-adopted-note"><b>处理说明</b>{{ selectedItem.public_reason }}</p><p class="feedback-updated">最近更新：{{ campusDateTimeLabel(selectedItem.updated_at || selectedItem.created_at) }}</p><details v-if="selectedItem.public_history?.length" class="feedback-history"><summary>查看处理时间线（{{ selectedItem.public_history.length }}）</summary><ol><li v-for="(event,index) in selectedItem.public_history" :key="index"><time>{{ campusDateTimeLabel(event.at) }}</time><b>{{ statusLabels[event.status] }}</b><p v-if="event.reply">{{ event.reply }}</p><p v-if="event.reason">{{ event.reason }}</p></li></ol></details></div></div></DialogContent>
    </Dialog>


    <Dialog v-model:open="composeOpen"><DialogContent class="max-h-[88dvh] overflow-y-auto sm:max-w-3xl" @close-auto-focus="restoreComposeFocus"><DialogHeader><DialogTitle>提交反馈</DialogTitle><DialogDescription>可选择匿名或昵称署名，内容检查通过后公开。</DialogDescription></DialogHeader><Alert v-if="error" variant="destructive"><AlertDescription>{{ error }}</AlertDescription></Alert>
    <section class="feedback-compose" aria-labelledby="feedback-compose-title">
      <div class="compose-copy"><h2 id="feedback-compose-title">提交反馈</h2><p>建议先浏览已有反馈，避免重复。问题反馈请说明操作步骤、预期结果和实际情况；功能建议请描述使用场景。</p><p>只有总管理员确认解决并设置奖励后，才会发放 0–20 个贡献豆，每条仅一次。</p></div>
      <form @submit.prevent="submit"><FieldGroup>
        <Field><FieldLabel for="feedback-category">分类</FieldLabel><NativeSelect id="feedback-category" v-model="draft.category" :disabled="submitting"><NativeSelectOption v-for="(label,value) in categoryLabels" :key="value" :value="value">{{ label }}</NativeSelectOption></NativeSelect></Field>
        <Field><FieldLabel for="feedback-title">标题</FieldLabel><Input id="feedback-title" v-model="draft.title" minlength="4" maxlength="100" placeholder="用一句话描述问题或建议" :disabled="submitting" required /></Field>
        <Field><FieldLabel for="feedback-body">详细内容</FieldLabel><textarea class="feedback-body-input" id="feedback-body" v-model="draft.body" minlength="10" maxlength="3000" rows="5" placeholder="在哪个功能遇到了什么情况？希望如何改进？" :disabled="submitting" required /><FieldDescription>{{ draft.body.length }} / 3000 字 · 请勿填写个人敏感信息</FieldDescription></Field>
        <Field orientation="horizontal"><input id="feedback-anonymous" v-model="draft.anonymous" type="checkbox" :disabled="submitting" /><FieldLabel for="feedback-anonymous">匿名提交</FieldLabel></Field>
        <p class="identity-preview">{{ draft.anonymous ? '公开署名：匿名用户。管理员可通过站内私信联系你。' : '公开署名：使用你在个人资料中设置的昵称。没有昵称时，请先在“我的账号”中设置。' }}</p>
        <Button type="submit" :disabled="submitting">{{ submitting ? '正在提交…' : signedIn ? '提交反馈' : '登录后提交' }}</Button>
      </FieldGroup></form>
    </section>
    </DialogContent></Dialog>

    <section v-if="accountUser" class="feedback-account">
      <button class="account-section-toggle" type="button" :aria-expanded="mineOpen" @click="mineOpen = !mineOpen"><span><b>我的反馈</b><small>查看安全检查、处理状态与私信</small></span><span>{{ mineOpen ? '收起 −' : '展开 +' }}</span></button>
      <div v-if="mineOpen" class="my-feedback-list">
        <p v-if="!signedIn" class="feedback-state">登录后可查看自己的建议和管理员站内回复。</p>
        <p v-else-if="mineLoading" class="feedback-state">正在读取你的提交…</p>
        <p v-else-if="!mine.length" class="feedback-state">你还没有提交建议。</p>
        <details v-for="item in mine" :key="item.id" class="my-feedback-row"><summary><b>{{ item.title }}</b><Badge variant="outline">{{ statusLabels[item.status] }}</Badge></summary><div><div class="feedback-row-meta"><Badge variant="outline">{{ item.visibility === 'pending_safety' ? '安全检查中' : item.visibility === 'hidden' ? '仅自己可见' : '已公开' }}</Badge><Badge variant="outline">{{ statusLabels[item.status] }}</Badge></div><h3>{{ item.title }}</h3><p>{{ item.body }}</p><p>{{ item.public_reply || item.public_reason || '等待管理员更新。' }}</p><small>署名方式：{{ item.is_anonymous === false ? item.public_author_name : '匿名用户' }}</small><small v-if="item.reward_issued">本条建议贡献奖励：{{ item.reward_beans || 0 }} 三两豆</small></div><details class="private-thread" @toggle="handlePrivateThreadToggle($event,item)"><summary>站内联系</summary><div class="private-messages"><p v-for="message in privateThreads[item.id] || []" :key="message.id" :class="{ mine: message.sender_id === accountUser.id }">{{ message.body }}</p><form @submit.prevent="sendPrivateMessage(item)"><input v-model="privateDrafts[item.id]" maxlength="2000" aria-label="站内私信内容" placeholder="仅你与管理员可见" /><Button size="sm" type="submit" :disabled="privateBusy === item.id">发送</Button></form></div></details></details>
        <nav v-if="mineTotal > pageSize" class="feedback-pagination" aria-label="我的反馈分页"><Button variant="outline" size="sm" :disabled="mineLoading || mineOffset === 0" @click="changeMinePage(mineOffset - pageSize)">上一页</Button><span>第 {{ Math.floor(mineOffset / pageSize) + 1 }} / {{ Math.ceil(mineTotal / pageSize) }} 页</span><Button variant="outline" size="sm" :disabled="mineLoading || mineOffset + pageSize >= mineTotal" @click="changeMinePage(mineOffset + pageSize)">下一页</Button></nav>
      </div>
    </section>

  </div>
</template>

<style scoped>
.feedback-page{display:grid;gap:24px;min-width:0}.feedback-page>*{min-width:0}.feedback-head-actions{display:flex;gap:10px;flex-wrap:wrap}.feedback-public{display:grid;gap:18px}.feedback-section-heading{display:flex;align-items:end;justify-content:space-between;gap:18px}.feedback-section-heading h2{margin:4px 0;font-size:var(--fs-22)}.feedback-section-heading p,.compose-copy p{max-width:65ch;margin:6px 0;color:var(--muted);font-size:var(--fs-12);line-height:1.8}.compose-index{color:var(--muted);font-size:var(--fs-11)}.feedback-filters{display:flex;align-items:end;gap:10px}.feedback-filters [data-slot=field]{width:auto}.feedback-list{border-top:1px solid var(--border)}.feedback-row{border-bottom:1px solid var(--border)}.feedback-row-body{min-width:0}.feedback-row-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;color:var(--muted);font-size:var(--fs-11)}.feedback-detail h3,.my-feedback-row h3{margin:10px 0;font-size:var(--fs-16);overflow-wrap:anywhere}.feedback-text,.my-feedback-row>div>p{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text);font-size:var(--fs-13);line-height:1.8}.feedback-status-help,.feedback-updated,.identity-preview{margin:8px 0;color:var(--muted);font-size:var(--fs-12);line-height:1.7}.admin-reply,.not-adopted-note{margin:14px 0;padding:12px 14px;border-left:3px solid var(--primary);background:var(--bg-tint);font-size:var(--fs-12);line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.admin-reply b,.not-adopted-note b{display:block;margin-bottom:4px}.admin-reply p{margin:0}.not-adopted-note{border-color:var(--warning)}.feedback-reward{color:var(--success);font-size:var(--fs-12)}.feedback-history{margin-top:12px;font-size:var(--fs-12)}.feedback-history summary{cursor:pointer;color:var(--primary);padding:6px 0}.feedback-history ol{display:grid;gap:14px;padding-left:16px;border-left:2px solid var(--border);list-style:none}.feedback-history time{display:block;margin-bottom:4px;color:var(--muted)}.feedback-history p{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}.feedback-state{display:grid;gap:9px;padding:30px 16px;border:1px dashed var(--border);border-radius:var(--radius-12);color:var(--muted);font-size:var(--fs-12);text-align:center}.feedback-state b{color:var(--text)}.feedback-pagination{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;font-size:var(--fs-12);color:var(--muted)}.feedback-compose{display:grid;gap:20px;min-width:0}.compose-copy h2{margin:0 0 10px;font-size:var(--fs-18)}.feedback-compose form{min-width:0}.feedback-body-input{box-sizing:border-box;width:100%;min-height:140px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--card);color:var(--text);font:inherit;font-size:var(--fs-13);line-height:1.8;resize:vertical}.feedback-body-input:focus-visible{outline:2px solid var(--primary);outline-offset:2px}#feedback-compose-title,.feedback-detail h3{scroll-margin-top:28px}#feedback-anonymous{width:18px;height:18px;flex:none;accent-color:var(--primary)}.feedback-account{border-top:1px solid var(--border);padding-top:18px}.account-section-toggle{display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border:0;background:transparent;color:var(--text);text-align:left;font:inherit}.account-section-toggle>span:first-child{display:grid;gap:4px}.account-section-toggle small{color:var(--muted);font-size:var(--fs-12)}.account-section-toggle>span:last-child{color:var(--primary);font-size:var(--fs-12)}.my-feedback-list{display:grid;gap:12px;margin-top:10px}.my-feedback-row{padding:14px 0;border-bottom:1px solid var(--border)}.my-feedback-row>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;font-size:var(--fs-13)}.my-feedback-row>div{margin-top:14px}.my-feedback-row small{display:block;margin-top:8px;color:var(--muted);font-size:var(--fs-11)}.private-thread{min-width:0}.private-thread summary{padding:8px;color:var(--primary);font-size:var(--fs-12);cursor:pointer}.private-messages{display:grid;gap:8px}.private-messages>p{margin:0;padding:10px;background:var(--bg-tint);border-radius:var(--radius-8);font-size:var(--fs-12);white-space:pre-wrap;overflow-wrap:anywhere}.private-messages form{display:flex;gap:6px}.private-messages input{min-width:0;flex:1;padding:8px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--card);color:var(--text);font:inherit}.feedback-page summary:focus-visible,.account-section-toggle:focus-visible{outline:2px solid var(--primary);outline-offset:3px}
@media(max-width:760px){.feedback-page .page-head,.feedback-section-heading{flex-direction:column;align-items:flex-start}.feedback-compose,.feedback-row,.my-feedback-row{grid-template-columns:minmax(0,1fr)}.feedback-compose{padding:18px;gap:18px}.feedback-row{gap:10px}.feedback-head-actions,.feedback-filters{width:100%;flex-wrap:wrap}.feedback-filters [data-slot=field]{flex:1;min-width:160px}.feedback-head-actions>*{flex:1}.feedback-body-input{font-size:16px}.feedback-detail h3{font-size:var(--fs-17)}}
.feedback-search{display:flex;gap:10px;max-width:680px}.feedback-search>input{min-width:0;flex:1}.feedback-section-heading h2 small{margin-left:8px;color:var(--muted);font-size:var(--fs-13);font-weight:normal}.feedback-results{margin:0;color:var(--muted);font-size:var(--fs-12)}.feedback-table-head,.feedback-row-open{display:grid;grid-template-columns:minmax(0,1fr) 100px 110px;gap:16px;align-items:center}.feedback-table-head{padding:12px;color:var(--muted);font-size:var(--fs-11);border-bottom:1px solid var(--border)}.feedback-row-open{width:100%;min-height:76px;padding:13px 12px;border:0;background:transparent;color:var(--text);text-align:left;font:inherit;cursor:pointer}.feedback-row-open:hover{background:var(--bg-tint)}.feedback-row-open:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}.feedback-row-open>time{color:var(--muted);font-size:var(--fs-11)}.feedback-row-open>[data-slot=badge]{justify-self:start}.feedback-row-main{display:grid;gap:6px;min-width:0}.feedback-row-main>b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-13);font-weight:var(--fw-650)}.feedback-row-main .feedback-row-meta{font-size:var(--fs-11)}.feedback-row-meta>span{margin-left:8px}.feedback-detail{min-width:0}.feedback-filters{justify-content:flex-start;flex-wrap:wrap}.feedback-filters>[data-slot=field]{min-width:130px;max-width:230px}.feedback-page [data-slot=dialog-content]{min-width:0}@media(max-width:520px){.feedback-table-head{display:none}.feedback-row-open{grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;min-height:82px}.feedback-row-open>time{grid-column:1/-1;font-size:var(--fs-10)}.feedback-filters{display:grid;grid-template-columns:1fr 1fr;align-items:end}.feedback-filters>[data-slot=field]{min-width:0;max-width:none;width:100%}.feedback-filters [data-slot=native-select-wrapper]{max-width:100%;width:100%}.feedback-filters>[data-slot=field]:nth-child(3){grid-column:1/-1}.feedback-row-main .feedback-row-meta{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;display:block}.feedback-row-main>b{font-size:var(--fs-14)}}

@media(max-width:520px){.feedback-page{gap:18px}.feedback-page .page-head{flex-direction:row;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:0}.feedback-page .page-head-main{flex:1;min-width:150px}.feedback-head-actions{width:auto}.feedback-head-actions>*{flex:none}.feedback-page .page-desc{font-size:var(--fs-12)}.feedback-section-heading{flex-direction:row;align-items:center}.feedback-section-heading h2{font-size:var(--fs-18)}.feedback-public{gap:14px}.feedback-filters{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.feedback-filters>[data-slot=field]:nth-child(3){grid-column:auto}.feedback-filters [data-slot=native-select]{font-size:var(--fs-12);padding-left:8px}.feedback-filters>[data-slot=button]{grid-column:1/-1;justify-self:start}.feedback-row-open{padding-left:4px;padding-right:4px}}
.feedback-row{display:grid;grid-template-columns:56px minmax(0,1fr);align-items:center;gap:16px}.feedback-table-head{grid-template-columns:56px minmax(0,1fr) 100px 110px}.feedback-support{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:48px;min-width:44px;margin:8px 4px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--card);color:var(--muted);font:inherit;font-size:var(--fs-12);font-variant-numeric:tabular-nums;cursor:pointer}.feedback-support.supported{color:var(--primary);background:var(--primary-soft);border-color:var(--primary)}.feedback-support:disabled{opacity:.6;cursor:wait}.feedback-support:focus-visible{outline:var(--focus-width) solid var(--focus-solid);outline-offset:var(--focus-offset)}@media(max-width:520px){.feedback-row{grid-template-columns:48px minmax(0,1fr);gap:10px}.feedback-row-open{min-width:0}.feedback-support{margin-left:0;margin-right:0}}
</style>
