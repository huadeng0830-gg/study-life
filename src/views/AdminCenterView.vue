<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import DataOverview from '../components/data/DataOverview.vue'
import { accountAvailable, accountOpen, accountReady, accountUser } from '../composables/accountAuth.js'
import { accountSyncError, accountSyncLastSyncedAt, accountSyncStatus } from '../composables/accountSyncState.js'
import { buildAdminCenterModel, buildAdminDiagnostics } from '../composables/adminCenterModel.js'
import { backupReminderTitle, lastBackupAt, needsBackup } from '../composables/backupReminder.js'
import { formatDataSize, readDataInventory } from '../composables/dataManagerInventory.js'
import { formatAppDate } from '../composables/timeContext.js'
import { localSafeMode } from '../composables/localSafeMode.js'
import { persistenceState } from '../composables/store/core.js'
import { flushStoredWrites } from '../composables/store/index.js'
import { currentVersionInfo } from '../composables/versionInfo.js'
import { announce, announceAlert } from '../composables/liveRegion.js'
import { silentErrors } from '../composables/globalError.js'
import { platformAdminRequest } from '../services/platformAdmin.js'

const DataManager = defineAsyncComponent(() => import('../components/DataManager.vue'))
const showDataManager = ref(false)
const inventory = shallowRef(null)
const inventoryError = ref('')
const refreshPending = ref(false)
const hasPlatformAccess = ref(false)
// flushStoredWrites() 的返回值此前被两个调用点都丢掉了，于是"写盘失败、刷新即丢"
// 这件事只在 console 里留一条 warn。本页把它读出来，作为需要处理的事项。
const pendingWriteKeys = ref([])
const online = ref(typeof navigator === 'undefined' ? null : navigator.onLine !== false)
const copyMessage = ref('')
// silentErrors 是普通数组，不是 ref —— 直接放进 computed 不会建立依赖。
// 用这个计数器在每次重新读取时手动触发，让诊断反映刚刚发生过的静默失败。
const diagnosticsRevision = ref(0)
let refreshTimer = 0

async function checkPlatformAccess() {
  const userId = accountUser.value?.id
  if (!accountAvailable.value || !accountReady.value || !userId) {
    hasPlatformAccess.value = false
    return
  }
  try {
    const identity = await platformAdminRequest('identity')
    hasPlatformAccess.value = accountUser.value?.id === userId && identity?.owner === true
  } catch { hasPlatformAccess.value = false }
}

const statusModel = computed(() => buildAdminCenterModel({
  inventory: inventory.value,
  inventoryError: inventoryError.value,
  persistence: persistenceState.value,
  safeMode: localSafeMode.value,
  account: {
    available: accountAvailable.value,
    ready: accountReady.value,
    status: accountSyncStatus.value,
    error: accountSyncError.value,
  },
  backupNeedsAttention: needsBackup.value,
  backupTitle: backupReminderTitle.value,
  pendingKeys: pendingWriteKeys.value,
  online: online.value,
}))

const statusRows = computed(() => [
  { id: 'local-data', title: '本机数据', ...statusModel.value.data },
  { id: 'local-save', title: '本机保存', ...statusModel.value.save },
  {
    id: 'account-sync', title: '账号同步', ...statusModel.value.sync,
    lastSynced: accountSyncLastSyncedAt.value
      ? formatAppDate(accountSyncLastSyncedAt.value, { withWeekday: false })
      : '',
  },
  { id: 'network', title: '设备网络', ...statusModel.value.network },
  { id: 'remote-services', title: '在线服务', ...statusModel.value.remote },
])

const modules = computed(() => inventory.value?.modules || [])
const lastBackupLabel = computed(() => {
  if (!lastBackupAt.value) return '尚未导出'
  const timestamp = new Date(lastBackupAt.value).getTime()
  return Number.isFinite(timestamp)
    ? `最近导出：${formatAppDate(lastBackupAt.value, { withWeekday: false })}`
    : '备份时间无法识别'
})

