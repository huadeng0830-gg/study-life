import { computed } from 'vue'
import { useStoredRef } from './store'

// iPhone 上主屏幕网页应用的本地存储可能被系统清空（杀后台/删除图标），
// 用"距上次备份的天数"驱动红点提醒，降低数据丢失风险。
const REMIND_AFTER_DAYS = 7
const DAY_MS = 86400000

export const lastBackupAt = useStoredRef('sl_last_backup_at', '')

export const backupReminderTitle = computed(() => {
  if (!lastBackupAt.value) return '尚未备份'
  const time = new Date(lastBackupAt.value).getTime()
  return Number.isFinite(time) ? '已有 7 天未备份' : '备份时间无法识别'
})

export const needsBackup = computed(() => {
  if (!lastBackupAt.value) return true
  const time = new Date(lastBackupAt.value).getTime()
  if (!Number.isFinite(time)) return true
  return Date.now() - time > REMIND_AFTER_DAYS * DAY_MS
})

export function markBackedUp() {
  lastBackupAt.value = new Date().toISOString()
}
