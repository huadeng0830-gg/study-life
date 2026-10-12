<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CheckIcon, CircleAlertIcon, CopyIcon, HistoryIcon, RefreshCwIcon } from '@lucide/vue'
import { announce, announceAlert } from '../../composables/liveRegion.js'
import { applyAppUpdate, checkForAppUpdate, forceRecoverToLatest, retryAppUpdate, webUpdateState } from '../../composables/appUpdate.js'
import { cancelDesktopAppUpdate, checkDesktopAppUpdate, desktopUpdateState, downloadDesktopAppUpdate,
  installDesktopAppUpdate, isDesktopApp, loadDesktopReleaseHistory, subscribeToDesktopUpdateState } from '../../composables/desktopAppUpdate.js'
import { getUpdatePresentation } from '../../composables/updatePresentation.js'
import { collectReleaseChanges, formatUpdateDiagnostic } from '../../composables/updateProtocol.js'
import { APP_DOMAIN_SCHEMA_VERSION, APP_SCHEMA_VERSION, BUILD_ID, COMMIT_ID } from '../../composables/versionInfo.js'
import { deferUpdateReminder, setUpdatePreference, updatePreferences } from '../../composables/updatePreferences.js'
import { performanceMode } from '../../composables/performanceMode.js'
import '../../styles/shadcn.css'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
const loadReleaseNotesBrowser = () => import('../ReleaseNotesBrowser.vue')
const ReleaseNotesBrowser = defineAsyncComponent(loadReleaseNotesBrowser)
const notesOpen = ref(false)
const copyMessage = ref('')
const preferencesMessage = ref('')
const deferredMessage = ref('')
const desktopReleaseChanges = ref([])
const clock = ref(Date.now())
let stopDesktop = () => {}
let timer
onMounted(() => {
  if (isDesktopApp) stopDesktop = subscribeToDesktopUpdateState()
  timer = window.setInterval(() => { clock.value = Date.now() }, 1000)
})
onBeforeUnmount(() => { stopDesktop(); window.clearInterval(timer) })
/** @type {import('vue').ComputedRef<any>} */
const state = computed(() => isDesktopApp ? desktopUpdateState.value : webUpdateState)
const ui = computed(() => getUpdatePresentation(state.value, isDesktopApp))
const releaseChanges = computed(() => isDesktopApp ? desktopReleaseChanges.value : (state.value.updateReleases || []))
const displayReleaseRecords = computed(() => {
  if (releaseChanges.value.length) return releaseChanges.value
  const manifest = state.value.releaseManifest
  return manifest ? [{ version: manifest.version, title: manifest.title, summary: manifest.summary,
    publishedAt: manifest.publishedAt, changes: manifest.changes, notes: manifest.notes, releaseUrl: manifest.releaseUrl }] : []
})
const statusClass = computed(() => cn('update-status', {
  'is-success': ui.value.tone === 'success', 'is-error': ui.value.tone === 'error',
  'is-warning': ui.value.tone === 'warning', 'is-info': ui.value.tone === 'info',
}))
const currentVersionLabel = computed(() => state.value.currentVersion || '正在读取版本…')
const statusLabel = computed(() => {
  if (state.value.stage !== 'idle') return ui.value.statusLabel
  return updatePreferences.autoCheck ? '自动检查已开启' : '自动检查已关闭'
})
const defaultMessage = computed(() => updatePreferences.autoCheck
  ? '启动或联网后自动检查，也可以手动检查。'
  : '自动检查已关闭，可以随时手动检查。')
