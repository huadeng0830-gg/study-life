<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import TaskProgress from './TaskProgress.vue'
import BackupSection from './data/BackupSection.vue'
import RestoreSection from './data/RestoreSection.vue'
import AccountSyncPanel from './data/AccountSyncPanel.vue'
import { backupReminderTitle, needsBackup } from '../composables/backupReminder.js'
import { animationsEnabled } from '../composables/motion.js'
import { backupError, backupMessage, restoreError } from '../composables/dataManagerFeedback.js'
import { useDataManagerBackup } from '../composables/dataManagerBackup.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const backup = useDataManagerBackup()
const {
  selectedName, backupProgress, exportBackup, retryBackup,
  continueBackupResult, abortBackup, summary, restoreBackup,
  restoreBackupTarget, restoreBackupMessage, restoreBackupPreviewModules, applyRestoreBackup,
} = backup
async function confirmRestoreBackup() {
  await applyRestoreBackup()
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
  if (!open && backupProgress.state.status === 'running' && backupProgress.state.canCancel) void backupProgress.cancel()
}, { immediate: true })

onBeforeUnmount(() => {
  abortBackup()
})

defineExpose({ exportBackup })

</script>

<template>
  <Modal :open="open" title="数据管理" :wide="true" @close="emit('close')">
    <div class="data-manager">
      <p v-if="needsBackup" class="backup-hint">⚠️ 删除苹果桌面应用或清除 Safari 网站数据可能同时删除本地记录。{{ backupReminderTitle }}，建议先导出一份。</p>
      <nav class="data-manager-nav" aria-label="数据管理分区">
        <button type="button" @click="jumpToSection('backup')">备份</button>
        <button type="button" @click="jumpToSection('restore')">恢复</button>
        <button type="button" @click="jumpToSection('sync')">账号同步</button>
      </nav>
      <BackupSection ref="backupSectionRef" />

      <TaskProgress
        :task="backupProgress.state"
        :elapsed-seconds="backupProgress.elapsedSeconds.value"
        :activity-age-seconds="backupProgress.activityAgeSeconds.value"
        :stalled="backupProgress.isStalled.value"
        compact
        @cancel="backupProgress.cancel"
        @retry="retryBackup"
        @continue="continueBackupResult"
        @wait="backupProgress.continueWaiting"
      />

      <p v-if="backupMessage" class="success" role="status">{{ backupMessage }}</p>
      <p v-if="backupError" class="error" role="alert">{{ backupError }}</p>

      <RestoreSection ref="restoreSectionRef" />

      <p v-if="restoreError" class="error" role="alert">{{ restoreError }}</p>

      <div v-if="summary" class="restore-preview">
        <div class="restore-preview-title">
          <b>备份已检查</b>
          <span class="restore-preview-name">{{ selectedName }}</span>
        </div>
        <div class="restore-preview-scope" role="group" aria-label="将恢复的数据范围">
          <span v-for="module in restoreBackupPreviewModules" :key="module">{{ module }}</span>
          <span v-if="summary.wallpapers">{{ summary.wallpapers }} 张壁纸图片</span>
        </div>
        <p class="restore-preview-note">只覆盖备份文件中包含的数据；未包含的模块保留在本机。确认恢复后无法撤销。</p>
        <button class="btn btn-primary" :disabled="restoreBackupPreviewModules.length === 0" @click="restoreBackup">确认恢复</button>
      </div>

      <section id="data-sync" ref="syncSectionRef" class="data-section account-sync-wrap">
        <div class="account-sync-icon" aria-hidden="true">↔</div>
        <AccountSyncPanel compact />
      </section>

      <p class="local-note">
        <b class="ios-warning">iPhone 注意：删除桌面应用或清除 Safari 网站数据可能清空本机记录，操作前请先导出备份。</b>
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
.data-manager-nav button:active {
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
.restore-preview {
  border:1px solid color-mix(in srgb, var(--success) 35%, var(--card));
  background:color-mix(in srgb, var(--success) 10%, var(--card));
  border-radius:var(--radius-10);
  flex-direction:column;
  align-items:stretch;
  gap:10px;
  padding:12px;
  font-size:var(--fs-12);
  display:flex}
.restore-preview-title {
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:3px}
.restore-preview-title b { color:var(--success); font-size:var(--fs-13); }
.restore-preview-name {
  color:var(--muted);
  text-overflow:ellipsis;
  white-space:nowrap;
  overflow:hidden}
.restore-preview-scope {
  display:flex;
  flex-wrap:wrap;
  gap:6px}
.restore-preview-scope span {
  color:var(--success);
  background:color-mix(in srgb, var(--success) 10%, var(--card));
  border-radius:var(--radius-6);
  padding:5px 8px}
.restore-preview-note { margin:0; color:var(--muted); line-height:1.5; }
.restore-preview .btn { align-self:flex-start; min-height:44px; }
.success {
  margin:0;
  color:var(--success);
  font-size:var(--fs-13)}
.error {
  margin:0;
  color:var(--danger);
  font-size:var(--fs-13)}
.local-note {
  margin:0;
  color:var(--muted);
  font-size:var(--fs-12);
  line-height:1.55;
  padding:0 4px}
.ios-warning {
  color:var(--warning);
  margin-top:6px;
  display:block}
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
  .restore-preview .btn { align-self:stretch; width:100%; }
}
</style>