// 分区 → 业务页面。只给确实有对应页面的分区挂链接：
// 专注记录出现在周回顾图表里，但它的入口是专注工具而不是回顾页，
// 指向 /review 会把人送到一个「看不到这些记录从哪改」的页面。
const moduleDestinations = Object.freeze({
  courses: '/schedule',
  tasks: '/tasks',
  countdown: '/exams',
  checklists: '/lists',
  ledger: '/bills',
  reviews: '/review',
})
// 没有独立页面的分区显示它实际归属的地方，而不是一句会让人去找页面的「设置」。
const moduleFallbackLabels = Object.freeze({
  focus: '专注工具',
  appearance: '外观设置',
  atmosphere: '氛围与心情',
  reminders: '提醒记录',
})
const moduleMarks = Object.freeze({
  courses: '课', tasks: '事', focus: '专', countdown: '期', checklists: '清',
  ledger: '账', appearance: '外', atmosphere: '氛', reminders: '提', reviews: '顾',
})

const diagnostics = computed(() => {
  // `silentErrors` 是普通数组，不是响应式的；读一次计数器才能让 computed
  // 在存储失败发生后重新求值（否则诊断里永远看不到刚发生的失败）。
  void diagnosticsRevision.value
  return buildAdminDiagnostics({
    inventory: inventory.value,
    model: statusModel.value,
    version: currentVersionInfo,
    syncLastSyncedAt: accountSyncLastSyncedAt.value,
    pendingKeys: pendingWriteKeys.value,
    online: online.value,
    silentErrors,
  })
})

function refreshInventory() {
  refreshPending.value = true
  diagnosticsRevision.value += 1
  try {
    // 先落盘再读，读到的才是「保存之后」的真相。返回值不能丢：
    // pendingKeys 非空说明有改动没进 localStorage，刷新或关页面就会丢。
    const flush = flushStoredWrites()
    pendingWriteKeys.value = Array.isArray(flush?.pendingKeys) ? flush.pendingKeys : []
    inventory.value = readDataInventory()
    inventoryError.value = ''
  } catch {
    inventory.value = null
    inventoryError.value = '无法读取当前设备的数据。请检查浏览器的网站存储权限后重试。'
  } finally {
    refreshPending.value = false
  }
}

function scheduleRefresh() {
  window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(refreshInventory, 160)
}

function openAttentionAction(action) {
  if (action === 'account') accountOpen.value = true
  else if (action === 'data') showDataManager.value = true
}

async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(diagnostics.value)
    copyMessage.value = '诊断信息已复制'
    announce(copyMessage.value)
  } catch {
    copyMessage.value = '复制失败，可以选中下方诊断文本手动复制'
    announceAlert(copyMessage.value)
  }
}

function syncOnlineState() {
  online.value = typeof navigator === 'undefined' ? null : navigator.onLine !== false
  scheduleRefresh()
}

onMounted(() => {
  refreshInventory()
  void checkPlatformAccess()
  window.addEventListener('study-life:storage-updated', scheduleRefresh)
  window.addEventListener('storage', scheduleRefresh)
  window.addEventListener('pageshow', scheduleRefresh)
  // 网络状态变化会改变同步能否继续，状态行也要跟着更新。
  window.addEventListener('online', syncOnlineState)
  window.addEventListener('offline', syncOnlineState)
})

watch(() => [accountReady.value, accountUser.value?.id], () => { void checkPlatformAccess() })

onBeforeUnmount(() => {
  window.clearTimeout(refreshTimer)
  window.removeEventListener('study-life:storage-updated', scheduleRefresh)
  window.removeEventListener('storage', scheduleRefresh)
  window.removeEventListener('pageshow', scheduleRefresh)
  window.removeEventListener('online', syncOnlineState)
  window.removeEventListener('offline', syncOnlineState)
})
</script>