const lastCheckedIso = computed(() => state.value.lastCheckedAt ? new Date(state.value.lastCheckedAt).toISOString() : undefined)
const lastCheckText = computed(() => {
  if (!state.value.lastCheckedAt) return '尚未成功检查'
  return `上次成功检查：${new Date(state.value.lastCheckedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
})
const elapsedText = computed(() => {
  if (!state.value.startedAt) return ''
  const seconds = Math.max(0, Math.floor(((state.value.finishedAt || clock.value) - state.value.startedAt) / 1000))
  return seconds < 60 ? `已用时 ${seconds} 秒` : `已用时 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
})
function bytes(value) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
const downloadSize = computed(() => {
  if (!isDesktopApp || !state.value.transferred) return ''
  return state.value.total ? `${bytes(state.value.transferred)} / ${bytes(state.value.total)}` : `已下载 ${bytes(state.value.transferred)}`
})
const diagnostic = computed(() => formatUpdateDiagnostic(isDesktopApp ? 'windows' : 'web', state.value))
const sourceText = isDesktopApp ? '已安装客户端配置的正式发布通道，校验更新包哈希与 Windows 发布者签名。' : `${window.location.origin}/release.json（同源稳定版清单）`
const steps = ['核对版本', '下载资源', isDesktopApp ? '重启安装' : '启用资源', '验证版本']
const motionOptions = [{ value: 'auto', label: '自动' }, { value: 'on', label: '减少动画' }, { value: 'off', label: '完整效果' }]
const releaseChangeKinds = [['features', '新功能'], ['improvements', '体验优化'], ['fixes', '问题修复'], ['security', '安全修复'], ['breaking', '兼容性变化']]
let historyRequest = 0
watch(() => [state.value.availableVersion, state.value.currentVersion], async ([targetVersion, currentVersion]) => {
  const request = ++historyRequest
  if (!isDesktopApp || !targetVersion || !currentVersion) { desktopReleaseChanges.value = []; return }
  const history = await loadDesktopReleaseHistory()
  if (request !== historyRequest) return
  desktopReleaseChanges.value = collectReleaseChanges(history || [], currentVersion, targetVersion)
}, { immediate: true })
function primaryAction() {
  if (ui.value.disabled) return
  if (isDesktopApp) {
    if (ui.value.action === 'download') return downloadDesktopAppUpdate()
    if (ui.value.action === 'install') return installDesktopAppUpdate()
    return checkDesktopAppUpdate()
  }
  if (ui.value.action === 'apply') return applyAppUpdate()
  if (ui.value.action === 'repair') return forceRecoverToLatest()
  if (ui.value.action === 'wait') return retryAppUpdate()
  return checkForAppUpdate()
}
function checkAgain() { return isDesktopApp ? checkDesktopAppUpdate() : checkForAppUpdate() }
function changePreference(key, event) {
  const saved = setUpdatePreference(key, Boolean(event.target?.checked))
  preferencesMessage.value = saved ? '偏好已保存到本机。' : '本机不允许写入设置；本次打开期间仍会按当前选择运行。'
}
function deferCurrentRelease() {
  const saved = deferUpdateReminder(state.value.availableVersion)
  deferredMessage.value = saved ? `已暂缓 ${state.value.availableVersion} 的提醒，可随时回来更新。` : '暂缓设置未能保存，请稍后重试。'
}
function warmReleaseNotes() { void loadReleaseNotesBrowser().catch(() => {}) }
async function copyDiagnostic() {
  try {
    await navigator.clipboard.writeText(diagnostic.value)
    copyMessage.value = '诊断信息已复制'
    announce(copyMessage.value)
  } catch {
    copyMessage.value = '复制失败，可以选中下方诊断文本手动复制'
    announceAlert(copyMessage.value)
  }
}
</script>

