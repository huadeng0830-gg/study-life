<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'
import TaskProgress from './TaskProgress.vue'
import { checkForAppUpdate, updateChecking, updateMessage } from '../composables/appUpdate.js'
import { markBackedUp, needsBackup } from '../composables/backupReminder.js'
import {
  canUndoPull,
  cloudExists,
  code,
  connectCloud,
  connectionState,
  disconnectCloud,
  isSyncing,
  lastError,
  lastLocalChangedAt,
  localChanged,
  pullFromCloud,
  pushToCloud,
  remoteDevice,
  remoteUpdatedAt,
  syncRelationship,
  syncStatus,
  undoLastPull,
} from '../composables/cloudSync.js'
import { deviceProfile, setDeviceName } from '../composables/deviceIdentity.js'
import {
  exportWallpapersForTransfer,
  importWallpapersFromTransfer,
} from '../composables/wallpaperStorage.js'
import { useTaskProgress } from '../composables/taskProgress.js'

// 二维码生成/扫描依赖体积较大，仅在用户真正打开迁移面板时下载和解析。
const LocalTransfer = defineAsyncComponent(() => import('./LocalTransfer.vue'))

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const selectedBackup = ref(null)
const selectedName = ref('')
const error = ref('')
const message = ref('')
const showTransfer = ref(false)
const includeWallpapers = ref(false)
const syncProgress = useTaskProgress()
const backupProgress = useTaskProgress()
let syncController = null
let backupController = null
let lastSyncAction = ''

const codeInput = ref('')
const deviceNameInput = ref(deviceProfile.value.name)

// 连接：只验证访问码 + 读取云端元数据（是否存在、最后更新时间），绝不触碰业务数据。
async function connectCode() {
  error.value = ''
  message.value = ''
  if (!codeInput.value || !/^\d{6}$/.test(codeInput.value)) {
    error.value = '请输入 6 位数字访问码'
    return
  }
  const result = await connectCloud(codeInput.value)
  if (!result.ok) {
    error.value = result.error
    return
  }
  codeInput.value = ''
  message.value = result.exists
    ? '已连接到云端空间（连接只做了验证，本地数据没有任何变化）'
    : '新访问码，首次推送到云端时会创建远程数据'
}

