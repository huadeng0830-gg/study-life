<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { accountAvailable, accountOpen, accountReady, accountUser, initializeAccountAuth } from '../composables/accountAuth.js'
import { currentVersionInfo } from '../composables/versionInfo.js'
import { PlatformAdminRequestError, platformAdminRequest } from '../services/platformAdmin.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import AdminActivity from '../components/admin/AdminActivity.vue'
import RegistrationControl from '../components/admin/RegistrationControl.vue'
import AccountRestrictionDialog from '../components/admin/AccountRestrictionDialog.vue'
import { restrictionActive, restrictionDate, restrictionRemaining } from '../composables/accountRestrictionModel.js'
import { errorMessage as sharedErrorMessage } from '../utils/errors.js'
const props = defineProps({ section: { type: String, default: 'system' } })

/** @typedef {{ id: string, email: string, createdAt: string|null, lastSignInAt: string|null, emailVerifiedAt: string|null, status: string, platformOwner: boolean, bannedUntil?:string|null, restrictions?:Record<string,{ enabled:boolean,expiresAt:string|null,reason:string,revision:string }> }} AdminAccount */
/** @typedef {{ users: AdminAccount[], page: number, pageSize: number, total: number, truncated: boolean }} AccountPage */
/** @typedef {{ checkedAt: string, services: { auth: string, collaborationData: string }, counts: { accounts: number|null, accountsScanned: number, accountsTruncated: boolean, activeProjects: number, collaborationProfiles: number } }} PlatformOverview */
/** @typedef {{ id: string, school: string, name: string, campus: string, area: string, place_hint: string, place_type: string, description: string, opening_hours: string, service_info: string, public_contact: string, source_info: string, category: string, owner_id: string, review_revision: string, created_at: string, updated_at: string }} PendingPlace */
/** @typedef {{ account: AdminAccount, scope: string }} StatusChangeDialog */
/** @typedef {{ tone: string, text: string }} FeedbackMessage */

const PAGE_SIZE = 25
const PLACE_PAGE_SIZE = 50
const access = ref('checking')
const overview = ref(/** @type {PlatformOverview|null} */ (null))
const accounts = ref(/** @type {AccountPage|null} */ (null))
const pendingPlaces = ref(/** @type {PendingPlace[]} */ ([]))
const pendingPlacePage = ref(1)
const pendingPlaceTotal = ref(0)
const reviewReasons = ref({})
const placeReviewConfirmation = ref(/** @type {{place:PendingPlace,decision:string,reason:string}|null} */(null))
const placesLoading = ref(false)
const placesError = ref('')
const reviewActionId = ref('')
const query = ref('')
const page = ref(1)
const loading = ref(false)
const usersLoading = ref(false)
const pageError = ref('')
const usersError = ref('')
const feedback = ref(/** @type {FeedbackMessage|null} */ (null))
const changeDialog = ref(/** @type {StatusChangeDialog|null} */ (null))
const accountClock = ref(Date.now())
let accessRevision = 0
let dataRevision = 0
let searchTimer = 0
let accountTimer = 0
let accountRequestRevision = 0

const pageCount = computed(() => Math.max(1, Math.ceil((accounts.value?.total || 0) / PAGE_SIZE)))
const placePageCount = computed(() => Math.max(1, Math.ceil(pendingPlaceTotal.value / PLACE_PAGE_SIZE)))
const accountSummary = computed(() => {
  const counts = overview.value?.counts
  if (counts?.accountsTruncated && Number.isSafeInteger(counts.accountsScanned)) {
    return `${counts.accountsScanned.toLocaleString('zh-CN')}+`
  }
  const count = Number(counts?.accounts)
  return Number.isSafeInteger(count) && count >= 0 ? count.toLocaleString('zh-CN') : '—'
})
const activeProjectSummary = computed(() => {
  const count = Number(overview.value?.counts?.activeProjects)
  return Number.isSafeInteger(count) && count >= 0 ? count.toLocaleString('zh-CN') : '—'
})
const collaborationProfileSummary = computed(() => {
  const count = Number(overview.value?.counts?.collaborationProfiles)
  return Number.isSafeInteger(count) && count >= 0 ? count.toLocaleString('zh-CN') : '—'
})

function statusLabel(status) {
  return ({ active: '正常', suspended: '已封禁', unverified: '待验证' })[status] || '未知'
}

function accountBlocked(account) { return restrictionActive(account.restrictions?.account, accountClock.value) || Boolean(account.bannedUntil && Date.parse(account.bannedUntil) > accountClock.value) }
function publishingBlocked(account) { return restrictionActive(account.restrictions?.publish, accountClock.value) }

