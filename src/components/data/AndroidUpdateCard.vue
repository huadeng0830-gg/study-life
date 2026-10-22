<script setup>
/**
 * 安卓安装版的"版本与更新"面板。
 *
 * 与网页版那套（Service Worker 换资源）完全是两回事：APK 的资源在安装包里，
 * 更新只能靠换包。所以这里单独一个卡片，不复用网页版的进度阶段机。
 *
 * 单独成组件而不是塞进 AppUpdateSection.vue：那个文件已经同时管着
 * 网页与 Windows 两套更新流程，再加第三套只会更难读。
 */
import { computed, onMounted, watch } from 'vue'
import { CheckIcon, CircleAlertIcon, DownloadIcon, RefreshCwIcon, ShieldCheckIcon } from '@lucide/vue'
import { androidUpdateMessage, androidUpdateState, cancelAndroidAppUpdate,
  checkAndroidAppUpdate, downloadAndroidAppUpdate, installAndroidAppUpdate } from '../../composables/androidAppUpdate.js'
import { updatePreferences } from '../../composables/updatePreferences.js'
import { announce, announceAlert } from '../../composables/liveRegion.js'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'

const state = androidUpdateState
const busy = computed(() => ['checking', 'downloading', 'installing'].includes(state.value.stage))
const hasRelease = computed(() => Boolean(state.value.availableVersion))

const statusLabel = computed(() => {
  if (state.value.stage === 'available') return `有新版本 ${state.value.availableVersion}`
  if (state.value.stage === 'completed') return '已交给系统安装器'
  if (state.value.stage === 'ready') return '安装包已就绪'
  if (state.value.stage === 'error') return '本次更新未完成'
  if (state.value.stage === 'checking') return '正在检查…'
  if (state.value.stage === 'downloading') return '正在下载安装包…'
  if (state.value.stage === 'installing') return '正在打开安装界面…'
  if (state.value.stage === 'latest') return '已经是最新版本'
  return '当前版本'
})

const statusDetail = computed(() => {
  if (state.value.stage === 'available') return '点「下载安装包」即可覆盖安装，本机资料不会丢失。'
  return state.value.message || androidUpdateMessage.idle
})

const downloadSize = computed(() => {
  const mb = (value) => `${(value / 1024 / 1024).toFixed(1)} MB`
  if (!state.value.transferred) return state.value.apkBytes ? `安装包约 ${mb(state.value.apkBytes)}` : ''
  return state.value.total
    ? `${mb(state.value.transferred)} / ${mb(state.value.total)}`
    : `已下载 ${mb(state.value.transferred)}`
})

