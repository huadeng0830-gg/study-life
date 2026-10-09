<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import Modal from './Modal.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import TaskProgress from './TaskProgress.vue'
import BackupSection from './data/BackupSection.vue'
import RestoreSection from './data/RestoreSection.vue'
import AccountSyncPanel from './data/AccountSyncPanel.vue'
import DataOverview from './data/DataOverview.vue'
import RestorePreview from './data/RestorePreview.vue'
import { backupReminderTitle, needsBackup } from '../composables/backupReminder.js'
import { animationsEnabled } from '../composables/motion.js'
import { backupError, backupMessage, backupWarning, restoreError } from '../composables/dataManagerFeedback.js'
import { useDataManagerBackup } from '../composables/dataManagerBackup.js'
import { readDataInventory } from '../composables/dataManagerInventory.js'
import { flushStoredWrites } from '../composables/store'
import { announce } from '../composables/liveRegion.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const backup = useDataManagerBackup()
const {
  backupProgress, backupBusy, restoring, exportBackup, retryBackup,
  continueBackupResult, cancelBackup, abortBackup, clearSelectedBackup,
  restoreBackupTarget, restoreBackupMessage,
  restoreCheckpoint, restoreCheckpointLoading, restoreCheckpointError, restoreCheckpointModules,
  restoreCheckpointWallpapers, restoreCheckpointDate, restoreCheckpointMessage,
  refreshRestoreCheckpoint, applyRestoreBackup, applyRestoreCheckpoint,
} = backup
const showCheckpointConfirm = ref(false)
const inventory = shallowRef(null)
const inventoryError = ref('')
const activeSection = ref('backup')
const operationProgressRef = ref(null)
let inventoryTimer = 0
function refreshInventory() {
  if (!props.open) return
  try {
    flushStoredWrites()
    inventory.value = readDataInventory()
    inventoryError.value = ''
  } catch {
    inventory.value = null
    inventoryError.value = '本机数据暂时无法读取，请检查浏览器的存储权限后刷新。'
  }
}
function scheduleInventoryRefresh() {
  if (!props.open) return
  window.clearTimeout(inventoryTimer)
  inventoryTimer = window.setTimeout(refreshInventory, 160)
}
function closeDataManager() {
  if (restoring.value) {
    announce('正在恢复数据，请等待完成后重新载入。')
    return
  }
  clearSelectedBackup()
  emit('close')
}
async function confirmRestoreBackup() {
  await applyRestoreBackup()
}
async function confirmRestoreCheckpoint() {
  showCheckpointConfirm.value = false
  await applyRestoreCheckpoint()
}

// 分区导航用组件内滚动代替 `#hash` 锚点。
// 应用使用 hash 路由，`href="#data-restore"` 会被路由解析成 /data-restore 并命中 404 兜底页，
// 恢复完成后的 reload 又会停在这个地址上，导致手机上“从备份恢复”看起来完全不可用。
const backupSectionRef = ref(null)
const restoreSectionRef = ref(null)
const syncSectionRef = ref(null)
const sectionRefs = {
  backup: backupSectionRef,
  restore: restoreSectionRef,
  sync: syncSectionRef,
}

function jumpToSection(name) {
  activeSection.value = name
  // 分区 <section> 现在是子组件的根节点，模板 ref 拿到的是组件实例；
  // 真正要做滚动的永远是那个根元素（实例上的 scrollIntoView 并不存在）。
  const target = sectionRefs[name]?.value
  const element = target?.$el ?? target
  if (!element?.scrollIntoView) return
  // 与 focusNavigation.scrollAndHighlight 同理：JS 发起的平滑滚动不受 CSS 降级规则约束，
  // 必须自己问一次。数据管理页的分区很长，不门控时「流畅优先」用户仍会被拖着滚。
  element.scrollIntoView({ block: 'start', behavior: animationsEnabled() ? 'smooth' : 'auto' })
}

watch(() => props.open, (open) => {
  if (open) { refreshInventory(); void refreshRestoreCheckpoint() }
  if (!open && backupProgress.state.status === 'running' && backupProgress.state.canCancel) void cancelBackup()
}, { immediate: true })

watch(restoring, async (running) => {
  if (!running) return
  await nextTick()
  operationProgressRef.value?.scrollIntoView({ block: 'start', behavior: animationsEnabled() ? 'smooth' : 'auto' })
})

onMounted(() => {
  window.addEventListener('study-life:storage-updated', scheduleInventoryRefresh)
  window.addEventListener('storage', scheduleInventoryRefresh)
  window.addEventListener('pageshow', scheduleInventoryRefresh)
})

