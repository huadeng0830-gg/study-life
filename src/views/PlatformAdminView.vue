<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { accountAvailable, accountOpen, accountReady, accountUser, initializeAccountAuth } from '../composables/accountAuth.js'
import { currentVersionInfo } from '../composables/versionInfo.js'
import { PlatformAdminRequestError, platformAdminRequest } from '../services/platformAdmin.js'

/** @typedef {{ id: string, email: string, createdAt: string|null, lastSignInAt: string|null, emailVerifiedAt: string|null, status: string, platformOwner: boolean }} AdminAccount */
/** @typedef {{ users: AdminAccount[], page: number, pageSize: number, total: number, truncated: boolean }} AccountPage */
/** @typedef {{ checkedAt: string, services: { auth: string, collaborationData: string }, counts: { accounts: number|null, accountsScanned: number, accountsTruncated: boolean, activeProjects: number, collaborationProfiles: number } }} PlatformOverview */
/** @typedef {{ id: string, actor_user_id: string|null, target_user_id: string|null, action: string, outcome: string, reason: string, created_at: string, completed_at: string|null }} AuditEvent */
/** @typedef {{ account: AdminAccount, suspend: boolean }} StatusChangeDialog */
/** @typedef {{ tone: string, text: string }} FeedbackMessage */

const PAGE_SIZE = 25
const access = ref('checking')
const ownerEmail = ref('')
const overview = ref(/** @type {PlatformOverview|null} */ (null))
const accounts = ref(/** @type {AccountPage|null} */ (null))
const auditEvents = ref(/** @type {AuditEvent[]} */ ([]))
const query = ref('')
const page = ref(1)
const loading = ref(false)
const usersLoading = ref(false)
const auditLoading = ref(false)
const pageError = ref('')
const usersError = ref('')
const auditError = ref('')
const feedback = ref(/** @type {FeedbackMessage|null} */ (null))
const changeDialog = ref(/** @type {StatusChangeDialog|null} */ (null))
const changeReason = ref('')
const changeError = ref('')
const changePending = ref(false)
const dialogElement = ref(/** @type {HTMLDialogElement|null} */ (null))
let accessRevision = 0
let dataRevision = 0
let searchTimer = 0

const pageCount = computed(() => Math.max(1, Math.ceil((accounts.value?.total || 0) / PAGE_SIZE)))
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
  return ({ active: '正常', suspended: '已暂停', unverified: '待验证' })[status] || '未知'
}

function dateLabel(value) {
  if (!value) return '暂无记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间无法识别' : new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function actionLabel(action) {
  return ({ 'user.suspend': '暂停账号', 'user.restore': '恢复账号' })[action] || '管理操作'
}

function outcomeLabel(outcome) {
  return ({ started: '处理中', succeeded: '已完成', failed: '失败' })[outcome] || '未知'
}

function errorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback
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
  usersLoading.value = true
  usersError.value = ''
  try {
    const result = await platformAdminRequest('users_list', { page: page.value, query: query.value.trim() })
    if (revision === dataRevision) accounts.value = result
  } catch (error) {
    if (revision === dataRevision) usersError.value = errorMessage(error, '暂时无法读取账号列表。')
  } finally {
    if (revision === dataRevision) usersLoading.value = false
  }
}

async function loadAudit(revision = dataRevision) {
  auditLoading.value = true
  auditError.value = ''
  try {
    const result = await platformAdminRequest('audit_list', { limit: 20 })
    if (revision === dataRevision) auditEvents.value = Array.isArray(result) ? result : []
  } catch (error) {
    if (revision === dataRevision) auditError.value = errorMessage(error, '暂时无法读取操作记录。')
  } finally {
    if (revision === dataRevision) auditLoading.value = false
  }
}

async function refreshAll() {
  if (access.value !== 'owner') return
  loading.value = true
  pageError.value = ''
  feedback.value = null
  const revision = ++dataRevision
  try {
    await Promise.all([loadOverview(revision), loadAccounts(revision), loadAudit(revision)])
  } finally {
    if (revision === dataRevision) loading.value = false
  }
}