function fmtTime(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

const cloudSourceText = computed(() => {
  if (!remoteDevice.value?.name) return '来源设备未知'
  return `来自「${remoteDevice.value.name}」${remoteDevice.value.id && remoteDevice.value.id === deviceProfile.value.id ? '（当前设备）' : ''}`
})

const relationshipCopy = computed(() => ({
  synced: ['✓ 已同步', '本机数据与当前云端版本一致。'],
  'local-changes': ['本机有未同步修改', '本地数据在上次同步后发生了变化，可推送到云端。'],
  'cloud-updated': ['云端有更新', `${remoteDevice.value?.name ? `「${remoteDevice.value.name}」更新了云端数据。` : '其他设备或客户端更新了云端数据。'}可从云端拉取。`],
  'both-changed': ['⚠ 本机和云端都有修改', '本机和云端都在上次同步后发生过变化，请自行选择下一步操作。'],
  unknown: ['状态无法可靠判断', '此云端版本缺少 revision 信息；系统不会按时间自动决定同步方向。'],
  empty: ['云端暂无数据', '尚未创建云端版本，可在确认后手动推送。'],
}[syncRelationship.value] || ['状态无法可靠判断', '请手动选择下一步操作。']))

// ---------- 手动同步操作：每个动作都先弹确认框 ----------
const confirmBox = ref(null) // { mode: 'pull'|'push', title, bodyLines[], confirmLabel }
const confirmCancelBtn = ref(null)

watch(confirmBox, (box) => {
  if (box) nextTick(() => confirmCancelBtn.value?.focus())
})

function closeConfirm() {
  confirmBox.value = null
}

function requestPullConfirm() {
  if (connectionState.value !== 'connected' || isSyncing.value) return
  confirmBox.value = {
    mode: 'pull',
    title: '从云端拉取数据？',
    lines: [
      ['操作', '云端数据将应用到当前设备'],
      ['云端最后更新', `${fmtTime(remoteUpdatedAt.value)} · ${cloudSourceText.value}`],
      ['本地最后更新', `${fmtTime(lastLocalChangedAt.value)} · 当前设备「${deviceProfile.value.name}」`],
      ['提示', localChanged.value ? '本机存在未同步修改；拉取可能覆盖本机尚未推送的数据。拉取前会创建安全快照。' : '拉取前会自动创建本机快照，本机将使用当前云端版本。'],
    ],
    confirmLabel: localChanged.value ? '仍然拉取' : '确认拉取',
  }
}

function requestPushConfirm() {
  if (connectionState.value !== 'connected' || isSyncing.value) return
  const overwritesNewerCloud = ['cloud-updated', 'both-changed'].includes(syncRelationship.value)
  confirmBox.value = {
    mode: 'push',
    title: overwritesNewerCloud ? '云端存在其他设备的新版本' : '推送到云端？',
    lines: [
      ['操作', '本机数据将作为新的云端版本'],
      ['本地最后更新', `${fmtTime(lastLocalChangedAt.value)} · 当前设备「${deviceProfile.value.name}」`],
      ['云端最后更新', cloudExists.value ? `${fmtTime(remoteUpdatedAt.value)} · ${cloudSourceText.value}` : '云端还没有数据'],
      ['提示', overwritesNewerCloud ? '继续推送将覆盖当前云端版本。' : '推送成功后，云端版本将更新为本机当前数据。'],
    ],
    confirmLabel: overwritesNewerCloud ? '仍然使用本机覆盖' : '确认推送',
  }
}

const SYNC_STEPS = {
  pull: [
    { id: 'request', label: '请求云端版本' },
    { id: 'decrypt', label: '本机解密数据' },
    { id: 'validate', label: '校验数据结构' },
    { id: 'apply', label: '创建快照并应用' },
  ],
  push: [
    { id: 'collect', label: '收集本机数据' },
    { id: 'check', label: '重新确认云端版本' },
    { id: 'encrypt', label: '本机加密数据' },
    { id: 'upload', label: '上传云端' },
    { id: 'confirm', label: '等待云端确认' },
  ],
}

function handleSyncProgress(event) {
  if (!event?.step) return
  syncProgress.setStep(event.step, 'running', event.message)
  if (event.partial) syncProgress.setPartial(event.partial, event.message)
}

async function runSync(action) {
  closeConfirm()
  if (syncProgress.state.status === 'running') return
  lastSyncAction = action
  const controller = new AbortController()
  syncController = controller
  syncProgress.start({
    title: action === 'pull' ? '正在从云端拉取' : '正在推送到云端',
    steps: SYNC_STEPS[action],
    cancel: () => controller.abort(),
  })
  try {
    const ok = action === 'pull'
      ? await pullFromCloud({ signal: controller.signal, onProgress: handleSyncProgress })
      : await pushToCloud({ signal: controller.signal, onProgress: handleSyncProgress })
    if (controller.signal.aborted) return
    if (!ok) {
      const running = syncProgress.state.steps.find((step) => step.status === 'running')?.id
      syncProgress.fail(running, lastError.value || '云同步失败', { retry: true })
      return
    }
    if (action === 'pull' && !cloudExists.value) {
      for (const step of syncProgress.state.steps.filter((item) => item.status === 'waiting')) {
        syncProgress.setStep(step.id, 'cancelled', '云端暂无数据，无需执行')
      }
    }
    syncProgress.finish(lastError.value || (action === 'pull' ? '云端数据已应用' : '云端已接收新版本'))
  } finally {
    if (syncController === controller) syncController = null
  }
}

function runPull() {
  return runSync('pull')
}

function runPush() {
  return runSync('push')
}

function retrySync() {
  if (lastSyncAction) void runSync(lastSyncAction)
}

function continueSyncResult() {
  syncProgress.reset()
}

watch(() => props.open, (open) => {
  if (!open && syncProgress.state.status === 'running') void syncProgress.cancel()
  if (!open && backupProgress.state.status === 'running' && backupProgress.state.canCancel) void backupProgress.cancel()
})

onBeforeUnmount(() => {
  syncController?.abort()
  backupController?.abort()
})

// 「撤销上次拉取」只有在存在拉取前快照时可用；否则禁用并解释原因。
const undoTitle = computed(() =>
  canUndoPull.value
    ? `恢复到上次拉取前的本机数据（${readUndoCreatedAtText()}）`
    : '暂无可撤销的拉取记录'
)

function readUndoCreatedAtText() {
  try {
    const value = JSON.parse(localStorage.getItem('study_life_cloud_pull_undo'))
    return value?.createdAt ? new Date(value.createdAt).toLocaleString() : ''
  } catch {
    return ''
  }
}

function doDisconnect() {
  disconnectCloud()
  codeInput.value = ''
  message.value = '已断开同步，本地数据保留'
  error.value = ''
}

const maskedCode = computed(() => {
  const value = String(code.value ?? '')
  if (!value) return ''
  return `••••••${value.slice(-2)}`
})

function saveCurrentDeviceName() {
  if (!setDeviceName(deviceNameInput.value)) {
    error.value = '设备名称不能为空'
    return
  }
  deviceNameInput.value = deviceProfile.value.name
  error.value = ''
  message.value = `当前设备已命名为“${deviceProfile.value.name}”`
}

const STORAGE_KEYS = {
  courses: 'sl_courses',
  countdowns: 'sl_exams',
  tasks: 'sl_tasks',
  courseTemplates: 'sl_course_templates',
  checklists: 'sl_checklists',
  bills: 'sl_bills',
  expenses: 'sl_expenses',
  timeConfig: 'sl_timecfg',
  semester: 'sl_semester',
  scheduleExceptions: 'sl_schedule_exceptions',
  theme: 'sl_theme',
  countdownShowPast: 'sl_countdown_show_past',
  foodPlaces: 'sl_food_places',
  foodHistory: 'sl_food_history',
  appearance: 'sl_appearance',
  wallpaperConfig: 'sl_wallpaper_config',
  autoWallpaperColor: 'sl_auto_wallpaper_color',
  wallpaperAccent: 'sl_wallpaper_accent',
}

function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function makeBackup() {
  return {
    app: 'study-life',
    version: 6,
    exportedAt: new Date().toISOString(),
    data: {
      courses: readStored(STORAGE_KEYS.courses, []),
      countdowns: readStored(STORAGE_KEYS.countdowns, []),
      tasks: readStored(STORAGE_KEYS.tasks, []),
      courseTemplates: readStored(STORAGE_KEYS.courseTemplates, []),
      checklists: readStored(STORAGE_KEYS.checklists, []),
      bills: readStored(STORAGE_KEYS.bills, []),
      expenses: readStored(STORAGE_KEYS.expenses, []),
      timeConfig: readStored(STORAGE_KEYS.timeConfig, null),
      semester: readStored(STORAGE_KEYS.semester, null),
      scheduleExceptions: readStored(STORAGE_KEYS.scheduleExceptions, []),
      theme: readStored(STORAGE_KEYS.theme, 'blue'),
      countdownShowPast: readStored(STORAGE_KEYS.countdownShowPast, false),
      foodPlaces: readStored(STORAGE_KEYS.foodPlaces, []),
      foodHistory: readStored(STORAGE_KEYS.foodHistory, []),
      appearance: readStored(STORAGE_KEYS.appearance, null),
      wallpaperConfig: readStored(STORAGE_KEYS.wallpaperConfig, null),
      autoWallpaperColor: readStored(STORAGE_KEYS.autoWallpaperColor, false),
      wallpaperAccent: readStored(STORAGE_KEYS.wallpaperAccent, '#456fe8'),
    },
  }
}

async function exportBackup() {
  error.value = ''
  const backup = makeBackup()
  const includeImages = includeWallpapers.value
  const controller = new AbortController()
  backupController = controller
  if (includeImages) {
    backupProgress.start({
      title: '正在生成含壁纸的备份',
      steps: [
        { id: 'collect', label: '收集本机数据' },
        { id: 'wallpapers', label: '压缩壁纸图片' },
        { id: 'file', label: '生成备份文件' },
      ],
      cancel: () => controller.abort(),
    })
    backupProgress.setStep('collect', 'completed', '文字数据与设置已收集')
  }
  try {
    if (includeImages) {
      backupProgress.setStep('wallpapers', 'running', '正在读取壁纸')
      const images = await exportWallpapersForTransfer({
        signal: controller.signal,
        onProgress: ({ current, total }) => {
          backupProgress.setPartial({ 壁纸: `${current}/${total}` }, total ? `已处理 ${current}/${total} 张壁纸` : '当前没有壁纸')
        },
      })
      if (Object.keys(images).length) backup.data.__wallpaper_images = images
    }
  } catch (reason) {
    if (reason?.name === 'AbortError') {
      if (backupController === controller) backupController = null
      return
    }
    error.value = '壁纸导出失败，已改为仅备份文字数据。'
    backupProgress.setStep('wallpapers', 'warning', '壁纸处理失败，将导出文字数据')
  }
  if (includeImages) backupProgress.setStep('file', 'running', '正在生成 JSON 备份文件')
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  link.href = url
  link.download = `控制台备份-${date}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  message.value = backup.data.__wallpaper_images
    ? `备份文件已导出（含 ${Object.keys(backup.data.__wallpaper_images).length} 张壁纸），请妥善保存。`
    : '备份文件已导出，请妥善保存。'
  markBackedUp()
  if (includeImages) {
    backupProgress.setStep('file', 'completed', '备份文件已交给浏览器下载')
    backupProgress.finish(error.value ? '文字数据已导出，壁纸需要稍后重试' : '备份文件已生成', error.value ? 'warning' : 'completed')
  }
  if (backupController === controller) backupController = null
}

function retryBackup() {
  void exportBackup()
}

function continueBackupResult() {
  backupProgress.reset()
}

function sanitizeWallpaperImages(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value).filter(
    ([target, dataUrl]) => typeof target === 'string' && /^data:image\//.test(String(dataUrl))
  )
  return entries.length ? Object.fromEntries(entries) : null
}

function validateBackup(value) {
  if (!value || value.app !== 'study-life' || ![1, 2, 3, 4, 5, 6].includes(value.version) || !value.data) {
    throw new Error('这不是有效的控制台备份文件')
  }
  const data = value.data
  if (!Array.isArray(data.courses) || !Array.isArray(data.countdowns)) {
    throw new Error('备份文件中的课程或倒计时数据不完整')
  }
  return {
    ...value,
    data: {
      courses: data.courses,
      countdowns: data.countdowns,
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      courseTemplates: Array.isArray(data.courseTemplates) ? data.courseTemplates : [],
      checklists: Array.isArray(data.checklists) ? data.checklists : [],
      bills: Array.isArray(data.bills) ? data.bills : [],
      expenses: Array.isArray(data.expenses) ? data.expenses : [],
      timeConfig: data.timeConfig && typeof data.timeConfig === 'object' ? data.timeConfig : null,
      semester: data.semester && typeof data.semester === 'object' ? data.semester : null,
      scheduleExceptions: Array.isArray(data.scheduleExceptions) ? data.scheduleExceptions : [],
      theme: typeof data.theme === 'string' ? data.theme : 'blue',
      countdownShowPast: Boolean(data.countdownShowPast),
      foodPlaces: Array.isArray(data.foodPlaces) ? data.foodPlaces : [],
      foodHistory: Array.isArray(data.foodHistory) ? data.foodHistory : [],
      appearance: data.appearance && typeof data.appearance === 'object' ? data.appearance : null,
      wallpaperConfig: data.wallpaperConfig && typeof data.wallpaperConfig === 'object' ? data.wallpaperConfig : null,
      autoWallpaperColor: Boolean(data.autoWallpaperColor),
      wallpaperAccent: typeof data.wallpaperAccent === 'string' ? data.wallpaperAccent : '#456fe8',
      __wallpaper_images: sanitizeWallpaperImages(data.__wallpaper_images),
    },
  }
}

async function selectFile(event) {
  error.value = ''
  message.value = ''
  selectedBackup.value = null
  const file = event.target.files?.[0]
  if (!file) return
  selectedName.value = file.name
  try {
    selectedBackup.value = validateBackup(JSON.parse(await file.text()))
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '无法读取这个备份文件'
  } finally {
    event.target.value = ''
  }
}

const summary = computed(() => {
  const data = selectedBackup.value?.data
  if (!data) return null
  return {
    courses: data.courses.length,
    countdowns: data.countdowns.length,
    tasks: data.tasks.length,
    courseTemplates: data.courseTemplates.length,
    checklists: data.checklists.length,
    bills: data.bills.length,
        expenses: data.expenses.length,
    scheduleExceptions: data.scheduleExceptions.length,
    foodPlaces: data.foodPlaces.length,
    wallpapers: data.__wallpaper_images ? Object.keys(data.__wallpaper_images).length : 0,
  }
})

async function restoreBackup() {
  const backup = selectedBackup.value
  if (!backup) return
  if (!window.confirm('恢复后将覆盖当前浏览器中的课程、倒计时和待办数据，是否继续？')) return

  const { data } = backup
  const hasWallpapers = Boolean(data.__wallpaper_images && Object.keys(data.__wallpaper_images).length)
  const previous = Object.fromEntries(Object.values(STORAGE_KEYS).map((key) => [key, localStorage.getItem(key)]))
  if (hasWallpapers) {
    backupProgress.start({
      title: '正在恢复备份',
      steps: [
        { id: 'validate', label: '校验备份内容' },
        { id: 'data', label: '恢复文字数据与设置' },
        { id: 'wallpapers', label: '恢复壁纸图片' },
        { id: 'finish', label: '完成并重新载入' },
      ],
    })
    backupProgress.setStep('validate', 'completed', '备份格式和必要字段检查通过')
    backupProgress.setStep('data', 'running', '正在写入本机数据')
  }
  try {
    localStorage.setItem(STORAGE_KEYS.courses, JSON.stringify(data.courses))
    localStorage.setItem(STORAGE_KEYS.countdowns, JSON.stringify(data.countdowns))
    localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(data.tasks))
    localStorage.setItem(STORAGE_KEYS.courseTemplates, JSON.stringify(data.courseTemplates))
    localStorage.setItem(STORAGE_KEYS.checklists, JSON.stringify(data.checklists))
    localStorage.setItem(STORAGE_KEYS.bills, JSON.stringify(data.bills))
    localStorage.setItem(STORAGE_KEYS.expenses, JSON.stringify(data.expenses))
    if (data.timeConfig) localStorage.setItem(STORAGE_KEYS.timeConfig, JSON.stringify(data.timeConfig))
    if (data.semester) localStorage.setItem(STORAGE_KEYS.semester, JSON.stringify(data.semester))
    localStorage.setItem(STORAGE_KEYS.scheduleExceptions, JSON.stringify(data.scheduleExceptions))
    localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(data.theme))
    localStorage.setItem(STORAGE_KEYS.countdownShowPast, JSON.stringify(data.countdownShowPast))
    localStorage.setItem(STORAGE_KEYS.foodPlaces, JSON.stringify(data.foodPlaces))
    localStorage.setItem(STORAGE_KEYS.foodHistory, JSON.stringify(data.foodHistory))
    if (data.appearance) localStorage.setItem(STORAGE_KEYS.appearance, JSON.stringify(data.appearance))
    if (data.wallpaperConfig) localStorage.setItem(STORAGE_KEYS.wallpaperConfig, JSON.stringify(data.wallpaperConfig))
    localStorage.setItem(STORAGE_KEYS.autoWallpaperColor, JSON.stringify(data.autoWallpaperColor))
    localStorage.setItem(STORAGE_KEYS.wallpaperAccent, JSON.stringify(data.wallpaperAccent))
    if (data.__wallpaper_images) {
      backupProgress.setStep('data', 'completed', '文字数据与设置已恢复')
      backupProgress.setStep('wallpapers', 'running', '正在解码壁纸图片')
      await importWallpapersFromTransfer(data.__wallpaper_images, 'replace', {
        onProgress: ({ current, total, stage }) => {
          backupProgress.setPartial({ 壁纸: `${current}/${total}` }, stage === 'committed' ? '壁纸已原子写入本机' : `已处理 ${current}/${total} 张壁纸`)
        },
      })
    }
    if (hasWallpapers) {
      backupProgress.setStep('wallpapers', 'completed', '壁纸恢复完成')
      backupProgress.setStep('finish', 'completed', '恢复完成，即将重新载入')
      backupProgress.finish('备份恢复完成')
      window.setTimeout(() => window.location.reload(), 700)
    } else {
      window.location.reload()
    }
  } catch (reason) {
    for (const [key, raw] of Object.entries(previous)) {
      if (raw === null) localStorage.removeItem(key)
      else localStorage.setItem(key, raw)
    }
    error.value = '恢复失败，浏览器可能已禁止本地存储或存储空间不足'
    if (hasWallpapers) {
      const running = backupProgress.state.steps.find((step) => step.status === 'running')?.id
      backupProgress.fail(running, reason instanceof Error ? reason.message : error.value, { retry: false })
    }
  }
}
</script>

<template>
  <Modal :open="open" title="数据备份与恢复" @close="emit('close')">
    <div class="data-manager">
      <p v-if="needsBackup" class="backup-hint">⚠️ 删除苹果桌面应用或清除 Safari 网站数据可能同时删除本地记录。已超过 7 天未备份，建议先导出一份。</p>
      <section class="data-section">
        <div class="section-icon">↓</div>
        <div class="section-copy">
          <h4>导出本地数据</h4>
          <p>将课程、待办、清单、账单、吃饭地点和个性化设置保存为备份文件。可勾选携带壁纸（文件会明显变大）。</p>
          <label class="wallpaper-option"><input v-model="includeWallpapers" type="checkbox" /> 同时包含壁纸图片</label>
          <button class="btn btn-primary" @click="exportBackup">导出备份文件</button>
        </div>
      </section>

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

      <section class="data-section">
        <div class="section-icon update">↻</div>
        <div class="section-copy">
          <h4>电脑与手机更新</h4>
          <p>电脑浏览器和苹果桌面版都可以直接检查新版本。更新页面不会删除本地课程和记录。</p>
          <button class="btn btn-primary" :disabled="updateChecking" @click="checkForAppUpdate()">
            {{ updateChecking ? '正在更新…' : '检查更新' }}
          </button>
          <span v-if="updateMessage" class="update-message">{{ updateMessage }}</span>
        </div>
      </section>

      <section class="data-section">
        <div class="section-icon transfer">▦</div>
        <div class="section-copy">
          <h4>本地二维码迁移</h4>
          <p>电脑生成加密二维码，手机扫码后选择合并或覆盖。数据只在两台设备之间传递，不上传服务器。</p>
          <button class="btn btn-primary" @click="showTransfer = true">打开二维码迁移</button>
        </div>
      </section>

      <section class="data-section">
        <div class="section-icon restore">↑</div>
        <div class="section-copy">
          <h4>从备份恢复</h4>
          <p>选择此前导出的 JSON 文件。确认恢复前不会修改当前数据。</p>
          <label class="file-button">
            选择备份文件
            <input type="file" accept="application/json,.json" @change="selectFile" />
          </label>
        </div>
      </section>

      <section class="data-section">
        <div class="section-icon sync">☁</div>
        <div class="section-copy">
          <h4>云端同步（可选 · 手动模式）</h4>
          <p>连接只验证云端访问权限并读取必要版本信息，不会读取、上传或修改任何业务数据。</p>
          <div class="device-name-row">
            <label>当前设备</label>
            <input v-model="deviceNameInput" maxlength="30" placeholder="例如：我的 iPhone" @keydown.enter="saveCurrentDeviceName" />
            <button class="btn" @click="saveCurrentDeviceName">保存名称</button>
          </div>

          <!-- 未连接：输入访问码 -> 点击连接 -->
          <template v-if="connectionState !== 'connected'">
            <div class="sync-input-row">
              <input
                v-model="codeInput"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="6"
                placeholder="6 位数字访问码"
                :disabled="connectionState === 'validating' || isSyncing"
                @keydown.enter="connectCode"
              />
              <button class="btn btn-primary" :disabled="connectionState === 'validating' || isSyncing" @click="connectCode">
                {{ connectionState === 'validating' ? '正在验证…' : '连接云端' }}
              </button>
            </div>
          </template>

          <!-- 已连接：展示双方状态 + 手动操作 -->
          <template v-else>
            <div class="conn-head">
              <b class="conn-badge">✓ 已连接</b>
              <span class="conn-meta-item">云端空间：<code>{{ maskedCode }}</code></span>
              <span class="conn-meta-item">当前设备：{{ deviceProfile.name }}</span>
            </div>
            <div class="conn-times">
              <div class="relationship-state">
                <b>{{ relationshipCopy[0] }}</b>
                <span>{{ relationshipCopy[1] }}</span>
              </div>
              <span>云端最后更新：<b>{{ fmtTime(remoteUpdatedAt) }}</b> · {{ cloudSourceText }}<i v-if="!cloudExists">（云端还没有数据）</i></span>
              <span>本地最后更新：<b>{{ fmtTime(lastLocalChangedAt) }}</b> · 当前设备「{{ deviceProfile.name }}」</span>
            </div>

            <div class="sync-ops">
              <span class="ops-label">同步操作（均需手动确认）</span>
              <div class="sync-actions">
                <button
                  class="btn btn-pull"
                  :disabled="isSyncing || !cloudExists"
                  :title="cloudExists ? '下载云端数据应用到本机（会先弹确认）' : '云端还没有数据，等首次推送后再拉取'"
                  @click="requestPullConfirm"
                >↓ 从云端拉取</button>
                <button class="btn btn-push" :disabled="isSyncing" @click="requestPushConfirm">↑ 推送到云端</button>
              </div>
              <div class="sync-actions secondary">
                <button class="btn" :disabled="isSyncing || !canUndoPull" :title="undoTitle" @click="undoLastPull">撤销上次拉取</button>
                <button class="btn btn-danger" :disabled="isSyncing" @click="doDisconnect">断开同步</button>
              </div>
              <span v-if="!canUndoPull" class="sync-hint">{{ undoTitle }}</span>
            </div>

            <TaskProgress
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
            <span v-if="syncStatus === 'success' && !(syncProgress.state.active && syncProgress.state.visible)" class="success">{{ lastError }}</span>
            <span v-else-if="syncStatus === 'error' && !(syncProgress.state.active && syncProgress.state.visible)" class="error">⚠ {{ lastError }}</span>
          </template>
        </div>
      </section>

      <!-- 拉取 / 推送 确认框（取消为默认焦点） -->
      <Modal :open="Boolean(confirmBox)" :title="confirmBox?.title ?? ''" @close="closeConfirm">
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

      <div v-if="summary" class="restore-preview">
        <b>{{ selectedName }}</b>
        <span>{{ summary.courses }} 门课程</span>
        <span>{{ summary.scheduleExceptions }} 个特殊日期</span>
        <span>{{ summary.countdowns }} 个倒计时</span>
        <span>{{ summary.tasks }} 项待办</span>
        <span>{{ summary.courseTemplates }} 个课表模板</span>
        <span>{{ summary.checklists }} 份生活清单</span>
        <span>{{ summary.bills }} 项固定账单 · {{ summary.expenses }} 笔消费</span>
        <span>{{ summary.foodPlaces }} 个吃饭地点</span>
        <span v-if="summary.wallpapers">{{ summary.wallpapers }} 张壁纸</span>
        <button class="btn btn-primary" @click="restoreBackup">确认恢复</button>
      </div>

      <p v-if="message" class="success">{{ message }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <p class="local-note">
        数据保存在当前浏览器，并同步保留一份设备内安全副本。换设备或清理浏览器前仍建议导出备份。
        <b class="ios-warning">iPhone 注意：从后台划掉应用不会删除记录；删除桌面应用或清除 Safari 网站数据则可能清空本地数据。重要操作前请先导出备份或推送云端。</b>
      </p>
    </div>
  </Modal>

  <LocalTransfer v-if="showTransfer" :open="showTransfer" @close="showTransfer = false" />
</template>

<style scoped>
.data-manager {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.backup-hint {
  padding: 10px 12px;
  border: 1px solid #f2d08c;
  border-radius: 10px;
  background: #fffaf0;
  color: #8a6845;
  font-size: 12px;
  line-height: 1.55;
}
.data-section {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fafbfd;
}
.section-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  color: var(--primary);
  font-size: 20px;
  font-weight: 800;
  border-radius: 10px;
  background: var(--primary-soft);
}
.section-icon.restore {
  color: #07805d;
  background: #e7f8f1;
}
.section-icon.transfer {
  color: #89520a;
  background: #fff1d8;
}
.section-icon.update {
  color: #7755d0;
  background: #f0ebff;
}
.section-icon.sync {
  color: #0891b2;
  background: #e0f7ff;
}
.update-message {
  color: var(--primary);
  font-size: 11px;
}
.section-copy {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 7px;
}
.section-copy h4 {
  font-size: 14px;
}
.section-copy p,
.local-note {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}
.file-button {
  display: inline-flex;
  padding: 8px 14px;
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border-radius: 8px;
  background: var(--primary-soft);
}
.file-button input {
  display: none;
}
.wallpaper-option {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text);
  font-size: 12px;
}
.device-name-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 4px;
  padding: 9px;
  border-radius: 9px;
  background: var(--bg);
}
.device-name-row label { color: var(--muted); font-size: 11px; }
.device-name-row input { min-width: 0; width: 100%; }
.sync-input-row {
  display: flex;
  gap: 8px;
  margin: 8px 0;
}
.sync-input-row input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 14px;
  text-align: center;
  letter-spacing: 0.2em;
}
.sync-hint {
  color: #8590a6;
  font-size: 11px;
  line-height: 1.5;
}

/* ---------- 已连接状态 ---------- */
.conn-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px 14px;
  width: 100%;
  padding: 9px 11px;
  border: 1px solid #bfe8d8;
  border-radius: 9px;
  background: #f0faf5;
}
.conn-badge { color: #07805d; font-size: 13px; }
.conn-meta-item { color: var(--ink-soft, #55607a); font-size: 11.5px; }
.conn-meta-item code {
  letter-spacing: 0.12em;
  background: rgba(255, 255, 255, 0.7);
  padding: 1px 6px;
  border-radius: 5px;
}
.conn-times {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 9px 11px;
  color: var(--ink-soft, #55607a);
  font-size: 11.5px;
  line-height: 1.5;
  border-radius: 9px;
  background: var(--bg);
}
.conn-times b { font-weight: 700; font-variant-numeric: tabular-nums; }
.conn-times i { color: #8590a6; font-style: normal; }
.relationship-state { display: flex; flex-direction: column; gap: 2px; padding-bottom: 5px; border-bottom: 1px solid var(--border); }
.relationship-state b { color: var(--text); }
.relationship-state span { color: var(--muted); }

.sync-ops {
  width: 100%;
  margin-top: 2px;
  padding-top: 9px;
  border-top: 1px dashed var(--border);
}
.ops-label {
  color: #98a1b2;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.sync-actions {
  display: flex;
  gap: 8px;
  margin-top: 7px;
  flex-wrap: wrap;
}
.btn-pull { color: var(--primary); background: var(--primary-soft); }
.btn-pull:hover:not(:disabled) { background: #e1e9ff; }
.btn-push { color: #07805d; background: #e7f8f1; }
.btn-push:hover:not(:disabled) { background: #d7f2e8; }
.sync-status {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f5f7fb;
  font-size: 12px;
  line-height: 1.6;
}
.sync-status .muted { color: var(--muted); }
.device-history { display: block; margin-top: 3px; color: #5e6f85; font-size: 10px; }

/* ---------- 拉取/推送 确认框 ---------- */
.confirm-body { display: flex; flex-direction: column; gap: 9px; }
.confirm-row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
  padding: 7px 10px;
  color: var(--ink-soft, #55607a);
  font-size: 12.5px;
  border-radius: 8px;
  background: var(--bg);
}
.confirm-row + .confirm-row { margin-top: -3px; }
.confirm-row b { color: var(--text); font-variant-numeric: tabular-nums; }
.restore-preview {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  font-size: 12px;
  border: 1px solid #b9e6d5;
  border-radius: 10px;
  background: #f2fbf7;
}
.restore-preview b {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.restore-preview span {
  padding: 4px 7px;
  color: #16745a;
  border-radius: 6px;
  background: #e1f5ed;
}
.restore-preview .btn {
  margin-left: auto;
}
.success {
  color: #07805d;
  font-size: 13px;
}
.error {
  color: var(--danger);
  font-size: 13px;
}
.local-note {
  padding: 0 4px;
}
.ios-warning {
  display: block;
  margin-top: 6px;
  color: #a35e22;
}
@media (max-width: 520px) {
  .data-section { gap: 10px; padding: 12px; }
  .section-icon { width: 32px; height: 32px; flex-basis: 32px; font-size: 17px; }
  .section-copy { min-width: 0; width: 100%; }
  .device-name-row { grid-template-columns: 1fr auto; }
  .device-name-row label { grid-column: 1 / -1; }
  .sync-input-row { flex-direction: column; width: 100%; }
  .sync-input-row .btn { width: 100%; }
  .sync-actions { display: grid; grid-template-columns: 1fr 1fr; width: 100%; }
}
</style>
