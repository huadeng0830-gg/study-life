import { registerSW } from 'virtual:pwa-register'
import { ref } from 'vue'

let registration = null
let updateSW = () => Promise.resolve()
let updateInFlight = null
let lastSilentCheckAt = 0
let applyingUpdate = false
const SILENT_CHECK_INTERVAL = 10 * 60 * 1000
export const updateMessage = ref('')

updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    if (applyingUpdate) return
    applyingUpdate = true
    updateMessage.value = '发现新版本，正在更新…'
    void updateSW(true)
  },
  onRegisteredSW(_url, value) {
    registration = value
  },
})

export async function checkForAppUpdate(showResult = true) {
  if (!navigator.onLine) {
    if (showResult) updateMessage.value = '当前没有网络，暂时无法检查更新'
    return false
  }
  if (!registration) {
    if (showResult) updateMessage.value = '更新服务正在准备，请稍后再试'
    return false
  }
  const now = Date.now()
  if (!showResult && now - lastSilentCheckAt < SILENT_CHECK_INTERVAL) return false
  if (updateInFlight) return updateInFlight
  try {
    if (showResult) updateMessage.value = '正在检查新版本…'
    lastSilentCheckAt = now
    updateInFlight = registration.update()
    await updateInFlight
    if (showResult && updateMessage.value === '正在检查新版本…') {
      updateMessage.value = '已是最新版本'
      window.setTimeout(() => {
        if (updateMessage.value === '已是最新版本') updateMessage.value = ''
      }, 3000)
    }
    return true
  } catch {
    if (showResult) updateMessage.value = '检查失败，请确认网络后重试'
    return false
  } finally {
    updateInFlight = null
  }
}

function silentCheck() {
  void checkForAppUpdate(false)
}

window.addEventListener('focus', silentCheck)
window.addEventListener('online', silentCheck)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') silentCheck()
})
window.setTimeout(silentCheck, 30 * 1000)
window.setInterval(silentCheck, 30 * 60 * 1000)