<template>
  <div class="admin-center">
    <header class="page-head admin-head">
      <div class="page-head-main">
        <h1 class="page-title">管理中心</h1>
        <p class="page-desc">查看本机记录、安全状态和常用管理入口。</p>
      </div>
      <button type="button" class="btn btn-primary admin-primary-action" @click="showDataManager = true">
        <span aria-hidden="true">↓</span> 备份与恢复
      </button>
    </header>

    <section class="admin-scope" aria-label="管理范围">
      <span class="admin-scope-mark" aria-hidden="true">本</span>
      <p><b>当前设备的个人工作台</b><span>记录默认保存在本机。登录后可选择同步到自己的账号；这里没有管理员角色或跨用户数据入口。</span></p>
      <span class="admin-scope-tag">本机优先</span>
    </section>

    <div class="admin-layout">
      <div class="admin-primary-column">
        <DataOverview :inventory="inventory" :error="inventoryError" :heading-level="2"
          :show-refresh="false" :show-module-details="false" @refresh="refreshInventory" />

        <section class="admin-panel admin-attention" aria-labelledby="admin-attention-title">
          <div class="admin-section-head">
            <div>
              <h2 id="admin-attention-title">需要处理</h2>
              <p>只列出本机数据、保存或账号同步中检测到的事项。</p>
            </div>
            <span class="admin-count" :class="{ 'has-items': statusModel.hasActions }" aria-label="待处理事项数量">{{ statusModel.actions.length }}</span>
          </div>
          <ul v-if="statusModel.hasActions" class="admin-attention-list">
            <li v-for="item in statusModel.actions" :key="item.id" :data-tone="item.tone">
              <span class="attention-marker" aria-hidden="true"></span>
              <div class="attention-copy"><b>{{ item.title }}</b><p>{{ item.detail }}</p></div>
              <button type="button" class="admin-text-action" @click="openAttentionAction(item.action)">
                {{ item.actionLabel }}
              </button>
            </li>
          </ul>
          <p v-else-if="!inventory && !inventoryError" class="admin-inventory-loading" role="status">正在读取数据，完成后会显示需要处理的事项。</p>
          <p v-else class="admin-clear-state"><span aria-hidden="true">✓</span> 当前没有需要处理的数据事项。</p>
        </section>

        <section class="admin-panel admin-inventory" aria-labelledby="admin-inventory-title">
          <div class="admin-section-head">
            <div>
              <h2 id="admin-inventory-title">本机数据分区</h2>
              <p>记录数量来自已保存的数据；容量为本机文本估算。</p>
            </div>
            <button type="button" class="admin-refresh" :disabled="refreshPending" :aria-busy="refreshPending" @click="refreshInventory">
              <span aria-hidden="true" :class="{ spinning: refreshPending }">↻</span>{{ refreshPending ? '读取中' : '刷新' }}
            </button>
          </div>
          <p v-if="inventoryError" class="admin-load-error" role="alert">{{ inventoryError }}</p>
          <div v-else-if="!inventory" class="admin-inventory-loading" role="status">正在读取本机数据…</div>
          <ul v-else class="admin-module-list">
            <li v-for="module in modules" :key="module.id" :data-issue="module.hasIssue || undefined">
              <div class="admin-module-main">
                <span class="admin-module-mark" aria-hidden="true">{{ moduleMarks[module.id] || '数' }}</span>
                <div class="admin-module-copy">
                  <div class="admin-module-title"><b>{{ module.label }}</b><span v-if="module.hasIssue" class="admin-module-issue">需检查</span></div>
                  <p>{{ module.recordCount.toLocaleString() }} 项记录<span v-if="module.settingCount"> · {{ module.settingCount }} 项设置</span></p>
                </div>
              </div>
              <div class="admin-module-meta">
                <span class="admin-module-size">{{ formatDataSize(module.bytes) }}</span>
                <RouterLink v-if="moduleDestinations[module.id]" class="admin-module-link" :to="moduleDestinations[module.id]">查看</RouterLink>
                <span v-else class="admin-module-static">{{ moduleFallbackLabels[module.id] || '本机设置' }}</span>
              </div>
            </li>
          </ul>
          <p class="admin-inventory-note">协作项目、账号资料和成果文件由账号服务管理，不计入这份本机清单或 JSON 备份。</p>
        </section>
      </div>

      <aside class="admin-secondary-column" aria-label="运行状态和常用入口">
        <section class="admin-panel admin-status-panel" aria-labelledby="admin-status-title">
          <div class="admin-section-head">
            <div>
              <h2 id="admin-status-title">运行状态</h2>
              <p>状态来自当前页面与账号同步流程。</p>
            </div>
          </div>
          <!-- 每行是两个 <dd>：状态标签 + 整行说明。原写法把 <p> 直接放在
               <dl> 的 <div> 里，<dl> 只允许 dt/dd，那样是无效结构。 -->
          <dl class="admin-status-list">
            <div v-for="row in statusRows" :key="row.id" class="admin-status-row">
              <dt>{{ row.title }}</dt>
              <dd class="admin-status-pill-cell"><span class="admin-status-pill" :data-tone="row.tone">{{ row.label }}</span></dd>
              <dd class="admin-status-detail">{{ row.detail }}<span v-if="row.id === 'account-sync' && row.lastSynced" class="admin-last-sync">最近成功：{{ row.lastSynced }}</span></dd>
            </div>
          </dl>
          <p class="admin-backup-stamp">{{ lastBackupLabel }}</p>
        </section>

        <section class="admin-panel admin-links-panel" aria-labelledby="admin-links-title">
          <div class="admin-section-head">
            <div>
              <h2 id="admin-links-title">常用管理入口</h2>
              <p>直接进入对应业务页面，沿用原有编辑与保存流程。</p>
            </div>
          </div>
          <nav class="admin-quick-links" aria-label="常用业务管理入口">
            <RouterLink to="/schedule"><span class="admin-link-mark" aria-hidden="true">课</span><span>课程与课表</span><span aria-hidden="true">↗</span></RouterLink>
            <RouterLink to="/tasks"><span class="admin-link-mark" aria-hidden="true">事</span><span>待办与作业</span><span aria-hidden="true">↗</span></RouterLink>
            <RouterLink to="/events"><span class="admin-link-mark" aria-hidden="true">日</span><span>日程安排</span><span aria-hidden="true">↗</span></RouterLink>
            <RouterLink to="/exams"><span class="admin-link-mark" aria-hidden="true">期</span><span>重要日期</span><span aria-hidden="true">↗</span></RouterLink>
            <RouterLink to="/bills"><span class="admin-link-mark" aria-hidden="true">账</span><span>账本与固定账单</span><span aria-hidden="true">↗</span></RouterLink>
            <RouterLink to="/lists"><span class="admin-link-mark" aria-hidden="true">清</span><span>清单</span><span aria-hidden="true">↗</span></RouterLink>
            <RouterLink to="/review"><span class="admin-link-mark" aria-hidden="true">顾</span><span>周回顾</span><span aria-hidden="true">↗</span></RouterLink>
            <RouterLink v-if="hasPlatformAccess" class="admin-platform-link" to="/platform-admin"><span class="admin-link-mark" aria-hidden="true">运</span><span>平台运维</span><span aria-hidden="true">↗</span></RouterLink>
          </nav>
        </section>

        <section class="admin-version" aria-label="版本信息与诊断">
          <div><span>应用版本</span><b>v{{ currentVersionInfo.appVersion }}</b></div>
          <div><span>发布通道</span><b>{{ currentVersionInfo.channel }}</b></div>
          <div><span>业务数据结构</span><b>v{{ currentVersionInfo.domainSchemaVersion }}</b></div>
          <div><span>账号同步结构</span><b>v{{ currentVersionInfo.schemaVersion }}</b></div>
          <div><span>构建标识</span><b>{{ currentVersionInfo.buildId }}</b></div>
          <div><span>代码提交</span><b>{{ currentVersionInfo.commitId }}</b></div>
          <details class="admin-diagnostics">
            <summary>复制诊断信息</summary>
            <p>只包含版本、结构版本、分区数量与状态标签；不含记录内容、邮箱、账号标识或地址。反馈问题时附上这段即可。</p>
            <button type="button" class="admin-refresh" @click="copyDiagnostics">复制到剪贴板</button>
            <p v-if="copyMessage" role="status">{{ copyMessage }}</p>
            <textarea class="admin-diagnostics-text" aria-label="管理中心诊断信息" readonly :value="diagnostics"></textarea>
          </details>
          <p>{{ statusModel.remote.detail }}</p>
        </section>
      </aside>
    </div>
  </div>

  <DataManager v-if="showDataManager" :open="showDataManager" @close="showDataManager = false" />