onBeforeUnmount(() => {
  abortBackup()
  clearSelectedBackup()
  backupProgress.dispose()
  window.clearTimeout(inventoryTimer)
  window.removeEventListener('study-life:storage-updated', scheduleInventoryRefresh)
  window.removeEventListener('storage', scheduleInventoryRefresh)
  window.removeEventListener('pageshow', scheduleInventoryRefresh)
})

defineExpose({ exportBackup })

</script>

<template>
  <Modal :open="open" title="数据管理" :wide="true" @close="closeDataManager">
    <div class="data-manager">
      <DataOverview :inventory="inventory" :error="inventoryError" @refresh="refreshInventory" />
      <p v-if="needsBackup" class="backup-hint">{{ backupReminderTitle }}。更换设备或清理浏览器数据前，建议先导出一份完整备份。</p>
      <nav class="data-manager-nav" aria-label="数据管理分区">
        <button type="button" :class="{ active: activeSection === 'backup' }" :aria-current="activeSection === 'backup' ? 'location' : undefined" aria-controls="data-backup" @click="jumpToSection('backup')">备份</button>
        <button type="button" :class="{ active: activeSection === 'restore' }" :aria-current="activeSection === 'restore' ? 'location' : undefined" aria-controls="data-restore" @click="jumpToSection('restore')">恢复</button>
        <button type="button" :class="{ active: activeSection === 'sync' }" :aria-current="activeSection === 'sync' ? 'location' : undefined" aria-controls="data-sync" @click="jumpToSection('sync')">账号同步</button>
      </nav>
      <div ref="operationProgressRef" class="operation-progress">
      <TaskProgress
        :task="backupProgress.state"
        :elapsed-seconds="backupProgress.elapsedSeconds.value"
        :activity-age-seconds="backupProgress.activityAgeSeconds.value"
        :stalled="backupProgress.isStalled.value"
        compact
        dismissible
        @cancel="cancelBackup"
        @retry="retryBackup"
        @continue="continueBackupResult"
        @wait="backupProgress.continueWaiting"
        @dismiss="continueBackupResult"
      />
      </div>

      <BackupSection id="data-backup" ref="backupSectionRef" />

      <p v-if="backupMessage" class="success" role="status">{{ backupMessage }}</p>
      <p v-if="backupError" class="error" role="alert">{{ backupError }}</p>
      <p v-if="backupWarning" class="warning" role="status">{{ backupWarning }}</p>

      <RestoreSection id="data-restore" ref="restoreSectionRef" />

      <p v-if="restoreError" class="error restore-error" role="alert">{{ restoreError }}</p>

      <RestorePreview :inventory="inventory" />

      <section class="data-section restore-checkpoint" aria-label="本机恢复点">
        <div class="restore-checkpoint-heading">
          <div><h4>本机恢复点</h4><p>保留最近一次恢复前的副本，可撤回所选内容。恢复点只在这台设备上有效。</p></div>
          <span v-if="restoreCheckpointLoading" class="checkpoint-status">正在读取…</span>
        </div>
        <p v-if="restoreCheckpointError" class="error" role="alert">{{ restoreCheckpointError }}</p>
        <button v-if="restoreCheckpointError" type="button" class="btn btn-ghost" :disabled="backupBusy || restoreCheckpointLoading" @click="refreshRestoreCheckpoint">重新读取恢复点</button>
        <template v-if="restoreCheckpoint && !restoreCheckpointError && !restoreCheckpointLoading">
          <p class="checkpoint-time">上次保存：{{ restoreCheckpointDate }}</p>
          <div class="restore-preview-scope" aria-label="恢复点包含的数据">
            <span v-for="module in restoreCheckpointModules" :key="module">{{ module }}</span>
            <span v-if="restoreCheckpoint.selectedModules?.includes('wallpapers')">壁纸图片（{{ restoreCheckpointWallpapers }} 张）</span>
          </div>
          <button class="btn btn-ghost" type="button" :disabled="backupBusy" @click="showCheckpointConfirm = true">恢复到这个恢复点</button>
        </template>
        <p v-else-if="!restoreCheckpointLoading && !restoreCheckpointError" class="checkpoint-status">尚无恢复点。首次恢复备份时会自动创建，无需手动设置。</p>
      </section>

      <section id="data-sync" ref="syncSectionRef" class="data-section account-sync-wrap">
        <div class="account-sync-icon" aria-hidden="true">↔</div>
        <AccountSyncPanel compact />
      </section>

      <p class="local-note">
        清除浏览器网站数据，或删除 iPhone 桌面应用，可能同时清空本机记录与恢复点。请把备份文件保存在应用之外。
      </p>
    </div>
  </Modal>

  <ConfirmDialog
    v-if="restoreBackupTarget"
    :open="Boolean(restoreBackupTarget)"
    title="从备份恢复"
    :message="restoreBackupMessage"
    confirm-label="确认恢复"
    @close="restoreBackupTarget = null"
    @confirm="confirmRestoreBackup"
  />
  <ConfirmDialog
    v-if="showCheckpointConfirm && restoreCheckpoint"
    :open="showCheckpointConfirm"
    title="恢复本机恢复点"
    :message="restoreCheckpointMessage"
    confirm-label="恢复并重新载入"
    @close="showCheckpointConfirm = false"
    @confirm="confirmRestoreCheckpoint"
  />
