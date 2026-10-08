<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { APP_RELEASE } from '../../composables/releaseNotes.js'
import {
  appUpdateProgress, checkForAppUpdate, forceRecoverToLatest, lastCheckedAt, lastCheckOutcome,
  needsManualReload, reloadAppToApplyUpdate, retryAppUpdate, updateChecking, updateMessage, updateStage, updateTone,
} from '../../composables/appUpdate.js'
import { announce, announceAlert } from '../../composables/liveRegion.js'
import {
  checkDesktopAppUpdate, desktopUpdateState, downloadDesktopAppUpdate, installDesktopAppUpdate,
  isDesktopApp, subscribeToDesktopUpdateState,
} from '../../composables/desktopAppUpdate.js'
import TaskProgress from '../TaskProgress.vue'
import ReleaseNotesBrowser from '../ReleaseNotesBrowser.vue'

// 【不要再拿中文文案反推语气与出口】
// 原来这里是 `if (/失败/.test(updateMessage.value)) return 'error'`，按钮则靠
// `updateMessage.includes('重新加载页面')`。改一句提示就会改配色，还会把**唯一
// 的手动重载出口**删掉。现在语气读 updateTone，出口读 needsManualReload。
const recovering = ref(false)
const notesOpen = ref(false)
let unsubscribeDesktopUpdates = () => {}

onMounted(() => {
  if (isDesktopApp) unsubscribeDesktopUpdates = subscribeToDesktopUpdateState()
})
onBeforeUnmount(() => unsubscribeDesktopUpdates())

const currentLastCheckedAt = computed(() => (
  isDesktopApp ? desktopUpdateState.value.lastCheckedAt : lastCheckedAt.value
))
const checkBusy = computed(() => (
  isDesktopApp
    ? ['checking', 'downloading', 'installing'].includes(desktopUpdateState.value.stage)
    : updateChecking.value
))
const currentVersionLabel = computed(() => (
  isDesktopApp ? desktopUpdateState.value.currentVersion || '桌面版' : APP_RELEASE
))
const checkButtonLabel = computed(() => {
  if (!isDesktopApp) return updateChecking.value ? '正在检查…' : '检查更新'
  if (desktopUpdateState.value.stage === 'checking') return '正在检查…'
  if (desktopUpdateState.value.stage === 'downloading') return '正在下载…'
  if (desktopUpdateState.value.stage === 'installing') return '正在安装…'
  return '检查更新'
})

const lastCheckText = computed(() => {
  if (!currentLastCheckedAt.value) return ''
  const checkedAt = new Date(currentLastCheckedAt.value)
  if (!Number.isFinite(checkedAt.getTime())) return ''
  const today = checkedAt.toDateString() === new Date().toDateString()
  const day = today ? '今天' : checkedAt.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  const time = checkedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return `上次检查 ${day} ${time}`
})
const statusLabel = computed(() => {
  if (isDesktopApp) {
    const labels = {
      idle: '自动更新已开启',
      checking: '检查中',
      latest: '已是最新',
      available: '发现新版本',
      downloading: '正在下载',
      ready: '新版已就绪',
      installing: '正在安装',
      error: '检查失败',
      unavailable: '更新暂不可用',
    }
    return labels[desktopUpdateState.value.stage] || '自动更新已开启'
  }
  if (updateChecking.value) return '检查中'
  if (needsManualReload.value) return '新版待应用'
  const labels = {
    available: '发现新版本',
    downloading: '正在下载新版本',
    ready: '新版本已准备',
    updating: '正在启用新版本',
    latest: '已是最新',
    warning: '需要留意',
    error: '检查失败',
  }
  if (labels[updateStage.value]) return labels[updateStage.value]
  if (lastCheckOutcome.value === '已是最新版本') return '已是最新'
  if (lastCheckOutcome.value === '检查失败') return '检查失败'
  return '自动检查已开启'
})
const statusTone = computed(() => {
  if (isDesktopApp) {
    if (desktopUpdateState.value.stage === 'error' || desktopUpdateState.value.stage === 'unavailable') return 'error'
    if (['latest', 'ready', 'installing'].includes(desktopUpdateState.value.stage)) return 'success'
    if (desktopUpdateState.value.stage === 'available') return 'warning'
    return 'info'
  }
  if (updateTone.value === 'error' || lastCheckOutcome.value === '检查失败') return 'error'
  if (updateTone.value === 'warning') return 'warning'
  if (updateTone.value === 'success' || lastCheckOutcome.value === '已是最新版本') return 'success'
  return 'info'
})
const statusGlyph = computed(() => {
  if (isDesktopApp) {
    if (statusTone.value === 'error' || statusTone.value === 'warning') return statusTone.value === 'error' ? '!' : '↓'
    if (statusTone.value === 'success') return '✓'
    if (['checking', 'downloading', 'installing'].includes(desktopUpdateState.value.stage)) return '↻'
    return '·'
  }
  if (statusTone.value === 'error' || statusTone.value === 'warning') return '!'
  if (statusTone.value === 'success') return '✓'
  if (updateChecking.value || ['available', 'downloading', 'ready', 'updating'].includes(updateStage.value)) return '↻'
  return '·'
})
const statusDetail = computed(() => (
  isDesktopApp
    ? desktopUpdateState.value.message || '应用启动后会自动检查桌面版本；你也可以手动检查。'
    : updateMessage.value || lastCheckOutcome.value || '应用启动和联网时会自动检查；你也可以随时手动检查。'
))
const lastCheckedIso = computed(() => {
  const timestamp = Number(currentLastCheckedAt.value)
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : undefined
})