<template>
  <Card class="version-update-section gap-0 py-0 border-border" role="region" aria-label="应用版本与更新状态">
    <CardHeader class="update-card-header">
      <CardTitle>三两事</CardTitle>
      <CardDescription>检查、获取并验证应用更新</CardDescription>
    </CardHeader>
    <CardContent class="update-card-content">
      <header class="update-heading">
        <div class="version-heading">
          <span class="version-caption">当前运行版本</span>
          <strong class="version-number">{{ currentVersionLabel }}</strong>
        </div>
        <div class="update-heading-badges">
          <Badge variant="secondary">{{ isDesktopApp ? 'Windows' : '网页 / PWA' }}</Badge>
          <Badge variant="outline">稳定版</Badge>
        </div>
      </header>
      <div class="update-overview" role="status" aria-live="polite" aria-atomic="true">
        <span :class="cn('update-state-symbol', { 'is-success': ui.tone === 'success', 'is-error': ui.tone === 'error' })" aria-hidden="true">
          <CheckIcon v-if="ui.tone === 'success'" />
          <CircleAlertIcon v-else-if="ui.tone === 'error' || ui.tone === 'warning'" />
          <Spinner v-else-if="ui.busy" aria-hidden="true" />
          <RefreshCwIcon v-else />
        </span>
        <div class="section-copy">
          <strong :class="statusClass">{{ statusLabel }}</strong>
          <p class="update-detail">{{ state.message || defaultMessage }}</p>
          <time class="update-last-check" :datetime="lastCheckedIso">{{ lastCheckText }}</time>
        </div>
      </div>
      <p v-if="state.availableVersion && state.availableVersion !== currentVersionLabel && state.stage !== 'completed'" class="update-next-version">
        新版本 <strong>{{ state.availableVersion }}</strong>
      </p>
      <Alert v-if="state.error" variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>本次更新未完成</AlertTitle>
        <AlertDescription>{{ state.error.message }} 详细诊断可在下方展开查看。</AlertDescription>
      </Alert>
      <details v-if="state.availableVersion && state.stage !== 'blocked' && (displayReleaseRecords.length || state.releaseNotes)" class="update-release-info">
        <summary>查看 {{ currentVersionLabel }} 到 {{ state.availableVersion }} 的更新内容</summary>
        <article v-for="release in displayReleaseRecords" :key="release.version" class="update-release-entry">
          <h3>v{{ release.version }}</h3>
          <p v-if="release.summary" class="update-release-summary">{{ release.summary }}</p>
          <time v-if="release.publishedAt" class="update-last-check">{{ new Date(release.publishedAt).toLocaleDateString('zh-CN') }}</time>
          <template v-if="releaseChangeKinds.some(([kind]) => release.changes?.[kind]?.length)">
            <template v-for="([kind, label]) in releaseChangeKinds" :key="kind">
              <section v-if="release.changes?.[kind]?.length" class="update-change-group">
                <strong>{{ label }}</strong>
                <ul><li v-for="(note, index) in release.changes[kind]" :key="`${kind}-${index}`">{{ note }}</li></ul>
              </section>
            </template>
          </template>
          <ul v-else-if="release.notes?.length"><li v-for="(note, index) in release.notes" :key="index">{{ note }}</li></ul>
          <a v-if="release.releaseUrl" :href="release.releaseUrl" target="_blank" rel="noopener noreferrer">查看原始发布记录</a>
        </article>
        <p v-if="isDesktopApp && !displayReleaseRecords.length && state.releaseNotes" class="update-release-notes">{{ state.releaseNotes }}</p>
      </details>
      <section v-if="ui.showProgress" class="update-progress" aria-label="更新进度">
        <ol class="update-phase-list">
          <li v-for="(step, index) in steps" :key="step"
              :class="cn({ 'is-done': index < ui.phaseIndex, 'is-current': index === ui.phaseIndex })"
              :aria-current="index === ui.phaseIndex ? 'step' : undefined">
            <span aria-hidden="true">{{ index < ui.phaseIndex ? '✓' : index + 1 }}</span>{{ step }}
          </li>
        </ol>
        <Progress v-if="ui.busy" :model-value="isDesktopApp && state.stage === 'downloading' ? state.percent : null"
                  :aria-label="ui.statusLabel" class="update-progress-bar" />
        <div class="update-progress-meta">
          <span>{{ downloadSize || (state.stage === 'downloading' ? '正在接收资源，进度以浏览器事件为准' : '实际版本验证完成后才会显示更新成功') }}</span>
          <b v-if="isDesktopApp && state.stage === 'downloading' && state.percent !== null">{{ state.percent }}%</b>
          <time>{{ elapsedText }}</time>
        </div>
      </section>
      <div class="update-actions">
        <div class="update-main-action-slot">
          <Button type="button" class="update-check-button transition-[width] duration-[var(--dur-slow)] ease-in-out motion-reduce:transition-none in-data-[performance=reduced]:transition-none" :variant="ui.tone === 'success' ? 'secondary' : 'default'"
                  data-primary-action :data-pending="state.stage === 'checking' ? '' : undefined"
                  :data-success="ui.tone === 'success' ? '' : undefined"
                  :disabled="ui.disabled" :aria-busy="ui.busy" :aria-label="ui.actionLabel" @click="primaryAction">
            <Spinner v-if="state.stage === 'checking'" class="update-button-spinner" aria-hidden="true" />
            <span class="update-button-label"><CheckIcon v-if="ui.tone === 'success'" data-icon="inline-start" aria-hidden="true" />{{ ui.actionLabel }}</span>
          </Button>
        </div>
        <Button v-if="isDesktopApp && state.canCancel" type="button" variant="ghost" @click="cancelDesktopAppUpdate">取消下载</Button>
        <Button v-if="['available', 'ready'].includes(state.stage) && state.availableVersion" type="button" variant="ghost" @click="deferCurrentRelease">稍后提醒</Button>
        <p v-if="['ready', 'manual-reload'].includes(state.stage)" class="update-later-note">可以稍后处理，关闭此面板仍可继续使用当前版本。</p>
        <p v-if="deferredMessage" role="status" class="update-copy-result">{{ deferredMessage }}</p>
      </div>
      <details class="update-settings">
        <summary>更新偏好</summary>
        <label class="update-preference-row">
          <input type="checkbox" :checked="updatePreferences.autoCheck" @change="changePreference('autoCheck', $event)">
          <span><strong>自动检查更新</strong><small>启动、联网或重新打开应用时检查，最多每 10 分钟一次。</small></span>
        </label>
        <label class="update-preference-row">
          <input type="checkbox" :checked="updatePreferences.showReminder" @change="changePreference('showReminder', $event)">
          <span><strong>在导航中显示新版本提醒</strong><small>仅显示轻量标记，不会自动刷新正在使用的页面。</small></span>
        </label>
        <p class="update-motion-note">发布渠道：稳定版。偏好只保存在此设备，不同步账户数据。</p>
        <p v-if="preferencesMessage" role="status" class="update-copy-result">{{ preferencesMessage }}</p>
      </details>
      <details class="update-motion-settings">
        <summary>动画效果</summary>
        <div class="update-motion-options" role="group" aria-label="动画效果">
          <Button v-for="option in motionOptions" :key="option.value" type="button" size="sm"
                  :variant="performanceMode === option.value ? 'secondary' : 'outline'"
                  :aria-pressed="performanceMode === option.value" @click="performanceMode = option.value">{{ option.label }}</Button>
        </div>
        <p class="update-motion-note">应用到所有页面；系统减少动画偏好同样生效。</p>
      </details>
      <Separator />
      <details class="update-diagnostics">
        <summary>更新来源与诊断</summary>
        <div class="update-diagnostics-content">
          <p class="update-source">{{ sourceText }}</p>
          <dl class="update-tech-info">
            <dt>应用版本</dt><dd>{{ currentVersionLabel }}</dd>
            <dt>构建标识</dt><dd>{{ BUILD_ID }}</dd>
            <dt>代码提交</dt><dd>{{ COMMIT_ID }}</dd>
            <dt>账号数据结构</dt><dd>{{ APP_SCHEMA_VERSION }}</dd>
            <dt>本地数据结构</dt><dd>{{ APP_DOMAIN_SCHEMA_VERSION }}</dd>
          </dl>
          <dl v-if="state.timings.length" class="update-timings">
            <template v-for="(item, index) in state.timings" :key="index">
              <dt>{{ { checking: '版本检查', downloading: '资源下载', installing: '安装 / 启用', verifying: '版本验证' }[item.stage] || item.stage }}</dt>
              <dd>{{ (item.durationMs / 1000).toFixed(2) }} 秒</dd>
            </template>
          </dl>
          <div class="update-diagnostic-actions">
            <Button v-if="ui.canCheckAgain" type="button" variant="outline" size="sm" @click="checkAgain">重新检查</Button>
            <Button type="button" variant="outline" size="sm" @click="copyDiagnostic"><CopyIcon data-icon="inline-start" />复制诊断信息</Button>
            <Button v-if="!isDesktopApp" type="button" variant="ghost" size="sm"
                    :disabled="ui.busy || state.taskPending" @click="forceRecoverToLatest">修复更新缓存</Button>
          </div>
          <p v-if="!isDesktopApp" class="update-repair-note">修复会先核对发布资源，再重建当前应用的离线缓存。课程、待办、账本和 OCR 模型缓存会保留。</p>
          <p v-if="copyMessage" role="status" class="update-copy-result">{{ copyMessage }}</p>
          <textarea class="update-diagnostic-text" aria-label="更新诊断信息" readonly :value="diagnostic"></textarea>
        </div>
      </details>
    </CardContent>
    <CardFooter class="update-card-footer">
      <Button type="button" variant="ghost" class="update-notes-button" aria-haspopup="dialog"
              @pointerenter="warmReleaseNotes" @focus="warmReleaseNotes" @click="notesOpen = true">
        <HistoryIcon data-icon="inline-start" />查看更新记录
      </Button>
      <span class="update-auto-note">{{ state.stage === 'unavailable' ? '更新服务未启用' : updatePreferences.autoCheck ? '自动检查已开启' : '自动检查已关闭' }}</span>
    </CardFooter>
  </Card>
  <ReleaseNotesBrowser v-if="notesOpen" :open="notesOpen" @close="notesOpen = false" />