</template>

<style scoped>
.admin-center { width:100%; max-width:1240px; margin:0 auto; padding:0 0 36px; color:var(--text); }
.admin-head { align-items:center; margin-bottom:16px; }
.admin-head .page-title { margin:0; }
.admin-head .page-desc { max-width:58ch; }
.admin-primary-action { min-height:44px; white-space:nowrap; }
.admin-primary-action span { margin-right:4px; font-size:var(--fs-16); }
.admin-scope { display:flex; align-items:center; gap:12px; min-height:70px; margin-bottom:18px; padding:12px 16px; border:1px solid color-mix(in srgb,var(--primary) 21%,var(--border)); border-radius:var(--radius-12); background:color-mix(in srgb,var(--primary-soft) 48%,var(--card)); }
.admin-scope-mark { display:grid; place-items:center; width:38px; height:38px; flex:0 0 38px; border-radius:var(--radius-10); background:var(--primary); color:var(--on-primary); font-size:var(--fs-16); font-weight:var(--fw-800); }
.admin-scope p { display:grid; gap:3px; min-width:0; margin:0; line-height:1.5; }
.admin-scope p b { font-size:var(--fs-13); }
.admin-scope p span { color:var(--ink-soft); font-size:var(--fs-12); }
.admin-scope-tag { margin-left:auto; padding:5px 9px; border:1px solid var(--border); border-radius:var(--radius-pill); color:var(--ink-soft); background:var(--card); font-size:var(--fs-11); white-space:nowrap; }
.admin-layout { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(280px,0.9fr); align-items:start; gap:16px; }
.admin-primary-column,.admin-secondary-column { display:grid; align-content:start; gap:16px; min-width:0; }
.admin-panel { min-width:0; padding:16px 18px; border:1px solid var(--border); border-radius:var(--radius-12); background:var(--card); box-shadow:var(--shadow-sm); }
.admin-section-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:12px; }
.admin-section-head h2 { margin:0; font-size:var(--fs-15); font-weight:var(--fw-750); line-height:1.4; }
.admin-section-head p { margin:4px 0 0; color:var(--muted); font-size:var(--fs-12); line-height:1.55; }
.admin-count { display:grid; place-items:center; width:28px; height:28px; flex:0 0 28px; border:1px solid var(--border); border-radius:50%; color:var(--muted); background:var(--bg-tint); font-size:var(--fs-12); font-variant-numeric:tabular-nums; }
.admin-count.has-items { border-color:color-mix(in srgb,var(--warning) 35%,var(--border)); color:var(--warning); background:color-mix(in srgb,var(--warning) 9%,var(--card)); }
.admin-attention-list,.admin-module-list { list-style:none; margin:0; padding:0; }
.admin-attention-list li { display:grid; grid-template-columns:8px minmax(0,1fr) auto; align-items:start; gap:11px; padding:12px 0; border-top:1px solid var(--border); }
.attention-marker { width:7px; height:7px; margin-top:6px; border-radius:50%; background:var(--warning); }
.admin-attention-list li[data-tone='danger'] .attention-marker { background:var(--danger); }
.attention-copy { min-width:0; }
.attention-copy b { font-size:var(--fs-13); line-height:1.5; }
.attention-copy p { margin:3px 0 0; color:var(--muted); font-size:var(--fs-12); line-height:1.55; overflow-wrap:anywhere; }
.admin-text-action { min-height:40px; padding:6px 8px; border:0; border-radius:var(--radius-7); color:var(--primary); background:transparent; font:inherit; font-size:var(--fs-12); font-weight:var(--fw-700); cursor:pointer; }
.admin-text-action:hover { background:var(--primary-soft); }
.admin-text-action:focus-visible,.admin-refresh:focus-visible,.admin-quick-links a:focus-visible,.admin-module-link:focus-visible,.admin-diagnostics summary:focus-visible { outline:var(--focus-width) solid var(--focus-solid); outline-offset:var(--focus-offset); }
.admin-clear-state { display:flex; align-items:center; gap:9px; margin:0; padding:12px 0 2px; border-top:1px solid var(--border); color:var(--ink-soft); font-size:var(--fs-13); }
.admin-clear-state span { display:grid; place-items:center; width:22px; height:22px; flex:0 0 22px; border-radius:50%; color:var(--success); background:color-mix(in srgb,var(--success) 10%,var(--card)); font-weight:var(--fw-800); }
.admin-refresh { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-width:80px; min-height:40px; padding:5px 9px; border:1px solid var(--border); border-radius:var(--radius-8); color:var(--ink-soft); background:var(--card); font:inherit; font-size:var(--fs-12); cursor:pointer; }
.admin-refresh:hover:not(:disabled) { color:var(--primary); border-color:var(--primary); background:var(--primary-soft); }
.admin-refresh:disabled { cursor:wait; opacity:.7; }
.admin-refresh span { font-size:var(--fs-17); line-height:1; }
.spinning { animation:admin-spin 900ms linear infinite; }
.admin-inventory-loading,.admin-load-error { margin:0; padding:14px 0; border-top:1px solid var(--border); color:var(--muted); font-size:var(--fs-12); line-height:1.6; }
.admin-load-error { color:var(--danger); }
.admin-module-list li { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:61px; padding:9px 0; border-top:1px solid var(--border); }
.admin-module-main { display:flex; align-items:center; gap:11px; min-width:0; }
.admin-module-mark,.admin-link-mark { display:grid; place-items:center; width:34px; height:34px; flex:0 0 34px; border:1px solid var(--border); border-radius:var(--radius-9); color:var(--primary); background:var(--bg-tint); font-size:var(--fs-12); font-weight:var(--fw-750); }
.admin-module-copy { min-width:0; }
.admin-module-title { display:flex; align-items:center; flex-wrap:wrap; gap:7px; }
.admin-module-title b { font-size:var(--fs-13); font-weight:var(--fw-650); }
.admin-module-copy p { margin:3px 0 0; color:var(--muted); font-size:var(--fs-11); line-height:1.45; }
.admin-module-issue { color:var(--danger); font-size:var(--fs-10); font-weight:var(--fw-650); }
.admin-module-meta { display:flex; align-items:center; gap:12px; flex:0 0 auto; }
.admin-module-size,.admin-module-static { min-width:50px; color:var(--muted); font-size:var(--fs-11); text-align:right; white-space:nowrap; }
.admin-module-link { display:grid; place-items:center; min-width:46px; min-height:40px; padding:0 8px; border-radius:var(--radius-7); color:var(--primary); font-size:var(--fs-12); font-weight:var(--fw-700); text-decoration:none; }
.admin-module-link:hover { background:var(--primary-soft); }
.admin-inventory-note { margin:10px 0 0; padding-top:10px; border-top:1px solid var(--border); color:var(--muted); font-size:var(--fs-11); line-height:1.55; }
.admin-status-list { display:grid; margin:0; }
.admin-status-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:5px 10px; padding:12px 0; border-top:1px solid var(--border); }
.admin-status-row dt { color:var(--ink-soft); font-size:var(--fs-12); font-weight:var(--fw-600); }
.admin-status-row dd { margin:0; }
.admin-status-pill-cell { justify-self:end; }
.admin-status-detail { grid-column:1/-1; color:var(--muted); font-size:var(--fs-11); line-height:1.55; overflow-wrap:anywhere; }
.admin-status-pill { display:inline-flex; align-items:center; min-height:25px; padding:3px 8px; border:1px solid var(--border); border-radius:var(--radius-pill); color:var(--ink-soft); background:var(--bg-tint); font-size:var(--fs-10); line-height:1.35; }
.admin-status-pill[data-tone='success'] { border-color:color-mix(in srgb,var(--success) 28%,var(--border)); color:var(--success); background:color-mix(in srgb,var(--success) 8%,var(--card)); }
.admin-status-pill[data-tone='warning'] { border-color:color-mix(in srgb,var(--warning) 28%,var(--border)); color:var(--warning); background:color-mix(in srgb,var(--warning) 8%,var(--card)); }
.admin-status-pill[data-tone='danger'] { border-color:color-mix(in srgb,var(--danger) 28%,var(--border)); color:var(--danger); background:var(--danger-soft); }
.admin-status-pill[data-tone='pending'] { border-color:color-mix(in srgb,var(--primary) 25%,var(--border)); color:var(--primary); background:var(--primary-soft); }
.admin-last-sync { display:block; margin-top:3px; }
.admin-backup-stamp { margin:4px 0 0; padding-top:11px; border-top:1px solid var(--border); color:var(--muted); font-size:var(--fs-11); }
.admin-quick-links { display:grid; }
.admin-quick-links a { display:grid; grid-template-columns:34px minmax(0,1fr) auto; align-items:center; gap:10px; min-height:51px; border-top:1px solid var(--border); color:var(--text); font-size:var(--fs-12); font-weight:var(--fw-600); text-decoration:none; }
.admin-quick-links a:hover { color:var(--primary); }
.admin-quick-links .admin-platform-link { margin-top:6px; padding-top:6px; border-top:1px solid var(--border-strong); }
.admin-quick-links a > span:last-child { color:var(--muted); font-size:var(--fs-14); }
.admin-link-mark { width:30px; height:30px; flex-basis:30px; border-radius:var(--radius-8); font-size:var(--fs-11); }
.admin-version { display:grid; gap:8px; padding:14px 17px; border:1px solid var(--border); border-radius:var(--radius-12); background:var(--bg-tint); }
.admin-version > div { display:flex; justify-content:space-between; gap:12px; font-size:var(--fs-11); }
.admin-version > div span,.admin-version p { color:var(--muted); }
.admin-version > div b { font-weight:var(--fw-650); font-variant-numeric:tabular-nums; }
/* 只给收尾那句能力边界说明加分隔线：诊断区里嵌套的 <p> 不该跟着加分隔线。 */
.admin-version > p { margin:3px 0 0; padding-top:9px; border-top:1px solid var(--border); font-size:var(--fs-11); line-height:1.55; }
.admin-diagnostics { display:grid; gap:8px; margin:4px 0 0; padding-top:10px; border-top:1px solid var(--border); }
.admin-diagnostics summary { display:flex; align-items:center; min-height:44px; color:var(--primary); font-size:var(--fs-11); font-weight:var(--fw-650); cursor:pointer; }
.admin-diagnostics summary::before { content:'›'; margin-right:6px; font-size:var(--fs-16); }
.admin-diagnostics[open] summary::before { content:'⌄'; }
.admin-diagnostics p { margin:0; font-size:var(--fs-11); line-height:1.55; }
.admin-diagnostics-text { width:100%; min-height:150px; max-height:260px; padding:10px; border:1px solid var(--border); border-radius:var(--radius-8); color:var(--ink-soft); background:var(--bg-tint); font:var(--fs-11)/1.5 monospace; resize:vertical; }
@keyframes admin-spin { to { transform:rotate(360deg); } }
@media (max-width:900px) {
  .admin-layout { grid-template-columns:minmax(0,1fr); }
  .admin-secondary-column { grid-template-columns:repeat(2,minmax(0,1fr)); align-items:start; }
  .admin-status-panel { grid-row:span 2; }
  .admin-version { align-self:start; }
}
@media (max-width:520px) {
  .admin-center { padding-bottom:24px; }
  .admin-head { align-items:flex-start; margin-bottom:13px; }
  .admin-head .page-desc { max-width:38ch; }
  .admin-primary-action { align-self:flex-end; min-width:44px; padding-inline:10px; font-size:var(--fs-11); }
  .admin-primary-action span { margin:0 3px 0 0; }
  .admin-scope { align-items:flex-start; gap:9px; padding:11px; }
  .admin-scope-mark { width:32px; height:32px; flex-basis:32px; }
  .admin-scope p span { font-size:var(--fs-11); }
  .admin-scope-tag { display:none; }
  .admin-layout,.admin-primary-column,.admin-secondary-column { gap:12px; }
  .admin-panel { padding:14px; }
  .admin-secondary-column { grid-template-columns:minmax(0,1fr); }
  .admin-status-panel { grid-row:auto; }
  .admin-module-list li { gap:8px; }
  .admin-module-meta { gap:4px; }
  .admin-module-size { min-width:42px; font-size:var(--fs-10); }
  .admin-module-link { min-width:42px; padding-inline:4px; }
  .admin-attention-list li { grid-template-columns:8px minmax(0,1fr); gap:9px; }
  .admin-text-action { grid-column:2; justify-self:start; min-height:38px; margin-top:2px; padding-inline:0; }
}
@media (prefers-reduced-motion: reduce) {
  .spinning { animation:none; }
}
</style>
