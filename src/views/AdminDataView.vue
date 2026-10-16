<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import DataOverview from '../components/data/DataOverview.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Toast from '../components/Toast.vue'
import { accountAvailable, accountOpen, accountReady } from '../composables/accountAuth.js'
import { accountSyncError, accountSyncLastSyncedAt, accountSyncStatus } from '../composables/accountSyncState.js'
import { buildAdminCenterModel, buildAdminDiagnostics } from '../composables/adminCenterModel.js'
import { buildDataHealthReport, formatDataHealthReportText, normalizeDataHealthThresholds } from '../composables/dataHealthReport.js'
import { DATA_HEALTH_SETTINGS_KEY, dataHealthSettings, saveDataHealthSettings } from '../composables/dataHealthSettings.js'
import { backupReminderTitle, lastBackupAt, needsBackup } from '../composables/backupReminder.js'
import { formatDataSize, readDataInventory } from '../composables/dataManagerInventory.js'
import { appNow, appToday, formatAppDate } from '../composables/timeContext.js'
import { localSafeMode } from '../composables/localSafeMode.js'
import { persistenceState } from '../composables/store/core.js'
import { flushStoredWrites } from '../composables/store/index.js'
import { currentVersionInfo } from '../composables/versionInfo.js'
import { announce, announceAlert } from '../composables/liveRegion.js'
import { silentErrors } from '../composables/globalError.js'
import { useDomainCommands } from '../composables/domain/commands.js'
import { setNoticeStatus } from '../composables/noticeArchive.js'
import { animationsEnabled } from '../composables/motion.js'

const DataManager = defineAsyncComponent(() => import('../components/DataManager.vue'))
const domain = useDomainCommands()
const showDataManager = ref(false)
const inventory = shallowRef(/** @type {ReturnType<typeof readDataInventory>|null} */ (null))
const inventoryError = ref('')
const refreshPending = ref(false)
// flushStoredWrites() 的返回值此前被两个调用点都丢掉了，于是"写盘失败、刷新即丢"
// 这件事只在 console 里留一条 warn。本页把它读出来，作为需要处理的事项。
const pendingWriteKeys = ref(/** @type {string[]} */ ([]))
const online = ref(typeof navigator === 'undefined' ? null : navigator.onLine !== false)
const copyMessage = ref('')
const toast = ref(/** @type {{open: boolean, message: string, type: string, actionLabel: string, undoFn: (() => void)|null, duration: number}} */ ({ open: false, message: '', type: 'info', actionLabel: '', undoFn: null, duration: 3200 }))
const healthFixTarget = ref(/** @type {{issueKind: string, recordId: string, action: string, targetId: string, message: string}|null} */ (null))
const healthThresholdDraft = ref(/** @type {ReturnType<typeof normalizeDataHealthThresholds>} */ (normalizeDataHealthThresholds(dataHealthSettings.value)))
const healthCourseSelections = ref(/** @type {Record<string, string>} */ ({}))
const healthCategorySelections = ref(/** @type {Record<string, string>} */ ({}))
const healthPages = ref(/** @type {Record<string, number>} */ ({}))
const HEALTH_PAGE_SIZE = 8
// silentErrors 是普通数组，不是 ref —— 直接放进 computed 不会建立依赖。
// 用这个计数器在每次重新读取时手动触发，让诊断反映刚刚发生过的静默失败。
const diagnosticsRevision = ref(0)
let refreshTimer = 0

watch(dataHealthSettings, (value) => { healthThresholdDraft.value = normalizeDataHealthThresholds(value) }, { deep: true })

const dataHealthReport = computed(() => inventory.value
  ? buildDataHealthReport(inventory.value.data, { now: appNow.value, today: appToday.value, thresholds: dataHealthSettings.value })
  : [])

// The scanner remains capped for status and text export. The detail list loads
// all matching IDs, then renders only one small page so cleanup stays possible
// without mounting hundreds of row controls at once.
const dataHealthAllIds = computed(() => {
  if (!inventory.value) return new Map()
  const data = inventory.value.data || {}
  const recordCount = ['tasks', 'events', 'bills', 'transactions', 'expenses', 'notices', 'scheduleExceptions']
    .reduce((total, key) => total + (Array.isArray(data[key]) ? data[key].length : 0), 0)
  return new Map(buildDataHealthReport(data, {
    now: appNow.value, today: appToday.value, thresholds: dataHealthSettings.value, sampleLimit: recordCount,
  }).map((issue) => [issue.kind, issue.sampleIds]))
})