function dateLabel(value) {
  if (!value) return '暂无记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间无法识别' : new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function placeTypeLabel(type) {
  return ({ 'teaching-building': '教学楼', library: '图书馆', 'study-room': '自习室', laboratory: '实验楼', cafeteria: '食堂', restaurant: '餐厅', 'tea-shop': '奶茶店', 'coffee-shop': '咖啡店', supermarket: '超市', 'convenience-store': '便利店', 'campus-shop': '校园商店', printing: '打印复印', 'parcel-station': '快递站', sports: '体育场馆', recreation: '休闲社交', 'dorm-facility': '宿舍设施', medical: '医疗服务', administration: '行政办事', 'shuttle-stop': '校车站点', scenic: '校园景点', 'campus-edge-shop': '校园周边', other: '其他校园服务' })[type] || '校园地点'
}

function errorMessage(error, fallback) {
  return sharedErrorMessage(error, fallback)
}

async function loadOverview(revision = dataRevision) {
  try {
    const result = await platformAdminRequest('overview')
    if (revision === dataRevision) overview.value = result
  } catch (error) {
    if (revision === dataRevision) pageError.value = errorMessage(error, '暂时无法读取平台状态。')
  }
}

async function loadAccounts(revision = dataRevision) {
  const requestRevision = ++accountRequestRevision
  usersLoading.value = true
  usersError.value = ''
  try {
    const result = await platformAdminRequest('users_list', { page: page.value, query: query.value.trim() })
    if (revision === dataRevision && requestRevision === accountRequestRevision) accounts.value = result
  } catch (error) {
    if (revision === dataRevision && requestRevision === accountRequestRevision) usersError.value = errorMessage(error, '暂时无法读取账号列表。')
  } finally {
    if (revision === dataRevision && requestRevision === accountRequestRevision) usersLoading.value = false
  }
}


async function loadPendingPlaces(revision = dataRevision, pageNumber = pendingPlacePage.value) {
  placesLoading.value = true
  placesError.value = ''
  try {
    const result = await platformAdminRequest('places_pending', { page: pageNumber })
    if (revision === dataRevision) {
      const total = Number.isSafeInteger(result?.total) ? result.total : 0
      const lastPage = Math.max(1, Math.ceil(total / PLACE_PAGE_SIZE))
      if (pageNumber > lastPage) {
        await loadPendingPlaces(revision, lastPage)
        return
      }
      pendingPlacePage.value = Number.isSafeInteger(result?.page) ? result.page : pageNumber
      pendingPlaceTotal.value = total
      pendingPlaces.value = Array.isArray(result?.places) ? result.places : []
    }
  } catch (error) {
    if (revision === dataRevision) placesError.value = errorMessage(error, '暂时无法读取地点审核队列。')
  } finally {
    if (revision === dataRevision) placesLoading.value = false
  }
}


async function refreshAll() {
  if (access.value !== 'owner') return
  loading.value = true
  pageError.value = ''
  feedback.value = null
  changeDialog.value = null
  const revision = ++dataRevision
  try {
    if (props.section === 'accounts') await loadAccounts(revision)
    else if (props.section === 'places') await loadPendingPlaces(revision)
    else if (props.section === 'activity') return
    else await loadOverview(revision)
  } finally {
    if (revision === dataRevision) loading.value = false
  }
}

async function checkAccess() {
  changeDialog.value = null
  const revision = ++accessRevision
  dataRevision += 1
  overview.value = null
  accounts.value = null
  pendingPlaces.value = []
  pendingPlacePage.value = 1
  pendingPlaceTotal.value = 0
  loading.value = false
  usersLoading.value = false
  placesLoading.value = false
  pageError.value = ''
  usersError.value = ''
  placesError.value = ''
  feedback.value = null

  if (!accountAvailable.value) {
    access.value = 'unconfigured'
    return
  }
  if (!accountReady.value) {
    access.value = 'checking'
    return
  }
  if (!accountUser.value?.id) {
    access.value = 'signed-out'
    return
  }

  access.value = 'checking'
  try {
    const identity = await platformAdminRequest('identity')
    if (revision !== accessRevision) return
    if (!identity?.owner) {
      access.value = 'denied'
      return
    }
    access.value = 'owner'
    await refreshAll()
  } catch (error) {
    if (revision !== accessRevision) return
    if (error instanceof PlatformAdminRequestError && error.code === 'forbidden') access.value = 'denied'
    else if (error instanceof PlatformAdminRequestError && error.code === 'unauthorized') access.value = 'signed-out'
    else {
      access.value = 'error'
      pageError.value = errorMessage(error, '暂时无法验证平台管理权限。')
    }
  }
}

async function reviewPlace(place, decision) {
  if (reviewActionId.value) return
  const reason = String(reviewReasons.value[place.id] || '').trim()
  if (decision === 'rejected' && !reason) {
    placesError.value = `请先填写「${place.name}」的拒绝原因。`
    return
  }
  if (decision === 'rejected' && reason.length > 500) {
    placesError.value = '拒绝原因不能超过 500 个字符。'
    return
  }
  placeReviewConfirmation.value = { place, decision, reason }
}

async function confirmPlaceReview() {
  const confirmation = placeReviewConfirmation.value
  if (!confirmation) return
  placeReviewConfirmation.value = null
  const { place, decision, reason } = confirmation
  const label = decision === 'approved' ? '通过' : '拒绝'
  reviewActionId.value = place.id
  placesError.value = ''
  feedback.value = null
  try {
    const result = await platformAdminRequest('place_review', {
      placeId: place.id, expectedRevision: place.review_revision, decision, reason,
    })
    feedback.value = result.auditIncomplete || result.notificationIncomplete
      ? { tone: 'warning', text: `审核状态已更新，但${[result.auditIncomplete ? '完成日志' : '', result.notificationIncomplete ? '申请人通知' : ''].filter(Boolean).join('与')}没有确认保存，请刷新检查。` }
      : { tone: 'success', text: `「${place.name}」已${label}。` }
    reviewReasons.value[place.id] = ''
    const revision = ++dataRevision
    await loadPendingPlaces(revision)
  } catch (error) {
    if (error instanceof PlatformAdminRequestError && error.code === 'place_state_changed') {
      placesError.value = ''
      feedback.value = null
      const revision = ++dataRevision
      await loadPendingPlaces(revision)
      feedback.value = { tone: 'warning', text: '地点内容或状态已变化，审核队列已刷新；请重新检查最新资料后再处理。' }
    } else {
      placesError.value = errorMessage(error, '审核状态没有确认变更，请刷新队列检查。')
    }
  } finally {
    reviewActionId.value = ''
  }
}

function openLogin() { accountOpen.value = true }

function openStatusChange(account, scope) { changeDialog.value = { account, scope } }

async function restrictionSaved(result) {
  feedback.value = result.legacyBanRemaining
    ? { tone: 'warning', text: '新限制已保存，但旧版登录封禁尚未解除，请刷新后重试；账号仍处于封禁中。' }
    : { tone: 'success', text: `${result.label}已${result.removed ? '解除' : '保存'}，账号会收到原因和解除时间提示。` }
  await loadAccounts(++dataRevision)
}

function changePage(delta) {
  const next = page.value + delta
  if (next < 1 || next > pageCount.value || usersLoading.value) return
  page.value = next
  void loadAccounts()
}

watch(() => [accountReady.value, accountUser.value?.id], () => { void checkAccess() })
watch(query, () => {
  accountRequestRevision += 1
  page.value = 1
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => { if (access.value === 'owner') void loadAccounts() }, 320)
})
onMounted(() => {
  accountTimer = window.setInterval(() => { accountClock.value = Date.now() }, 30000)
  if (!accountReady.value) void initializeAccountAuth().then(checkAccess)
  else void checkAccess()
})

