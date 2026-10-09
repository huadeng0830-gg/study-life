import { computed, ref, shallowRef } from 'vue'
import {
  BACKUP_STORAGE_KEYS,
  BACKUP_MODULES,
  completeBackupArchive,
  createBackupArchiveParts,
  createBackupSnapshot,
  parseBackupArchive,
  restoreBackupModuleLabels,
  restoreBackupModuleOptions,
  restoreBackupSelectedFields,
} from './backupArchive.js'
import { markBackedUp } from './backupReminder.js'
import { buildBackupRestoreValues } from './backupRestore.js'
import { detachRetiredNoteRelations } from './domain/migrations.js'
import {
  backupWallpapersForUndo,
  discardWallpaperUndo,
  exportWallpapersForTransfer,
  importWallpapersFromTransfer,
  listWallpapers,
  restoreWallpaperUndo,
  restoreWallpapersSnapshot,
} from './wallpaperStorage.js'
import { clearRestoreCheckpoint, getRestoreCheckpoint, saveRestoreCheckpoint } from './dataVault.js'
import { flushStoredWrites, restoreStoredValues } from './store'
import { getAppToday, getAppTime } from './timeContext.js'
import { cachedDateFormatter, settingsPolicy } from './settingsPolicy.js'
import { throwIfAborted } from './asyncTask.js'
import { formatDataSize } from './dataManagerInventory.js'
import { useTaskProgress } from './taskProgress.js'
import { backupError, backupMessage, backupWarning, restoreError } from './dataManagerFeedback.js'

// 进度条等第一次被用到时才创建：useTaskProgress 会挂 onScopeDispose，
// 只有在主面板 setup 期间首次调用，才会挂到主面板的 scope 上、随它一起停表。
let backupProgress = null
let backupController = null

const selectedBackup = shallowRef(null)
const selectedName = ref('')
const selectedFileSize = ref(0)
const fileChecking = ref(false)
let fileCheckGeneration = 0
const exporting = ref(false)
const restoring = ref(false)
const backupBusy = computed(() => exporting.value || restoring.value)
const MAX_BACKUP_FILE_BYTES = 100 * 1024 * 1024
const restoreSelection = ref([])
const restoreCheckpoint = shallowRef(null)
const restoreCheckpointLoading = ref(false)
const restoreCheckpointError = ref('')
let restoreCheckpointLoad = null

const includeWallpapers = ref(false)