function healthRowsFor(issue) {
  const data = inventory.value?.data || {}
  const field = issue.kind.startsWith('orphan-task') || issue.kind === 'duplicate-tasks' || issue.kind === 'stale-tasks' || issue.kind === 'empty-task-title'
    ? 'tasks'
    : issue.kind.startsWith('orphan-event') || issue.kind === 'empty-event-title' ? 'events'
      : issue.kind === 'empty-bill-title' ? 'bills'
        : issue.kind === 'unhandled-notices' ? 'notices'
          : issue.kind === 'duplicate-schedule-exceptions' ? 'scheduleExceptions' : 'expenses'
  const source = Array.isArray(data[field]) ? data[field] : []
  return issue.sampleIds.map((id) => {
    const item = source.find((entry) => String(entry?.id ?? '') === String(id))
    const label = issue.kind === 'empty-bill-title' ? item?.name || item?.title
      : issue.kind.includes('transaction') || issue.kind === 'anomalous-transaction-amount' ? item?.name || item?.title
        : item?.title || item?.name
    return { id, item, label: String(label || '未命名记录').trim().slice(0, 48) }
  })
}

const dataHealthItems = computed(() => dataHealthReport.value.map((issue) => {
  const ids = dataHealthAllIds.value.get(issue.kind) || issue.sampleIds
  const pageCount = Math.max(1, Math.ceil(ids.length / HEALTH_PAGE_SIZE))
  const page = Math.min(healthPages.value[issue.id] || 0, pageCount - 1)
  const visibleIds = ids.slice(page * HEALTH_PAGE_SIZE, (page + 1) * HEALTH_PAGE_SIZE)
  return {
    ...issue,
    tone: issue.severity === 'warning' ? 'warning' : 'neutral',
    samples: healthRowsFor({ ...issue, sampleIds: visibleIds }),
    page,
    pageCount,
    sampleCount: ids.length,
  }
}))

function changeHealthPage(issue, delta) {
  const next = Math.min(issue.pageCount - 1, Math.max(0, issue.page + delta))
  healthPages.value = { ...healthPages.value, [issue.id]: next }
}

const healthCourses = computed(() => Array.isArray(inventory.value?.data?.courses) ? inventory.value.data.courses : [])
const healthCategories = computed(() => Array.isArray(inventory.value?.data?.ledgerCategories) ? inventory.value.data.ledgerCategories : [])
function healthCategoriesFor(sample) {
  const scope = sample.item?.direction === 'income' ? 'income' : 'expense'
  return healthCategories.value.filter((category) => !category.scope || category.scope === scope)
}

/** @param {string} message @param {{type?: string, undoFn?: (() => void)|null}} options */
function setToast(message, options = {}) {
  const { type = 'success', undoFn = null } = options
  toast.value = { open: true, message, type, actionLabel: undoFn ? '撤销' : '', undoFn, duration: undoFn ? 0 : 3200 }
}

function recordCollection(kind) {
  const data = inventory.value?.data || {}
  if (kind.includes('task') || kind === 'duplicate-tasks' || kind === 'stale-tasks') return data.tasks || []
  if (kind.includes('event')) return data.events || []
  if (kind.includes('bill')) return data.bills || []
  if (kind.includes('notice')) return data.notices || []
  if (kind.includes('schedule')) return data.scheduleExceptions || []
  return data.expenses || []
}

function findHealthRecord(kind, id) {
  return recordCollection(kind).find((entry) => String(entry?.id ?? '') === String(id)) || null
}

