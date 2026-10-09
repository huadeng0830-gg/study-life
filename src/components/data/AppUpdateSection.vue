<script setup>
import ActionButton from '../ActionButton.vue'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const loadReleaseNotesBrowser = () => import('../ReleaseNotesBrowser.vue')
const ReleaseNotesBrowser = defineAsyncComponent(loadReleaseNotesBrowser)

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
  recovering.value || (isDesktopApp
    ? ['checking', 'downloading', 'installing'].includes(desktopUpdateState.value.stage)
    : updateChecking.value || ['downloading', 'ready', 'updating'].includes(updateStage.value))
))
const hasApplyAction = computed(() => (
  isDesktopApp ? ['available', 'ready'].includes(desktopUpdateState.value.stage) : needsManualReload.value
))
const currentVersionLabel = computed(() => (
  isDesktopApp ? desktopUpdateState.value.currentVersion || '桌面版' : APP_RELEASE
))
const checkButtonLabel = computed(() => {
  if (recovering.value) return '正在修复…'
  if (!isDesktopApp) {
    if (updateStage.value === 'downloading') return '正在下载…'
    if (['ready', 'updating'].includes(updateStage.value)) return '正在应用…'
    if (updateChecking.value) return '正在检查…'
    return ['warning', 'error'].includes(updateStage.value) ? '重新检查' : '检查更新'
  }
  if (desktopUpdateState.value.stage === 'checking') return '正在检查…'
  if (desktopUpdateState.value.stage === 'downloading') return '正在下载…'
  if (desktopUpdateState.value.stage === 'installing') return '正在安装…'
  return ['error', 'unavailable'].includes(desktopUpdateState.value.stage) ? '重新检查' : '检查更新'
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
  if (needsManualReload.value) return '新版待应用'
  const labels = {
    available: '发现新版本',
    downloading: '正在下载新版本',
    ready: '新版本已准备',
    updating: '正在启用新版本',
    latest: '已是最新',
    warning: '需要留意',
    error: '检查失败',
    checking: '检查中',
  }
  if (labels[updateStage.value]) return labels[updateStage.value]
  if (updateChecking.value) return '检查中'
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
  if (needsManualReload.value) return 'warning'
  if (updateChecking.value || updateStage.value !== 'idle') return updateTone.value
  if (lastCheckOutcome.value === '检查失败') return 'error'
  if (lastCheckOutcome.value === '已是最新版本') return 'success'
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
  if (checkBusy.value) return
  return isDesktopApp ? checkDesktopAppUpdate() : checkForAppUpdate()
}

function warmReleaseNotes() {
  void loadReleaseNotesBrowser().catch(() => {})
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
  <section class="version-update-section" aria-label="应用版本与更新状态">
    <header class="update-heading">
      <div class="version-heading">
        <span class="version-caption">当前版本</span>
        <strong class="version-badge">{{ currentVersionLabel }}</strong>
      </div>
      <span class="update-platform">{{ isDesktopApp ? '桌面版' : '网页应用' }}</span>
    </header>
    <p v-if="isDesktopApp && desktopUpdateState.availableVersion && desktopUpdateState.availableVersion !== currentVersionLabel" class="update-next-version">新版本 {{ desktopUpdateState.availableVersion }}</p>
    <div class="update-overview" :class="`is-${statusTone}`">
      <div class="section-icon update" :class="`is-${statusTone}`" aria-hidden="true">{{ statusGlyph }}</div>
      <div class="section-copy">
        <strong class="update-status" :class="`is-${statusTone}`">{{ statusLabel }}</strong>
        <p class="update-detail">{{ statusDetail }}</p>
        <time v-if="lastCheckText" class="update-last-check" :datetime="lastCheckedIso">{{ lastCheckText }}</time>
      </div>
    </div>
    <div class="update-actions" :class="{ 'has-apply-action': hasApplyAction }">
      <button v-if="isDesktopApp && desktopUpdateState.stage === 'available'" type="button" class="btn btn-primary" @click="downloadDesktopUpdate">下载新版本</button>
      <button v-if="isDesktopApp && desktopUpdateState.stage === 'ready'" type="button" class="btn btn-primary" @click="installDesktopUpdate">重启并安装</button>
      <button v-if="!isDesktopApp && needsManualReload" type="button" class="btn btn-primary" @click="reloadAppToApplyUpdate">立即重新加载</button>
      <button type="button" class="btn update-check-button" :class="hasApplyAction ? 'btn-secondary' : 'btn-primary'" :disabled="checkBusy" :aria-busy="checkBusy" @click="checkUpdates">
        <span v-if="checkBusy" class="update-check-spinner" aria-hidden="true"></span>
        {{ checkButtonLabel }}
      </button>
      <button type="button" class="btn btn-secondary update-notes-button" aria-haspopup="dialog" @pointerenter="warmReleaseNotes" @pointerdown="warmReleaseNotes" @focus="warmReleaseNotes" @click="notesOpen = true"><span aria-hidden="true">≡</span>查看更新记录<span aria-hidden="true">›</span></button>
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
      :elapsed-seconds="appUpdateProgress.elapsedSeconds.value ?? undefined"
      :activity-age-seconds="appUpdateProgress.activityAgeSeconds.value"
      :stalled="appUpdateProgress.isStalled.value"
      compact
      @retry="retryAppUpdate"
      @wait="appUpdateProgress.continueWaiting"
    />
    <p class="update-auto-note"><span aria-hidden="true">↻</span>{{ isDesktopApp ? '启动时自动检查更新' : '启动和联网时自动检查更新' }}</p>
    <details v-if="!isDesktopApp" class="update-recovery">
      <summary>版本异常或更新卡住？</summary>
      <div class="update-recovery-content">
        <p>修复会重建应用资源缓存并重新加载，不会删除本机课程、待办或账本记录。</p>
        <ActionButton tone="neutral" type="button" class="btn btn-secondary" :disabled="checkBusy" :busy="recovering" kind="task" feedback="external" :show-error="false" :action="() => recoverToLatest()">
          {{ recovering ? '正在修复…' : '修复更新缓存' }}
        </ActionButton>
      </div>
    </details>
  </section>
  <ReleaseNotesBrowser v-if="notesOpen" :open="notesOpen" @close="notesOpen = false" />
</template>

<style scoped>
.version-update-section { display: grid; min-width: 0; gap: 16px; }
.update-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.version-heading { display: grid; min-width: 0; gap: 6px; }
.version-caption { color: var(--muted); font-size: var(--fs-12); }
.version-badge { color: var(--ink); font-size: var(--fs-19); font-weight: var(--fw-800); line-height: 1.4; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.update-platform { flex: 0 0 auto; padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--ink-soft); background: var(--bg-tint); font-size: var(--fs-10); }
.update-next-version { margin: -8px 0 0; color: var(--primary); font-size: var(--fs-12); overflow-wrap: anywhere; }
.update-overview { display: grid; grid-template-columns: 38px minmax(0, 1fr); align-items: start; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-12); background: var(--bg-tint); }
.update-overview.is-success { border-color: color-mix(in srgb, var(--success) 22%, var(--border)); }
.update-overview.is-warning { border-color: color-mix(in srgb, var(--warning) 24%, var(--border)); }
.update-overview.is-error { border-color: color-mix(in srgb, var(--danger) 22%, var(--border)); }
.section-icon { display: grid; width: 38px; height: 38px; place-items: center; border-radius: var(--radius-10); color: var(--primary); background: var(--primary-soft); font-size: var(--fs-20); font-weight: var(--fw-800); }
.section-icon.update.is-success { color:var(--success); background:color-mix(in srgb, var(--success) 11%, var(--card)); }
.section-icon.update.is-warning { color:var(--warning); background:color-mix(in srgb, var(--warning) 12%, var(--card)); }
.section-icon.update.is-error { color:var(--danger); background:color-mix(in srgb, var(--danger) 10%, var(--card)); }
.section-copy { display: grid; min-width: 0; gap: 5px; }
.update-status { color: var(--primary); font-size: var(--fs-14); font-weight: var(--fw-750); }
.update-status.is-success { color: var(--success); }
.update-status.is-warning { color: var(--warning); }
.update-status.is-error { color: var(--danger); }
.update-detail { margin: 0; color: var(--ink-soft); font-size: var(--fs-12); line-height: 1.6; overflow-wrap: anywhere; }
.update-last-check { color: var(--ink-faint); font-size: var(--fs-11); font-variant-numeric: tabular-nums; }
.update-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.update-actions .btn { display: flex; min-width: 0; min-height: 44px; align-items: center; justify-content: center; gap: 8px; }
.update-actions > .btn-primary { grid-column: 1 / -1; }
.update-actions:not(.has-apply-action) .update-notes-button { grid-column: 1 / -1; }
.update-actions .update-notes-button { justify-content: space-between; color: var(--ink-soft); }
.update-check-spinner { width: 14px; height: 14px; flex: 0 0 14px; border: 2px solid currentColor; border-right-color: transparent; border-radius: var(--radius-circle); animation: update-spin 900ms linear infinite; }
.update-auto-note { display: flex; align-items: center; justify-content: center; gap: 6px; margin: -4px 0 0; color: var(--ink-faint); font-size: var(--fs-11); }
.desktop-update-progress { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:10px; color:var(--ink-soft); font-size:var(--fs-11); font-variant-numeric:tabular-nums; }
.desktop-update-progress-track { display:block; height:8px; overflow:hidden; border-radius:var(--radius-pill); background:var(--border); }
.desktop-update-progress-track i { display:block; height:100%; border-radius:inherit; background:var(--primary); transition:width var(--dur-fast, 150ms) var(--ease-standard, ease); }
.desktop-update-progress b { min-width:34px; color:var(--ink); text-align:right; }
.update-recovery { border-top: 1px solid var(--border); }
.update-recovery summary { min-height: 44px; padding-block: 12px; color: var(--muted); font-size: var(--fs-12); font-weight: var(--fw-600); cursor: pointer; }
.update-recovery-content { display:grid; justify-items:start; gap:8px; padding-top:9px; }
.update-recovery-content p { margin:0; color:var(--muted); font-size:var(--fs-11); line-height:1.5; }
.update-recovery summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: var(--radius-6); }
@keyframes update-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .update-check-spinner { animation: none; } .desktop-update-progress-track i { transition: none; } }
@media (max-width:520px) {
  .version-update-section { gap: 14px; }
  .update-heading { flex-wrap: wrap; gap: 8px; }
  .version-heading { flex: 1 1 210px; }
  .version-badge { font-size: var(--fs-17); }
  .section-icon { width: 32px; height: 32px; font-size: var(--fs-17); }
  .update-overview { grid-template-columns: 32px minmax(0, 1fr); gap: 10px; padding: 12px; }
  .update-actions .btn { padding-inline: 9px; }
}</style>