async function exportBackup() {
  if (backupBusy.value || fileChecking.value) return
  exporting.value = true
  backupError.value = ''
  backupMessage.value = ''
  backupWarning.value = ''
  const includeImages = includeWallpapers.value
  const controller = new AbortController()
  backupController = controller
  backupProgress.start({
    title: includeImages ? '正在生成含壁纸的备份' : '正在生成完整备份',
    steps: [
      { id: 'collect', label: '收集本机数据' },
      ...(includeImages ? [{ id: 'wallpapers', label: '读取壁纸图片' }] : []),
      { id: 'file', label: '生成备份文件' },
    ],
    cancel: () => controller.abort(),
  })
  try {
    backupProgress.setStep('collect', 'running', '正在读取文字数据与设置')
    flushStoredWrites()
    const backup = createBackupSnapshot()
    backupProgress.setStep('collect', 'completed', '文字数据与设置已收集')
    if (includeImages) {
      backupProgress.setStep('wallpapers', 'running', '正在读取壁纸')
      try {
        const images = await exportWallpapersForTransfer({
          signal: controller.signal,
          onProgress: ({ current, total }) => {
            backupProgress.setPartial({ 壁纸: `${current}/${total}` }, total ? `已处理 ${current}/${total} 张壁纸` : '当前没有壁纸')
          },
        })
        if (Object.keys(images).length) backup.data.__wallpaper_images = images
        backupProgress.setStep('wallpapers', 'completed', '壁纸读取完成')
      } catch (reason) {
        if (reason?.name === 'AbortError' || controller.signal.aborted) throw reason
        backupWarning.value = '壁纸读取失败，本次文件仅包含文字数据与设置。需要壁纸时，请重新勾选并导出。'
        backupProgress.setStep('wallpapers', 'warning', '壁纸读取失败，将导出文字数据与设置')
      }
    }
    throwIfAborted(controller.signal)
    backupProgress.setStep('file', 'running', '正在生成并校验 JSON 备份文件')
    const archiveParts = await createBackupArchiveParts(backup)
    throwIfAborted(controller.signal)
    const blob = new Blob(archiveParts, { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const now = new Date()
    const filename = `三两事备份-${getAppToday(now)}-${getAppTime(now).replace(/:/g, '')}${String(now.getUTCSeconds()).padStart(2, '0')}-${String(now.getMilliseconds()).padStart(3, '0')}.json`
    try {
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
    } finally {
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    const imageCount = Object.keys(backup.data.__wallpaper_images || {}).length
    backupMessage.value = `已生成 ${filename}（${formatDataSize(blob.size)}${imageCount ? `，含 ${imageCount} 张壁纸` : ''}）。请确认文件已保存。`
    markBackedUp()
    backupProgress.setStep('file', 'completed', '备份文件已交给浏览器下载')
    backupProgress.finish(backupWarning.value ? '文字数据已导出，壁纸需要稍后重试' : '备份文件已生成', backupWarning.value ? 'warning' : 'completed')
  } catch (reason) {
    if (reason?.name === 'AbortError' || controller.signal.aborted) {
      await cancelBackup()
      backupMessage.value = '已取消备份，未生成新的文件。'
    } else {
      backupError.value = reason instanceof Error ? `备份失败：${reason.message}` : '备份文件生成失败，请重试。'
      const step = backupProgress.state.steps.find((item) => item.status === 'running')?.id
      backupProgress.fail(step, backupError.value)
    }
  } finally {
    exporting.value = false
    if (backupController === controller) backupController = null
  }
}

function retryBackup() {
  void exportBackup()
}

function continueBackupResult() {
  backupProgress.reset()
}

async function cancelBackup() {
  await backupProgress.cancel()
  backupProgress.state.retainedResult = false
  backupProgress.state.partial = null
}

async function selectFile(event) {
  if (backupBusy.value) return
  const input = event.target
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const generation = ++fileCheckGeneration
  restoreError.value = ''
  selectedBackup.value = null
  restoreSelection.value = []
  selectedName.value = file.name
  selectedFileSize.value = file.size || 0
  fileChecking.value = true
  try {
    if (file.size > MAX_BACKUP_FILE_BYTES) throw new Error('备份文件超过 100 MB，请改用不含壁纸的备份，或在原设备重新导出。')
    const text = await file.text()
    if (generation !== fileCheckGeneration) return
    let value
    try { value = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { throw new Error('文件不是有效的 JSON 备份，请选择由三两事导出的 .json 文件。') }
    const backup = await parseBackupArchive(value)
    if (generation !== fileCheckGeneration) return
    selectedBackup.value = backup
    restoreSelection.value = [
      ...restoreBackupModuleOptions(selectedBackup.value).map((option) => option.id),
      ...(Object.keys(selectedBackup.value.data.__wallpaper_images || {}).length ? ['wallpapers'] : []),
    ]
  } catch (reason) {
    if (generation === fileCheckGeneration) restoreError.value = reason instanceof Error ? reason.message : '无法读取这个备份文件'
  } finally {
    if (generation === fileCheckGeneration) fileChecking.value = false
  }
}

function clearSelectedBackup() {
  if (backupBusy.value) return
  fileCheckGeneration += 1
  fileChecking.value = false
  selectedBackup.value = null
  selectedName.value = ''
  selectedFileSize.value = 0
  restoreSelection.value = []
  restoreError.value = ''
}

function formatBackupDate(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  const timezone = settingsPolicy.value.timezone
  return cachedDateFormatter(timezone, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const summary = computed(() => {
  const data = selectedBackup.value?.data
  if (!data) return null
  return {
    wallpapers: data.__wallpaper_images ? Object.keys(data.__wallpaper_images).length : 0,
    exportedAt: formatBackupDate(selectedBackup.value.exportedAt),
    version: selectedBackup.value.version,
    verified: Boolean(selectedBackup.value.checksum),
    fileSize: selectedFileSize.value ? formatDataSize(selectedFileSize.value) : '',
  }
})

async function refreshRestoreCheckpoint() {
  if (restoreCheckpointLoad) return restoreCheckpointLoad
  restoreCheckpointLoading.value = true
  restoreCheckpointError.value = ''
  restoreCheckpointLoad = getRestoreCheckpoint()
    .then((value) => {
      if (value && (value.version !== 1 || !value.backup?.data || !Array.isArray(value.selectedModules))) throw new Error('恢复点格式不正确')
      restoreCheckpoint.value = value || null
    })
    .catch(() => { restoreCheckpointError.value = '本机恢复点暂时无法读取。请重试；仍可导出本机备份。' })
    .finally(() => { restoreCheckpointLoading.value = false; restoreCheckpointLoad = null })
  return restoreCheckpointLoad
}

// 恢复备份的确认。快照必须在打开对话框**之前**取：恢复预览里可以换文件，
// 若确认后才去读 selectedBackup，用户中途换了备份就会写错目标（弹窗套弹窗）。
const restoreBackupTarget = ref(null)

/**
 * 「这份备份会覆盖哪些模块」的**纯函数**版本（人话标签数组）。
 *
 * 【为什么必须算、不能写死】确认框原来写死的是"课程、重要日期和待办数据"，
 * 而 `applyRestoreBackup` 走的是 `buildBackupRestoreValues(data, providedFields, BACKUP_STORAGE_KEYS)`——
 * 按**备份携带的字段**恢复存储键：日程、专注记录、课程打卡、
 * 账本（账单/消费/分类/汇率/预算/模板）、清单、外观、壁纸、心情、氛围与提醒去重全都在内。
 * 写死的清单一定会随存储映射漂移，所以范围计算从三个真源反推：
 * `providedFields`（备份实际有哪些字段）× `BACKUP_STORAGE_KEYS`（字段→存储键）× `BACKUP_MODULES`（键→人话标签）。
 * 落在 `BACKUP_MODULES` 之外、但确实会被写回的键，统一归为「其它本机设置」，而不是假装没有。
 * 抽成纯函数是为了能直接对这张表写守卫（不必挂载组件）。
 */
const restoreBackupModules = computed(() => restoreBackupModuleLabels(restoreBackupTarget.value, {
  selectedModuleIds: restoreBackupTarget.value?.selectedModules,
}))
const restoreBackupPreviewModules = computed(() => restoreBackupModuleLabels(selectedBackup.value, {
  selectedModuleIds: restoreSelection.value,
}))
const restoreBackupPreviewOptions = computed(() => restoreBackupModuleOptions(selectedBackup.value))
const restoreCheckpointModules = computed(() => restoreCheckpoint.value
  ? restoreBackupModuleLabels(restoreCheckpoint.value.backup, {
      selectedModuleIds: (restoreCheckpoint.value.selectedModules || []).filter((id) => id !== 'wallpapers'),
    })
  : [])
const restoreCheckpointWallpapers = computed(() => Object.keys(restoreCheckpoint.value?.wallpaperImages || {}).length)
const restoreCheckpointDate = computed(() => {
  const timestamp = restoreCheckpoint.value?.createdAt
  if (!timestamp) return ''
  return formatBackupDate(timestamp)
})

/** 恢复确认框的文案：与 `restoreBackupModules` 同源，改一处不会两处对不上。 */
const restoreBackupMessage = computed(() => {
  const labels = restoreBackupModules.value
  const scope = labels.length ? labels.join('、') : '这份备份实际携带的模块'
  const wallpaperCount = restoreBackupTarget.value?.selectedModules?.includes('wallpapers')
    ? Object.keys(restoreBackupTarget.value?.data?.__wallpaper_images || {}).length
    : 0
  const wallpapers = wallpaperCount ? `、壁纸图片（${wallpaperCount} 张）` : ''
  return `将用备份内容覆盖：${scope}${wallpapers}。恢复前会保存本机恢复点，完成后可在此撤回。其它分区保持原样。已开启账号同步时，恢复结果也会同步到其它设备。是否继续？`
})

const restoreCheckpointMessage = computed(() => {
  if (!restoreCheckpoint.value) return ''
  const labels = restoreCheckpointModules.value
  const scope = labels.length ? labels.join('、') : '备份恢复前的数据'
  const wallpapers = restoreCheckpoint.value.selectedModules?.includes('wallpapers') ? '、壁纸图片' : ''
  return `将恢复 ${restoreCheckpointDate.value} 保存的本机恢复点，范围是：${scope}${wallpapers}。当前对应分区会先保存为新的恢复点，完成后仍可撤回。继续后，本机数据会按现有账号同步规则更新。`
})

function restoreBackup() {
  const backup = selectedBackup.value
  if (!backup || backupBusy.value || fileChecking.value || restoreSelection.value.length === 0) return
  restoreBackupTarget.value = { ...backup, selectedModules: [...restoreSelection.value] }
}

async function createRestoreCheckpoint(selectedModules, values) {
  flushStoredWrites()
  const affectedKeys = new Set(Object.keys(values))
  const snapshot = createBackupSnapshot({ getItem: (key) => affectedKeys.has(key) ? localStorage.getItem(key) : null })
  // 缺失字段也保存它的默认值；否则首次导入后，恢复点会跳过原先为空的分区。
  const selectedFields = Object.entries(BACKUP_STORAGE_KEYS).filter(([, key]) => affectedKeys.has(key)).map(([field]) => field)
  const data = Object.fromEntries(selectedFields.map((field) => [field, snapshot.data[field]]))
  const archive = await completeBackupArchive({ ...snapshot, data })
  const wallpaperImages = selectedModules.includes('wallpapers') ? await listWallpapers() : null
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    selectedModules: [...selectedModules],
    backup: { ...archive, providedFields: selectedFields },
    storedValues: Object.fromEntries(selectedFields.map((field) => [BACKUP_STORAGE_KEYS[field], snapshot.data[field]])),
    wallpaperImages,
  }
}

async function applyRestorePayload(backup, { fromCheckpoint = false } = {}) {
  if (backupBusy.value || fileChecking.value) return
  restoreError.value = ''
  const selectedModules = [...(backup.selectedModules || [])]
  if (!selectedModules.length) {
    restoreError.value = '请至少选择一个恢复分区。'
    return
  }
  const selectedFields = restoreBackupSelectedFields(backup, selectedModules)
  const restoredValues = JSON.parse(JSON.stringify(buildBackupRestoreValues(backup.data, selectedFields, BACKUP_STORAGE_KEYS)))
  if (fromCheckpoint && backup.storedValues) {
    const knownKeys = new Set(Object.values(BACKUP_STORAGE_KEYS))
    const allowedKeys = new Set(BACKUP_MODULES.filter((mod) => selectedModules.includes(mod.key)).flatMap((mod) => mod.keys))
    for (const [key, value] of Object.entries(backup.storedValues)) {
      if (knownKeys.has(key) && allowedKeys.has(key)) restoredValues[key] = JSON.parse(JSON.stringify(value))
    }
  }
  for (const key of ['sl_tasks', 'sl_events']) {
    const records = restoredValues[key]
    if (Array.isArray(records)) detachRetiredNoteRelations({ [key === 'sl_tasks' ? 'tasks' : 'events']: records })
  }
  const hasWallpapers = selectedModules.includes('wallpapers')
    && (fromCheckpoint || Object.keys(backup.data?.__wallpaper_images || {}).length > 0)

  let previousCheckpoint = null
  let checkpointSaved = false
  let wallpaperUndoReady = false
  let dataWriteStarted = false
  restoring.value = true
  backupProgress.start({
    title: '正在恢复数据',
    steps: [
      { id: 'checkpoint', label: '保存本机恢复点' },
      { id: 'wallpapers', label: '恢复壁纸图片' },
      { id: 'data', label: '恢复文字数据与设置' },
      { id: 'finish', label: '完成并重新载入' },
    ],
  })
  backupProgress.state.visible = true
  backupProgress.setStep('checkpoint', 'running', '正在读取当前数据并保存可撤回副本')

  try {
    flushStoredWrites()
    const nextCheckpoint = await createRestoreCheckpoint(selectedModules, restoredValues)
    previousCheckpoint = await getRestoreCheckpoint()
    await saveRestoreCheckpoint(nextCheckpoint)
    restoreCheckpoint.value = nextCheckpoint
    checkpointSaved = true
    backupProgress.setStep('checkpoint', 'completed', '恢复前数据已保存在本机安全副本')

    if (hasWallpapers) {
      backupProgress.setStep('wallpapers', 'running', '正在创建壁纸回滚副本')
      await backupWallpapersForUndo()
      wallpaperUndoReady = true
      if (fromCheckpoint) {
        await restoreWallpapersSnapshot(backup.wallpaperImages || {})
      } else {
        await importWallpapersFromTransfer(backup.data.__wallpaper_images, 'replace', {
          onProgress: ({ current, total, stage }) => {
            backupProgress.setPartial({ 壁纸: `${current}/${total}` }, stage === 'committed' ? '壁纸已原子写入本机' : `已处理 ${current}/${total} 张壁纸`)
          },
        })
      }
      backupProgress.setStep('wallpapers', 'completed', '壁纸恢复完成')
    } else {
      backupProgress.setStep('wallpapers', 'completed', '未选择壁纸图片')
    }

    backupProgress.setStep('data', 'running', '正在写入所选分区')
    dataWriteStarted = true
    await restoreStoredValues(restoredValues)
    backupProgress.setStep('data', 'completed', '所选分区已恢复')
    if (wallpaperUndoReady) {
      try { await discardWallpaperUndo() } catch { /* durable checkpoint already protects the previous images */ }
    }
    backupProgress.setStep('finish', 'completed', '恢复完成，即将重新载入')
    backupProgress.finish(fromCheckpoint ? '本机恢复点已恢复' : '备份恢复完成')
    window.setTimeout(() => window.location.reload(), 700)
  } catch (reason) {
    // restoreStoredValues 负责原子回滚文字数据；保存恢复点失败时尚未写入数据。
    const rollbackFailed = dataWriteStarted && Boolean(reason?.rollbackFailed)
    let wallpaperRollbackFailed = false
    if (wallpaperUndoReady) {
      try { await restoreWallpaperUndo() } catch { wallpaperRollbackFailed = true }
    }
    if (checkpointSaved && !rollbackFailed && !wallpaperRollbackFailed) {
      try {
        if (previousCheckpoint) {
          await saveRestoreCheckpoint(previousCheckpoint)
          restoreCheckpoint.value = previousCheckpoint
        } else {
          await clearRestoreCheckpoint()
          restoreCheckpoint.value = null
        }
      } catch { /* the newly written checkpoint still contains the pre-restore state */ }
    }
    const detail = reason instanceof Error ? reason.message : '本机数据未能完成写入。'
    restoreError.value = rollbackFailed || wallpaperRollbackFailed
      ? `恢复失败，自动回滚未完成：${detail}。恢复前副本已保留，请使用本机恢复点重试。`
      : `恢复失败：${detail}。${dataWriteStarted || wallpaperUndoReady ? '已回滚本次修改。' : '当前数据未被替换。'}`
    restoring.value = false
    const running = backupProgress.state.steps.find((step) => step.status === 'running')?.id
    backupProgress.fail(running, restoreError.value, { retry: false })
  }
}

async function applyRestoreBackup() {
  const backup = restoreBackupTarget.value
  restoreBackupTarget.value = null
  if (backup) await applyRestorePayload(backup)
}

async function applyRestoreCheckpoint() {
  const checkpoint = restoreCheckpoint.value
  if (!checkpoint?.backup) return
  await applyRestorePayload({
    ...checkpoint.backup,
    selectedModules: [...(checkpoint.selectedModules || [])],
    wallpaperImages: checkpoint.wallpaperImages,
    storedValues: checkpoint.storedValues,
  }, { fromCheckpoint: true })
}

function abortBackup() {
  backupController?.abort()
  fileCheckGeneration += 1
  fileChecking.value = false
}

export function useDataManagerBackup() {
  if (!backupProgress) backupProgress = useTaskProgress()
  return {
    selectedBackup, selectedName, includeWallpapers, backupProgress, backupBusy, exporting, restoring, fileChecking, exportBackup, retryBackup, continueBackupResult, cancelBackup, abortBackup, selectFile, clearSelectedBackup, summary, restoreBackup, restoreSelection, restoreBackupTarget, restoreBackupModules, restoreBackupPreviewModules, restoreBackupPreviewOptions, restoreBackupMessage, restoreCheckpoint, restoreCheckpointLoading, restoreCheckpointError, restoreCheckpointModules, restoreCheckpointWallpapers, restoreCheckpointDate, restoreCheckpointMessage, refreshRestoreCheckpoint, applyRestoreBackup, applyRestoreCheckpoint,
  }
}