function findDuplicateTaskPair(task) {
  const normalize = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
  const title = normalize(task?.title)
  const dueDate = String(task?.dueDate || '')
  if (!title || !dueDate) return null
  const matches = (inventory.value?.data?.tasks || []).filter((item) => !item.archivedAt && !item.deletedAt && !item.tombstone
    && item.done !== true && item.status !== 'completed' && item.status !== 'cancelled'
    && normalize(item.title) === title && item.dueDate === dueDate)
  const source = matches.find((item) => String(item.id) === String(task.id))
  const target = matches.find((item) => String(item.id) !== String(task.id))
  return source && target ? { source, target } : null
}

function openHealthFix(issue, sample, action) {
  const record = findHealthRecord(issue.kind, sample.id)
  if (!record) { setToast('记录已变化，请重新刷新体检结果。', { type: 'error' }); return }
  let targetId = ''
  if (action === 'merge-task') {
    const pair = findDuplicateTaskPair(record)
    if (!pair) { setToast('未找到可合并的同组待办，请刷新后复核。', { type: 'error' }); return }
    targetId = String(pair.target.id)
  }
  if (action === 'reassign-course') targetId = healthCourseSelections.value[sample.id] || ''
  if (action === 'merge-category') targetId = healthCategorySelections.value[sample.id] || ''
  if (['reassign-course', 'merge-category'].includes(action) && !targetId) {
    setToast('请先选择一个现有目标。', { type: 'warning' }); return
  }
  const actionText = {
    archive: '归档这条记录', 'merge-task': '合并备注并归档这条重复待办',
    'reassign-course': '将关联改为所选课程', 'merge-category': '将分类合并到所选分类',
  }[action]
  healthFixTarget.value = {
    issueKind: issue.kind, recordId: sample.id, action, targetId,
    message: `确认${actionText}吗？操作完成后可在提示中撤销。`,
  }
}

function updateTaskNoteForMerge(primary, duplicate) {
  const notes = [primary.note, duplicate.note].map((value) => String(value || '').trim()).filter(Boolean)
  const combined = [...new Set(notes)].join('\n\n')
  return domain.updateTask(primary.id, { note: combined })
}

function confirmHealthFix() {
  const target = healthFixTarget.value
  healthFixTarget.value = null
  if (!target) return
  const record = findHealthRecord(target.issueKind, target.recordId)
  if (!record) { setToast('记录已变化，请重新刷新体检结果。', { type: 'error' }); return }
  try {
    let undo = null
    let message = '已完成处理'
    if (target.action === 'archive') {
      let archived
      let restore
      if (target.issueKind.includes('task') || target.issueKind === 'duplicate-tasks' || target.issueKind === 'stale-tasks') {
        archived = domain.archiveTask(record.id); restore = () => domain.restoreTask(record.id); message = '待办已归档'
      } else if (target.issueKind.includes('event')) {
        archived = domain.archiveEvent(record.id); restore = () => domain.restoreEvent(record.id); message = '日程已归档'
      } else if (target.issueKind.includes('bill')) {
        archived = domain.archiveBill(record.id); restore = () => domain.restoreBill(record.id); message = '固定账单已归档'
      } else if (target.issueKind.includes('notice')) {
        const previousStatus = record.status
        archived = setNoticeStatus(record.id, 'archived'); restore = () => setNoticeStatus(record.id, previousStatus); message = '通知已归档'
      } else {
        archived = domain.archiveTransaction(record.id)
        if (archived?.blocked) throw new Error(archived.reason)
        restore = () => domain.restoreTransaction(record.id); message = '收支记录已归档'
      }
      if (!archived) throw new Error('记录已变化，没有执行归档。')
      undo = () => {
        try {
          const restored = restore()
          if (!restored) announceAlert('记录已不存在，无法撤销归档。')
          else { refreshInventory(); announce('已撤销归档') }
        } catch { announceAlert('撤销未完成，请刷新本机数据后重试。') }
      }
    } else if (target.action === 'merge-task') {
      const pair = findDuplicateTaskPair(record)
      if (!pair) throw new Error('同组待办已变化，请刷新后复核。')
      const originalNote = pair.target.note || ''
      const updated = updateTaskNoteForMerge(pair.target, pair.source)
      const archived = domain.archiveTask(pair.source.id)
      if (!updated || !archived) throw new Error('合并未完成，请刷新后复核。')
      undo = () => {
        try {
          domain.restoreTask(pair.source.id)
          domain.updateTask(pair.target.id, { note: originalNote })
          refreshInventory(); announce('已撤销合并')
        } catch { announceAlert('撤销未完成，请刷新本机数据后重试。') }
      }
      message = '待办备注已合并，多余待办已归档'
    } else if (target.action === 'reassign-course') {
      const course = healthCourses.value.find((item) => String(item.id) === target.targetId)
      if (!course) throw new Error('所选课程已不存在，请刷新后重选。')
      const previous = { courseId: record.courseId, courseName: record.courseName }
      const update = target.issueKind.includes('task') ? domain.updateTask : domain.updateEvent
      const updated = update(record.id, { courseId: course.id, courseName: course.name })
      if (!updated) throw new Error('记录已变化，没有更新关联。')
      undo = () => {
        try { update(record.id, previous); refreshInventory(); announce('已撤销课程关联调整') }
        catch { announceAlert('撤销未完成，请刷新本机数据后重试。') }
      }
      message = '已重新关联课程'
    } else if (target.action === 'merge-category') {
      const previous = [{
        id: record.id, categoryId: record.cat, hasCategory: Object.hasOwn(record, 'cat'),
      }]
      const changed = domain.updateTransactionCategories([{ id: record.id, categoryId: target.targetId }])
      if (!changed.length) throw new Error('记录或分类已变化，没有执行合并。')
      undo = () => {
        try { domain.restoreTransactionCategories(previous); refreshInventory(); announce('已撤销分类合并') }
        catch { announceAlert('撤销未完成，请刷新本机数据后重试。') }
      }
      message = '已合并到所选分类'
    }
    refreshInventory()
    setToast(message, { undoFn: undo })
  } catch (error) {
    setToast(error instanceof Error ? error.message : '操作失败，请刷新后重试。', { type: 'error' })
  }
}