onBeforeUnmount(() => { window.clearTimeout(searchTimer); window.clearInterval(accountTimer); dataRevision += 1; accountRequestRevision += 1; accessRevision += 1 })
</script>

<template>
  <div class="platform-admin">


    <section v-if="access === 'checking'" class="ops-gate" role="status">
      <span class="ops-loader" aria-hidden="true"></span><p>正在验证管理权限…</p>
    </section>
    <section v-else-if="access === 'unconfigured'" class="ops-gate ops-gate-warning" role="alert">
      <h2>账号服务尚未配置</h2><p>当前部署没有可用的 Supabase 登录配置，平台权限无法验证。</p>
    </section>
    <section v-else-if="access === 'signed-out'" class="ops-gate">
      <span class="gate-mark" aria-hidden="true">登</span>
      <h2>请先登录平台所有者账号</h2>

      <button class="ops-button ops-button-primary" type="button" @click="openLogin">打开账号登录</button>
    </section>
    <section v-else-if="access === 'denied'" class="ops-gate ops-gate-warning" role="alert">
      <span class="gate-mark" aria-hidden="true">限</span>
      <h2>此账号没有平台管理权限</h2>
      <p>当前账号可以继续使用个人工作台；平台运维仅对已授权所有者开放。</p>
    </section>
    <template v-else-if="access === 'owner'">
      <RegistrationControl v-if="section === 'system'" />
      <div v-if="section === 'system'" class="ops-system-toolbar"><button class="ops-button ops-button-quiet" type="button" :disabled="loading" @click="refreshAll">{{ loading ? '检查中' : '检查服务' }}</button></div>
      <section v-if="section === 'system'" class="ops-signal" aria-label="服务连接状态">
        <div class="signal-heading"><span class="signal-pulse" :data-state="overview ? 'online' : 'pending'" aria-hidden="true"></span><div><b>服务状态</b><small>{{ overview?.checkedAt ? `最近检查 ${dateLabel(overview.checkedAt)}` : '正在读取真实服务状态' }}</small></div></div>
        <div class="signal-services">
          <div><span>Supabase Auth</span><b :data-state="overview?.services?.auth || 'pending'">{{ overview?.services?.auth === 'online' ? '可连接' : '检查中' }}</b></div>
          <div><span>协作数据</span><b :data-state="overview?.services?.collaborationData || 'pending'">{{ overview?.services?.collaborationData === 'online' ? '可读取' : '检查中' }}</b></div>
          <div><span>网页版本</span><b class="signal-version">v{{ currentVersionInfo.appVersion }}</b></div>
        </div>
      </section>

      <p v-if="pageError" class="ops-feedback error" role="alert">{{ pageError }} <button type="button" @click="refreshAll">重试</button></p>
      <p v-if="feedback" class="ops-feedback" :class="feedback.tone" role="status">{{ feedback.text }}</p>

      <section v-if="section === 'system'" class="ops-overview" aria-label="平台业务概况">
        <div><span>已注册账号</span><b>{{ accountSummary }}</b></div>
        <div><span>进行中的协作项目</span><b>{{ activeProjectSummary }}</b></div>
        <div><span>协作资料</span><b>{{ collaborationProfileSummary }}</b></div>
      </section>

      <AdminActivity v-if="section === 'activity'" />
      <div v-if="section === 'places'" class="ops-review-columns">
        <section v-if="section === 'places'" class="ops-panel ops-place-review" aria-labelledby="ops-place-review-heading">
          <div class="ops-panel-heading">
            <div><h2 id="ops-place-review-heading">校园地点审核 <span class="review-count">{{ pendingPlaceTotal }}</span></h2></div>
            <button class="ops-button ops-button-quiet" type="button" :disabled="placesLoading || loading" @click="loadPendingPlaces()">{{ placesLoading ? '刷新中' : '刷新队列' }}</button>
          </div>
          <p v-if="placesError" class="ops-inline-error" role="alert">{{ placesError }} <button type="button" @click="loadPendingPlaces()">重试</button></p>
          <div v-else-if="placesLoading && !pendingPlaces.length" class="ops-empty" role="status">正在读取真实审核队列…</div>
          <p v-else-if="!pendingPlaces.length" class="ops-empty">当前没有待审核的地点。</p>
          <ul v-else class="ops-place-review-list" :aria-busy="placesLoading">
            <li v-for="place in pendingPlaces" :key="place.id" class="ops-place-review-item">
              <div class="review-place-heading"><div><span>{{ place.school }}<span v-if="place.campus"> · {{ place.campus }}</span></span><h3>{{ place.name }}</h3></div><small>提交 {{ dateLabel(place.created_at) }}</small></div>
              <p class="review-place-location">{{ placeTypeLabel(place.place_type) }}<span v-if="place.area"> · {{ place.area }}</span><span v-if="place.place_hint"> · {{ place.place_hint }}</span></p>
              <p v-if="place.description" class="review-place-copy">{{ place.description }}</p>
              <dl class="review-place-facts"><div v-if="place.opening_hours"><dt>开放时间</dt><dd>{{ place.opening_hours }}</dd></div><div v-if="place.service_info"><dt>服务与价格</dt><dd>{{ place.service_info }}</dd></div><div v-if="place.public_contact"><dt>公开业务联系</dt><dd>{{ place.public_contact }}</dd></div><div v-if="place.source_info"><dt>来源说明</dt><dd>{{ place.source_info }}</dd></div></dl>
              <label class="ops-search review-reason"><span>拒绝原因</span><textarea v-model="reviewReasons[place.id]" rows="2" maxlength="500" :disabled="Boolean(reviewActionId)" placeholder="请说明需要补充或修改的内容"></textarea><small>{{ String(reviewReasons[place.id] || '').trim().length }} / 500</small></label>
              <div class="dialog-actions"><button class="ops-button ops-button-danger" type="button" :disabled="Boolean(reviewActionId)" @click="reviewPlace(place, 'rejected')">{{ reviewActionId === place.id ? '正在提交…' : '拒绝并说明原因' }}</button><button class="ops-button ops-button-primary" type="button" :disabled="Boolean(reviewActionId)" @click="reviewPlace(place, 'approved')">{{ reviewActionId === place.id ? '正在提交…' : '审核通过并发布' }}</button></div>
            </li>
          </ul>
          <div v-if="pendingPlaceTotal > PLACE_PAGE_SIZE" class="ops-place-pagination" aria-label="地点审核队列分页">
            <button class="ops-button ops-button-quiet" type="button" :disabled="placesLoading || pendingPlacePage <= 1" @click="loadPendingPlaces(dataRevision, pendingPlacePage - 1)">上一页</button>
            <span>第 {{ pendingPlacePage }} / {{ placePageCount }} 页 · 共 {{ pendingPlaceTotal }} 条</span>
            <button class="ops-button ops-button-quiet" type="button" :disabled="placesLoading || pendingPlacePage >= placePageCount" @click="loadPendingPlaces(dataRevision, pendingPlacePage + 1)">下一页</button>
          </div>
        </section>


      </div>

      <div class="ops-columns">
        <section v-if="section === 'accounts'" class="ops-panel ops-accounts" aria-labelledby="ops-accounts-heading">
          <div class="ops-panel-heading">
            <div><h2 id="ops-accounts-heading">账号管理</h2></div>
            <button class="ops-button ops-button-quiet" type="button" :disabled="loading || usersLoading" @click="refreshAll">{{ loading ? '刷新中' : '刷新' }}</button>
          </div>
          <label class="ops-search"><span>按登录邮箱搜索</span><input v-model="query" type="search" autocomplete="off" placeholder="输入邮箱的一部分" maxlength="120"></label>
          <p class="ops-account-help">账号封禁后仅可查看处理通知与使用本机数据；禁止发布单独生效。两种限制均可调整时长、提前解除，到期自动恢复。</p>
          <p v-if="usersError" class="ops-inline-error" role="alert">{{ usersError }} <button type="button" @click="loadAccounts()">重试</button></p>
          <div v-else-if="usersLoading && !accounts" class="ops-empty" role="status">正在安全读取账号信息…</div>
          <ul v-else-if="accounts?.users?.length" class="ops-account-list" :aria-busy="usersLoading">
            <li v-for="account in accounts.users" :key="account.id" class="ops-account-row">
              <div class="account-primary">
                <b>{{ account.email || '未设置邮箱' }}</b>
                <span class="account-status" :data-status="accountBlocked(account) ? 'suspended' : account.emailVerifiedAt ? 'active' : 'unverified'">{{ accountBlocked(account) ? '已封禁' : statusLabel(account.emailVerifiedAt ? 'active' : 'unverified') }}</span>
                <span v-if="publishingBlocked(account)" class="account-status" data-status="suspended">禁止发布</span>
                <small>注册 {{ dateLabel(account.createdAt) }}<span class="account-last-seen">最近登录 {{ dateLabel(account.lastSignInAt) }}</span></small>
                <small v-if="accountBlocked(account)">账号封禁：{{ restrictionDate(account.restrictions?.account?.enabled ? account.restrictions.account.expiresAt : account.bannedUntil) }}<span v-if="account.restrictions?.account?.enabled">{{ restrictionRemaining(account.restrictions.account, accountClock) }}</span></small>
                <small v-if="publishingBlocked(account)">禁发至：{{ restrictionDate(account.restrictions?.publish?.expiresAt) }} · {{ restrictionRemaining(account.restrictions?.publish, accountClock) }}</small>
              </div>
              <div v-if="!account.platformOwner" class="account-actions"><button class="ops-button ops-button-quiet" type="button" :disabled="usersLoading" @click="openStatusChange(account, 'account')">{{ accountBlocked(account) ? '调整封禁' : '封禁账号' }}</button><button class="ops-button ops-button-quiet" type="button" :disabled="usersLoading" @click="openStatusChange(account, 'publish')">{{ publishingBlocked(account) ? '调整禁发' : '禁止发布' }}</button></div>
              <span v-else-if="account.platformOwner" class="account-owner-tag">平台所有者</span>
            </li>
          </ul>
          <div v-else class="ops-empty">{{ query ? '没有找到匹配邮箱的账号。' : '当前没有账号记录。' }}</div>
          <p v-if="accounts?.truncated" class="ops-list-note">搜索最多扫描 50,000 个账号；达到上限后结果可能不完整。</p>
          <footer v-if="accounts" class="ops-pagination">
            <span>{{ accounts.truncated ? '至少 ' : '' }}{{ accounts.total.toLocaleString('zh-CN') }} 个匹配账号 · 第 {{ page }} / {{ pageCount }} 页</span>
            <div><button type="button" class="ops-button ops-button-quiet" :disabled="page <= 1 || usersLoading" @click="changePage(-1)">上一页</button><button type="button" class="ops-button ops-button-quiet" :disabled="page >= pageCount || usersLoading" @click="changePage(1)">下一页</button></div>
          </footer>
        </section>


      </div>

      <ConfirmDialog v-if="placeReviewConfirmation" :open="Boolean(placeReviewConfirmation)" :title="placeReviewConfirmation.decision === 'approved' ? '审核并发布地点' : '拒绝地点资料'" :message="placeReviewConfirmation.decision === 'approved' ? `确认通过“${placeReviewConfirmation.place.name}”？通过后，同校学生可以搜索并查看。` : `确认拒绝“${placeReviewConfirmation.place.name}”？发布者会收到填写的原因并可修改后重新提交。`" :confirm-label="placeReviewConfirmation.decision === 'approved' ? '审核通过并发布' : '拒绝并说明原因'" :tone="placeReviewConfirmation.decision === 'approved' ? 'primary' : 'danger'" @close="placeReviewConfirmation = null" @confirm="confirmPlaceReview" />
    </template>
    <section v-else class="ops-gate ops-gate-warning" role="alert">
      <h2>暂时无法验证管理权限</h2><p>{{ pageError || '请检查网络后重试。' }}</p>
      <button class="ops-button ops-button-primary" type="button" @click="checkAccess">重新检查</button>
    </section>

    <AccountRestrictionDialog :target="changeDialog || undefined" @close="changeDialog = null" @saved="restrictionSaved" @stale="loadAccounts()" />
  </div>
