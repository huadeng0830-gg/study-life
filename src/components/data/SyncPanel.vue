<script setup>
import { nextTick, ref } from 'vue'
import { canUndoPull, cloudExists, connectionState, isSyncing, lastCheckedAt, lastError, lastLocalChangedAt, lastSyncedAt, remoteUpdatedAt, renameSyncDevice, syncCalibrationRequired, syncPreview, syncRelationship, syncRecovery, syncStatus, undoLastPull } from '../../composables/cloudSync.js'
import { SYNC_MODULES } from '../../composables/cloudSyncData.js'
import { deviceProfile, setDeviceName } from '../../composables/deviceIdentity.js'
import { autoSyncError, autoSyncState } from '../../composables/autoSyncCoordinator.js'
import { isSyncSpaceBound, syncSpaceBootstrapPending, syncSpaceSettings } from '../../composables/syncSpace.js'
import { localSafeMode } from '../../composables/localSafeMode.js'
import { useDataManagerStatus } from '../../composables/dataManagerStatus.js'
import { useDataManagerBackup } from '../../composables/dataManagerBackup.js'
import { useDataManagerPairing } from '../../composables/dataManagerPairing.js'
import { useDataManagerSyncActions } from '../../composables/dataManagerSyncActions.js'
import TaskProgress from '../TaskProgress.vue'

const { error, message, fmtTime, fullTime, compactTime, compactCheckTime, syncSummary, maskedSpaceId, deviceList, visibleDevices, hiddenDeviceCount, cloudSourceText, relationshipCopy, deviceIcon, devicePlatform, deviceActivity, showAllDevices } = useDataManagerStatus()
const { exportBackup } = useDataManagerBackup()
const {
  pairingBusy, pairingTokenBusy, joinBusy, codeInput, joinSpaceId, joinRecoverySecret,
  connectCode, confirmCreateSpace, confirmUpgradeLegacy, openPairingFlow, startClaimPairing,
  joinSpaceFlow, recalibrateBlocked, recalibrateCurrentSync, exportRecoveryInfo, removeDevice,
  copySpaceId, spaceCopied,
} = useDataManagerPairing()
const {
  immediateSync, syncMainActionLabel, syncActionBusy, doDisconnect, syncUiDisabled,
  requestDisconnect, requestPullConfirm, requestPushConfirm, runPreview, refreshCloudStatus,
  refreshingCloud, pullScopeKeys, selectedPullModules, allModulesSelected, selectedModuleCount,
  toggleAllModules, undoTitle, recoverSyncData, syncProgress, retrySync, continueSyncResult,
  runPrePushCheck, cancelJoinPreview, confirmJoin, previewChangeLabel,
} = useDataManagerSyncActions()

const editingDeviceName = ref(false)
const deviceNameEditor = ref(null)
const deviceNameInput = ref(deviceProfile.value.name)

// 设备菜单是自造的 <details> 浮层（不是共享 Modal）：键盘用户打开后必须能用 Escape 收起。
function onDeviceMenuKeydown(event) {
  if (event.key === 'Escape') event.currentTarget.open = false
}

function startDeviceNameEdit() {
  deviceNameInput.value = deviceProfile.value.name
  editingDeviceName.value = true
  nextTick(() => deviceNameEditor.value?.focus?.())
}

function cancelDeviceNameEdit() {
  deviceNameInput.value = deviceProfile.value.name
  editingDeviceName.value = false
}

async function saveCurrentDeviceName() {
  const nextName = String(deviceNameInput.value ?? '').trim().slice(0, 30)
  if (!nextName) {
    error.value = '设备名称不能为空'
    return
  }
  if (nextName === deviceProfile.value.name) {
    editingDeviceName.value = false
    return
  }
  if (isSyncSpaceBound.value && connectionState.value === 'connected') {
    const result = await renameSyncDevice(nextName)
    if (!result.ok) {
      error.value = result.error
      return
    }
  }
  setDeviceName(nextName)
  deviceNameInput.value = deviceProfile.value.name
  editingDeviceName.value = false
  error.value = ''
  message.value = `当前设备已命名为“${deviceProfile.value.name}”`
}
</script>