const lastCheckText = computed(() => {
  if (!state.value.lastCheckedAt) return '尚未成功检查'
  return `上次成功检查：${new Date(state.value.lastCheckedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
})

const notes = computed(() => String(state.value.notes || '').trim())

function onCheck() {
  void checkAndroidAppUpdate()
}
async function onDownload() {
  const ok = await downloadAndroidAppUpdate()
  if (ok) announce('安装包已下载完成，可以安装')
}
async function onInstall() {
  const ok = await installAndroidAppUpdate()
  if (ok) announce('已打开系统安装界面')
}
async function onCancel() {
  await cancelAndroidAppUpdate()
}

watch(() => state.value.stage, (stage, previous) => {
  if (stage === previous) return
  if (stage === 'error') announceAlert(state.value.message || '更新没有完成')
  else if (stage === 'available') announce(`发现新版本 ${state.value.availableVersion}`)
})

onMounted(() => {
  // 自动检查只在用户开着时进行；失败保持安静，不打扰。
  if (updatePreferences.autoCheck) void checkAndroidAppUpdate({ silent: true })
})
</script>

<template>
  <Card class="version-update-section gap-0 py-0 border-border" role="region" aria-label="安卓安装版版本与更新状态">
    <CardHeader class="update-card-header">
      <CardTitle>安卓安装版</CardTitle>
      <CardDescription>检查、下载并安装新的安装包</CardDescription>
    </CardHeader>
    <CardContent class="update-card-content">
      <header class="update-heading">
        <div class="version-heading">
          <span class="update-caption">当前运行版本</span>
          <strong class="version-number">{{ state.currentVersion }}</strong>
        </div>
        <div class="update-heading-badges">
          <Badge variant="secondary">Android</Badge>
          <Badge variant="outline">稳定版</Badge>
        </div>
      </header>

      <div class="update-overview" role="status" aria-live="polite" aria-atomic="true">
        <span :class="cn('update-state-symbol', { 'is-success': state.stage === 'latest' || state.stage === 'completed', 'is-error': state.stage === 'error' })" aria-hidden="true">
          <CheckIcon v-if="state.stage === 'latest' || state.stage === 'completed'" />
          <CircleAlertIcon v-else-if="state.stage === 'error'" />
          <Spinner v-else-if="busy" />
          <RefreshCwIcon v-else />
        </span>
        <div class="section-copy">
          <strong class="update-detail">{{ statusLabel }}</strong>
          <p class="update-detail">{{ statusDetail }}</p>
          <time class="update-last-check">{{ lastCheckText }}</time>
        </div>
      </div>

      <Alert v-if="state.error" variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>本次更新未完成</AlertTitle>
        <AlertDescription>{{ state.error.message }}</AlertDescription>
      </Alert>

      <section v-if="hasRelease" class="update-release-info">
        <p class="update-next-version">
          新版本 <strong>{{ state.availableVersion }}</strong>
          <span v-if="state.apkBytes"> · 安装包约 {{ (state.apkBytes / 1024 / 1024).toFixed(1) }} MB</span>
        </p>
        <details v-if="notes">
          <summary>查看这一版的更新内容</summary>
          <p class="update-release-notes">{{ notes }}</p>
        </details>
        <a v-if="state.releaseUrl" :href="state.releaseUrl" target="_blank" rel="noopener noreferrer">查看原始发布记录</a>
      </section>

      <section v-if="state.stage === 'downloading'" class="update-progress" aria-label="安装包下载进度">
        <Progress v-if="state.percent !== null" :model-value="state.percent" :aria-label="`正在下载安装包 ${state.percent}%`" class="update-progress-bar" />
        <div class="update-progress-meta">
          <span>{{ downloadSize || '正在下载安装包…' }}</span>
          <b v-if="state.percent !== null">{{ state.percent }}%</b>
        </div>
      </section>

      <p class="update-later-note">
        <ShieldCheckIcon aria-hidden="true" />
        <span>新版以同一签名覆盖安装，<strong>本机资料不会被清除</strong>；请不要卸载旧版。首次安装新版时，Android 8 以上会要求你允许本应用「安装未知应用」。</span>
      </p>

      <div class="update-actions">
        <Button v-if="state.stage !== 'available' && state.stage !== 'ready' && state.stage !== 'downloading'"
                type="button" variant="default" data-primary-action :aria-busy="state.stage === 'checking'"
                :disabled="busy" @click="onCheck">
          <Spinner v-if="state.stage === 'checking'" class="update-button-spinner" aria-hidden="true" />
          <span class="update-button-label">检查更新</span>
        </Button>
        <Button v-if="state.stage === 'available'" type="button" variant="default" data-primary-action @click="onDownload">
          <DownloadIcon data-icon="inline-start" aria-hidden="true" />
          <span class="update-button-label">下载安装包</span>
        </Button>
        <Button v-if="state.stage === 'ready'" type="button" variant="default" data-primary-action @click="onInstall">
          <span class="update-button-label">安装到系统</span>
        </Button>
        <Button v-if="state.stage === 'downloading'" type="button" variant="ghost" @click="onCancel">取消下载</Button>
        <Button v-if="state.stage === 'available'" type="button" variant="ghost" @click="onCancel">稍后再说</Button>
        <Button v-if="state.stage === 'available'" type="button" variant="ghost" @click="onCheck">重新检查</Button>
        <Button v-if="state.stage === 'completed'" type="button" variant="secondary" @click="onCheck">重新检查</Button>
      </div>
    </CardContent>
    <CardFooter class="update-card-footer">
      <p class="update-motion-note">发布渠道：GitHub Releases 稳定版。网页版与安卓安装版的本机存储相互独立，可用同一账号同步。</p>
    </CardFooter>
  </Card>
</template>
