<script setup>
import { defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import TaskProgress from './TaskProgress.vue'
import BackupSection from './data/BackupSection.vue'
import AppUpdateSection from './data/AppUpdateSection.vue'
import TransferSection from './data/TransferSection.vue'
import DataHealthCard from './data/DataHealthCard.vue'
import RestoreSection from './data/RestoreSection.vue'
import SyncPanel from './data/SyncPanel.vue'
import MergeConflictModal from './data/MergeConflictModal.vue'
import { needsBackup } from '../composables/backupReminder.js'
import { animationsEnabled } from '../composables/motion.js'
import { isSyncing, refreshCloudMetadata, syncCalibrationRequired, syncPreview } from '../composables/cloudSync.js'
import { autoSyncEnabled, isSyncSpaceBound } from '../composables/syncSpace.js'
import { localSafeMode } from '../composables/localSafeMode.js'

import { useDataManagerStatus } from '../composables/dataManagerStatus.js'
import { useDataManagerBackup } from '../composables/dataManagerBackup.js'
import { useDataManagerPairing } from '../composables/dataManagerPairing.js'
import { useDataManagerSyncActions } from '../composables/dataManagerSyncActions.js'

// 二维码生成/扫描依赖体积较大，仅在用户真正打开迁移面板时下载和解析。
const LocalTransfer = defineAsyncComponent(() => import('./LocalTransfer.vue'))
const SyncPairingModal = defineAsyncComponent(() => import('./SyncPairingModal.vue'))

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])



const status = useDataManagerStatus()
const { error, message, refreshDataHealth } = status

const backup = useDataManagerBackup()
const {
  selectedName, backupProgress, exportBackup, retryBackup,
  continueBackupResult, abortBackup, summary, restoreBackup,
} = backup
const restoreBackupTarget = backup.restoreBackupTarget

const pairing = useDataManagerPairing()
const {
  showPairing, pairingInfo, pairingBusy, pairingTokenBusy, pairingMode, pairingError,
  joinBusy, regeneratePairing, onPairingScanned,
} = pairing
const createSpaceTarget = pairing.createSpaceTarget
const upgradeLegacyTarget = pairing.upgradeLegacyTarget
const recalibrateTarget = pairing.recalibrateTarget
const removeDeviceTarget = pairing.removeDeviceTarget

const sync = useDataManagerSyncActions()
const {
  confirmBox, disconnectConfirmOpen, syncProgress, closeConfirm, runPull, runPush,
  doDisconnect, toggleAutoSync, abortSync,
} = sync

// 五个 ConfirmDialog 的目标都由各自 composable 持有；这里用字面声明 + 字面函数名包一层，
// 保证 tests/confirmDialogMigration.test.js 的 @confirm/@close 判据仍在本文件内命中。
function runCreateSpace() {
  pairing.runCreateSpaceFlow()
}
function runUpgradeLegacy() {
  pairing.runUpgradeLegacyFlow()
}
async function confirmRecalibrate() {
  await pairing.applyRecalibrate()
}
async function confirmRemoveDevice() {
  await pairing.applyRemoveDevice()
}
async function confirmRestoreBackup() {
  await backup.applyRestoreBackup()
}

const showTransfer = ref(false)