function checkUpdates() {
  return isDesktopApp ? checkDesktopAppUpdate() : checkForAppUpdate()
}

function downloadDesktopUpdate() {
  return downloadDesktopAppUpdate()
}

function installDesktopUpdate() {
  return installDesktopAppUpdate()
}

// 这段提示是 v-if 插入的"新节点带内容"，VoiceOver 可能一个字都不播（见 liveRegion.js）。
// 视觉照旧保留，发声交给常驻通道：语气决定走礼貌还是紧急。
// 记上次文本是为了不重复播报同一句话。
let lastSpoken = ''
watch(updateMessage, (message) => {
  if (!message || message === lastSpoken) return
  lastSpoken = message
  if (updateTone.value === 'error' || updateTone.value === 'warning') announceAlert(message)
  else announce(message)
})
watch(() => desktopUpdateState.value.message, (message) => {
  if (!isDesktopApp || !message || message === lastSpoken) return
  lastSpoken = message
  if (desktopUpdateState.value.stage === 'error') announceAlert(message)
  else announce(message)
})

// 强制恢复是异常时的自助修复入口；常规更新保持一键检查，避免误清理资源缓存。
async function recoverToLatest() {
  if (recovering.value) return
  recovering.value = true
  announce('正在强制获取最新版本，请稍候…')
  try {
    const ok = await forceRecoverToLatest()
    if (!ok) announceAlert('暂时无法强制更新，请关闭应用后重新打开。')
  } finally {
    recovering.value = false
  }
}
</script>

<template>
  <section class="version-update-section">
    <div class="update-overview">
      <div class="section-icon update" :class="`is-${statusTone}`" aria-hidden="true">{{ statusGlyph }}</div>
      <div class="section-copy">
        <div class="update-heading">
          <div class="version-heading">
            <span class="version-caption">当前版本</span>
            <span class="version-badge">{{ currentVersionLabel }}</span>
          </div>
          <span class="update-status" :class="`is-${statusTone}`">{{ statusLabel }}</span>
        </div>
        <p class="update-detail">{{ statusDetail }}</p>
        <time v-if="lastCheckText" class="update-last-check" :datetime="lastCheckedIso">{{ lastCheckText }}</time>
      </div>
    </div>
    <div class="update-actions">
      <button v-if="isDesktopApp && desktopUpdateState.stage === 'available'" type="button" class="btn btn-primary" @click="downloadDesktopUpdate">下载新版本</button>
      <button v-if="isDesktopApp && desktopUpdateState.stage === 'ready'" type="button" class="btn btn-primary" @click="installDesktopUpdate">重启并安装</button>
      <button v-if="!isDesktopApp && needsManualReload" type="button" class="btn btn-primary" @click="reloadAppToApplyUpdate">立即重新加载</button>
      <button type="button" class="btn btn-primary" :disabled="checkBusy" :aria-busy="checkBusy" @click="checkUpdates">
        {{ checkButtonLabel }}
      </button>
      <button type="button" class="btn" @click="notesOpen = true">查看更新记录</button>
    </div>
    <div
      v-if="isDesktopApp && desktopUpdateState.stage === 'downloading'"
      class="desktop-update-progress"
      role="progressbar"
      aria-label="下载桌面更新"
      :aria-valuenow="desktopUpdateState.percent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span class="desktop-update-progress-track"><i :style="{ width: `${desktopUpdateState.percent}%` }"></i></span>
      <b>{{ desktopUpdateState.percent }}%</b>
    </div>
    <TaskProgress
      v-if="!isDesktopApp && appUpdateProgress.state.active && appUpdateProgress.state.visible"
      :task="appUpdateProgress.state"
      :elapsed-seconds="appUpdateProgress.elapsedSeconds.value"
      :activity-age-seconds="appUpdateProgress.activityAgeSeconds.value"
      :stalled="appUpdateProgress.isStalled.value"
      compact
      @retry="retryAppUpdate"
      @wait="appUpdateProgress.continueWaiting"
    />
    <details v-if="!isDesktopApp" class="update-recovery">
      <summary>版本异常或更新卡住？</summary>
      <div class="update-recovery-content">
        <p>修复会重建应用资源缓存并重新加载，不会删除本机课程、待办或账本记录。</p>
        <button type="button" class="btn" :disabled="recovering || updateChecking" :aria-busy="recovering" @click="recoverToLatest">
          {{ recovering ? '正在修复…' : '修复更新缓存' }}
        </button>
      </div>
    </details>
  </section>
  <ReleaseNotesBrowser :open="notesOpen" @close="notesOpen = false" />
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
.version-update-section {
  display:grid;
  gap:14px;
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:var(--radius-12);
  padding:16px}