</template>

<style scoped>
.version-update-section { gap:0; padding-block:0; min-width:0; }
.update-card-header { padding:20px 20px 0; }
.update-card-content { display:flex; flex-direction:column; gap:18px; padding:20px; }
.update-card-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 20px 16px; }
.update-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.update-heading-badges { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; }
.version-heading { display:flex; flex-direction:column; gap:5px; min-width:0; }
.version-caption { color:var(--muted); font-size:var(--fs-12); }
.version-number { color:var(--text); font-size:var(--fs-20); line-height:1.45; font-weight:var(--fw-750); overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
.update-overview { display:grid; grid-template-columns:32px minmax(0,1fr); gap:12px; align-items:start; min-height:83px; }
.update-state-symbol { display:grid; width:32px; height:32px; place-items:center; border-radius:var(--radius-circle); background:var(--primary-soft); color:var(--primary); }
.update-state-symbol :deep(svg) { width:18px; height:18px; }
.update-state-symbol.is-success { background:color-mix(in srgb,var(--success) 9%,var(--card)); color:var(--success); }
.update-state-symbol.is-error { background:var(--danger-soft); color:var(--danger); }
.section-copy { display:flex; flex-direction:column; gap:5px; min-width:0; }
.update-status { font-size:var(--fs-14); font-weight:var(--fw-750); color:var(--text); }
.update-status.is-success { color:var(--success); }
.update-status.is-warning { color:var(--warning); }
.update-status.is-error { color:var(--danger); }
.update-detail { margin:0; color:var(--ink-soft); font-size:var(--fs-12); line-height:1.6; overflow-wrap:anywhere; }
.update-last-check { font-size:var(--fs-11); color:var(--muted); font-variant-numeric:tabular-nums; }
.update-next-version { margin:0; font-size:var(--fs-12); color:var(--primary); overflow-wrap:anywhere; }
.update-main-action-slot { display:flex; align-items:center; justify-content:center; min-height:48px; }
.version-update-section :deep(button) { min-height:44px; }
.update-check-button { width:176px; min-height:44px; position:relative; overflow:hidden; transition:width var(--dur-slow) var(--action-ease); }
.update-check-button[data-pending] { width:44px; }
.update-button-label { display:inline-flex; gap:8px; align-items:center; white-space:nowrap; transition:opacity var(--dur-fast) var(--action-ease); }
.update-check-button[data-pending] .update-button-label { opacity:0; pointer-events:none; }
.update-button-spinner { position:absolute; inset:0; margin:auto; }
.update-check-button[data-success] .update-button-label :deep(svg) { color:var(--success); animation:update-check-in var(--dur-base) var(--ease-out); }
.update-actions { display:flex; flex-direction:column; align-items:center; gap:6px; }
.update-later-note { margin:0; text-align:center; color:var(--muted); font-size:var(--fs-11); line-height:1.6; }
.update-progress { display:flex; flex-direction:column; gap:12px; }
.update-phase-list { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; list-style:none; margin:0; padding:0; }
.update-phase-list li { display:flex; flex-direction:column; align-items:center; gap:7px; color:var(--muted); font-size:var(--fs-11); }
.update-phase-list li > span { display:grid; place-items:center; width:24px; height:24px; border:1px solid var(--border); border-radius:var(--radius-circle); font-variant-numeric:tabular-nums; }
.update-phase-list .is-current { color:var(--primary); }
.update-phase-list .is-current > span { border-color:var(--primary); background:var(--primary-soft); }
.update-phase-list .is-done > span { color:var(--primary); border-color:var(--border); }
.update-progress-bar { height:6px; }
.update-progress-meta { display:flex; flex-wrap:wrap; align-items:center; gap:8px; color:var(--muted); font-size:var(--fs-11); line-height:1.5; font-variant-numeric:tabular-nums; }
.update-progress-meta > time { margin-left:auto; white-space:nowrap; }
.update-diagnostics summary,.update-release-info summary,.update-motion-settings summary,.update-settings summary { display:flex; align-items:center; min-height:44px; color:var(--muted); font-size:var(--fs-12); cursor:pointer; list-style:revert; }
.update-diagnostics summary:focus-visible,.update-release-info summary:focus-visible,.update-motion-settings summary:focus-visible,.update-settings summary:focus-visible { outline:2px solid var(--focus-solid); outline-offset:2px; border-radius:var(--radius-6); }
.update-release-entry { display:grid; gap:8px; padding-block:8px; }
.update-release-entry + .update-release-entry { border-top:1px solid var(--border); }
.update-release-entry h3 { margin:0; color:var(--text); font-size:var(--fs-12); }
.update-release-summary { margin:0; color:var(--ink-soft); font-size:var(--fs-12); line-height:1.6; }
.update-change-group { display:grid; gap:5px; }
.update-change-group > strong { color:var(--muted); font-size:var(--fs-11); }
.update-release-entry ul { display:flex; flex-direction:column; gap:6px; margin:0; padding-left:20px; color:var(--ink-soft); font-size:var(--fs-12); line-height:1.6; }
.update-release-entry a { color:var(--primary); font-size:var(--fs-11); }
.update-preference-row { display:flex; align-items:flex-start; gap:12px; min-height:48px; padding:8px 0; color:var(--ink-soft); cursor:pointer; }
.update-preference-row input { flex:0 0 20px; width:20px; height:20px; margin:2px 0 0; accent-color:var(--primary); }
.update-preference-row > span { display:flex; flex-direction:column; gap:3px; }
.update-preference-row strong { color:var(--text); font-size:var(--fs-12); font-weight:var(--fw-650); }
.update-preference-row small { color:var(--muted); font-size:var(--fs-11); line-height:1.5; }
.update-tech-info { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.4fr); gap:7px 12px; margin:0; color:var(--muted); font-size:var(--fs-11); }
.update-tech-info dd { min-width:0; margin:0; color:var(--ink-soft); font-family:monospace; overflow-wrap:anywhere; }
.update-motion-options { display:flex; flex-wrap:wrap; gap:8px; }
.update-motion-note { margin:8px 0 0; color:var(--muted); font-size:var(--fs-11); line-height:1.6; }
.update-diagnostics-content { display:flex; flex-direction:column; gap:12px; padding-top:6px; }
.update-source,.update-repair-note,.update-copy-result { margin:0; color:var(--muted); font-size:var(--fs-11); line-height:1.6; overflow-wrap:anywhere; }
.update-diagnostic-actions { display:flex; flex-wrap:wrap; gap:8px; }
.update-diagnostic-actions :deep(button) { min-height:44px; }
.update-diagnostic-text { width:100%; min-height:140px; max-height:260px; resize:vertical; padding:10px; border:1px solid var(--border); border-radius:var(--radius-8); background:var(--bg-tint); color:var(--ink-soft); font:var(--fs-11)/1.5 monospace; }
.update-timings { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:6px; margin:0; color:var(--muted); font-size:var(--fs-11); }
.update-timings dd { margin:0; font-variant-numeric:tabular-nums; }
.update-release-notes { color:var(--ink-soft); font-size:var(--fs-12); line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; }
.update-notes-button { min-height:44px; }
.update-auto-note { color:var(--muted); font-size:var(--fs-11); white-space:nowrap; }
@keyframes update-check-in { from { opacity:0; transform:scale(.75); } to { opacity:1; transform:scale(1); } }
:global(html[data-performance="reduced"] .update-check-button),
:global(html[data-performance="reduced"] .update-button-label) { transition:none; }
:global(html[data-performance="reduced"] .update-state-symbol svg),
:global(html[data-performance="reduced"] .update-button-spinner),
:global(html[data-performance="reduced"] .update-check-button[data-success] .update-button-label svg) { animation:none; }
@media (max-width:520px) {
  .update-card-header { padding:16px 14px 0; }
  .update-card-content { gap:16px; padding:16px 14px; }
  .update-card-footer { padding:0 14px 12px; gap:6px; }
  .version-number { font-size:var(--fs-18); }
  .update-heading { flex-wrap:wrap; }
  .update-progress-meta > time { margin-left:0; }
}
@media (prefers-reduced-motion:reduce) {
  .update-check-button,.update-button-label { transition:none; }
  .update-check-button[data-success] .update-button-label :deep(svg) { animation:none; }
  .update-state-symbol :deep(svg),.update-button-spinner { animation:none; }
}
</style>