<template>
      <section id="data-sync" class="data-section">
        <div class="section-icon sync">☁</div>
        <div class="section-copy sync-section-copy">
          <h4>多设备同步</h4>
          <p>无需账号。创建或加入同步空间时会先明确确认；确认后才会建立绑定并开启自动同步。联网时设备端加密数据会在已绑定设备之间同步，离线时本机照常使用。</p>
          <template v-if="isSyncSpaceBound">
            <section class="sync-status-card" :data-tone="syncSummary.tone" aria-live="polite">
              <div class="sync-status-copy">
                <span class="status-kicker">同步状态</span>
                <h5>{{ syncSummary.title }}</h5>
                <p>{{ syncSummary.detail }}</p>
              </div>
              <div class="sync-status-meta">
                <span><i>最近同步</i><b :title="fullTime(lastSyncedAt)">{{ compactTime(lastSyncedAt) }}</b></span>
                <span><i>最后检查</i><b :title="fullTime(lastCheckedAt)">{{ compactCheckTime(lastCheckedAt) }}</b></span>
                <span><i>当前设备</i><b class="truncate" :title="deviceProfile.name">{{ deviceProfile.name }}</b></span>
              </div>
              <button class="btn btn-primary sync-main-action" :disabled="syncActionBusy || pairingBusy || joinBusy || syncCalibrationRequired || ['conflict', 'recovery-required', 'calibration-required', 'credential-invalid', 'permission-denied'].includes(autoSyncState) || ['credential-invalid', 'permission-denied'].includes(connectionState)" @click="immediateSync">{{ syncMainActionLabel }}</button>
              <button v-if="['credential-invalid', 'permission-denied'].includes(connectionState) || ['credential-invalid', 'permission-denied'].includes(autoSyncState)" type="button" class="text-button sync-rebind-action" @click="doDisconnect">重新绑定此设备</button>
            </section>

            <slot />

              <section class="sync-devices" aria-labelledby="sync-devices-title">
              <div class="section-line-head"><div><h5 id="sync-devices-title">已连接设备</h5><span>{{ deviceList.length }} 台</span></div><button type="button" class="btn btn-add-device" :disabled="syncUiDisabled || pairingBusy || pairingTokenBusy || joinBusy" @click="openPairingFlow">＋ 添加设备</button></div>
              <ul class="device-list">
                <li v-for="device in visibleDevices" :key="device.id" class="device-row">
                  <span class="device-icon" aria-hidden="true">{{ deviceIcon(device) }}</span>
                  <div class="device-copy"><strong :title="device.name">{{ device.name }}<em v-if="device.id === deviceProfile.id">本设备</em></strong><span>{{ device.id === deviceProfile.id ? '本设备 · ' : '' }}{{ devicePlatform(device) }} · {{ deviceActivity(device) }}</span></div>
                  <button v-if="device.id === deviceProfile.id" type="button" class="icon-button" aria-label="重命名当前设备" @click="startDeviceNameEdit">✎</button>
                   <details v-else class="device-menu" @keydown="onDeviceMenuKeydown"><summary aria-label="打开设备菜单">•••</summary><div class="device-menu-popover"><button type="button" :disabled="pairingBusy" @click="removeDevice(device)">{{ pairingBusy ? '正在处理…' : '移除设备' }}</button></div></details>
                </li>
              </ul>
              <button v-if="hiddenDeviceCount" type="button" class="text-button device-more" :aria-expanded="showAllDevices" @click="showAllDevices = !showAllDevices">{{ showAllDevices ? '收起设备' : `查看全部设备（还有 ${hiddenDeviceCount} 台）` }}</button>
              <form v-if="editingDeviceName" class="device-name-edit" @submit.prevent="saveCurrentDeviceName">
                <label for="sync-device-name">设备名称</label>
                <input id="sync-device-name" ref="deviceNameEditor" v-model="deviceNameInput" maxlength="30" autocomplete="off" placeholder="例如：我的 iPhone" @keydown.esc="cancelDeviceNameEdit" />
                <button type="button" class="btn btn-sm" @click="cancelDeviceNameEdit">取消</button><button type="submit" class="btn btn-sm btn-primary">保存</button>
              </form>
            </section>

            <section class="space-summary">
              <div><span>同步空间</span><code>{{ maskedSpaceId }}</code></div>
              <details><summary>查看</summary><div class="space-id-detail"><code>{{ syncSpaceSettings.spaceId }}</code><button type="button" class="text-button" @click="copySpaceId">{{ spaceCopied ? '已复制' : '复制编号' }}</button></div></details>
            </section>

            <details class="sync-advanced">
              <summary>高级同步与恢复</summary>
              <div class="advanced-content">
                <div v-if="syncCalibrationRequired" class="sync-recovery danger" role="alert">
                  <b>发现旧版不可靠同步基线</b>
                  <span>系统不会猜测本机或云端哪一份正确。请先导出本机备份，再重新查看初始协调结果。</span>
                  <div class="calibration-actions"><button type="button" class="btn" :disabled="joinBusy || isSyncing" @click="exportBackup">先导出本机备份</button><button type="button" class="btn btn-danger" :disabled="recalibrateBlocked" @click="recalibrateCurrentSync">重新校准此设备同步</button></div>
                </div>
                <div v-if="['interrupted', 'recovering', 'recovered', 'recovery-required'].includes(syncRecovery.status)" class="sync-recovery" :class="{ danger: syncRecovery.status === 'recovery-required' }" role="alert">
                  <b>{{ syncRecovery.status === 'recovery-required' ? '同步已暂停' : '同步恢复状态' }}</b>
                  <span>{{ syncRecovery.message }}</span>
                  <button v-if="syncRecovery.status === 'recovery-required'" type="button" class="btn btn-danger" :disabled="syncRecovery.status === 'recovering'" @click="recoverSyncData">恢复同步前数据</button>
                </div>

                <div class="advanced-group">
                  <h5>手动同步</h5>
                  <p>通常使用“立即同步”即可。需要精细控制时，可查看差异或选择数据范围。</p>
                  <div v-if="syncRelationship === 'both-changed' || syncRelationship === 'unknown'" class="conflict-guide" role="note">
                    <b>{{ syncRelationship === 'both-changed' ? '双方都有修改，需要你决定' : '暂时无法判断同步方向' }}</b>
                    <span>{{ syncRelationship === 'both-changed' ? '建议先查看差异；只有同一条记录两边都改过时才需要选择。' : '请查看更新时间与来源设备后，再手动选择。' }}</span>
                  <div><button type="button" class="btn btn-sm" :disabled="syncUiDisabled || syncCalibrationRequired || !cloudExists || !selectedModuleCount" @click="requestPullConfirm(pullScopeKeys)">以云端为准</button><button type="button" class="btn btn-sm btn-push" :disabled="syncUiDisabled || syncCalibrationRequired" @click="requestPushConfirm">以本机为准</button></div>
                  </div>
                  <div class="sync-actions">
                    <button class="btn" :disabled="syncUiDisabled || syncCalibrationRequired || !cloudExists || !selectedModuleCount" @click="runPreview">查看差异</button>
                    <button class="btn btn-pull" :disabled="syncUiDisabled || syncCalibrationRequired || !cloudExists || !selectedModuleCount" @click="requestPullConfirm(pullScopeKeys)">从云端拉取</button>
                    <button class="btn btn-push" :disabled="syncUiDisabled || syncCalibrationRequired" @click="requestPushConfirm">上传本机数据</button>
                    <button class="btn" :disabled="syncUiDisabled || refreshingCloud" @click="refreshCloudStatus">{{ refreshingCloud ? '正在刷新…' : '刷新云端状态' }}</button>
                    <button class="btn" :disabled="syncUiDisabled || !canUndoPull" :title="undoTitle" @click="undoLastPull">撤销上次拉取</button>
                  </div>
                  <details class="pull-scope-details">
                    <summary>选择从云端拉取的数据范围</summary>
                    <div class="pull-scope"><div class="pull-scope-head"><span class="ops-label">未勾选的模块保持原样</span><button type="button" class="scope-toggle" @click="toggleAllModules">{{ allModulesSelected ? '清空' : '全选' }}</button></div><div class="scope-grid"><label v-for="mod in SYNC_MODULES" :key="mod.key" class="scope-item"><input v-model="selectedPullModules" type="checkbox" :value="mod.key" /><span>{{ mod.label }}</span></label></div></div>
                  </details>
                  <span v-if="!canUndoPull" class="sync-hint">{{ undoTitle }}</span>
                  <p v-if="autoSyncError && ['error', 'retrying'].includes(autoSyncState)" class="sync-hint">{{ autoSyncError }}</p>
                </div>

                <div class="advanced-group recovery-actions">
                  <h5>恢复与迁移</h5>
                  <p>恢复信息可以让其它设备访问此同步空间，请像密码一样保存。</p>
                  <button class="btn" @click="exportRecoveryInfo">导出恢复信息</button>
                </div>

                <div class="advanced-group space-management">
                  <h5>同步空间管理</h5>
                  <p>停止后只影响本设备同步，本机数据不会删除；之后可再次绑定。</p>
                  <button class="btn btn-danger-text" :disabled="syncUiDisabled" @click="requestDisconnect">停止本设备同步</button>
                </div>

                <small>高级操作不会显示同步密钥或设备授权信息。</small>
              </div>
            </details>
          </template>
          <template v-else-if="connectionState === 'connected'">
            <section class="sync-empty-card legacy-card">
              <span class="status-kicker">旧版手动同步</span>
              <h5>已连接云端</h5>
              <p>当前连接仍可手动同步。升级为多设备同步后，手机和电脑可以自动保持一致。</p>
              <div class="space-actions"><button class="btn btn-primary" :disabled="pairingBusy || syncUiDisabled" @click="confirmUpgradeLegacy">升级为自动同步</button><button class="btn btn-danger-text" :disabled="syncUiDisabled" @click="requestDisconnect">断开云端连接</button></div>
            </section>
            <details class="sync-advanced setup-advanced"><summary>手动同步与数据范围</summary><div class="advanced-content"><div class="conn-times"><div class="relationship-state"><b>{{ relationshipCopy[0] }}</b><span>{{ relationshipCopy[1] }}</span></div><span>云端最后更新：<b>{{ fmtTime(remoteUpdatedAt) }}</b> · {{ cloudSourceText }}</span><span>本地最后更新：<b>{{ fmtTime(lastLocalChangedAt) }}</b></span></div><div class="sync-actions"><button class="btn" :disabled="syncUiDisabled || !cloudExists || !selectedModuleCount" @click="runPreview">查看差异</button><button class="btn btn-pull" :disabled="syncUiDisabled || !cloudExists || !selectedModuleCount" @click="requestPullConfirm(pullScopeKeys)">从云端拉取</button><button class="btn btn-push" :disabled="syncUiDisabled" @click="requestPushConfirm">上传本机数据</button><button class="btn" :disabled="syncUiDisabled" @click="runPrePushCheck">推送前预检</button></div><details class="pull-scope-details"><summary>选择从云端拉取的数据范围</summary><div class="pull-scope"><div class="pull-scope-head"><span class="ops-label">未勾选的模块保持原样</span><button type="button" class="scope-toggle" @click="toggleAllModules">{{ allModulesSelected ? '清空' : '全选' }}</button></div><div class="scope-grid"><label v-for="mod in SYNC_MODULES" :key="mod.key" class="scope-item"><input v-model="selectedPullModules" type="checkbox" :value="mod.key" /><span>{{ mod.label }}</span></label></div></div></details></div></details>
          </template>
          <template v-else>
            <section class="sync-empty-card">
              <span class="status-kicker">还没有连接设备</span>
              <h5>开始使用多设备同步</h5>
              <p>在此设备创建同步空间，或扫描另一台设备的绑定码。</p>
              <div class="space-actions"><button class="btn btn-primary" :disabled="localSafeMode || pairingBusy || joinBusy" @click="confirmCreateSpace">创建同步空间</button><button class="btn" :disabled="localSafeMode || pairingBusy || joinBusy" @click="startClaimPairing">扫描绑定码</button></div>
            </section>
            <details class="sync-advanced setup-advanced"><summary>使用恢复信息或旧版访问码</summary><div class="advanced-content"><div class="join-form"><input aria-label="同步空间编号" v-model="joinSpaceId" type="text" autocomplete="off" placeholder="同步空间编号" /><input aria-label="恢复信息" v-model="joinRecoverySecret" type="password" autocomplete="off" placeholder="恢复信息" /><button class="btn" :disabled="localSafeMode || joinBusy || !joinSpaceId || !joinRecoverySecret" @click="joinSpaceFlow">{{ joinBusy ? '正在验证…' : '使用恢复信息加入' }}</button></div><small>恢复信息只用于重新绑定当前设备，不会在页面显示密钥内容。</small><div class="advanced-group"><h5>旧版手动同步</h5><div class="sync-input-row"><input aria-label="6 位数字访问码" v-model="codeInput" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="6 位数字访问码" :disabled="localSafeMode || connectionState === 'validating' || isSyncing" @keydown.enter="connectCode" /><button class="btn" :disabled="localSafeMode || connectionState === 'validating' || isSyncing" @click="connectCode">{{ connectionState === 'validating' ? '正在验证…' : '连接云端' }}</button></div></div></div></details>
          </template>

          <TaskProgress
            v-if="isSyncSpaceBound && (syncProgress.state.active || syncProgress.state.status !== 'idle')"
            :task="syncProgress.state"
            :elapsed-seconds="syncProgress.elapsedSeconds.value"
            :activity-age-seconds="syncProgress.activityAgeSeconds.value"
            :stalled="syncProgress.isStalled.value"
            compact
            @cancel="syncProgress.cancel"
            @retry="retrySync"
            @continue="continueSyncResult"
            @wait="syncProgress.continueWaiting"
          />
          <span v-if="syncStatus === 'success' && !(syncProgress.state.active && syncProgress.state.visible)" class="success" role="status">{{ lastError }}</span>
          <span v-else-if="syncStatus === 'error' && !(syncProgress.state.active && syncProgress.state.visible)" class="error" role="alert">⚠ {{ lastError }}</span>
          <div v-if="syncPreview && isSyncSpaceBound" class="sync-preview-card"><b>{{ syncPreview.resolved ? '冲突已处理' : '最近一次同步预览' }}</b><span>新增 {{ syncPreview.summary.added }} · 变更 {{ syncPreview.summary.updated }} · 删除 {{ syncPreview.summary.deleted }} · 需确认 {{ syncPreview.conflicts.length }}</span><details v-if="syncPreview.changes?.length" class="sync-preview-details"><summary>展开查看变更明细</summary><ul><li v-for="change in syncPreview.changes" :key="`${change.key}:${change.entityId || change.status}`"><span>{{ change.label }}</span><small>{{ previewChangeLabel(change) }}</small></li></ul></details><small v-if="syncPreview.remoteDevice">云端来源：{{ syncPreview.remoteDevice.name }}</small></div>
          <div v-if="syncSpaceBootstrapPending" class="bootstrap-actions">
            <p>确认前不会修改本机业务数据；取消加入只会清除本机临时绑定。</p>
            <div><button type="button" class="btn" :disabled="joinBusy || isSyncing" @click="cancelJoinPreview">取消加入</button><button type="button" class="btn btn-primary" :disabled="localSafeMode || joinBusy || isSyncing || syncPreview?.conflicts?.length" @click="confirmJoin">{{ cloudExists ? '确认应用合并结果' : '使用本机初始化云端' }}</button></div>
          </div>
        </div>
      </section>