.update-overview { display:grid; grid-template-columns:38px minmax(0, 1fr); align-items:start; gap:13px; }
.section-icon.update {
  color:var(--primary);
  background:color-mix(in srgb, var(--primary) 10%, var(--card))}
.section-icon.update.is-success { color:var(--success); background:color-mix(in srgb, var(--success) 11%, var(--card)); }
.section-icon.update.is-warning { color:var(--warning); background:color-mix(in srgb, var(--warning) 12%, var(--card)); }
.section-icon.update.is-error { color:var(--danger); background:color-mix(in srgb, var(--danger) 10%, var(--card)); }
.update-last-check {
  color:var(--ink-faint);
  font-size:var(--fs-11)}
.update-actions { display:flex; flex-wrap:wrap; gap:8px; }
.update-actions .btn { flex:0 1 auto; min-height:40px; }
.desktop-update-progress { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:10px; color:var(--ink-soft); font-size:var(--fs-11); font-variant-numeric:tabular-nums; }
.desktop-update-progress-track { display:block; height:8px; overflow:hidden; border-radius:var(--radius-pill); background:var(--border); }
.desktop-update-progress-track i { display:block; height:100%; border-radius:inherit; background:var(--primary); transition:width var(--dur-fast, 150ms) var(--ease-standard, ease); }
.desktop-update-progress b { min-width:34px; color:var(--ink); text-align:right; }
.section-copy {
  flex-direction:column;
  align-items:flex-start;
  gap:7px;
  display:flex}
.section-copy h4 {
  font-size:var(--fs-14)}
.update-heading {
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:8px}
.version-heading { display:flex; min-width:0; flex-wrap:wrap; align-items:center; gap:8px; }
.version-caption { color:var(--muted); font-size:var(--fs-12); font-weight:var(--fw-600); }
.version-badge {
  max-width:100%;
  color:var(--primary);
  background:var(--primary-soft);
  border:1px solid color-mix(in srgb, var(--primary) 18%, var(--card));
  border-radius:var(--radius-pill);
  font-variant-numeric:tabular-nums;
  padding:4px 9px;
  font-size:var(--fs-10-5);
  font-weight:var(--fw-750)}
.section-copy p {
  color:var(--muted);
  font-size:var(--fs-12);
  line-height:1.55}
.section-copy .update-detail { color:var(--ink-soft); }
.update-status { display:inline-flex; align-items:center; min-height:24px; padding:3px 9px; border-radius:var(--radius-pill); color:var(--primary); background:var(--primary-soft); font-size:var(--fs-10-5); font-weight:var(--fw-700); white-space:nowrap; }
.update-status.is-success { color:var(--success); background:color-mix(in srgb, var(--success) 11%, var(--card)); }
.update-status.is-warning { color:var(--warning); background:color-mix(in srgb, var(--warning) 12%, var(--card)); }
.update-status.is-error { color:var(--danger); background:color-mix(in srgb, var(--danger) 10%, var(--card)); }
.update-recovery { padding-top:11px; border-top:1px solid var(--border); }
.update-recovery summary { color:var(--muted); font-size:var(--fs-12); font-weight:var(--fw-600); cursor:pointer; }
.update-recovery-content { display:grid; justify-items:start; gap:8px; padding-top:9px; }
.update-recovery-content p { margin:0; color:var(--muted); font-size:var(--fs-11); line-height:1.5; }
@media (max-width:520px) {
  .section-icon {
    flex-basis:32px;
    width:32px;
    height:32px;
    font-size:var(--fs-17)}
  .section-copy {
    width:100%;
    min-width:0}
  .version-update-section { gap:13px; padding:13px; }
  .update-overview { grid-template-columns:32px minmax(0, 1fr); gap:10px; }
  .update-heading { align-items:flex-start; }
  .update-actions { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .update-actions .btn { width:100%; min-width:0; min-height:44px; padding-inline:8px; }
  .update-actions .btn-primary { grid-column:1 / -1; }
}</style>