// 移动端分区导航：用组件内滚动代替 `#hash` 锚点。
// 应用使用 hash 路由，`href="#data-restore"` 会被路由解析成 /data-restore 并命中 404 兜底页，
// 恢复完成后的 reload 又会停在这个地址上，导致手机上“从备份恢复”看起来完全不可用。
const backupSectionRef = ref(null)
const syncSectionRef = ref(null)
const transferSectionRef = ref(null)
const restoreSectionRef = ref(null)
const sectionRefs = {
  backup: backupSectionRef,
  sync: syncSectionRef,
  transfer: transferSectionRef,
  restore: restoreSectionRef,
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

let deviceRefreshTimer = null

async function refreshDeviceMetadata() {
  if (!props.open || !isSyncSpaceBound.value || pairingBusy.value || pairingTokenBusy.value || joinBusy.value || isSyncing.value) return
  // 设备列表必须独立于 AutoSync；AutoSync 关闭时，配对/撤销也要在当前页面收敛。
  await refreshCloudMetadata()
}

function stopDeviceMetadataRefresh() {
  if (deviceRefreshTimer !== null) window.clearInterval(deviceRefreshTimer)
  deviceRefreshTimer = null
}

function startDeviceMetadataRefresh() {
  stopDeviceMetadataRefresh()
  if (!isSyncSpaceBound.value) return
  void refreshDeviceMetadata()
  deviceRefreshTimer = window.setInterval(() => { void refreshDeviceMetadata() }, 15_000)
}

const confirmCancelBtn = ref(null)

watch(confirmBox, (box) => {
  if (box) nextTick(() => confirmCancelBtn.value?.focus())
})

watch(() => props.open, (open) => {
  if (open) {
    void refreshDataHealth()
    startDeviceMetadataRefresh()
  } else {
    stopDeviceMetadataRefresh()
  }
  if (!open && syncProgress.state.status === 'running') void syncProgress.cancel()
  if (!open && backupProgress.state.status === 'running' && backupProgress.state.canCancel) void backupProgress.cancel()
}, { immediate: true })

onBeforeUnmount(() => {
  abortSync()
  abortBackup()
  stopDeviceMetadataRefresh()
  pairing.resetPairingUi()
})

defineExpose({ exportBackup })

</script>

<template>
  <Modal :open="open" title="数据备份与恢复" :wide="true" @close="emit('close')">
    <div class="data-manager">
      <p v-if="needsBackup" class="backup-hint">⚠️ 删除苹果桌面应用或清除 Safari 网站数据可能同时删除本地记录。已超过 7 天未备份，建议先导出一份。</p>
      <nav class="mobile-data-nav" aria-label="数据管理分区">
        <button type="button" @click="jumpToSection('backup')">备份</button>
        <button type="button" @click="jumpToSection('sync')">同步</button>
        <button type="button" @click="jumpToSection('transfer')">迁移</button>
        <button type="button" @click="jumpToSection('restore')">恢复</button>
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

      <AppUpdateSection />

      <TransferSection ref="transferSectionRef" @open="showTransfer = true" />

      <DataHealthCard />

      <RestoreSection ref="restoreSectionRef" />

      <SyncPanel ref="syncSectionRef">
        <div class="sync-setting-row">
          <div><b>自动同步</b><span>本机修改后自动上传，并检查其它设备更新。</span></div>
          <button type="button" class="switch" role="switch" :aria-checked="autoSyncEnabled" :class="{ on: autoSyncEnabled }" :disabled="syncCalibrationRequired || localSafeMode" @click="toggleAutoSync"><span>{{ autoSyncEnabled ? '开' : '关' }}</span></button>
        </div>
      </SyncPanel>

      <Modal v-if="disconnectConfirmOpen" :open="disconnectConfirmOpen" title="停止本设备同步" @close="disconnectConfirmOpen = false">
        <div class="confirm-body disconnect-confirm"><p>仅停止当前设备同步，本机课程、待办和记录都会保留。之后如需使用同步，可再次绑定设备。</p><div class="actions"><button type="button" class="btn" @click="disconnectConfirmOpen = false">取消</button><button type="button" class="btn btn-danger" @click="doDisconnect">停止同步</button></div></div>
      </Modal>

      <!-- 拉取 / 推送 确认框（取消为默认焦点） -->
      <Modal v-if="confirmBox" :open="Boolean(confirmBox)" :title="confirmBox?.title ?? ''" @close="closeConfirm">
        <div v-if="confirmBox" class="confirm-body">
          <div v-for="[label, value] in confirmBox.lines" :key="label" class="confirm-row">
            <span>{{ label }}</span>
            <b>{{ value }}</b>
          </div>
          <div class="actions">
            <button ref="confirmCancelBtn" class="btn" @click="closeConfirm">取消</button>
            <button
              class="btn btn-primary"
              :class="{ 'btn-danger': confirmBox.mode === 'push' }"
              @click="confirmBox.mode === 'pull' ? runPull() : runPush()"
            >{{ confirmBox.confirmLabel }}</button>
          </div>
        </div>
      </Modal>

      <MergeConflictModal v-if="syncPreview?.conflicts?.length" />

      <div v-if="summary" class="restore-preview">
        <b>{{ selectedName }}</b>
        <span>{{ summary.courses }} 门课程</span>
        <span>{{ summary.scheduleExceptions }} 个特殊日期</span>
        <span>{{ summary.countdowns }} 个重要日期</span>
        <span>{{ summary.tasks }} 项待办</span>
        <span>{{ summary.courseTemplates }} 个课表模板</span>
        <span>{{ summary.checklists }} 份生活清单</span>
        <span>{{ summary.bills }} 项固定账单 · {{ summary.expenses }} 笔消费</span>
        <span v-if="summary.wallpapers">{{ summary.wallpapers }} 张壁纸</span>
        <button class="btn btn-primary" @click="restoreBackup">确认恢复</button>
      </div>

      <p v-if="message" class="success" role="status">{{ message }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p class="local-note">
        数据保存在当前浏览器，并同步保留一份设备内安全副本。换设备或清理浏览器前仍建议导出备份。
        <b class="ios-warning">iPhone 注意：从后台划掉应用不会删除记录；删除桌面应用或清除 Safari 网站数据则可能清空本地数据。重要操作前请先导出备份或推送云端。</b>
      </p>
    </div>
  </Modal>

  <LocalTransfer v-if="showTransfer" :open="showTransfer" @close="showTransfer = false" />
  <SyncPairingModal v-if="showPairing" :open="showPairing" :pairing="pairingInfo" :mode="pairingMode" :busy="pairingBusy || pairingTokenBusy" :error="pairingError" @close="showPairing = false" @regenerate="regeneratePairing" @scanned="onPairingScanned" />

  <!-- 这几处确认框都在本组件自身的 Modal 之上（弹窗套弹窗）；ConfirmDialog 自己
       Teleport 到 body，所以叠放顺序与 Escape 只关最上层这两条都由现有机制保证。
       五个都加 v-if 随目标挂载：本组件的 Modal 没有 v-if、声明在最前面，锚点天然
       更早，但 LocalTransfer / SyncPairingModal 是 v-if 的、挂载更晚——统一 v-if
       可以让确认框的锚点在打开这一刻才创建，永远排到最上层
       （见 ConfirmDialog 顶部的浮层顺序说明）。 -->
  <ConfirmDialog
    v-if="createSpaceTarget"
    :open="createSpaceTarget"
    title="创建同步空间"
    message="当前本机数据会在设备端加密后上传到同步空间。创建成功后将开启自动同步：联网时本机加密数据会在已绑定设备之间同步，离线时仍可本地使用。是否继续？"
    confirm-label="创建同步空间"
    @close="createSpaceTarget = false"
    @confirm="runCreateSpace"
  />

  <ConfirmDialog
    v-if="upgradeLegacyTarget"
    :open="upgradeLegacyTarget"
    title="升级为自动同步"
    message="将使用当前设备的数据创建新版同步空间；旧访问码和旧云端数据会保留不删除。是否继续？"
    confirm-label="升级"
    @close="upgradeLegacyTarget = false"
    @confirm="runUpgradeLegacy"
  />

  <ConfirmDialog
    v-if="recalibrateTarget"
    :open="recalibrateTarget"
    title="重新校准同步"
    message="重新校准前建议先导出本机备份。校准不会删除本机数据，但会要求重新查看远端与本机的首次合并结果。是否继续？"
    confirm-label="重新校准"
    @close="recalibrateTarget = false"
    @confirm="confirmRecalibrate"
  />

  <ConfirmDialog
    v-if="removeDeviceTarget"
    :open="Boolean(removeDeviceTarget)"
    title="移除设备"
    :message="`确定移除“${removeDeviceTarget?.name || ''}”吗？\n\n该设备之后无法继续同步，但设备上的本地数据不会自动删除；重新使用需再次绑定。`"
    confirm-label="移除设备"
    @close="removeDeviceTarget = null"
    @confirm="confirmRemoveDevice"
  />

  <ConfirmDialog
    v-if="restoreBackupTarget"
    :open="Boolean(restoreBackupTarget)"
    title="从备份恢复"
    message="恢复后将覆盖当前浏览器中的课程、重要日期和待办数据，是否继续？"
    confirm-label="确认恢复"
    @close="restoreBackupTarget = null"
    @confirm="confirmRestoreBackup"
  />
</template>

<style scoped>
/* 第三十七轮说明：本样式块曾因一次删除器 bug 被破坏，内容由删除前的构建产物
   （dist/assets 的编译 CSS，去掉 scope 属性后反压缩）整体重建，**原有注释在重建中丢失**。
   第三十八轮已按 scope 归属清掉其中属于别组件的同值副本。新增规则时请照常写注释。 */
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
.mobile-data-nav {
  display:none}
.data-section {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:var(--radius-12);
  align-items:flex-start;
  gap:13px;
  padding:14px;
  display:flex}
.local-note {
  color:var(--muted);
  font-size:var(--fs-12);
  line-height:1.55}
.device-name-row {
  background:var(--bg);
  border-radius:var(--radius-9);
  grid-template-columns:auto minmax(0,1fr) auto;
  align-items:center;
  gap:8px;
  width:100%;
  margin-top:4px;
  padding:9px;
  display:grid}
.device-name-row label {
  color:var(--muted);
  font-size:var(--fs-11)}
.device-name-row input {
  width:100%;
  min-width:0}
.sync-ops {
  border-top:1px dashed var(--border);
  width:100%;
  margin-top:2px;
  padding-top:9px}
.sync-status {
  background:var(--bg-tint);
  border-radius:var(--radius-8);
  margin-top:10px;
  padding:8px 10px;
  font-size:var(--fs-12);
  line-height:1.6}
.sync-status .muted {
  color:var(--muted)}
.sync-setting-row {
  border-bottom:1px solid var(--border);
  justify-content:space-between;
  align-items:center;
  gap:16px;
  padding:12px 2px;
  display:flex}
.sync-setting-row>div {
  flex-direction:column;
  gap:3px;
  min-width:0;
  display:flex}
.sync-setting-row b {
  color:var(--text);
  font-size:var(--fs-13)}
.sync-setting-row span {
  color:var(--muted);
  font-size:var(--fs-11);
  line-height:1.45}
.switch {
  width:48px;
  height:28px;
  color:var(--muted);
  border:1px solid var(--border);
  background:var(--bg);
  cursor:pointer;
  border-radius:var(--radius-pill);
  flex:none;
  justify-content:center;
  align-items:center;
  padding:2px;
  display:inline-flex}
.switch span {
  width:22px;
  height:22px;
  box-shadow:var(--shadow-sm);
  background:#fff;
  border-radius:var(--radius-circle);
  place-items:center;
  font-size:var(--fs-10);
  font-weight:var(--fw-800);
  display:grid}
.switch.on {
  color:#fff;
  background:#07805d;
  border-color:#07805d;
  justify-content:flex-end}
.switch.on span {
  color:#07805d}
.disconnect-confirm p {
  color:var(--ink-soft,#55607a);
  margin:0;
  font-size:var(--fs-13);
  line-height:1.6}
.confirm-body {
  flex-direction:column;
  gap:9px;
  display:flex}
.confirm-row {
  color:var(--ink-soft,#55607a);
  background:var(--bg);
  border-radius:var(--radius-8);
  grid-template-columns:92px minmax(0,1fr);
  align-items:baseline;
  gap:10px;
  padding:7px 10px;
  font-size:var(--fs-12-5);
  display:grid}
.confirm-row+.confirm-row {
  margin-top:-3px}
.confirm-row b {
  color:var(--text);
  font-variant-numeric:tabular-nums}
.restore-preview {
  border:1px solid color-mix(in srgb, var(--success) 35%, var(--card));
  background:color-mix(in srgb, var(--success) 10%, var(--card));
  border-radius:var(--radius-10);
  flex-wrap:wrap;
  align-items:center;
  gap:8px;
  padding:12px;
  font-size:var(--fs-12);
  display:flex}
.restore-preview b {
  text-overflow:ellipsis;
  white-space:nowrap;
  width:100%;
  overflow:hidden}
.restore-preview span {
  color:var(--success);
  background:color-mix(in srgb, var(--success) 10%, var(--card));
  border-radius:var(--radius-6);
  padding:4px 7px}
.restore-preview .btn {
  margin-left:auto}
.success {
  color:var(--success);
  font-size:var(--fs-13)}
.error {
  color:var(--danger);
  font-size:var(--fs-13)}
.local-note {
  padding:0 4px}
.ios-warning {
  color:var(--warning);
  margin-top:6px;
  display:block}
@media (max-width:520px) {
  .mobile-data-nav {
  z-index:3;
  border-bottom:1px solid var(--border);
  background:var(--card);
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:4px;
  margin:-14px -4px 0;
  padding:6px 4px;
  display:grid;
  position:sticky;
  top:-14px}
  .mobile-data-nav button {
  min-height:40px;
  color:var(--ink-soft);
  font:inherit;
  background:var(--bg);
  cursor:pointer;
  border:0;
  border-radius:var(--radius-8);
  place-items:center;
  padding:0;
  font-size:var(--fs-12);
  font-weight:var(--fw-700);
  display:grid}
  .mobile-data-nav button:active {
  color:var(--primary);
  background:var(--primary-soft)}
  /* 58px 要让开移动端顶部那条粘性导航：本组件里 `.data-section` 是跳转/定位的目标，
   没有这个 scroll-margin 时，锚点滚动会把章节标题压在粘性栏下面。
   tests/focusObscured.test.js 的 OFFSETS 就是登记这一条，删掉这个声明守卫会红。 */
  .data-section {
  gap:10px;
  padding:12px;
  scroll-margin-top:58px}
  .device-name-row {
  grid-template-columns:1fr auto}
  .device-name-row label {
  grid-column:1/-1}
  .sync-setting-row {
  align-items:flex-start}
  .sync-setting-row>div {
  max-width:calc(100% - 64px)}
}
</style>