async function checkAccess() {
  const revision = ++accessRevision
  dataRevision += 1
  overview.value = null
  accounts.value = null
  auditEvents.value = []
  loading.value = false
  usersLoading.value = false
  auditLoading.value = false
  pageError.value = ''
  usersError.value = ''
  auditError.value = ''
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
    ownerEmail.value = ''
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
    ownerEmail.value = identity.email || accountUser.value.email || ''
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

function openLogin() { accountOpen.value = true }

function openStatusChange(account, suspend) {
  changeDialog.value = { account, suspend }
  changeReason.value = ''
  changeError.value = ''
}

function closeStatusChange(force = false) {
  if (changePending.value && !force) return
  if (dialogElement.value?.open) dialogElement.value.close()
  changeDialog.value = null
  changeError.value = ''
}

function cancelStatusChange() { closeStatusChange() }
function onDialogClose() { changeDialog.value = null }

async function confirmStatusChange() {
  if (changePending.value || !changeDialog.value) return
  const reason = changeReason.value.trim()
  if (!reason) {
    changeError.value = '请填写处理原因，操作才会进入审计记录。'
    return
  }
  if (reason.length > 500) {
    changeError.value = '原因不能超过 500 个字符。'
    return
  }
  const target = changeDialog.value
  changePending.value = true
  changeError.value = ''
  try {
    const result = await platformAdminRequest(target.suspend ? 'user_suspend' : 'user_restore', {
      userId: target.account.id,
      reason,
    })
    closeStatusChange(true)
    feedback.value = result.auditIncomplete
      ? { tone: 'warning', text: '账号状态已变更，但审计记录未能确认完成。请刷新操作记录检查。' }
      : { tone: 'success', text: target.suspend ? '账号已暂停，用户数据没有删除。' : '账号已恢复。' }
    const revision = ++dataRevision
    await Promise.all([loadAccounts(revision), loadAudit(revision), loadOverview(revision)])
  } catch (error) {
    changeError.value = errorMessage(error, '账号状态没有确认变更，请刷新后检查。')
  } finally {
    changePending.value = false
  }
}

function changePage(delta) {
  const next = page.value + delta
  if (next < 1 || next > pageCount.value || usersLoading.value) return
  page.value = next
  void loadAccounts()
}

watch(() => [accountReady.value, accountUser.value?.id], () => { void checkAccess() })
watch(query, () => {
  page.value = 1
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => { if (access.value === 'owner') void loadAccounts() }, 320)
})
watch(changeDialog, async (value) => {
  await nextTick()
  if (value && dialogElement.value && !dialogElement.value.open) dialogElement.value.showModal()
  else if (!value && dialogElement.value?.open) dialogElement.value.close()
})

onMounted(() => {
  if (!accountReady.value) void initializeAccountAuth().then(checkAccess)
  else void checkAccess()
})

onBeforeUnmount(() => window.clearTimeout(searchTimer))
</script>