</template>

<style scoped>
/* 旧样式注释在数据管理视图拆分时丢失；本样式块已按备份、恢复和账号同步的新结构重建。 */
.data-manager {
  flex-direction:column;
  gap:12px;
  width:100%;
  max-width:780px;
  margin:0 auto;
  display:flex}
.backup-hint {
  border:1px solid color-mix(in srgb, var(--warning) 35%, var(--card));
  background:color-mix(in srgb, var(--warning) 10%, var(--card));
  color:var(--warning);
  border-radius:var(--radius-10);
  padding:10px 12px;
  font-size:var(--fs-12);
  line-height:1.55}
.data-manager-nav {
  z-index:3;
  position:sticky;
  top:0;
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:6px;
  padding:6px;
  border:1px solid var(--border);
  border-radius:var(--radius-10);
  background:var(--card)}
.data-manager-nav button {
  min-height:44px;
  color:var(--ink-soft);
  font:inherit;
  background:var(--bg);
  cursor:pointer;
  border:0;
  border-radius:var(--radius-8);
  place-items:center;
  padding:0 8px;
  font-size:var(--fs-12);
  font-weight:var(--fw-700);
  display:grid}
.data-manager-nav button:hover,
.data-manager-nav button:active,
.data-manager-nav button.active {
  color:var(--primary);
  background:var(--primary-soft)}
.data-manager-nav button:focus-visible {
  outline:var(--focus-width) solid var(--focus-solid);
  outline-offset:var(--focus-offset)}
.data-section {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:var(--radius-12);
  align-items:flex-start;
  gap:13px;
  padding:14px;
  display:flex;
  scroll-margin-top:64px}
.account-sync-wrap :deep(.account-sync-panel) {
  flex:1;
  min-width:0}
.account-sync-icon {
  width:38px;
  height:38px;
  color:var(--primary);
  background:var(--primary-soft);
  border-radius:var(--radius-10);
  flex:0 0 38px;
  place-items:center;
  font-size:var(--fs-18);
  font-weight:var(--fw-800);
  display:grid}
.restore-preview-scope {
  display:flex;
  flex-wrap:wrap;
  gap:6px}
.restore-preview-scope span {
  color:var(--success);
  background:color-mix(in srgb, var(--success) 10%, var(--card));
  border-radius:var(--radius-6);
  padding:5px 8px}
.restore-checkpoint { flex-direction:column; align-items:stretch; }
.restore-checkpoint-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.restore-checkpoint-heading h4, .restore-checkpoint-heading p { margin:0; }
.restore-checkpoint-heading h4 { font-size:var(--fs-14); }
.restore-checkpoint-heading p, .checkpoint-time, .checkpoint-status { color:var(--muted); font-size:var(--fs-12); line-height:1.5; }
.restore-checkpoint-heading p { margin-top:3px; }
.checkpoint-time { margin:0; }
.restore-checkpoint .btn { align-self:flex-start; min-height:44px; }
.success {
  margin:0;
  color:var(--success);
  font-size:var(--fs-13)}
.error {
  margin:0;
  color:var(--danger);
  font-size:var(--fs-13)}
.warning { margin:0; color:var(--warning); font-size:var(--fs-12); line-height:1.6; overflow-wrap:anywhere; }
.operation-progress { scroll-margin-top:64px; }
.operation-progress:empty { display:none; }
.local-note {
  margin:0;
  color:var(--muted);
  font-size:var(--fs-12);
  line-height:1.55;
  padding:0 4px}
@media (max-width:520px) {
  .data-manager-nav {
  gap:4px;
  padding:5px}
  /* 章节滚动定位要避开顶部的粘性分区导航。 */
  .data-section {
  gap:10px;
  padding:12px}
  .account-sync-icon {
  flex-basis:32px;
  width:32px;
  height:32px;
  font-size:var(--fs-16)}
  .restore-checkpoint .btn { align-self:stretch; }
}
</style>
