import { computed, ref } from 'vue'
import { accountUser } from './accountAuth.js'
import { clearAccountLocalData, withAccountDataLock } from './accountLocalData.js'
import { captureAccountDataIdentity, setAccountDataOwner } from './accountSyncIdentity.js'
import { clearRestoreCheckpoint } from './dataVault.js'
import { clearStoredDataByPrefix, flushStoredWrites } from './store/core.js'
import { clearAllWallpapers } from './wallpaperStorage.js'
import { needsBackup } from './backupReminder.js'

/**
 * 清空这台设备上的全部本机数据。
 *
 * 【为什么需要它】在此之前，清空本机记录的唯一入口是「退出账号」——
 * 而退出账号一定会清数据，没有别的选择。于是这几种人被困住了：
 *
 *  - 还没登录、只想把试用数据清干净的人（没有账号可退）；
 *  - 想保留账号、但要把这台共用设备上的记录清掉的人（退出即丢失）；
 *  - 已经退出、但换了浏览器还想继续清的人。
 *
 * 三个人都只能去清除浏览器网站数据 —— 那会连主题、同步设置和账号会话
 * 一起抹掉，而且恢复点也没了。
 *
 * 【它做什么】按 `sl_` 前缀清本机记录、账号本机副本、壁纸图片和恢复点。
 * 【它不做什么】不登出账号、不删云端快照、不碰非 `sl_` 的应用设置。
 */
export function useLocalDataPurge() {
  const purging = ref(false)
  const error = ref('')
  const signedIn = computed(() => Boolean(accountUser.value?.id))
  /** 清空前必须先导出：这一步没有撤销，也没有云端副本可以兜底。 */
  const shouldWarnBackup = computed(() => needsBackup.value)

  async function purgeLocalData() {
    if (purging.value) return { ok: false, message: '正在清空，请稍候。' }
    error.value = ''
    purging.value = true
    try {
      const identity = captureAccountDataIdentity()
      const ownerId = identity.userId || identity.ownerId || 'guest'
      await withAccountDataLock(async (assertLock) => {
        assertLock()
        const flush = flushStoredWrites()
        // 有没写下去的修改时停下来：清空会把它们一起丢掉，而用户
        // 此刻看到的界面并没有提示这些修改尚未保存。
        if (!flush.ok) throw new Error(`存在未能保存的本机修改（${flush.pendingKeys.join('、')}），已保留数据并取消清空。`)
        await clearAccountLocalData()
        assertLock()
        await clearStoredDataByPrefix('sl_')
        assertLock()
        // 壁纸在独立的 IndexedDB 里，不在 sl_ 前缀下。以前连退出账号都漏掉它，
        // 于是「清空数据」之后图片还留在设备上。
        await clearAllWallpapers()
        // 恢复点同理：清空之后它要是还在，用户就能一路撤回回到被清掉之前。
        await clearRestoreCheckpoint(ownerId).catch(() => {})
        setAccountDataOwner('')
      })
      if (typeof window !== 'undefined') window.location.reload()
      return { ok: true }
    } catch (cause) {
      error.value = cause?.message || '清空没有完成，请重试。'
      return { ok: false, message: error.value }
    } finally {
      purging.value = false
    }
  }

  /** 确认框文案：说清楚删什么、不删什么，以及唯一的退路是什么。 */
  const confirmMessage = computed(() => {
    const scope = '课程、待办、日程、账本、专注、清单、地点记录、通知档案等全部本机记录，以及账号本机副本、壁纸图片和本机恢复点'
    const cloud = signedIn.value
      ? '云端已同步的记录不会删除，其它设备不受影响；本机同步会在重新载入后重新开始。'
      : '本机没有账号副本可删，清空后需要重新登录并重新同步。'
    const backup = shouldWarnBackup.value
      ? '还没有近期备份，清空后无法找回。建议先取消、导出完整备份，再回来清空。'
      : '这一步没有撤销。清空后只能靠已导出的备份文件恢复。'
    return `将清除：${scope}。不会清除：账号登录状态与应用设置。${cloud}${backup}`
  })

  return { purging, error, signedIn, shouldWarnBackup, confirmMessage, purgeLocalData }
}