<template>
  <div class="platform-admin">
    <header class="ops-header">
      <div class="ops-title-group">
        <p class="ops-breadcrumb">管理中心 / 平台运维</p>
        <h1>平台运维</h1>
        <p class="ops-intro">只管理账号访问与协作服务状态。个人日程、账本和同步快照仍由用户本人控制。</p>
      </div>
      <div v-if="access === 'owner'" class="ops-owner-chip">
        <span class="owner-mark" aria-hidden="true">所</span>
        <span><b>平台所有者</b><small>{{ ownerEmail }}</small></span>
      </div>
    </header>

    <section v-if="access === 'checking'" class="ops-gate" role="status">
      <span class="ops-loader" aria-hidden="true"></span><p>正在验证管理权限…</p>
    </section>
    <section v-else-if="access === 'unconfigured'" class="ops-gate ops-gate-warning" role="alert">
      <h2>账号服务尚未配置</h2><p>当前部署没有可用的 Supabase 登录配置，平台权限无法验证。</p>
    </section>
    <section v-else-if="access === 'signed-out'" class="ops-gate">
      <span class="gate-mark" aria-hidden="true">登</span>
      <h2>请先登录平台所有者账号</h2>
      <p>使用已绑定为平台所有者的 Supabase 登录邮箱。登录身份由服务端核验。</p>
      <button class="ops-button ops-button-primary" type="button" @click="openLogin">打开账号登录</button>
    </section>
    <section v-else-if="access === 'denied'" class="ops-gate ops-gate-warning" role="alert">
      <span class="gate-mark" aria-hidden="true">限</span>
      <h2>此账号没有平台管理权限</h2>
      <p>当前账号可以继续使用个人工作台；平台运维仅对已授权所有者开放。</p>
    </section>
    <template v-else-if="access === 'owner'">
      <section class="ops-signal" aria-label="服务连接状态">
        <div class="signal-heading"><span class="signal-pulse" :data-state="overview ? 'online' : 'pending'" aria-hidden="true"></span><div><b>连接检查</b><small>{{ overview?.checkedAt ? `最近检查 ${dateLabel(overview.checkedAt)}` : '正在读取真实服务状态' }}</small></div></div>
        <div class="signal-services">
          <div><span>Supabase Auth</span><b :data-state="overview?.services?.auth || 'pending'">{{ overview?.services?.auth === 'online' ? '可连接' : '检查中' }}</b></div>
          <div><span>协作数据</span><b :data-state="overview?.services?.collaborationData || 'pending'">{{ overview?.services?.collaborationData === 'online' ? '可读取' : '检查中' }}</b></div>
          <div><span>网页版本</span><b class="signal-version">v{{ currentVersionInfo.appVersion }}</b></div>
        </div>
      </section>

      <p v-if="pageError" class="ops-feedback error" role="alert">{{ pageError }} <button type="button" @click="refreshAll">重试</button></p>
      <p v-if="feedback" class="ops-feedback" :class="feedback.tone" role="status">{{ feedback.text }}</p>

      <section class="ops-overview" aria-label="平台业务概况">
        <div><span>已注册账号</span><b>{{ accountSummary }}</b><small>逐页读取；超过 50,000 时显示下限</small></div>
        <div><span>进行中的协作项目</span><b>{{ activeProjectSummary }}</b><small>仅统计状态为进行中的项目</small></div>
        <div><span>协作资料</span><b>{{ collaborationProfileSummary }}</b><small>仅计数，不读取用户日程正文</small></div>
      </section>

      <div class="ops-columns">
        <section class="ops-panel ops-accounts" aria-labelledby="ops-accounts-heading">
          <div class="ops-panel-heading">
            <div><h2 id="ops-accounts-heading">账号管理</h2><p>暂停只阻止后续登录与云服务访问，不删除账号或设备上的个人数据。</p></div>
            <button class="ops-button ops-button-quiet" type="button" :disabled="loading || usersLoading" @click="refreshAll">{{ loading ? '刷新中' : '刷新' }}</button>
          </div>
          <label class="ops-search"><span>按登录邮箱搜索</span><input v-model="query" type="search" autocomplete="off" placeholder="输入邮箱的一部分" maxlength="120"></label>
          <p v-if="usersError" class="ops-inline-error" role="alert">{{ usersError }} <button type="button" @click="loadAccounts()">重试</button></p>
          <div v-else-if="usersLoading && !accounts" class="ops-empty" role="status">正在安全读取账号信息…</div>
          <ul v-else-if="accounts?.users?.length" class="ops-account-list" :aria-busy="usersLoading">
            <li v-for="account in accounts.users" :key="account.id" class="ops-account-row">
              <div class="account-primary">
                <b>{{ account.email || '未设置邮箱' }}</b>
                <span class="account-status" :data-status="account.status">{{ statusLabel(account.status) }}</span>
                <small>注册 {{ dateLabel(account.createdAt) }}<span class="account-last-seen">最近登录 {{ dateLabel(account.lastSignInAt) }}</span></small>
              </div>
              <button v-if="!account.platformOwner && account.status === 'active'" class="ops-button ops-button-danger" type="button" :disabled="changePending" @click="openStatusChange(account, true)">暂停</button>
              <button v-else-if="!account.platformOwner && account.status === 'suspended'" class="ops-button ops-button-quiet" type="button" :disabled="changePending" @click="openStatusChange(account, false)">恢复</button>
              <span v-else-if="account.platformOwner" class="account-owner-tag">平台所有者</span>
              <span v-else class="account-no-action">无需处理</span>
            </li>
          </ul>
          <div v-else class="ops-empty">{{ query ? '没有找到匹配邮箱的账号。' : '当前没有账号记录。' }}</div>
          <p v-if="accounts?.truncated" class="ops-list-note">搜索最多扫描 50,000 个账号；达到上限后结果可能不完整。</p>
          <footer v-if="accounts" class="ops-pagination">
            <span>{{ accounts.truncated ? '至少 ' : '' }}{{ accounts.total.toLocaleString('zh-CN') }} 个匹配账号 · 第 {{ page }} / {{ pageCount }} 页</span>
            <div><button type="button" class="ops-button ops-button-quiet" :disabled="page <= 1 || usersLoading" @click="changePage(-1)">上一页</button><button type="button" class="ops-button ops-button-quiet" :disabled="page >= pageCount || usersLoading" @click="changePage(1)">下一页</button></div>
          </footer>
        </section>

        <aside class="ops-side-column">
          <section class="ops-panel ops-audit" aria-labelledby="ops-audit-heading">
            <div class="ops-panel-heading"><div><h2 id="ops-audit-heading">最近管理操作</h2><p>账号暂停与恢复均留下服务端记录。</p></div></div>
            <p v-if="auditError" class="ops-inline-error" role="alert">{{ auditError }} <button type="button" @click="loadAudit()">重试</button></p>
            <div v-else-if="auditLoading && !auditEvents.length" class="ops-empty" role="status">正在读取操作记录…</div>
            <ul v-else-if="auditEvents.length" class="ops-audit-list">
              <li v-for="event in auditEvents" :key="event.id">
                <span class="audit-mark" :data-outcome="event.outcome" aria-hidden="true"></span>
                <div><b>{{ actionLabel(event.action) }} · {{ outcomeLabel(event.outcome) }}</b><p>{{ event.reason }}</p><time :datetime="event.created_at">{{ dateLabel(event.created_at) }}</time></div>
              </li>
            </ul>
            <p v-else class="ops-empty">还没有平台管理操作记录。</p>
          </section>

          <section class="ops-boundary" aria-labelledby="ops-boundary-heading">
            <span class="boundary-mark" aria-hidden="true">隐</span>
            <div><h2 id="ops-boundary-heading">数据访问边界</h2><p>后台不提供个人同步快照、账本、课表或协作正文的查询入口。账号列表只返回登录邮箱与认证状态；权限由服务端表和已验证会话共同决定。</p></div>
          </section>
        </aside>
      </div>
    </template>
    <section v-else class="ops-gate ops-gate-warning" role="alert">
      <h2>暂时无法验证管理权限</h2><p>{{ pageError || '请检查网络后重试。' }}</p>
      <button class="ops-button ops-button-primary" type="button" @click="checkAccess">重新检查</button>
    </section>

    <dialog ref="dialogElement" class="ops-dialog" :aria-labelledby="changeDialog ? 'ops-dialog-title' : undefined" @cancel.prevent="cancelStatusChange" @close="onDialogClose">
      <form v-if="changeDialog" class="ops-dialog-form" @submit.prevent="confirmStatusChange">
        <p class="ops-breadcrumb">账号安全操作</p>
        <h2 id="ops-dialog-title">{{ changeDialog.suspend ? '暂停此账号？' : '恢复此账号？' }}</h2>
        <p class="dialog-impact">{{ changeDialog.suspend ? `暂停 ${changeDialog.account.email} 后，将阻止新的登录和会话续期。已签发的访问令牌在过期前可能仍可使用；账号与本机数据不会删除，也不会修改协作项目内容。` : `恢复 ${changeDialog.account.email} 后，账号可重新登录并继续使用云服务。` }}</p>
        <label class="ops-search dialog-reason"><span>处理原因（写入审计记录）</span><textarea v-model="changeReason" rows="3" maxlength="500" required placeholder="例如：用户确认账号被盗，已通过其他方式核实"></textarea><small>{{ changeReason.trim().length }} / 500</small></label>
        <p v-if="changeError" class="ops-inline-error" role="alert">{{ changeError }}</p>
        <div class="dialog-actions"><button class="ops-button ops-button-quiet" type="button" :disabled="changePending" @click="cancelStatusChange">取消</button><button class="ops-button" :class="changeDialog.suspend ? 'ops-button-danger' : 'ops-button-primary'" type="submit" :disabled="changePending">{{ changePending ? '正在处理…' : changeDialog.suspend ? '确认暂停' : '确认恢复' }}</button></div>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.platform-admin { width:100%; max-width:1240px; margin:0 auto; padding:0 0 38px; color:var(--text); }