</template>

<style scoped>
.section-icon {
  width:38px;
  height:38px;
  color:var(--primary);
  background:var(--primary-soft);
  border-radius:var(--radius-10);
  flex:0 0 38px;
  place-items:center;
  font-size:var(--fs-20);
  font-weight:var(--fw-800);
  display:grid}
.section-icon.sync {
  color:#0e7490;
  background:#e0f7ff}
.section-copy {
  flex-direction:column;
  align-items:flex-start;
  gap:7px;
  display:flex}
.section-copy h4 {
  font-size:var(--fs-14)}
.section-copy p {
  color:var(--muted);
  font-size:var(--fs-12);
  line-height:1.55}
.sync-input-row {
  gap:8px;
  margin:8px 0;
  display:flex}
.sync-input-row input {
  border:1px solid var(--border);
  text-align:center;
  letter-spacing:.2em;
  border-radius:var(--radius-8);
  flex:1;
  padding:8px 10px;
  font-size:var(--fs-14)}
.sync-hint {
  color:var(--ink-faint);
  font-size:var(--fs-11);
  line-height:1.5}
.conn-times {
  width:100%;
  color:var(--ink-soft,#55607a);
  background:var(--bg);
  border-radius:var(--radius-9);
  flex-direction:column;
  gap:4px;
  padding:9px 11px;
  font-size:var(--fs-11-5);
  line-height:1.5;
  display:flex}
.conn-times b {
  font-variant-numeric:tabular-nums;
  font-weight:var(--fw-700)}
.conn-times i {
  color:var(--ink-faint);
  font-style:normal}
.relationship-state {
  border-bottom:1px solid var(--border);
  flex-direction:column;
  gap:2px;
  padding-bottom:5px;
  display:flex}
.relationship-state b {
  color:var(--text)}
.relationship-state span {
  color:var(--muted)}
.conflict-guide {
  border:1px solid color-mix(in srgb, var(--warning) 35%, var(--card));
  background:color-mix(in srgb, var(--warning) 10%, var(--card));
  color:var(--warning);
  border-radius:var(--radius-9);
  flex-direction:column;
  gap:6px;
  margin-top:10px;
  padding:10px 12px;
  font-size:var(--fs-12);
  line-height:1.55;
  display:flex}
.conflict-guide span {
  color:var(--warning)}
.conflict-guide>div {
  flex-wrap:wrap;
  gap:6px;
  display:flex}
.conflict-guide .btn {
  min-height:30px}
.ops-label {
  color:var(--ink-faint);
  letter-spacing:.08em;
  font-size:var(--fs-10);
  font-weight:var(--fw-800)}
.pull-scope {
  border:1px dashed var(--border);
  background:var(--bg);
  border-radius:var(--radius-9);
  flex-direction:column;
  gap:7px;
  width:100%;
  padding:9px 10px;
  display:flex}
.pull-scope-head {
  justify-content:space-between;
  align-items:center;
  gap:8px;
  display:flex}
.scope-toggle {
  min-height:30px;
  color:var(--primary);
  background:var(--primary-soft);
  border:none;
  border-radius:var(--radius-8);
  padding:3px 10px;
  font-size:var(--fs-11-5);
  font-weight:var(--fw-700)}
.scope-grid {
  grid-template-columns:repeat(auto-fill,minmax(132px,1fr));
  gap:6px;
  display:grid}
.scope-item {
  min-height:40px;
  color:var(--text);
  cursor:pointer;
  border:1px solid var(--border);
  background:var(--card);
  border-radius:var(--radius-8);
  align-items:center;
  gap:7px;
  padding:4px 8px;
  font-size:var(--fs-12-5);
  display:flex}
.scope-item input {
  accent-color:var(--primary)}
.sync-actions {
  flex-wrap:wrap;
  gap:8px;
  margin-top:7px;
  display:flex}
.btn-pull {
  color:var(--primary);
  background:var(--primary-soft)}
.btn-pull:hover:not(:disabled) {
  background:color-mix(in srgb, var(--primary) 6%, var(--card));
  box-shadow:0 3px 10px color-mix(in srgb, var(--primary) 24%, transparent)}
.btn-push {
  color:var(--success);
  background:color-mix(in srgb, var(--success) 10%, var(--card))}
.btn-push:hover:not(:disabled) {
  background:color-mix(in srgb, var(--success) 14%, var(--card))}
.sync-recovery {
  color:var(--success);
  border:1px solid color-mix(in srgb, var(--success) 35%, var(--card));
  background:color-mix(in srgb, var(--success) 10%, var(--card));
  border-radius:var(--radius-9);
  flex-direction:column;
  gap:5px;
  margin:10px 0;
  padding:10px 12px;
  font-size:var(--fs-12);
  display:flex}
.sync-recovery.danger {
  color:var(--danger);
  background:color-mix(in srgb, var(--danger) 8%, var(--card));
  border-color:#f2c4c4}
.calibration-actions {
  flex-wrap:wrap;
  gap:7px;
  margin-top:3px;
  display:flex}
.sync-preview-card {
  color:#236175;
  background:#f1fbfe;
  border:1px solid #b9ddea;
  border-radius:var(--radius-9);
  flex-wrap:wrap;
  gap:6px 12px;
  margin-top:9px;
  padding:9px 11px;
  font-size:var(--fs-11);
  line-height:1.5;
  display:flex}
.sync-preview-card small {
  color:#4a6b78;
  width:100%}
.sync-preview-details {
  color:#236175;
  width:100%}
.sync-preview-details summary {
  cursor:pointer}
.sync-preview-details ul {
  gap:4px;
  margin:6px 0 0;
  padding-left:18px;
  display:grid}
.sync-preview-details li {
  justify-content:space-between;
  gap:10px;
  display:flex}
.sync-preview-details li small {
  color:#5d8290;
  width:auto}
.space-actions {
  flex-wrap:wrap;
  gap:7px;
  display:flex}
.join-form {
  grid-template-columns:1fr 1.3fr auto;
  gap:7px;
  display:grid}
.join-form input {
  border:1px solid var(--border);
  background:var(--card);
  min-width:0;
  color:var(--text);
  border-radius:var(--radius-8);
  padding:8px 9px;
  font-size:var(--fs-11)}
.sync-section-copy {
  width:100%;
  min-width:0}
.sync-status-card {
  border:1px solid color-mix(in srgb, var(--success) 35%, var(--card));
  background:color-mix(in srgb, var(--success) 6%, var(--card));
  border-radius:var(--radius-12);
  grid-template-columns:minmax(0,1fr) auto;
  gap:10px 18px;
  min-height:142px;
  padding:16px;
  display:grid}
.sync-status-card[data-tone=pending],.sync-status-card[data-tone=offline],.sync-status-card[data-tone=warning] {
  border-color:color-mix(in srgb, var(--warning) 35%, var(--card));
  background:color-mix(in srgb, var(--warning) 6%, var(--card))}
.sync-status-card[data-tone=danger] {
  background:#fff6f5;
  border-color:#efc3c3}
.sync-status-card[data-tone=working] {
  background:#f7f9ff;
  border-color:#c8d7fb}
.sync-status-card[data-tone=neutral] {
  border-color:var(--border);
  background:var(--bg)}
.sync-status-copy {
  min-width:0}
.status-kicker {
  color:var(--muted);
  letter-spacing:.08em;
  margin-bottom:5px;
  font-size:var(--fs-10);
  font-weight:var(--fw-800);
  display:block}
.sync-status-copy h5,.sync-empty-card h5 {
  color:var(--text);
  margin:0;
  font-size:var(--fs-21);
  line-height:1.2}
.sync-status-copy p,.sync-empty-card p {
  color:var(--muted);
  margin:6px 0 0;
  font-size:var(--fs-12);
  line-height:1.55}
.sync-status-meta {
  align-content:start;
  gap:7px;
  min-width:142px;
  display:grid}
.sync-status-meta span {
  flex-direction:column;
  gap:2px;
  min-width:0;
  display:flex}
.sync-status-meta i {
  color:var(--muted);
  font-size:var(--fs-10);
  font-style:normal}
.sync-status-meta b {
  color:var(--text);
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:var(--fs-12);
  font-weight:var(--fw-700);
  overflow:hidden}
.sync-main-action {
  grid-column:1/-1;
  justify-self:start;
  min-width:128px}
.sync-rebind-action {
  grid-column:1/-1;
  justify-self:start}
.sync-devices {
  padding-top:12px}
.section-line-head {
  justify-content:space-between;
  align-items:center;
  gap:12px;
  display:flex}
.section-line-head>div {
  align-items:baseline;
  gap:8px;
  min-width:0;
  display:flex}
.section-line-head h5,.advanced-group h5 {
  color:var(--text);
  margin:0;
  font-size:var(--fs-14)}
.section-line-head span {
  color:var(--muted);
  font-size:var(--fs-11)}
.text-button {
  color:var(--primary);
  cursor:pointer;
  background:0 0;
  border:0;
  padding:4px 0;
  font-size:var(--fs-12);
  font-weight:var(--fw-800)}
.text-button:disabled {
  color:var(--ink-faint,#a4adbd);
  cursor:not-allowed}
.btn-add-device {
  color:var(--primary);
  border:1px solid var(--border-strong);
  background:var(--primary-soft);
  flex:none;
  padding:7px 11px}
.btn-add-device:hover:not(:disabled) {
  background:color-mix(in srgb, var(--primary) 6%, var(--card));
  box-shadow:0 3px 10px color-mix(in srgb, var(--primary) 24%, transparent)}
.device-list {
  gap:0;
  margin:5px 0 0;
  padding:0;
  list-style:none;
  display:grid}
.device-row {
  border-top:1px solid var(--border);
  grid-template-columns:auto minmax(0,1fr) auto;
  align-items:center;
  gap:10px;
  min-width:0;
  padding:11px 0;
  display:grid;
  position:relative}
.device-icon {
  background:var(--bg);
  border-radius:var(--radius-9);
  flex:0 0 32px;
  place-items:center;
  width:32px;
  height:32px;
  font-size:var(--fs-17);
  display:grid}
.device-copy {
  flex-direction:column;
  gap:3px;
  min-width:0;
  display:flex}
.device-copy strong {
  min-width:0;
  color:var(--text);
  text-overflow:ellipsis;
  white-space:nowrap;
  align-items:center;
  gap:6px;
  font-size:var(--fs-13);
  display:flex;
  overflow:hidden}
.device-copy strong em {
  color:var(--success);
  background:color-mix(in srgb, var(--success) 10%, var(--card));
  border-radius:var(--radius-5);
  flex:none;
  padding:2px 5px;
  font-size:var(--fs-9);
  font-style:normal;
  font-weight:var(--fw-800)}
.device-copy>span {
  color:var(--muted);
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:var(--fs-10-5);
  overflow:hidden}
.icon-button {
  width:30px;
  height:30px;
  color:var(--primary);
  background:var(--primary-soft);
  cursor:pointer;
  border:0;
  border-radius:var(--radius-7);
  font-size:var(--fs-15)}
.device-menu {
  align-self:center;
  position:relative}
.device-menu summary {
  width:32px;
  height:30px;
  color:var(--muted);
  cursor:pointer;
  border-radius:var(--radius-7);
  place-items:center;
  font-size:var(--fs-15);
  line-height:1;
  list-style:none;
  display:grid}
.device-menu summary::-webkit-details-marker {
  display:none}
.device-menu summary:hover,.device-menu[open] summary {
  color:var(--text);
  background:var(--bg)}
.device-menu-popover {
  z-index:3;
  border:1px solid var(--border);
  background:var(--card);
  min-width:112px;
  box-shadow:var(--shadow-md);
  border-radius:var(--radius-8);
  padding:4px;
  position:absolute;
  top:calc(100% + 4px);
  right:0}
.device-menu-popover button {
  width:100%;
  color:var(--danger);
  text-align:left;
  cursor:pointer;
  background:0 0;
  border:0;
  border-radius:var(--radius-6);
  padding:7px 9px;
  font-size:var(--fs-11)}
.device-menu-popover button:hover {
  background:color-mix(in srgb, var(--danger) 8%, var(--card))}
.device-more {
  margin:4px auto 0;
  display:block}
.device-name-edit {
  background:var(--bg);
  border-radius:var(--radius-9);
  grid-template-columns:auto minmax(0,1fr) auto auto;
  align-items:center;
  gap:7px;
  margin-top:3px;
  padding:9px;
  display:grid}
.device-name-edit label {
  color:var(--muted);
  font-size:var(--fs-11)}
.device-name-edit input {
  width:100%;
  min-width:0}
.space-summary {
  border-top:1px solid var(--border);
  border-bottom:1px solid var(--border);
  justify-content:space-between;
  align-items:center;
  gap:12px;
  padding:12px 0;
  display:flex}
.space-summary>div {
  flex-direction:column;
  gap:3px;
  min-width:0;
  display:flex}
.space-summary span {
  color:var(--muted);
  font-size:var(--fs-10)}
.space-summary code,.space-id-detail code {
  overflow-wrap:anywhere;
  color:var(--ink-soft,#55607a);
  letter-spacing:.08em;
  font-size:var(--fs-11)}
.space-summary details {
  flex:none;
  position:relative}
.space-summary summary,.pull-scope-details summary,.sync-advanced>summary {
  color:var(--primary);
  cursor:pointer;
  font-size:var(--fs-12);
  font-weight:var(--fw-800)}
.space-summary summary {
  list-style:none}
.space-summary summary::-webkit-details-marker {
  display:none}
.space-id-detail {
  z-index:3;
  border:1px solid var(--border);
  background:var(--card);
  min-width:220px;
  box-shadow:var(--shadow-md);
  border-radius:var(--radius-8);
  align-items:center;
  gap:10px;
  padding:9px 10px;
  display:flex;
  position:absolute;
  top:calc(100% + 7px);
  right:0}
.sync-advanced {
  border-bottom:1px solid var(--border)}
.sync-advanced>summary {
  padding:13px 0;
  list-style-position:inside}
.advanced-content {
  gap:13px;
  padding:0 0 13px;
  display:grid}
.advanced-group {
  border-top:1px solid var(--border);
  gap:7px;
  padding-top:12px;
  display:grid}
.advanced-group:first-child {
  border-top:0;
  padding-top:0}
.advanced-group p {
  color:var(--muted);
  margin:0;
  font-size:var(--fs-11);
  line-height:1.55}
.pull-scope-details {
  margin-top:4px}
.pull-scope-details>summary {
  padding:4px 0;
  font-size:var(--fs-11);
  display:inline-block}
.pull-scope-details .pull-scope {
  margin-top:5px}
.btn-danger-text {
  color:var(--danger);
  background:0 0}
.btn-danger-text:hover:not(:disabled) {
  background:color-mix(in srgb, var(--danger) 8%, var(--card))}
.sync-empty-card {
  border:1px solid var(--border);
  background:var(--bg);
  border-radius:var(--radius-12);
  gap:5px;
  padding:16px;
  display:grid}
.sync-empty-card .space-actions {
  margin-top:7px}
.legacy-card {
  background:#f7f9ff;
  border-color:#c8d7fb}
@media (max-width:760px) {
  .space-actions,.join-form {
  grid-template-columns:1fr;
  display:grid}
  .space-actions .btn {
  width:100%}
}
.success {
  color:var(--success);
  font-size:var(--fs-13)}
.error {
  color:var(--danger);
  font-size:var(--fs-13)}
@media (max-width:520px) {
  .section-icon {
  flex-basis:32px;
  width:32px;
  height:32px;
  font-size:var(--fs-17)}
  .section-copy {
  width:100%;
  min-width:0}
  .sync-input-row {
  flex-direction:column;
  width:100%}
  .sync-input-row .btn {
  width:100%}
  .sync-actions {
  grid-template-columns:1fr;
  width:100%;
  display:grid}
  .sync-status-card {
  grid-template-columns:minmax(0,1fr);
  gap:11px;
  min-height:0;
  padding:14px}
  .sync-status-meta {
  grid-template-columns:repeat(2,minmax(0,1fr));
  min-width:0}
  .sync-main-action {
  width:100%}
  .device-name-edit {
  grid-template-columns:1fr auto auto}
  .device-name-edit label {
  grid-column:1/-1}
  .device-copy>span {
  white-space:normal}
  .space-id-detail {
  min-width:min(250px,100vw - 76px);
  right:-4px}
}</style>