</template>

<style scoped>
.platform-admin { width:100%; max-width:1240px; margin:0 auto; padding:0 0 38px; color:var(--text); }
.ops-signal { display:flex; align-items:center; justify-content:space-between; gap:24px; min-height:84px; margin-bottom:15px; padding:15px 18px; border:1px solid var(--border); border-radius:var(--radius-12); background:var(--card); }
.signal-heading { display:flex; align-items:center; gap:11px; min-width:180px; }
.signal-pulse { width:10px; height:10px; flex:0 0 10px; border-radius:50%; background:var(--muted); }
.signal-pulse[data-state='online'] { background:var(--success); box-shadow:0 0 0 4px color-mix(in srgb,var(--success) 12%,transparent); }
.signal-heading div { display:grid; gap:3px; }
.signal-heading b { font-size:var(--fs-13); }
.signal-heading small { color:var(--muted); font-size:var(--fs-11); }
.signal-services { display:flex; align-items:center; justify-content:flex-end; flex:1; }
.signal-services > div { display:grid; gap:4px; min-width:140px; padding:0 17px; border-left:1px solid var(--border); }
.signal-services span,.ops-overview span { color:var(--muted); font-size:var(--fs-11); }
.signal-services b { color:var(--ink-soft); font-size:var(--fs-12); font-weight:var(--fw-650); }
.signal-services b[data-state='online'] { color:var(--success); }
.signal-version { font-variant-numeric:tabular-nums; }
.ops-overview { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); margin-bottom:16px; border:1px solid var(--border); border-radius:var(--radius-12); background:var(--card); }
.ops-overview > div { display:grid; gap:4px; min-width:0; padding:15px 18px; }
.ops-overview > div + div { border-left:1px solid var(--border); }
.ops-overview b { font-size:var(--fs-22); font-weight:var(--fw-750); font-variant-numeric:tabular-nums; }
.ops-overview small { color:var(--muted); font-size:var(--fs-10); line-height:1.45; }
.ops-review-columns { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(270px,.75fr); align-items:start; gap:16px; margin-bottom:16px; }
.review-count { display:inline-grid; min-width:24px; height:24px; place-items:center; margin-inline-start:5px; padding:0 6px; border-radius:var(--radius-pill); color:var(--primary); background:var(--primary-soft); font-size:var(--fs-11); vertical-align:2px; }
.ops-place-review-list { display:grid; gap:10px; margin:0; padding:0; list-style:none; }
.ops-place-review-item { display:grid; gap:8px; padding:13px 0; border-top:1px solid var(--border); }
.ops-place-pagination { display:flex; align-items:center; justify-content:center; gap:12px; padding-top:12px; border-top:1px solid var(--border); color:var(--muted); font-size:var(--fs-11); }
.review-place-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.review-place-heading > div { display:grid; gap:4px; min-width:0; }
.review-place-heading span,.review-place-heading small,.review-place-location { color:var(--muted); font-size:var(--fs-10); }
.review-place-heading h3 { margin:0; font-size:var(--fs-15); }
.review-place-heading small { flex:none; }
.review-place-location,.review-place-copy { margin:0; font-size:var(--fs-12); line-height:1.6; overflow-wrap:anywhere; }
.review-place-facts { display:grid; gap:6px; margin:0; }
.review-place-facts > div { display:grid; grid-template-columns:78px minmax(0,1fr); gap:8px; font-size:var(--fs-11); line-height:1.55; }
.review-place-facts dt { color:var(--muted); }
.review-place-facts dd { margin:0; overflow-wrap:anywhere; }
.review-reason { margin:2px 0 0; }
.review-reason textarea { min-height:66px; resize:vertical; }
.review-reason small { justify-self:end; color:var(--muted); font-weight:var(--fw-400); }
.ops-columns { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(270px,.9fr); align-items:start; gap:16px; }
.ops-panel { min-width:0; padding:17px 18px; border:1px solid var(--border); border-radius:var(--radius-12); background-color:var(--glass-surface); backdrop-filter:var(--glass-filter); box-shadow:var(--glass-shadow); }
.ops-accounts { min-height:390px; grid-column:1 / -1; }
.ops-account-help { margin:0 0 14px; color:var(--muted); font-size:var(--fs-12); line-height:1.65; }
.account-actions { display:flex; flex-wrap:wrap; gap:8px; flex-shrink:0; }
.ops-panel-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:14px; }
.ops-button { display:inline-flex; align-items:center; justify-content:center; min-height:40px; padding:7px 12px; border:1px solid var(--border); border-radius:var(--radius-8); color:var(--text); background:var(--card); font:inherit; font-size:var(--fs-12); font-weight:var(--fw-650); cursor:pointer; }
.ops-button:hover:not(:disabled) { border-color:var(--primary); color:var(--primary); background:var(--primary-soft); }
.ops-button:focus-visible,.ops-search input:focus-visible,.ops-search textarea:focus-visible { outline:var(--focus-width) solid var(--focus-solid); outline-offset:var(--focus-offset); }
.ops-button:disabled { cursor:wait; opacity:.58; }
.ops-button-primary { border-color:var(--primary); color:var(--on-primary); background:var(--primary); }
.ops-button-primary:hover:not(:disabled) { color:var(--on-primary); background:var(--primary-hover); }
.ops-button-danger { border-color:color-mix(in srgb,var(--danger) 32%,var(--border)); color:var(--danger); background:color-mix(in srgb,var(--danger) 6%,var(--card)); }
.ops-button-quiet { color:var(--ink-soft); background:var(--bg-tint); }
.ops-search { display:grid; gap:6px; margin:0 0 11px; color:var(--ink-soft); font-size:var(--fs-11); font-weight:var(--fw-650); }
.ops-search input,.ops-search textarea { width:100%; min-height:42px; padding:9px 11px; border:1px solid var(--border-strong); border-radius:var(--radius-8); color:var(--text); background:var(--bg); font:inherit; font-size:var(--fs-13); font-weight:var(--fw-400); }
.ops-account-row { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:75px; padding:10px 0; border-top:1px solid var(--border); }
.account-primary { display:flex; align-items:center; flex-wrap:wrap; gap:7px 10px; min-width:0; }
.account-primary > b { overflow:hidden; max-width:100%; font-size:var(--fs-13); font-weight:var(--fw-650); text-overflow:ellipsis; white-space:nowrap; }
.account-primary small { display:flex; flex-basis:100%; flex-wrap:wrap; gap:3px 12px; color:var(--muted); font-size:var(--fs-10); line-height:1.5; }
.account-status,.account-owner-tag { display:inline-flex; align-items:center; min-height:23px; padding:2px 8px; border:1px solid var(--border); border-radius:var(--radius-pill); color:var(--ink-soft); background:var(--bg-tint); font-size:var(--fs-10); white-space:nowrap; }
.account-status[data-status='active'] { border-color:color-mix(in srgb,var(--success) 28%,var(--border)); color:var(--success); background:color-mix(in srgb,var(--success) 7%,var(--card)); }
.account-status[data-status='suspended'] { border-color:color-mix(in srgb,var(--danger) 30%,var(--border)); color:var(--danger); background:var(--danger-soft); }
.account-owner-tag { border-color:color-mix(in srgb,var(--primary) 27%,var(--border)); color:var(--primary); background:var(--primary-soft); }
.ops-list-note { margin:10px 0 0; color:var(--warning); font-size:var(--fs-11); line-height:1.5; }
.ops-pagination { display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:12px; border-top:1px solid var(--border); color:var(--muted); font-size:var(--fs-10); }
.ops-pagination > div { display:flex; gap:6px; }
.ops-pagination .ops-button { min-height:36px; }
.ops-empty { padding:19px 10px; border-top:1px solid var(--border); color:var(--muted); font-size:var(--fs-12); text-align:center; }
.ops-inline-error,.ops-feedback { padding:10px 12px; border:1px solid color-mix(in srgb,var(--danger) 30%,var(--border)); border-radius:var(--radius-8); color:var(--danger); background:var(--danger-soft); font-size:var(--fs-12); line-height:1.55; }
.ops-inline-error button,.ops-feedback button { margin-left:5px; padding:0; border:0; color:inherit; background:transparent; font:inherit; font-weight:var(--fw-750); text-decoration:underline; cursor:pointer; }
.ops-feedback.success { border-color:color-mix(in srgb,var(--success) 29%,var(--border)); color:var(--success); background:color-mix(in srgb,var(--success) 7%,var(--card)); }
.ops-feedback.warning { border-color:color-mix(in srgb,var(--warning) 33%,var(--border)); color:var(--warning); background:color-mix(in srgb,var(--warning) 8%,var(--card)); }
.ops-gate { display:grid; justify-items:start; gap:9px; max-width:540px; margin:30px auto; padding:24px; border:1px solid var(--border); border-radius:var(--radius-12); background:var(--card); box-shadow:var(--shadow-sm); }
.ops-gate h2 { margin:0; font-size:var(--fs-17); }
.ops-gate p { max-width:54ch; margin:0 0 5px; color:var(--muted); font-size:var(--fs-13); line-height:1.65; }
.ops-gate-warning { border-color:color-mix(in srgb,var(--warning) 34%,var(--border)); }
.ops-loader { width:20px; height:20px; border:2px solid var(--border); border-top-color:var(--primary); border-radius:50%; animation:ops-spin .8s linear infinite; }
.dialog-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:4px; }
@keyframes ops-spin { to { transform:rotate(360deg); } }
@media (max-width:760px) {
  .ops-review-columns { grid-template-columns:minmax(0,1fr); }
  .ops-columns { grid-template-columns:minmax(0,1fr); }
  .ops-signal { align-items:flex-start; flex-direction:column; gap:13px; }
  .signal-services { justify-content:stretch; width:100%; }
  .signal-services > div { flex:1; min-width:0; padding:0 10px; }
  .signal-services > div:first-child { padding-left:0; border-left:0; }
}
@media (max-width:520px) {
  .platform-admin { padding-bottom:24px; }
  .ops-overview { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .ops-overview > div { padding:12px; }
  .ops-overview > div + div { border-left:0; }
  .ops-overview > div:nth-child(2) { border-left:1px solid var(--border); }
  .ops-overview > div:nth-child(3) { grid-column:1/-1; border-top:1px solid var(--border); }
  .ops-overview b { font-size:var(--fs-20); }
  .ops-panel { padding:14px; }
  .ops-account-row { align-items:flex-start; }
  /* `>` 只匹配直接子元素，而账号行的按钮是嵌在 `.account-actions` 里的，
     于是窄屏下它们一直是 40px —— 用后代选择器把两种情况一起覆盖。 */
  .ops-account-row .ops-button { min-width:56px; min-height:44px; flex:0 0 auto; }
  .ops-search input, .ops-search textarea { min-height:44px; }
  .account-primary { gap:5px 7px; }
  .account-primary > b { font-size:var(--fs-12); }
  .account-primary small { gap:2px; }
  .account-last-seen { flex-basis:100%; }
  .ops-pagination { align-items:flex-start; flex-direction:column; }
  .ops-pagination > div { width:100%; }
  .ops-pagination .ops-button { flex:1; }
}
@media (prefers-reduced-motion: reduce) {
  .ops-loader { animation:none; }
}
.ops-columns,.ops-review-columns{grid-template-columns:minmax(0,1fr)}
.ops-system-toolbar{display:flex;justify-content:flex-end;margin-bottom:14px}
.gate-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;color:var(--primary);background:var(--primary-soft)}
</style>