async function saveHealthThresholds() {
  try {
    saveDataHealthSettings(healthThresholdDraft.value)
    await nextTick()
    const flush = flushStoredWrites()
    pendingWriteKeys.value = Array.isArray(flush?.pendingKeys) ? flush.pendingKeys : []
    if (pendingWriteKeys.value.includes(DATA_HEALTH_SETTINGS_KEY)) throw new Error('阈值写入本机失败，请检查浏览器存储权限。')
    setToast('体检阈值已保存')
  } catch (error) { setToast(error instanceof Error ? error.message : '阈值没有保存，请检查输入。', { type: 'error' }) }
}

function exportDataHealthReport() {
  const text = formatDataHealthReportText(dataHealthReport.value, {
    generatedAt: appNow.value.toISOString(), thresholds: dataHealthSettings.value,
  })
  try {
    const blob = new Blob([`\uFEFF${text}`], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `study-life-data-health-${appNow.value.toISOString().slice(0, 10)}.txt`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setToast('体检记录已导出为纯文本')
  } catch { setToast('导出失败，请检查浏览器下载权限。', { type: 'error' }) }
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
  dataHealthReport: dataHealthReport.value,
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
  'data-health': '体检阈值',
})
const moduleMarks = Object.freeze({
  courses: '课', tasks: '事', focus: '专', countdown: '期', checklists: '清',
  ledger: '账', appearance: '外', atmosphere: '氛', reminders: '提', reviews: '顾', 'data-health': '体',
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
  else if (action === 'health') document.getElementById('admin-data-health')?.scrollIntoView({ behavior: animationsEnabled() ? 'smooth' : 'auto', block: 'center' })
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
  window.addEventListener('study-life:storage-updated', scheduleRefresh)
  window.addEventListener('storage', scheduleRefresh)
  window.addEventListener('pageshow', scheduleRefresh)
  // 网络状态变化会改变同步能否继续，状态行也要跟着更新。
  window.addEventListener('online', syncOnlineState)
  window.addEventListener('offline', syncOnlineState)
})


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
        <h2 class="page-title">本机数据</h2>
      </div>
      <button type="button" class="btn btn-primary admin-primary-action" @click="showDataManager = true">
        <span aria-hidden="true">↓</span> 备份与恢复
      </button>
    </header>

    <div class="admin-layout">
      <div class="admin-primary-column">
        <DataOverview :inventory="inventory || undefined" :error="inventoryError" :heading-level="2"
          :show-refresh="false" :show-module-details="false" @refresh="refreshInventory" />

        <section class="admin-panel admin-attention" aria-labelledby="admin-attention-title">
          <div class="admin-section-head">
            <div>
              <h2 id="admin-attention-title">需要处理</h2>
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

        <section id="admin-data-health" class="admin-panel admin-health" aria-labelledby="admin-data-health-title">
          <div class="admin-section-head">
            <div>
              <h2 id="admin-data-health-title">本机数据体检</h2>
            </div>
            <span class="admin-health-total" :data-tone="statusModel.dataHealth.tone" aria-label="发现的问题类别数">{{ statusModel.dataHealth.totalCount }}</span>
          </div>
          <div class="admin-health-overview" aria-live="polite">
            <b :data-tone="statusModel.dataHealth.tone">{{ statusModel.dataHealth.label }}</b>
            <span>{{ statusModel.dataHealth.detail }}</span>
            <div class="admin-health-actions">
              <button type="button" class="admin-health-tool" @click="exportDataHealthReport">导出纯文本</button>
              <button type="button" class="admin-health-tool" :disabled="refreshPending" @click="refreshInventory">重新体检</button>
            </div>
          </div>

          <details class="admin-health-settings">
            <summary>体检阈值设置</summary>
            <div class="admin-health-thresholds">
              <label>待办超过多少天算陈旧
                <input v-model.number="healthThresholdDraft.staleTaskDays" type="number" min="1" max="3650" step="1" inputmode="numeric">
              </label>
              <label>通知超过多少天算未处理
                <input v-model.number="healthThresholdDraft.unhandledNoticeDays" type="number" min="1" max="3650" step="1" inputmode="numeric">
              </label>
              <label>收支金额上限（元）
                <input v-model.number="healthThresholdDraft.maxTransactionAmount" type="number" min="0.01" max="1000000000" step="100" inputmode="decimal">
              </label>
            </div>
            <button type="button" class="admin-health-save" @click="saveHealthThresholds">保存阈值</button>
          </details>

          <p v-if="inventoryError" class="admin-load-error" role="alert">本机数据无法读取，暂不能运行体检。</p>
          <p v-else-if="!inventory" class="admin-inventory-loading" role="status">正在读取本机数据…</p>
          <p v-else-if="!dataHealthItems.length" class="admin-health-empty">当前可读取的数据没有发现需要复核的项目。</p>
          <ul v-else class="admin-health-issues">
            <li v-for="issue in dataHealthItems" :key="issue.id" :data-tone="issue.tone">
              <details>
                <summary><span class="admin-health-issue-title">{{ issue.title }}</span><span class="admin-health-issue-count">{{ issue.count }} 条</span></summary>
                <p class="admin-health-issue-detail">{{ issue.detail }}</p>
                <ul class="admin-health-samples">
                  <li v-for="sample in issue.samples" :key="sample.id">
                    <span class="admin-health-record">{{ sample.label }}</span>
                    <div class="admin-health-row-actions">
                      <template v-if="issue.fix === 'merge-or-archive'">
                        <button type="button" class="admin-text-action" @click="openHealthFix(issue, sample, 'merge-task')">合并备注</button>
                        <button type="button" class="admin-text-action" @click="openHealthFix(issue, sample, 'archive')">归档</button>
                      </template>
                      <template v-else-if="issue.fix === 'reassign-or-archive' && (issue.kind.startsWith('orphan-task') || issue.kind.startsWith('orphan-event'))">
                        <label class="admin-health-select-label" :for="`health-course-${sample.id}`">关联课程</label>
                        <select :id="`health-course-${sample.id}`" v-model="healthCourseSelections[sample.id]" :aria-label="`为记录 ${sample.id} 重新关联课程`">
                          <option value="">选择课程</option><option v-for="course in healthCourses" :key="course.id" :value="course.id">{{ course.name }}</option>
                        </select>
                        <button v-if="healthCourses.length" type="button" class="admin-text-action" @click="openHealthFix(issue, sample, 'reassign-course')">重新关联</button>
                        <button type="button" class="admin-text-action" @click="openHealthFix(issue, sample, 'archive')">归档</button>
                      </template>
                      <template v-else-if="issue.fix === 'merge-category-or-archive'">
                        <label class="admin-health-select-label" :for="`health-category-${sample.id}`">目标分类</label>
                        <select :id="`health-category-${sample.id}`" v-model="healthCategorySelections[sample.id]" :aria-label="`为记录 ${sample.id} 选择目标分类`">
                        <option value="">选择分类</option><option v-for="category in healthCategoriesFor(sample)" :key="category.key" :value="category.key">{{ category.name }}</option>
                      </select>
                        <button v-if="healthCategoriesFor(sample).length" type="button" class="admin-text-action" @click="openHealthFix(issue, sample, 'merge-category')">合并分类</button>
                        <button type="button" class="admin-text-action" @click="openHealthFix(issue, sample, 'archive')">归档</button>
                      </template>
                      <template v-else-if="issue.fix === 'archive' || issue.fix === 'reassign-or-archive' || issue.fix === 'archive-notice'">
                        <button type="button" class="admin-text-action" @click="openHealthFix(issue, sample, 'archive')">归档</button>
                      </template>
                      <RouterLink v-else-if="issue.fix === 'review-schedule'" class="admin-module-link" to="/schedule">前往课表复核</RouterLink>
                      <span v-else class="admin-health-manual">请在对应页面复核</span>
                    </div>
                  </li>
                </ul>
                <nav v-if="issue.pageCount > 1" class="admin-health-pagination" :aria-label="`${issue.title}记录分页`">
                  <span>第 {{ issue.page + 1 }} / {{ issue.pageCount }} 组 · {{ issue.sampleCount }} 条记录，每组最多 {{ HEALTH_PAGE_SIZE }} 条</span>
                  <div>
                    <button type="button" class="admin-health-tool" :disabled="issue.page === 0" @click="changeHealthPage(issue, -1)">上一组</button>
                    <button type="button" class="admin-health-tool" :disabled="issue.page >= issue.pageCount - 1" @click="changeHealthPage(issue, 1)">下一组</button>
                  </div>
                </nav>
              </details>
            </li>
          </ul>
        </section>

        <section class="admin-panel admin-inventory" aria-labelledby="admin-inventory-title">
          <div class="admin-section-head">
            <div>
              <h2 id="admin-inventory-title">本机数据分区</h2>
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

      <aside class="admin-secondary-column" aria-label="本机运行状态与诊断">
        <section class="admin-panel admin-status-panel" aria-labelledby="admin-status-title">
          <div class="admin-section-head">
            <div>
              <h2 id="admin-status-title">运行状态</h2>
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

        <details class="admin-version" aria-label="版本信息与诊断"><summary>版本与诊断</summary>
          <div><span>应用版本</span><b>v{{ currentVersionInfo.appVersion }}</b></div>
          <div><span>发布通道</span><b>{{ currentVersionInfo.channel }}</b></div>
          <div><span>业务数据结构</span><b>v{{ currentVersionInfo.domainSchemaVersion }}</b></div>
          <div><span>账号同步结构</span><b>v{{ currentVersionInfo.schemaVersion }}</b></div>
          <div><span>构建标识</span><b>{{ currentVersionInfo.buildId }}</b></div>
          <div><span>代码提交</span><b>{{ currentVersionInfo.commitId }}</b></div>
          <details class="admin-diagnostics">
            <summary>复制诊断信息</summary>
            <p>诊断不含个人记录或账号信息。</p>
            <button type="button" class="admin-refresh" @click="copyDiagnostics">复制到剪贴板</button>
            <p v-if="copyMessage" role="status">{{ copyMessage }}</p>
            <textarea class="admin-diagnostics-text" aria-label="管理中心诊断信息" readonly :value="diagnostics"></textarea>
          </details>
        </details>
      </aside>
    </div>
  </div>

  <DataManager v-if="showDataManager" :open="showDataManager" @close="showDataManager = false" />
  <ConfirmDialog v-if="healthFixTarget" :open="Boolean(healthFixTarget)" title="确认处理本机记录" :message="healthFixTarget.message" confirm-label="确认并继续" tone="primary" @close="healthFixTarget = null" @confirm="confirmHealthFix" />
  <Toast v-model:open="toast.open" :message="toast.message" :type="toast.type" :action-label="toast.actionLabel" :undo-fn="toast.undoFn || undefined" :duration="toast.duration" @close="toast.open = false" />
