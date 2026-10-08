import { computed, ref } from 'vue'
import {
  BACKUP_STORAGE_KEYS,
  completeBackupArchive,
  createBackupSnapshot,
  parseBackupArchive,
  restoreBackupModuleLabels,
} from './backupArchive.js'
import { markBackedUp } from './backupReminder.js'
import { buildBackupRestoreValues } from './backupRestore.js'
import {
  backupWallpapersForUndo,
  discardWallpaperUndo,
  exportWallpapersForTransfer,
  importWallpapersFromTransfer,
  restoreWallpaperUndo,
} from './wallpaperStorage.js'
import { restoreStoredValues } from './store'
import { getAppToday } from './timeContext.js'
import { useTaskProgress } from './taskProgress.js'
import { backupError, backupMessage, restoreError } from './dataManagerFeedback.js'

// 进度条等第一次被用到时才创建：useTaskProgress 会挂 onScopeDispose，
// 只有在主面板 setup 期间首次调用，才会挂到主面板的 scope 上、随它一起停表。
let backupProgress = null
let backupController = null

const selectedBackup = ref(null)
const selectedName = ref('')

const includeWallpapers = ref(false)

async function exportBackup() {
  backupError.value = ''
  backupMessage.value = ''
  const backup = createBackupSnapshot()
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
    backupError.value = '壁纸导出失败，已改为仅备份文字数据。'
    backupProgress.setStep('wallpapers', 'warning', '壁纸处理失败，将导出文字数据')
  }
  if (includeImages) backupProgress.setStep('file', 'running', '正在生成 JSON 备份文件')
  const archive = await completeBackupArchive(backup)
  const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = getAppToday()
  link.href = url
  link.download = `控制台备份-${date}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  backupMessage.value = backup.data.__wallpaper_images
    ? `备份文件已导出（含 ${Object.keys(backup.data.__wallpaper_images).length} 张壁纸），请妥善保存。`
    : '备份文件已导出，请妥善保存。'
  markBackedUp()
  if (includeImages) {
    backupProgress.setStep('file', 'completed', '备份文件已交给浏览器下载')
    backupProgress.finish(backupError.value ? '文字数据已导出，壁纸需要稍后重试' : '备份文件已生成', backupError.value ? 'warning' : 'completed')
  }
  if (backupController === controller) backupController = null
}

function retryBackup() {
  void exportBackup()
}

function continueBackupResult() {
  backupProgress.reset()
}

async function selectFile(event) {
  restoreError.value = ''
  selectedBackup.value = null
  const file = event.target.files?.[0]
  if (!file) return
  selectedName.value = file.name
  try {
    selectedBackup.value = await parseBackupArchive(JSON.parse(await file.text()))
  } catch (reason) {
    restoreError.value = reason instanceof Error ? reason.message : '无法读取这个备份文件'
  } finally {
    event.target.value = ''
  }
}

const summary = computed(() => {
  const data = selectedBackup.value?.data
  if (!data) return null
  return {
    wallpapers: data.__wallpaper_images ? Object.keys(data.__wallpaper_images).length : 0,
  }
})

// 恢复备份的确认。快照必须在打开对话框**之前**取：恢复预览里可以换文件，
// 若确认后才去读 selectedBackup，用户中途换了备份就会写错目标（弹窗套弹窗）。
const restoreBackupTarget = ref(null)

/**
 * 「这份备份会覆盖哪些模块」的**纯函数**版本（人话标签数组）。
 *
 * 【为什么必须算、不能写死】确认框原来写死的是"课程、重要日期和待办数据"，
 * 而 `applyRestoreBackup` 走的是 `buildBackupRestoreValues(data, providedFields, BACKUP_STORAGE_KEYS)`——
 * 按**备份携带的字段**恢复存储键：日程、专注记录、课程打卡、
 * 账本（账单/消费/分类/汇率/预算/模板）、清单、笔记、外观、壁纸、心情、氛围与提醒去重全都在内。
 * 写死的清单一定会随存储映射漂移，所以范围计算从三个真源反推：
 * `providedFields`（备份实际有哪些字段）× `BACKUP_STORAGE_KEYS`（字段→存储键）× `BACKUP_MODULES`（键→人话标签）。
 * 落在 `BACKUP_MODULES` 之外、但确实会被写回的键，统一归为「其它本机设置」，而不是假装没有。
 * 抽成纯函数是为了能直接对这张表写守卫（不必挂载组件）。
 */
const restoreBackupModules = computed(() => restoreBackupModuleLabels(restoreBackupTarget.value))
const restoreBackupPreviewModules = computed(() => restoreBackupModuleLabels(selectedBackup.value))

/** 恢复确认框的文案：与 `restoreBackupModules` 同源，改一处不会两处对不上。 */
const restoreBackupMessage = computed(() => {
  const labels = restoreBackupModules.value
  const scope = labels.length ? labels.join('、') : '这份备份实际携带的模块'
  const wallpaperCount = Object.keys(restoreBackupTarget.value?.data?.__wallpaper_images || {}).length
  const wallpapers = wallpaperCount ? `，另含 ${wallpaperCount} 张壁纸图片` : ''
  return `恢复会用这份备份里的内容覆盖当前浏览器中的本机数据，范围是：${scope}${wallpapers}。备份里没有的模块保持原样；本机现有数据会被替换，且无法撤销。是否继续？`
})

function restoreBackup() {
  const backup = selectedBackup.value
  if (!backup) return
  restoreBackupTarget.value = backup
}

async function applyRestoreBackup() {
  const backup = restoreBackupTarget.value
  restoreBackupTarget.value = null
  if (!backup) return

  const { data } = backup
  // 校验层会为旧备份补齐显示用默认值；恢复时只能写入原文件实际携带的字段，
  // 避免用空默认值覆盖当前版本后来新增的模块。
  const restoredValues = buildBackupRestoreValues(data, backup.providedFields, BACKUP_STORAGE_KEYS)
  const previous = Object.fromEntries(
    Object.keys(restoredValues).map((key) => [key, localStorage.getItem(key)])
  )
  const hasWallpapers = Boolean(data.__wallpaper_images && Object.keys(data.__wallpaper_images).length)
  if (hasWallpapers) {
    backupProgress.start({
      title: '正在恢复备份',
      steps: [
        { id: 'validate', label: '校验备份内容' },
        { id: 'wallpapers', label: '创建恢复点并恢复壁纸' },
        { id: 'data', label: '恢复文字数据与设置' },
        { id: 'finish', label: '完成并重新载入' },
      ],
    })
    backupProgress.setStep('validate', 'completed', '备份格式和必要字段检查通过')
  }
  let wallpaperUndoReady = false
  try {
    if (data.__wallpaper_images) {
      backupProgress.setStep('wallpapers', 'running', '正在创建现有壁纸恢复点')
      await backupWallpapersForUndo()
      wallpaperUndoReady = true
      await importWallpapersFromTransfer(data.__wallpaper_images, 'replace', {
        onProgress: ({ current, total, stage }) => {
          backupProgress.setPartial({ 壁纸: `${current}/${total}` }, stage === 'committed' ? '壁纸已原子写入本机' : `已处理 ${current}/${total} 张壁纸`)
        },
      })
      backupProgress.setStep('wallpapers', 'completed', '壁纸恢复完成')
      backupProgress.setStep('data', 'running', '正在写入文字数据与设置')
    }
    // 文字数据最后提交。它自身会同时回滚 localStorage 和已创建的响应式引用，
    // 因此任一阶段失败都不会留下“半套备份”。
    await restoreStoredValues(restoredValues)
    if (hasWallpapers) {
      try { await discardWallpaperUndo() } catch {}
      backupProgress.setStep('data', 'completed', '文字数据与设置已恢复')
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
    if (wallpaperUndoReady) {
      try { await restoreWallpaperUndo() } catch {}
    }
    restoreError.value = '恢复失败，浏览器可能已禁止本地存储或存储空间不足'
    if (hasWallpapers) {
      const running = backupProgress.state.steps.find((step) => step.status === 'running')?.id
      backupProgress.fail(running, reason instanceof Error ? reason.message : restoreError.value, { retry: false })
    }
  }
}

function abortBackup() {
  backupController?.abort()
}

export function useDataManagerBackup() {
  if (!backupProgress) backupProgress = useTaskProgress()
  return {
    selectedBackup, selectedName, includeWallpapers, backupProgress, exportBackup, retryBackup, continueBackupResult, abortBackup, selectFile, summary, restoreBackup, restoreBackupTarget, restoreBackupModules, restoreBackupPreviewModules, restoreBackupMessage, applyRestoreBackup,
  }
}