.ops-header { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin:0 0 22px; }
.ops-title-group h1 { margin:0; font-size:var(--fs-26); font-weight:var(--fw-800); letter-spacing:-.025em; }
.ops-breadcrumb { margin:0 0 8px; color:var(--muted); font-size:var(--fs-12); }
.ops-intro { max-width:70ch; margin:7px 0 0; color:var(--ink-soft); font-size:var(--fs-13); line-height:1.65; }
.ops-owner-chip { display:flex; align-items:center; gap:10px; max-width:310px; padding:8px 13px 8px 9px; border:1px solid var(--border); border-radius:var(--radius-pill); background:var(--card); }
.owner-mark,.gate-mark,.boundary-mark { display:grid; place-items:center; width:34px; height:34px; flex:0 0 34px; border-radius:50%; color:var(--primary); background:var(--primary-soft); font-size:var(--fs-12); font-weight:var(--fw-750); }
.ops-owner-chip span:last-child { display:grid; min-width:0; gap:1px; }
.ops-owner-chip b { font-size:var(--fs-11); }
.ops-owner-chip small { overflow:hidden; color:var(--muted); font-size:var(--fs-11); text-overflow:ellipsis; white-space:nowrap; }
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
.ops-columns { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(270px,.9fr); align-items:start; gap:16px; }
.ops-panel { min-width:0; padding:17px 18px; border:1px solid var(--border); border-radius:var(--radius-12); background:var(--card); box-shadow:var(--shadow-sm); }
.ops-accounts { min-height:390px; }
.ops-panel-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:14px; }
.ops-panel-heading h2,.ops-boundary h2 { margin:0; font-size:var(--fs-15); font-weight:var(--fw-750); }
.ops-panel-heading p,.ops-boundary p { margin:4px 0 0; color:var(--muted); font-size:var(--fs-11); line-height:1.55; }
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
.ops-account-list,.ops-audit-list { list-style:none; margin:0; padding:0; }
.ops-account-row { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:75px; padding:10px 0; border-top:1px solid var(--border); }
.account-primary { display:flex; align-items:center; flex-wrap:wrap; gap:7px 10px; min-width:0; }
.account-primary > b { overflow:hidden; max-width:100%; font-size:var(--fs-13); font-weight:var(--fw-650); text-overflow:ellipsis; white-space:nowrap; }
.account-primary small { display:flex; flex-basis:100%; flex-wrap:wrap; gap:3px 12px; color:var(--muted); font-size:var(--fs-10); line-height:1.5; }
.account-status,.account-owner-tag { display:inline-flex; align-items:center; min-height:23px; padding:2px 8px; border:1px solid var(--border); border-radius:var(--radius-pill); color:var(--ink-soft); background:var(--bg-tint); font-size:var(--fs-10); white-space:nowrap; }
.account-status[data-status='active'] { border-color:color-mix(in srgb,var(--success) 28%,var(--border)); color:var(--success); background:color-mix(in srgb,var(--success) 7%,var(--card)); }
.account-status[data-status='suspended'] { border-color:color-mix(in srgb,var(--danger) 30%,var(--border)); color:var(--danger); background:var(--danger-soft); }
.account-owner-tag { border-color:color-mix(in srgb,var(--primary) 27%,var(--border)); color:var(--primary); background:var(--primary-soft); }
.account-no-action { color:var(--muted); font-size:var(--fs-11); white-space:nowrap; }
.ops-list-note { margin:10px 0 0; color:var(--warning); font-size:var(--fs-11); line-height:1.5; }
.ops-pagination { display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:12px; border-top:1px solid var(--border); color:var(--muted); font-size:var(--fs-10); }
.ops-pagination > div { display:flex; gap:6px; }
.ops-pagination .ops-button { min-height:36px; }
.ops-side-column { display:grid; gap:15px; min-width:0; }
.ops-audit-list li { display:grid; grid-template-columns:9px minmax(0,1fr); gap:10px; padding:11px 0; border-top:1px solid var(--border); }
.audit-mark { width:8px; height:8px; margin-top:5px; border-radius:50%; background:var(--warning); }
.audit-mark[data-outcome='succeeded'] { background:var(--success); }
.audit-mark[data-outcome='failed'] { background:var(--danger); }
.ops-audit-list b { font-size:var(--fs-11); font-weight:var(--fw-650); }
.ops-audit-list p { margin:4px 0; color:var(--ink-soft); font-size:var(--fs-11); line-height:1.5; overflow-wrap:anywhere; }
.ops-audit-list time { color:var(--muted); font-size:var(--fs-10); }
.ops-boundary { display:flex; align-items:flex-start; gap:11px; padding:15px; border:1px solid color-mix(in srgb,var(--primary) 19%,var(--border)); border-radius:var(--radius-12); background:color-mix(in srgb,var(--primary-soft) 46%,var(--card)); }
.boundary-mark { width:29px; height:29px; flex-basis:29px; }
.ops-boundary h2 { font-size:var(--fs-12); }
.ops-boundary p { margin-top:5px; color:var(--ink-soft); }
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
.ops-dialog { width:min(500px,calc(100vw - 28px)); max-height:min(90dvh,740px); padding:0; border:1px solid var(--border); border-radius:var(--radius-14); color:var(--text); background:var(--card); box-shadow:var(--shadow-overlay); }
.ops-dialog::backdrop { background:color-mix(in srgb,var(--text) 36%,transparent); backdrop-filter:blur(2px); }
.ops-dialog:focus-visible { outline:var(--focus-width) solid var(--focus-solid); outline-offset:var(--focus-offset); }
.ops-dialog-form { display:grid; gap:10px; padding:22px; }
.ops-dialog-form h2 { margin:0; font-size:var(--fs-19); }
.dialog-impact { margin:0; color:var(--ink-soft); font-size:var(--fs-13); line-height:1.65; }
.dialog-reason { margin:3px 0 0; }
.dialog-reason textarea { min-height:94px; resize:vertical; }
.dialog-reason small { justify-self:end; color:var(--muted); font-weight:var(--fw-400); }
.dialog-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:4px; }
@keyframes ops-spin { to { transform:rotate(360deg); } }
@media (max-width:760px) {
  .ops-columns { grid-template-columns:minmax(0,1fr); }
  .ops-side-column { grid-template-columns:repeat(2,minmax(0,1fr)); align-items:start; }
  .ops-signal { align-items:flex-start; flex-direction:column; gap:13px; }
  .signal-services { justify-content:stretch; width:100%; }
  .signal-services > div { flex:1; min-width:0; padding:0 10px; }
  .signal-services > div:first-child { padding-left:0; border-left:0; }
}
@media (max-width:520px) {
  .platform-admin { padding-bottom:24px; }
  .ops-header { align-items:flex-start; flex-direction:column; gap:12px; margin-bottom:16px; }
  .ops-title-group h1 { font-size:var(--fs-23); }
  .ops-owner-chip { max-width:100%; }
  .ops-overview { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .ops-overview > div { padding:12px; }
  .ops-overview > div + div { border-left:0; }
  .ops-overview > div:nth-child(2) { border-left:1px solid var(--border); }
  .ops-overview > div:nth-child(3) { grid-column:1/-1; border-top:1px solid var(--border); }
  .ops-overview b { font-size:var(--fs-20); }
  .ops-side-column { grid-template-columns:minmax(0,1fr); }
  .ops-panel { padding:14px; }
  .ops-account-row { align-items:flex-start; }
  .ops-account-row > .ops-button { min-width:56px; min-height:44px; flex:0 0 auto; }
  .account-primary { gap:5px 7px; }
  .account-primary > b { font-size:var(--fs-12); }
  .account-primary small { gap:2px; }
  .account-last-seen { flex-basis:100%; }
  .ops-pagination { align-items:flex-start; flex-direction:column; }
  .ops-pagination > div { width:100%; }
  .ops-pagination .ops-button { flex:1; }
  .ops-dialog-form { padding:18px; }
}
@media (prefers-reduced-motion: reduce) {
  .ops-loader { animation:none; }
}
</style>