</template>

<style scoped>
.admin-center { width:100%; max-width:1240px; margin:0 auto; padding:0 0 36px; color:var(--text); }
.admin-head { align-items:center; margin-bottom:16px; }
.admin-head .page-title { margin:0; }
.admin-head .page-desc { max-width:58ch; }
.admin-primary-action { min-height:44px; white-space:nowrap; }
.admin-primary-action span { margin-right:4px; font-size:var(--fs-16); }
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
.admin-clear-state { display:flex; align-items:center; gap:9px; margin:0; padding:12px 0 2px; border-top:1px solid var(--border); color:var(--ink-soft); font-size:var(--fs-13); }
.admin-clear-state span { display:grid; place-items:center; width:22px; height:22px; flex:0 0 22px; border-radius:50%; color:var(--success); background:color-mix(in srgb,var(--success) 10%,var(--card)); font-weight:var(--fw-800); }
.admin-refresh { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-width:80px; min-height:40px; padding:5px 9px; border:1px solid var(--border); border-radius:var(--radius-8); color:var(--ink-soft); background:var(--card); font:inherit; font-size:var(--fs-12); cursor:pointer; }
.admin-refresh:hover:not(:disabled) { color:var(--primary); border-color:var(--primary); background:var(--primary-soft); }
.admin-refresh:disabled { cursor:wait; opacity:.7; }
.admin-refresh span { font-size:var(--fs-17); line-height:1; }
.spinning { animation:admin-spin 900ms linear infinite; }
.admin-inventory-loading,.admin-load-error { margin:0; padding:14px 0; border-top:1px solid var(--border); color:var(--muted); font-size:var(--fs-12); line-height:1.6; }
.admin-load-error { color:var(--danger); }
.admin-health-total { display:grid; place-items:center; width:30px; height:30px; flex:0 0 30px; border:1px solid var(--border); border-radius:50%; color:var(--muted); background:var(--bg-tint); font-size:var(--fs-12); font-variant-numeric:tabular-nums; }
.admin-health-total[data-tone='warning'] { border-color:color-mix(in srgb,var(--warning) 35%,var(--border)); color:var(--warning); background:color-mix(in srgb,var(--warning) 9%,var(--card)); }
.admin-health-total[data-tone='success'] { border-color:color-mix(in srgb,var(--success) 35%,var(--border)); color:var(--success); background:color-mix(in srgb,var(--success) 8%,var(--card)); }
.admin-health-overview { display:grid; gap:5px; padding:12px 0; border-top:1px solid var(--border); color:var(--muted); font-size:var(--fs-12); line-height:1.55; }
.admin-health-overview b { color:var(--success); font-size:var(--fs-13); }
.admin-health-overview b[data-tone='warning'] { color:var(--warning); }
.admin-health-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:4px; }
.admin-health-tool { display:inline-flex; align-items:center; justify-content:center; min-height:40px; padding:5px 10px; border:1px solid var(--border); border-radius:var(--radius-8); color:var(--ink-soft); background:var(--card); font:inherit; font-size:var(--fs-12); cursor:pointer; }
.admin-health-tool:hover:not(:disabled) { color:var(--primary); border-color:var(--primary); background:var(--primary-soft); }
.admin-health-tool:disabled { cursor:wait; opacity:.7; }
.admin-health-settings { margin-top:4px; padding:11px 0; border-top:1px solid var(--border); border-bottom:1px solid var(--border); }
.admin-health-settings summary { display:flex; align-items:center; min-height:40px; color:var(--primary); font-size:var(--fs-12); font-weight:var(--fw-650); cursor:pointer; }
.admin-health-thresholds { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; padding:8px 0; }
.admin-health-thresholds label { display:grid; gap:5px; color:var(--muted); font-size:var(--fs-11); line-height:1.45; }
.admin-health-thresholds input,.admin-health-select-label + select,.admin-health-row-actions select { width:100%; min-height:40px; padding:7px 9px; border:1px solid var(--border); border-radius:var(--radius-8); color:var(--text); background:var(--bg); font:inherit; font-size:var(--fs-12); }
.admin-health-save { min-height:40px; padding:6px 11px; border:1px solid var(--primary); border-radius:var(--radius-8); color:var(--on-primary); background:var(--primary); font:inherit; font-size:var(--fs-12); font-weight:var(--fw-650); cursor:pointer; }
.admin-health-empty { margin:0; padding:13px 0 2px; border-top:1px solid var(--border); color:var(--ink-soft); font-size:var(--fs-12); }
.admin-health-issues { list-style:none; margin:0; padding:0; }
.admin-health-issues > li { border-bottom:1px solid var(--border); }
.admin-health-issues > li:last-child { border-bottom:0; }
.admin-health-issues summary { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:48px; cursor:pointer; }
.admin-health-issue-title { color:var(--text); font-size:var(--fs-12); font-weight:var(--fw-650); }
.admin-health-issues > li[data-tone='warning'] .admin-health-issue-title { color:var(--warning); }
.admin-health-issue-count { flex:none; color:var(--muted); font-size:var(--fs-11); font-variant-numeric:tabular-nums; }
.admin-health-issue-detail { margin:0 0 9px; color:var(--muted); font-size:var(--fs-11); line-height:1.55; }
.admin-health-samples { list-style:none; margin:0 0 7px; padding:0; }
.admin-health-samples > li { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.4fr); align-items:center; gap:8px 12px; padding:9px 0; border-top:1px solid var(--border); }
.admin-health-record { min-width:0; overflow-wrap:anywhere; color:var(--ink-soft); font-size:var(--fs-11); }
.admin-health-record small { display:block; margin-top:2px; color:var(--muted); font-size:var(--fs-10); }
.admin-health-row-actions { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:2px 5px; }
.admin-health-row-actions .admin-text-action { min-height:38px; }
.admin-health-row-actions select { width:auto; min-width:115px; max-width:180px; }
.admin-health-select-label { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
.admin-health-manual { color:var(--muted); font-size:var(--fs-10); }
.admin-health-pagination { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px 12px; margin-top:8px; padding-top:9px; border-top:1px solid var(--border); color:var(--muted); font-size:var(--fs-11); }
.admin-health-pagination > div { display:flex; flex-wrap:wrap; gap:6px; }
.admin-health-pagination .admin-health-tool { min-height:36px; }
.admin-module-list li { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:61px; padding:9px 0; border-top:1px solid var(--border); }
.admin-module-main { display:flex; align-items:center; gap:11px; min-width:0; }
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
.admin-version { display:block; grid-template-columns:minmax(0,1fr); min-width:0; gap:8px; padding:14px 17px; border:1px solid var(--border); border-radius:var(--radius-12); background:var(--bg-tint); }
.admin-version > div { display:flex; justify-content:space-between; gap:12px; font-size:var(--fs-11); }
.admin-version > div span,.admin-version p { color:var(--muted); }
.admin-version > div b { min-width:0; overflow-wrap:anywhere; text-align:right; font-weight:var(--fw-650); font-variant-numeric:tabular-nums; }
.admin-version > p { margin:3px 0 0; padding-top:9px; border-top:1px solid var(--border); font-size:var(--fs-11); line-height:1.55; }
.admin-diagnostics { display:block; gap:8px; margin:4px 0 0; padding-top:10px; border-top:1px solid var(--border); }
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
  .admin-health-thresholds { grid-template-columns:minmax(0,1fr); }
  .admin-health-samples > li { grid-template-columns:minmax(0,1fr); }
  .admin-health-row-actions { justify-content:flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  .spinning { animation:none; }
}
.admin-version>summary{min-height:44px;display:flex;align-items:center;font-size:var(--fs-13);cursor:pointer}.admin-version>div{padding:5px 0}.admin-diagnostics-text{margin-top:10px}
</style>
